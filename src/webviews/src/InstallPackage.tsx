import React, { useState, useCallback, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { Package, ArrowLeft, Loader2, CheckCircle, XCircle, Folder } from 'lucide-react'
import { Button } from './lib/components/ui/button'
import { useProjectMessages } from './lib/hooks/useProjectMessages'
import type { UnityProjectInfo, ProjectResponseType } from './lib/types/project'
import { cn } from './lib/utils'

type InstallState = 'idle' | 'installing' | 'success' | 'error'

function InstallPackage() {
  const navigate = useNavigate()
  const location = useLocation()
  const [installState, setInstallState] = useState<InstallState>('idle')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [installedVersion, setInstalledVersion] = useState<string | null>(null)

  // Get project from navigation state
  const project = (location.state as { project?: UnityProjectInfo })?.project
  const projectPath = project?.path || (location.state as { projectPath?: string })?.projectPath

  const handleMessage = useCallback(
    (response: ProjectResponseType) => {
      switch (response.type) {
        case 'packageInstalling':
          if (response.projectPath === projectPath) {
            setInstallState('installing')
          }
          break

        case 'packageInstallComplete':
          if (response.projectPath === projectPath) {
            if (response.success) {
              setInstallState('success')
              setInstalledVersion(response.version || null)
              // Auto-navigate to chat after short delay
              setTimeout(() => {
                navigate('/chatView')
              }, 1500)
            } else {
              setInstallState('error')
              setErrorMessage(response.error || 'Installation failed')
            }
          }
          break
      }
    },
    [projectPath, navigate]
  )

  const { installPackage } = useProjectMessages(handleMessage)

  // If no project, go back to selector
  useEffect(() => {
    if (!projectPath) {
      navigate('/projectSelector')
    }
  }, [projectPath, navigate])

  const handleInstall = () => {
    if (!projectPath) return
    setInstallState('installing')
    setErrorMessage(null)
    installPackage(projectPath)
  }

  const handleBack = () => {
    navigate('/projectSelector')
  }

  const handleRetry = () => {
    setInstallState('idle')
    setErrorMessage(null)
  }

  if (!projectPath) {
    return null
  }

  const projectName = project?.name || projectPath.split(/[/\\]/).pop() || 'Unknown Project'

  return (
    <div className="flex flex-col h-screen bg-vscode-editor-background text-vscode-foreground">
      {/* Header */}
      <header className="flex-shrink-0 px-4 py-3 border-b border-vscode-panel-border">
        <Button variant="ghost" size="sm" onClick={handleBack} className="gap-2">
          <ArrowLeft className="w-4 h-4" />
          Back to projects
        </Button>
      </header>

      {/* Content */}
      <div className="flex-1 flex flex-col items-center justify-center px-6">
        <div className="max-w-md w-full text-center">
          {/* Project Info */}
          <div className="mb-8">
            <div className="flex items-center justify-center gap-2 mb-2">
              <Folder className="w-5 h-5 text-vscode-textLink-foreground" />
              <h2 className="font-medium">{projectName}</h2>
            </div>
            {project?.editorVersion && (
              <span className="text-xs px-2 py-0.5 rounded bg-vscode-badge-background text-vscode-badge-foreground">
                Unity {project.editorVersion}
              </span>
            )}
            <p className="text-xs text-vscode-descriptionForeground mt-2 truncate">{projectPath}</p>
          </div>

          {/* Install Card */}
          <div
            className={cn(
              'p-6 rounded-xl border',
              'bg-vscode-editor-background border-vscode-panel-border'
            )}
          >
            {installState === 'idle' && (
              <>
                <div className="flex items-center justify-center w-16 h-16 mx-auto mb-4 rounded-full bg-vscode-textLink-foreground/10">
                  <Package className="w-8 h-8 text-vscode-textLink-foreground" />
                </div>
                <h3 className="text-lg font-semibold mb-2">Install Movesia Package</h3>
                <p className="text-sm text-vscode-descriptionForeground mb-6">
                  This project doesn't have the Movesia Unity package installed. Install it to enable
                  AI-powered Unity development.
                </p>
                <Button onClick={handleInstall} className="w-full">
                  <Package className="w-4 h-4 mr-2" />
                  Install Movesia Package
                </Button>
              </>
            )}

            {installState === 'installing' && (
              <>
                <div className="flex items-center justify-center w-16 h-16 mx-auto mb-4 rounded-full bg-vscode-textLink-foreground/10">
                  <Loader2 className="w-8 h-8 animate-spin text-vscode-textLink-foreground" />
                </div>
                <h3 className="text-lg font-semibold mb-2">Installing...</h3>
                <p className="text-sm text-vscode-descriptionForeground">
                  Copying package files to your Unity project. Unity will reload automatically.
                </p>
              </>
            )}

            {installState === 'success' && (
              <>
                <div className="flex items-center justify-center w-16 h-16 mx-auto mb-4 rounded-full bg-vscode-testing-iconPassed/10">
                  <CheckCircle className="w-8 h-8 text-vscode-testing-iconPassed" />
                </div>
                <h3 className="text-lg font-semibold mb-2 text-vscode-testing-iconPassed">
                  Installation Complete!
                </h3>
                <p className="text-sm text-vscode-descriptionForeground">
                  Movesia package{installedVersion ? ` v${installedVersion}` : ''} has been installed.
                  <br />
                  Redirecting to chat...
                </p>
              </>
            )}

            {installState === 'error' && (
              <>
                <div className="flex items-center justify-center w-16 h-16 mx-auto mb-4 rounded-full bg-vscode-errorForeground/10">
                  <XCircle className="w-8 h-8 text-vscode-errorForeground" />
                </div>
                <h3 className="text-lg font-semibold mb-2 text-vscode-errorForeground">
                  Installation Failed
                </h3>
                <p className="text-sm text-vscode-descriptionForeground mb-4">
                  {errorMessage || 'An unknown error occurred'}
                </p>
                <div className="flex gap-2 justify-center">
                  <Button variant="outline" onClick={handleBack}>
                    Choose Different Project
                  </Button>
                  <Button onClick={handleRetry}>Try Again</Button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default InstallPackage
