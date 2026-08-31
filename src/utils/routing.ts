export function restoreGitHubPagesRoute(
  search = window.location.search,
  replace: (route: string) => void = (route) => window.history.replaceState(null, '', route),
) {
  const fallbackRoute = new URLSearchParams(search).get('route')
  if (!fallbackRoute?.startsWith('/') || fallbackRoute.startsWith('//')) return false
  replace(fallbackRoute)
  return true
}
