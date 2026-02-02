import { promises as fs } from 'fs'
import * as path from 'path'
import * as os from 'os'

export type UnityProject = {
  path: string
  name: string
  editorVersion?: string
}

async function isDir(p: string) {
  try {
    return (await fs.stat(p)).isDirectory()
  } catch {
    return false
  }
}

async function readEditorVersion(projectDir: string) {
  try {
    const txt = await fs.readFile(
      path.join(projectDir, 'ProjectSettings', 'ProjectVersion.txt'),
      'utf8'
    )
    const m = txt.match(/m_EditorVersion:\s*([^\s]+)/)
    return m?.[1]
  } catch {
    return undefined
  }
}

export async function isUnityProject(
  projectDir: string
): Promise<(UnityProject & { productGUID?: string }) | null> {
  const hasAssets = await isDir(path.join(projectDir, 'Assets'))
  const hasProjectSettings = await isDir(
    path.join(projectDir, 'ProjectSettings')
  )

  if (!hasAssets || !hasProjectSettings) {
    return null
  }

  // Optional extra confidence: Packages/manifest.json exists
  try {
    await fs.access(path.join(projectDir, 'Packages', 'manifest.json'))
  } catch {
    // Optional check, ignore if missing
  }

  const editorVersion = await readEditorVersion(projectDir)
  const productGUID = await readProductGUID(projectDir)
  const name = path.basename(projectDir)
  return { path: projectDir, name, editorVersion, productGUID }
}

function hubProjectsJsonCandidates(): string[] {
  const out: string[] = []
  if (process.platform === 'win32' && process.env.APPDATA) {
    out.push(path.join(process.env.APPDATA, 'UnityHub', 'projects-v1.json'))
  } else if (process.platform === 'darwin') {
    out.push(
      path.join(
        os.homedir(),
        'Library',
        'Application Support',
        'UnityHub',
        'projects-v1.json'
      )
    )
  } else {
    out.push(path.join(os.homedir(), '.config', 'UnityHub', 'projects-v1.json'))
  }
  return out
}

export async function readHubRecentPaths(): Promise<string[]> {
  const candidates = hubProjectsJsonCandidates()

  for (const p of candidates) {
    try {
      const fileContent = await fs.readFile(p, 'utf8')
      const json = JSON.parse(fileContent)

      const paths = new Set<string>()
      const pushIf = (v: unknown) => {
        if (typeof v === 'string') {
          paths.add(v)
        }
      }

      // Modern Unity Hub format (v1 schema)
      if (
        json?.schema_version === 'v1' &&
        json?.data &&
        typeof json.data === 'object'
      ) {
        // In this format, the keys of the "data" object are the project paths
        const projectEntries = Object.entries(json.data)

        for (const [projectPath, projectInfo] of projectEntries) {
          // Add the key (project path) directly
          pushIf(projectPath)

          // Also check if there's a path property inside (for redundancy)
          if (
            projectInfo &&
            typeof projectInfo === 'object' &&
            'path' in projectInfo
          ) {
            pushIf((projectInfo as Record<string, unknown>).path)
          }
        }
      }

      // Legacy formats
      if (Array.isArray(json)) {
        json.forEach(it => pushIf(it?.path))
      }

      if (json?.projects && Array.isArray(json.projects)) {
        json.projects.forEach((it: unknown) =>
          pushIf((it as Record<string, unknown>)?.path)
        )
      }

      return [...paths]
    } catch (_error) {
      // Try next candidate
    }
  }

  return []
}

export async function findUnityProjects(
  extraRoots: string[] = []
): Promise<UnityProject[]> {
  const results: UnityProject[] = []
  const seen = new Set<string>()

  // 1) Hub list
  const hubPaths = await readHubRecentPaths()

  for (const p of hubPaths) {
    const proj = await isUnityProject(p)
    if (proj && !seen.has(proj.path)) {
      seen.add(proj.path)
      results.push(proj)
    }
  }

  // 2) User-provided roots (shallow scan)
  async function scan(root: string, depth = 2) {
    try {
      const entries = await fs.readdir(root, { withFileTypes: true })
      for (const e of entries) {
        if (!e.isDirectory()) continue
        const full = path.join(root, e.name)
        const proj = await isUnityProject(full)
        if (proj && !seen.has(proj.path)) {
          seen.add(proj.path)
          results.push(proj)
          continue
        }
        if (depth > 0) await scan(full, depth - 1)
      }
    } catch (_error) {
      // Ignore scanning errors for bad roots
    }
  }

  for (const r of extraRoots) {
    await scan(r, 2)
  }

  return results
}

export async function readProductGUID(
  projectDir: string
): Promise<string | undefined> {
  try {
    // ProjectSettings/ProjectSettings.asset is YAML-ish; fish out productGUID line
    const txt = await fs.readFile(
      path.join(projectDir, 'ProjectSettings', 'ProjectSettings.asset'),
      'utf8'
    )
    // Typical line: productGUID: 00000000000000000000000000000000
    const m = txt.match(/^\s*productGUID:\s*([0-9a-fA-F-]{16,})/m)
    return m?.[1]?.toLowerCase()
  } catch {
    return undefined
  }
}

export async function enrichWithProductGUID(projects: UnityProject[]) {
  return Promise.all(
    projects.map(
      async p =>
        ({
          ...p,
          productGUID: await readProductGUID(p.path),
        } as UnityProject & { productGUID?: string })
    )
  )
}

/**
 * Find a Unity project by its normalized productGUID
 */
export async function findByProductGuid(
  normalizedGuid: string
): Promise<string | undefined> {
  try {
    const projects = await findUnityProjects()
    const enriched = await enrichWithProductGUID(projects)

    for (const project of enriched) {
      if (project.productGUID) {
        // Normalize the project GUID (remove dashes, lowercase)
        const normalized = project.productGUID.replace(/-/g, '').toLowerCase()
        if (normalized === normalizedGuid) {
          return project.path
        }
      }
    }

    return undefined
  } catch (error) {
    console.warn('Failed to find project by productGUID:', error)
    return undefined
  }
}

/**
 * Normalize Unity version to docs format (major.minor only)
 * Examples:
 *   "6000.2.6f1" -> "6000.2"
 *   "2022.3.18f1" -> "2022.3"
 *   "2021.3" -> "2021.3"
 */
export function normalizeUnityVersionForDocs(version: string): string {
  // Extract major.minor from version string (remove patch, build, and suffixes)
  const match = version.match(/^(\d+\.\d+)/)
  if (!match) {
    console.warn(`⚠️ Could not normalize Unity version: ${version}`)
    return version
  }
  return match[1]
}
