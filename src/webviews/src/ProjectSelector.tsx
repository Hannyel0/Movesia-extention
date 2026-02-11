import React, { useEffect, useState, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { RefreshCw, FolderOpen, Loader2, AlertCircle, Search } from 'lucide-react'
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
  const [unityRunning, setUnityRunning] = useState<Record<string, boolean>>({})
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

        case 'unityRunningStatus':
          setUnityRunning(prev => ({
            ...prev,
            [response.projectPath]: response.isRunning,
          }))
          break
      }
    },
    []
  )

  const { getUnityProjects, checkPackageStatus, setSelectedProject, browseForProject, checkUnityRunning } =
    useProjectMessages(handleMessage)

  useEffect(() => {
    if (!initialLoadDone.current) {
      initialLoadDone.current = true
      getUnityProjects()
    }
  }, [getUnityProjects])

  // Check Unity running status for each project when the list loads
  useEffect(() => {
    if (projects.length > 0) {
      projects.forEach(p => checkUnityRunning(p.path))
    }
  }, [projects, checkUnityRunning])

  const handleRefresh = () => {
    setLoading(true)
    setError(null)
    getUnityProjects()
  }

  const handleProjectClick = (project: UnityProjectInfo) => {
    console.log('[ProjectSelector] handleProjectClick called', project)
    setSelectedProject(project.path)

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
    <div className="flex flex-col h-screen bg-vscode-sideBar-background text-vscode-foreground">
      <div className="flex-1 flex flex-col items-center px-6 pt-10">
        <div className="w-full max-w-sm">
          {/* Header */}
          <h1 className="text-lg font-semibold tracking-tight text-center mb-8">Select Project</h1>

          {/* Content */}
          {loading ? (
            <div className="flex flex-col items-center py-16 gap-3">
              <Loader2 className="w-6 h-6 animate-spin text-vscode-textLink-foreground" />
              <p className="text-xs text-vscode-descriptionForeground">
                Scanning for Unity projects...
              </p>
            </div>
          ) : error ? (
            <div className="flex flex-col items-center py-16 gap-4">
              <div className="flex items-center justify-center w-10 h-10 rounded-full bg-vscode-errorForeground/10">
                <AlertCircle className="w-5 h-5 text-vscode-errorForeground" />
              </div>
              <div className="text-center">
                <p className="text-sm font-medium text-vscode-errorForeground">
                  Failed to load projects
                </p>
                <p className="text-xs text-vscode-descriptionForeground mt-1">{error}</p>
              </div>
              <Button variant="outline" size="sm" onClick={handleRefresh}>
                <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
                Try Again
              </Button>
            </div>
          ) : projects.length === 0 ? (
            <div className="flex flex-col items-center py-16 gap-4">
              <div className="flex items-center justify-center w-10 h-10 rounded-full bg-vscode-descriptionForeground/10">
                <Search className="w-5 h-5 text-vscode-descriptionForeground" />
              </div>
              <div className="text-center">
                <p className="text-sm font-medium">No projects found</p>
                <p className="text-xs text-vscode-descriptionForeground mt-1">
                  We couldn't detect any Unity projects.
                  <br />
                  Browse for one manually.
                </p>
              </div>
              <div className="flex gap-2">
                <Button size="sm" onClick={handleBrowse}>
                  <FolderOpen className="w-3.5 h-3.5 mr-1.5" />
                  Browse
                </Button>
                <Button variant="ghost" size="sm" onClick={handleRefresh}>
                  <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
                  Refresh
                </Button>
              </div>
            </div>
          ) : (
            <>
              {/* Project list header */}
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs text-vscode-descriptionForeground">
                  {projects.length} project{projects.length !== 1 ? 's' : ''} found
                </p>
                <div className="flex gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={handleRefresh}
                    title="Refresh"
                  >
                    <RefreshCw className="w-3 h-3" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={handleBrowse}
                    title="Browse for project"
                  >
                    <FolderOpen className="w-3 h-3" />
                  </Button>
                </div>
              </div>

              {/* Project list */}
              <ScrollArea className="max-h-[calc(100vh-260px)]">
                <div className="space-y-1.5">
                  {projects.map(project => (
                    <ProjectCard
                      key={project.path}
                      project={project}
                      onClick={() => handleProjectClick(project)}
                      isLoading={checkingProject === project.path}
                      disabled={checkingProject !== null}
                      unityRunning={unityRunning[project.path] ?? false}
                    />
                  ))}
                </div>
              </ScrollArea>
            </>
          )}
        </div>
      </div>

      {/* Footer */}
      <footer className="flex-shrink-0 py-4 px-6">
        <p className="text-center text-xs text-vscode-descriptionForeground">
          Projects are detected from Unity Hub
        </p>
      </footer>
    </div>
  )
}

export default ProjectSelector
