import type { ReactNode } from 'react'
import type { PublicGalleryConfig } from '../../shared/contracts'
import { GalleryVisibilityContext, type GalleryVisibilityContextValue } from '../context/gallery-visibility-context'
import { mockEvents } from '../data/mock'

// Test fixtures are not loaded by the application's Fast Refresh boundary.
// eslint-disable-next-line react/only-export-components
export function publicConfig(overrides: Partial<PublicGalleryConfig> = {}): PublicGalleryConfig {
  const mode = overrides.mode ?? 'both'
  return {
    mode, events: mockEvents.filter(event => mode === 'both' || event.slug === mode),
    uploadsEnabled: true, serverTime: new Date().toISOString(), nextTransitionAt: null,
    revision: `test-${mode}`, validUntil: new Date(Date.now() + 30_000).toISOString(), ...overrides,
  }
}

export function TestVisibilityProvider({ children, config = publicConfig(), status, refresh }: { children: ReactNode; config?: PublicGalleryConfig | null; status?: GalleryVisibilityContextValue['status']; refresh?: GalleryVisibilityContextValue['refresh'] }) {
  return <GalleryVisibilityContext.Provider value={{ config, status: status ?? (config ? 'ready' : 'error'), refresh: refresh ?? (() => Promise.resolve(config ?? publicConfig())) }}>{children}</GalleryVisibilityContext.Provider>
}
