import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { restoreGitHubPagesRoute } from './utils/routing'

// GitHub Pages serves public/404.html for clean client-side routes. That file
// carries the original path back to the root document so BrowserRouter can
// restore it before React reads the current location.
restoreGitHubPagesRoute()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
