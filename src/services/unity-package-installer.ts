import { promises as fs } from 'fs'
import * as path from 'path'

export interface InstallResult {
  success: boolean
  alreadyInstalled?: boolean
  upgraded?: boolean
  previousVersion?: string
  installedVersion?: string
  error?: string
}

export interface InstalledPackageInfo {
  installed: boolean
  version?: string
  path?: string
}

interface PackageJson {
  name: string
  version: string
  displayName?: string
  dependencies?: Record<string, string>
}

interface ManifestJson {
  dependencies: Record<string, string>
  [key: string]: unknown
}

const PACKAGE_NAME = 'com.movesia.unity'
const NATIVE_WEBSOCKET_DEPENDENCY = 'com.endel.nativewebsocket'
const NATIVE_WEBSOCKET_URL = 'https://github.com/endel/NativeWebSocket.git#upm'

export class UnityPackageInstaller {
  private packageSourceDir: string

  constructor(extensionPath: string) {
    this.packageSourceDir = path.join(
      extensionPath,
      'unity-package',
      PACKAGE_NAME
    )
  }

  /**
   * Check if the package is installed in the given Unity project
   */
  async checkInstallation(projectPath: string): Promise<InstalledPackageInfo> {
    const packageDir = path.join(projectPath, 'Packages', PACKAGE_NAME)
    const packageJsonPath = path.join(packageDir, 'package.json')

    try {
      const exists = await this.directoryExists(packageDir)
      if (!exists) {
        return { installed: false }
      }

      // Try to read the version from package.json
      try {
        const content = await fs.readFile(packageJsonPath, 'utf-8')
        const packageJson: PackageJson = JSON.parse(content)
        return {
          installed: true,
          version: packageJson.version,
          path: packageDir,
        }
      } catch {
        // Package folder exists but no valid package.json
        return {
          installed: true,
          path: packageDir,
        }
      }
    } catch {
      return { installed: false }
    }
  }

  /**
   * Get the version of the bundled package
   */
  async getBundledVersion(): Promise<string | null> {
    try {
      const packageJsonPath = path.join(this.packageSourceDir, 'package.json')
      const content = await fs.readFile(packageJsonPath, 'utf-8')
      const packageJson: PackageJson = JSON.parse(content)
      return packageJson.version
    } catch {
      return null
    }
  }

  /**
   * Install the Unity package to the given project
   */
  async install(
    projectPath: string,
    options?: { force?: boolean }
  ): Promise<InstallResult> {
    const { force = false } = options ?? {}

    try {
      // Validate source package exists
      const sourceExists = await this.directoryExists(this.packageSourceDir)
      if (!sourceExists) {
        return {
          success: false,
          error: `Bundled package not found at: ${this.packageSourceDir}`,
        }
      }

      // Validate Unity project
      const validationError = await this.validateUnityProject(projectPath)
      if (validationError) {
        return { success: false, error: validationError }
      }

      // Check current installation status
      const currentInstall = await this.checkInstallation(projectPath)
      const bundledVersion = await this.getBundledVersion()

      // Determine if we should skip (already installed, same version, no force)
      if (
        currentInstall.installed &&
        currentInstall.version &&
        bundledVersion &&
        currentInstall.version === bundledVersion &&
        !force
      ) {
        return {
          success: true,
          alreadyInstalled: true,
          installedVersion: currentInstall.version,
        }
      }

      const isUpgrade = !!(currentInstall.installed && currentInstall.version)
      const previousVersion = currentInstall.version

      // Copy package files
      const targetDir = path.join(projectPath, 'Packages', PACKAGE_NAME)
      await this.copyPackageFiles(targetDir)

      // Update manifest.json
      await this.updateManifest(projectPath)

      return {
        success: true,
        upgraded: isUpgrade,
        previousVersion: isUpgrade ? previousVersion : undefined,
        installedVersion: bundledVersion ?? undefined,
      }
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : 'Unknown error occurred'
      return {
        success: false,
        error: errorMessage,
      }
    }
  }

  /**
   * Uninstall the package from the given project
   */
  async uninstall(
    projectPath: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const packageDir = path.join(projectPath, 'Packages', PACKAGE_NAME)

      // Check if installed
      const exists = await this.directoryExists(packageDir)
      if (!exists) {
        return { success: true } // Already not installed
      }

      // Remove the package folder
      await fs.rm(packageDir, { recursive: true, force: true })

      // Remove from manifest.json
      await this.removeFromManifest(projectPath)

      return { success: true }
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : 'Unknown error occurred'
      return { success: false, error: errorMessage }
    }
  }

  /**
   * Validate that the given path is a valid Unity project
   */
  private async validateUnityProject(projectPath: string): Promise<string | null> {
    // Check project path exists
    if (!(await this.directoryExists(projectPath))) {
      return `Project path does not exist: ${projectPath}`
    }

    // Check Assets folder exists
    const assetsPath = path.join(projectPath, 'Assets')
    if (!(await this.directoryExists(assetsPath))) {
      return 'Invalid Unity project: Assets folder not found'
    }

    // Check ProjectSettings folder exists
    const settingsPath = path.join(projectPath, 'ProjectSettings')
    if (!(await this.directoryExists(settingsPath))) {
      return 'Invalid Unity project: ProjectSettings folder not found'
    }

    // Check Packages folder exists (create if not)
    const packagesPath = path.join(projectPath, 'Packages')
    if (!(await this.directoryExists(packagesPath))) {
      await fs.mkdir(packagesPath, { recursive: true })
    }

    // Check manifest.json exists
    const manifestPath = path.join(packagesPath, 'manifest.json')
    try {
      await fs.access(manifestPath)
    } catch {
      return 'Invalid Unity project: Packages/manifest.json not found'
    }

    return null
  }

  /**
   * Copy the package files to the target directory
   */
  private async copyPackageFiles(targetDir: string): Promise<void> {
    // Remove existing if present
    if (await this.directoryExists(targetDir)) {
      await fs.rm(targetDir, { recursive: true, force: true })
    }

    // Create target directory
    await fs.mkdir(targetDir, { recursive: true })

    // Recursively copy all files
    await this.copyDirectoryRecursive(this.packageSourceDir, targetDir)
  }

  /**
   * Recursively copy a directory and all its contents
   */
  private async copyDirectoryRecursive(
    source: string,
    target: string
  ): Promise<void> {
    const entries = await fs.readdir(source, { withFileTypes: true })

    for (const entry of entries) {
      const sourcePath = path.join(source, entry.name)
      const targetPath = path.join(target, entry.name)

      if (entry.isDirectory()) {
        await fs.mkdir(targetPath, { recursive: true })
        await this.copyDirectoryRecursive(sourcePath, targetPath)
      } else {
        await fs.copyFile(sourcePath, targetPath)
      }
    }
  }

  /**
   * Update the Unity project's manifest.json to include our package
   */
  private async updateManifest(projectPath: string): Promise<void> {
    const manifestPath = path.join(projectPath, 'Packages', 'manifest.json')

    // Read existing manifest
    const content = await fs.readFile(manifestPath, 'utf-8')
    let manifest: ManifestJson

    try {
      manifest = JSON.parse(content)
    } catch {
      throw new Error('Failed to parse manifest.json: invalid JSON')
    }

    // Ensure dependencies object exists
    if (!manifest.dependencies) {
      manifest.dependencies = {}
    }

    let modified = false

    // Add our package reference (local file reference)
    if (!manifest.dependencies[PACKAGE_NAME]) {
      manifest.dependencies[PACKAGE_NAME] = `file:${PACKAGE_NAME}`
      modified = true
    }

    // Add NativeWebSocket dependency (git URL)
    if (!manifest.dependencies[NATIVE_WEBSOCKET_DEPENDENCY]) {
      manifest.dependencies[NATIVE_WEBSOCKET_DEPENDENCY] = NATIVE_WEBSOCKET_URL
      modified = true
    }

    // Write back if modified
    if (modified) {
      await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
    }
  }

  /**
   * Remove our package from the manifest.json
   */
  private async removeFromManifest(projectPath: string): Promise<void> {
    const manifestPath = path.join(projectPath, 'Packages', 'manifest.json')

    try {
      const content = await fs.readFile(manifestPath, 'utf-8')
      const manifest: ManifestJson = JSON.parse(content)

      if (manifest.dependencies) {
        let modified = false

        if (manifest.dependencies[PACKAGE_NAME]) {
          delete manifest.dependencies[PACKAGE_NAME]
          modified = true
        }

        // Optionally remove NativeWebSocket if we added it
        // (keeping it for now as other packages might use it)

        if (modified) {
          await fs.writeFile(
            manifestPath,
            JSON.stringify(manifest, null, 2) + '\n'
          )
        }
      }
    } catch {
      // Ignore errors when removing from manifest
    }
  }

  /**
   * Check if a directory exists
   */
  private async directoryExists(dirPath: string): Promise<boolean> {
    try {
      const stat = await fs.stat(dirPath)
      return stat.isDirectory()
    } catch {
      return false
    }
  }
}

/**
 * Create an installer instance for the given extension context
 */
export function createInstaller(extensionPath: string): UnityPackageInstaller {
  return new UnityPackageInstaller(extensionPath)
}
