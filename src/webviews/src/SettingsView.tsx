import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, User, Palette, Info, LogOut, Bell, Cpu } from 'lucide-react'
import { Avatar, AvatarImage, AvatarFallback } from './lib/components/ui/avatar'
import { useAuthState } from './lib/hooks/useAuthState'

// ─────────────────────────────────────────────────────────────────────────────
// Types & nav config
// ─────────────────────────────────────────────────────────────────────────────

type NavId = 'account' | 'general' | 'model' | 'notifications' | 'about'

const NAV: { id: NavId; label: string; icon: React.ReactNode }[] = [
  { id: 'account', label: 'Account', icon: <User className="w-[14px] h-[14px]" /> },
  { id: 'general', label: 'General', icon: <Palette className="w-[14px] h-[14px]" /> },
  { id: 'model', label: 'Model', icon: <Cpu className="w-[14px] h-[14px]" /> },
  { id: 'notifications', label: 'Notifications', icon: <Bell className="w-[14px] h-[14px]" /> },
  { id: 'about', label: 'About', icon: <Info className="w-[14px] h-[14px]" /> },
]

// ─────────────────────────────────────────────────────────────────────────────
// Shared primitives
// ─────────────────────────────────────────────────────────────────────────────

function Label({ children }: { children: React.ReactNode }) {
  return <span className="text-[11px] font-medium uppercase tracking-widest text-muted-foreground/60 mb-3 block">{children}</span>
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="py-2.5 flex items-baseline justify-between gap-4 border-b border-white/[0.04] last:border-b-0">
      <span className="text-[13px] text-muted-foreground">{label}</span>
      <span className={`text-[13px] ${mono ? 'font-mono text-[12px]' : ''}`}>{value}</span>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Panels
// ─────────────────────────────────────────────────────────────────────────────

function AccountPanel({
  authState,
  onSignOut,
}: {
  authState: { user: { name?: string; email?: string; picture?: string } | null }
  onSignOut: () => void
}) {
  return (
    <>
      <Label>Profile</Label>
      <div className="flex items-center gap-3 mb-8">
        <Avatar className="h-9 w-9 ring-1 ring-white/10">
          {authState.user?.picture && (
            <AvatarImage src={authState.user.picture} alt={authState.user.name || 'User'} />
          )}
          <AvatarFallback className="text-[10px] bg-white/5 text-foreground/70">
            {authState.user?.name
              ? authState.user.name.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2)
              : <User className="w-3.5 h-3.5" />}
          </AvatarFallback>
        </Avatar>
        <div className="flex flex-col min-w-0">
          <span className="text-[13px] font-medium truncate">{authState.user?.name || 'User'}</span>
          {authState.user?.email && (
            <span className="text-[11px] text-muted-foreground truncate">{authState.user.email}</span>
          )}
        </div>
      </div>

      <button
        onClick={onSignOut}
        className="inline-flex items-center gap-1.5 text-[12px] text-destructive/80 hover:text-destructive transition-colors cursor-pointer"
      >
        <LogOut className="w-3 h-3" />
        Sign out
      </button>
    </>
  )
}

function GeneralPanel() {
  return (
    <>
      <Label>Preferences</Label>
      <Field label="Theme" value="Sync with VS Code" />
      <Field label="Language" value="English" />
    </>
  )
}

function ModelPanel() {
  return (
    <>
      <Label>AI Configuration</Label>
      <Field label="Model" value="claude-haiku-4.5" mono />
      <Field label="Provider" value="OpenRouter" />
      <Field label="Context window" value="200k tokens" mono />
    </>
  )
}

function NotificationsPanel() {
  return (
    <>
      <Label>Notifications</Label>
      <p className="text-[13px] text-muted-foreground/60">Coming soon.</p>
    </>
  )
}

function AboutPanel() {
  return (
    <>
      <Label>Movesia AI</Label>
      <Field label="Version" value="1.0.0" mono />
      <Field label="Unity" value="6000.x" mono />
      <Field label="Agent" value="LangGraph" />

      <div className="mt-8 flex gap-4">
        {['Website', 'Privacy', 'Terms'].map((t) => (
          <a
            key={t}
            href={`https://movesia.ai/${t === 'Website' ? '' : t.toLowerCase()}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[11px] text-muted-foreground/50 hover:text-[var(--vscode-textLink-foreground)] transition-colors"
          >
            {t}
          </a>
        ))}
      </div>
    </>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Settings View
// ─────────────────────────────────────────────────────────────────────────────

function SettingsView() {
  const navigate = useNavigate()
  const { authState, signOut } = useAuthState()
  const [active, setActive] = useState<NavId>('account')

  const panels: Record<NavId, React.ReactNode> = {
    account: <AccountPanel authState={authState} onSignOut={signOut} />,
    general: <GeneralPanel />,
    model: <ModelPanel />,
    notifications: <NotificationsPanel />,
    about: <AboutPanel />,
  }

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-[var(--vscode-sideBar-background)] text-foreground">
      {/* Header — razor thin */}
      <header className="flex items-center gap-2 h-9 px-2 border-b border-white/[0.06] flex-shrink-0">
        <button
          onClick={() => navigate('/chatView')}
          className="p-1 rounded hover:bg-white/[0.06] transition-colors cursor-pointer"
          title="Back to chat"
        >
          <ArrowLeft className="w-3.5 h-3.5 text-muted-foreground" />
        </button>
        <span className="text-[12px] font-medium tracking-wide text-muted-foreground">Settings</span>
      </header>

      {/* Body */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar — full height, spaced out */}
        <nav className="w-40 flex-shrink-0 border-r border-white/[0.06] flex flex-col py-3 gap-0.5">
          {NAV.map((item) => {
            const isActive = active === item.id
            return (
              <button
                key={item.id}
                onClick={() => setActive(item.id)}
                className={`flex items-center gap-2 mx-1.5 px-2.5 py-[7px] rounded-md text-[12px] transition-all cursor-pointer ${
                  isActive
                    ? 'bg-white/[0.08] text-foreground'
                    : 'text-muted-foreground hover:text-foreground hover:bg-white/[0.04]'
                }`}
              >
                <span className={`flex-shrink-0 transition-opacity ${isActive ? 'opacity-100' : 'opacity-50'}`}>
                  {item.icon}
                </span>
                <span>{item.label}</span>
              </button>
            )
          })}
        </nav>

        {/* Content */}
        <main className="flex-1 overflow-y-auto px-6 py-5">
          {panels[active]}
        </main>
      </div>
    </div>
  )
}

export default SettingsView
