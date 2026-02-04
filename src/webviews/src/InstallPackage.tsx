import React, { useState, useCallback, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import {
  Package,
  ArrowLeft,
  Folder,
  ExternalLink,
  RefreshCw,
} from 'lucide-react'
import { Button } from './lib/components/ui/button'
import { OnboardingStep, type StepStatus } from './lib/components/OnboardingStep'
import { useProjectMessages } from './lib/hooks/useProjectMessages'
import { useUnityStatus } from './lib/hooks/useUnityStatus'
import { useUnityRunning } from './lib/hooks/useUnityRunning'
import type { UnityProjectInfo, ProjectResponseType } from './lib/types/project'

// Unity logo as inline SVG component
function UnityLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 1488 1681" className={className} fill="currentColor" aria-hidden="true">
      <path d="m1487.5 1176.1v-784.1l-679-392v301l266 154c10.5 7 10.5 21.1 0 24.6l-315 182c-10.5 7-21 3.5-28 0l-315-182c-10.5-3.5-10.5-21.1 0-24.6l266-154v-301l-682.5 392v784.1-3.5 3.5l259-150.5v-308c0-10.5 14-17.5 21-14l315 182c10.5 7 14 14 14 24.5v364c0 10.5-14 17.5-21 14l-266-154-259 150.5 679 395.6 679-392.1-259-150.5-266 154c-10.5 7-21 0-21-14v-364c0-10.5 7-21 14-24.5l315-182c10.5-7 21 0 21 14v308z" />
    </svg>
  )
}

type InstallState = 'idle' | 'installing' | 'success' | 'error'

// Package version - could be fetched dynamically in the future
const PACKAGE_VERSION = '0.1.0'

function InstallPackage() {
  const navigate = useNavigate()
  const location = useLocation()
  const [installState, setInstallState] = useState<InstallState>('idle')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [installedVersion, setInstalledVersion] = useState<string | null>(null)

  // Get project from navigation state
  const project = (location.state as { project?: UnityProjectInfo })?.project
  const projectPath = project?.path || (location.state as { projectPath?: string })?.projectPath

  // Poll Unity connection status (backend agent connection)
  const { connectionState, status: unityStatus } = useUnityStatus({
    pollInterval: 1500,
    enabled: true,
  })

  // Check if Unity Editor has the project open (Temp folder exists)
  const { isRunning: isUnityOpen, isLoading: isCheckingUnity } = useUnityRunning({
    projectPath: projectPath || null,
    pollInterval: 2000,
    enabled: !!projectPath,
  })

  const handleMessage = useCallback(
    (response: ProjectResponseType) => {
      switch (response.type) {
        case 'packageStatus':
          // Check if package is already installed
          if (response.projectPath === projectPath) {
            if (response.installed) {
              setInstallState('success')
              setInstalledVersion(response.version || null)
            }
          }
          break

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
            } else {
              setInstallState('error')
              setErrorMessage(response.error || 'Installation failed')
            }
          }
          break
      }
    },
    [projectPath]
  )

  const { installPackage, checkPackageStatus } = useProjectMessages(handleMessage)

  // Check if package is already installed on mount
  useEffect(() => {
    console.log('[InstallPackage] Mount/project check:', {
      projectPath,
      projectFromState: project,
      movesiaInstalled: project?.movesiaInstalled,
    })

    if (projectPath) {
      // First check if we have the info from navigation state
      if (project?.movesiaInstalled) {
        console.log('[InstallPackage] Package already installed (from nav state), setting success')
        setInstallState('success')
        setInstalledVersion(project.movesiaVersion || null)
      } else {
        // Otherwise, check with the extension
        console.log('[InstallPackage] Checking package status with extension...')
        checkPackageStatus(projectPath)
      }
    }
  }, [projectPath, project, checkPackageStatus])

  // If no project, go back to selector
  useEffect(() => {
    if (!projectPath) {
      navigate('/projectSelector')
    }
  }, [projectPath, navigate])

  // Auto-navigate to chat when all conditions are met:
  // - Package is installed
  // - Unity has the project open (Temp folder exists)
  // - Agent is connected
  useEffect(() => {
    console.log('[InstallPackage] Checking auto-navigate conditions:', {
      installState,
      isUnityOpen,
      connectionState,
      allMet: installState === 'success' && isUnityOpen && connectionState === 'connected',
    })

    if (installState === 'success' && isUnityOpen && connectionState === 'connected') {
      console.log('[InstallPackage] ✅ All conditions met, navigating to /chatView in 200ms')
      // Short delay to avoid flicker, but fast enough to feel instant
      const timer = setTimeout(() => {
        console.log('[InstallPackage] -> /chatView')
        navigate('/chatView')
      }, 200)
      return () => clearTimeout(timer)
    }
  }, [installState, isUnityOpen, connectionState, navigate])

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

  // Determine step statuses
  const getStepStatuses = (): {
    linkProject: StepStatus
    installPackage: StepStatus
    openUnity: StepStatus
    syncAssets: StepStatus
  } => {
    // Step 1: Link project - always completed since we're on this page
    const linkProject: StepStatus = 'completed'

    // Step 2: Install package
    let installPackageStatus: StepStatus
    if (installState === 'success') {
      installPackageStatus = 'completed'
    } else if (installState === 'installing') {
      installPackageStatus = 'loading'
    } else if (installState === 'error') {
      installPackageStatus = 'active' // Show as active so user can retry
    } else {
      installPackageStatus = 'active'
    }

    // Step 3: Open Unity - uses Temp folder check to detect if Unity has project open
    let openUnity: StepStatus
    if (isUnityOpen) {
      openUnity = 'completed'
    } else if (installState === 'success') {
      openUnity = isCheckingUnity ? 'loading' : 'active'
    } else {
      openUnity = 'pending'
    }

    // Step 4: Sync assets - active when Unity is open, completed when agent connects
    let syncAssets: StepStatus
    if (connectionState === 'connected') {
      syncAssets = 'completed'
    } else if (connectionState === 'compiling') {
      syncAssets = 'loading'
    } else if (isUnityOpen) {
      // Unity is open but agent not connected yet - waiting for compilation
      syncAssets = 'active'
    } else {
      syncAssets = 'pending'
    }

    return { linkProject, installPackage: installPackageStatus, openUnity, syncAssets }
  }

  const stepStatuses = getStepStatuses()

  // Check if all steps are completed
  const allStepsCompleted =
    stepStatuses.linkProject === 'completed' &&
    stepStatuses.installPackage === 'completed' &&
    stepStatuses.openUnity === 'completed' &&
    stepStatuses.syncAssets === 'completed'

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
      <div className="flex-1 flex flex-col items-center justify-center px-6 py-8 overflow-auto">
        <div className="max-w-lg w-full">
          {/* Title */}
          <h1 className="text-2xl font-semibold text-center mb-8">Get Started</h1>

          {/* Steps Card */}
          <div className="rounded-xl border border-vscode-panel-border bg-vscode-editor-background overflow-hidden">
            {/* Step 1: Link Unity Project */}
            <OnboardingStep
              icon={<Folder className="w-5 h-5" />}
              title="Link your Unity project"
              description={`${projectName}${project?.editorVersion ? ` • Unity ${project.editorVersion}` : ''}`}
              status={stepStatuses.linkProject}
            />

            {/* Step 2: Install Package */}
            <OnboardingStep
              icon={<Package className="w-5 h-5" />}
              title="Install the Movesia plugin"
              description={
                installState === 'error'
                  ? errorMessage || 'Installation failed. Please try again.'
                  : installState === 'installing'
                    ? 'Installing package files to your Unity project...'
                    : installState === 'success'
                      ? 'Plugin installed successfully!'
                      : 'Enables AI-powered Unity development in your project.'
              }
              status={stepStatuses.installPackage}
              badge={`Version - ${installedVersion || PACKAGE_VERSION}`}
              action={
                installState === 'idle'
                  ? { label: 'Install plugin', onClick: handleInstall }
                  : installState === 'error'
                    ? { label: 'Try again', onClick: handleRetry }
                    : undefined
              }
            />

            {/* Step 3: Open Unity */}
            <OnboardingStep
              icon={<UnityLogo className="w-5 h-5" />}
              title="Open Unity"
              description={
                stepStatuses.openUnity === 'completed'
                  ? `Unity is running with ${projectName}!`
                  : stepStatuses.openUnity === 'loading'
                    ? 'Checking if Unity is running...'
                    : 'Open this project in Unity Editor to continue.'
              }
              status={stepStatuses.openUnity}
            />

            {/* Step 4: Focus Unity to Connect */}
            <OnboardingStep
              icon={<RefreshCw className="w-5 h-5" />}
              title="Focus Unity to connect"
              description={
                stepStatuses.syncAssets === 'completed'
                  ? 'Connected and ready to go!'
                  : stepStatuses.syncAssets === 'loading'
                    ? 'Unity is compiling the Movesia plugin...'
                    : stepStatuses.syncAssets === 'active'
                      ? 'Click on the Unity Editor window to trigger script compilation.'
                      : 'Once Unity compiles the plugin, the agent will connect automatically.'
              }
              status={stepStatuses.syncAssets}
              isLast
            />
          </div>

          {/* Footer info */}
          <div className="mt-6 text-center">
            <p className="text-sm text-vscode-descriptionForeground">
              {allStepsCompleted
                ? 'All set! Redirecting to chat...'
                : 'A Unity project must be open and connected to continue.'}
            </p>
            <a
              href="https://docs.movesia.ai"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-sm text-vscode-textLink-foreground hover:underline mt-2"
            >
              Need help? View product docs
              <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        </div>
      </div>
    </div>
  )
}

export default InstallPackage
