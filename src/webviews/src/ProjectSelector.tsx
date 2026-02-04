import React, { useEffect, useState, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { FolderSearch, RefreshCw, FolderOpen, Loader2, AlertCircle } from 'lucide-react'
import { Button } from './lib/components/ui/button'
import { ScrollArea } from './lib/components/ui/scroll-area'
import { ProjectCard } from './lib/components/ProjectCard'
import { useProjectMessages } from './lib/hooks/useProjectMessages'
import type { UnityProjectInfo, ProjectResponseType } from './lib/types/project'

function ProjectSelector() {
  const navigate = useNavigate()
  const [projects, setProjects] = useState<UnityProjectInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [checkingProject, setCheckingProject] = useState<string | null>(null)
  const initialLoadDone = useRef(false)

  const handleMessage = useCallback(
    (response: ProjectResponseType) => {
      switch (response.type) {
        case 'unityProjects':
          setProjects(response.projects)
          setLoading(false)
          setError(null)
          break

        case 'unityProjectsLoading':
          setLoading(true)
          setError(null)
          break

        case 'unityProjectsError':
          setError(response.error)
          setLoading(false)
          break

        case 'packageStatus':
          // Update project with installation status
          setProjects(prev =>
            prev.map(p =>
              p.path === response.projectPath
                ? { ...p, movesiaInstalled: response.installed, movesiaVersion: response.version }
                : p
            )
          )
          setCheckingProject(null)
          break

        case 'browseResult':
          if (response.project) {
            // Add the new project to the list if not already present
            setProjects(prev => {
              const exists = prev.some(p => p.path === response.project!.path)
              if (exists) {
                return prev.map(p =>
                  p.path === response.project!.path ? response.project! : p
                )
              }
              return [...prev, response.project!]
            })
          }
          break

        // Note: 'selectedProject' response is handled but we navigate directly in handleProjectClick
        // so we don't need to handle it here
      }
    },
    []
  )

  const { getUnityProjects, checkPackageStatus, setSelectedProject, browseForProject } =
    useProjectMessages(handleMessage)

  // Load projects only once on mount
  useEffect(() => {
    if (!initialLoadDone.current) {
      initialLoadDone.current = true
      getUnityProjects()
    }
  }, [getUnityProjects])

  const handleRefresh = () => {
    setLoading(true)
    setError(null)
    getUnityProjects()
  }

  const handleProjectClick = (project: UnityProjectInfo) => {
    console.log('[ProjectSelector] handleProjectClick called', project)

    // Set the selected project (for persistence)
    setSelectedProject(project.path)

    // Simple routing based on package installation:
    // - Package installed → go to ChatView (ChatView will check if Unity is open)
    // - Package not installed → go to InstallPackage
    if (project.movesiaInstalled) {
      console.log('[ProjectSelector] Package installed -> /chatView')
      navigate('/chatView')
    } else {
      console.log('[ProjectSelector] Package not installed -> /installPackage')
      navigate('/installPackage', { state: { project } })
    }
  }

  const handleBrowse = () => {
    browseForProject()
  }

  return (
    <div className="flex flex-col h-screen bg-vscode-editor-background text-vscode-foreground">
      {/* Header */}
      <header className="flex-shrink-0 px-6 py-5 border-b border-vscode-panel-border">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-vscode-textLink-foreground/10">
            <FolderSearch className="w-5 h-5 text-vscode-textLink-foreground" />
          </div>
          <div>
            <h1 className="text-lg font-semibold">Select Unity Project</h1>
            <p className="text-sm text-vscode-descriptionForeground">
              Choose a project to connect with Movesia AI
            </p>
          </div>
        </div>
      </header>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {loading ? (
          <div className="flex flex-col items-center justify-center h-full gap-3">
            <Loader2 className="w-8 h-8 animate-spin text-vscode-textLink-foreground" />
            <p className="text-sm text-vscode-descriptionForeground">Scanning for Unity projects...</p>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center h-full gap-4 px-6">
            <AlertCircle className="w-12 h-12 text-vscode-errorForeground" />
            <div className="text-center">
              <h2 className="font-medium text-vscode-errorForeground">Failed to load projects</h2>
              <p className="text-sm text-vscode-descriptionForeground mt-1">{error}</p>
            </div>
            <Button variant="outline" onClick={handleRefresh}>
              <RefreshCw className="w-4 h-4 mr-2" />
              Try Again
            </Button>
          </div>
        ) : projects.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-4 px-6">
            <FolderSearch className="w-12 h-12 text-vscode-descriptionForeground" />
            <div className="text-center">
              <h2 className="font-medium">No Unity projects found</h2>
              <p className="text-sm text-vscode-descriptionForeground mt-1">
                We couldn't find any Unity projects in Unity Hub.
                <br />
                Try browsing for a project manually.
              </p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={handleBrowse}>
                <FolderOpen className="w-4 h-4 mr-2" />
                Browse...
              </Button>
              <Button variant="ghost" onClick={handleRefresh}>
                <RefreshCw className="w-4 h-4 mr-2" />
                Refresh
              </Button>
            </div>
          </div>
        ) : (
          <ScrollArea className="h-full">
            <div className="p-4 space-y-3">
              {projects.map(project => (
                <ProjectCard
                  key={project.path}
                  project={project}
                  onClick={() => handleProjectClick(project)}
                  isLoading={checkingProject === project.path}
                  disabled={checkingProject !== null}
                />
              ))}
            </div>
          </ScrollArea>
        )}
      </div>

      {/* Footer */}
      {!loading && !error && projects.length > 0 && (
        <footer className="flex-shrink-0 px-4 py-3 border-t border-vscode-panel-border">
          <div className="flex justify-between items-center">
            <Button variant="ghost" size="sm" onClick={handleBrowse}>
              <FolderOpen className="w-4 h-4 mr-2" />
              Browse...
            </Button>
            <Button variant="ghost" size="sm" onClick={handleRefresh}>
              <RefreshCw className="w-4 h-4 mr-2" />
              Refresh
            </Button>
          </div>
        </footer>
      )}
    </div>
  )
}

export default ProjectSelector
