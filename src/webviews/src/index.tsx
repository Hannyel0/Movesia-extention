import React from 'react'
import { createRoot } from 'react-dom/client'
import ChatView from './ChatView'
import View2 from './View2'
import ProjectSelector from './ProjectSelector'
import InstallPackage from './InstallPackage'
import './lib/vscode.css'
import { MemoryRouter as Router, Routes, Route } from 'react-router-dom'

const rootEl = document.getElementById('root')

// Get the initial route from data attribute, ensure it has leading slash
const getInitialRoute = () => {
  const route = rootEl?.dataset.route || 'projectSelector'
  return route.startsWith('/') ? route : `/${route}`
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/projectSelector" element={<ProjectSelector />} />
      <Route path="/installPackage" element={<InstallPackage />} />
      <Route path="/chatView" element={<ChatView />} />
      <Route path="/view2" element={<View2 />} />
    </Routes>
  )
}

const reactRoot = createRoot(rootEl!)
reactRoot.render(
  <React.StrictMode>
    <Router initialEntries={[getInitialRoute()]} initialIndex={0}>
      <AppRoutes />
    </Router>
  </React.StrictMode>
)
