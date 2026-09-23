import { lazy, Suspense } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { LocaleProvider } from './context/LocaleContext'
import { GalleryVisibilityProvider } from './context/GalleryVisibilityContext'
import { HomePage } from './pages/HomePage'
import { useLocale } from './context/useLocale'
import { copy } from './i18n/copy'
import { RouteErrorBoundary } from './components/RouteErrorBoundary'
import { WeddingMonogram } from './components/WeddingMonogram'

const LivePage = lazy(() => import('./pages/LivePage'))
const QrPage = lazy(() => import('./pages/QrPage'))
const AdminPage = lazy(() => import('./pages/AdminPage'))
const PolaroidPage = lazy(() => import('./pages/PolaroidPage'))

function RouteLoading() {
  const { locale } = useLocale()
  return <main className="route-loading" role="status"><WeddingMonogram compact /><p>{copy[locale].preparing}</p></main>
}

function RoutedContent() {
  const { locale } = useLocale()
  const t = copy[locale]
  return (
    <RouteErrorBoundary title={t.routeErrorTitle} message={t.routeErrorBody} retry={t.tryAgain}>
      <Suspense fallback={<RouteLoading />}>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/gallery" element={<HomePage />} />
          <Route path="/photobooth" element={<PolaroidPage />} />
          <Route path="/polaroid" element={<Navigate to="/photobooth" replace />} />
          <Route path="/guestbook" element={<Navigate to="/gallery" replace />} />
          <Route path="/live" element={<LivePage />} />
          <Route path="/qr" element={<QrPage />} />
          <Route path="/admin" element={<AdminPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </RouteErrorBoundary>
  )
}

export default function App() {
  return (
    <LocaleProvider>
      <GalleryVisibilityProvider>
      <BrowserRouter>
        <RoutedContent />
      </BrowserRouter>
      </GalleryVisibilityProvider>
    </LocaleProvider>
  )
}
