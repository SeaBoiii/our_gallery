import { lazy, Suspense } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { LocaleProvider } from './context/LocaleContext'
import { HomePage } from './pages/HomePage'
import { useLocale } from './context/useLocale'
import { copy } from './i18n/copy'
import { RouteErrorBoundary } from './components/RouteErrorBoundary'
import { WeddingMonogram } from './components/WeddingMonogram'
import { FavouritesProvider } from './context/FavouritesContext'

const LivePage = lazy(() => import('./pages/LivePage'))
const QrPage = lazy(() => import('./pages/QrPage'))
const AdminPage = lazy(() => import('./pages/AdminPage'))
const ExplorePage = lazy(() => import('./pages/ExplorePage'))
const FindMePage = lazy(() => import('./pages/FindMePage'))

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
          <Route path="/live" element={<LivePage />} />
          <Route path="/qr" element={<QrPage />} />
          <Route path="/explore" element={<ExplorePage />} />
          <Route path="/find-me" element={<FindMePage />} />
          <Route path="/admin/*" element={<AdminPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </RouteErrorBoundary>
  )
}

export default function App() {
  return (
    <LocaleProvider>
      <FavouritesProvider>
        <BrowserRouter>
          <RoutedContent />
        </BrowserRouter>
      </FavouritesProvider>
    </LocaleProvider>
  )
}
