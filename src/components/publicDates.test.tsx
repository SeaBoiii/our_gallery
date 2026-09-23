import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { GalleryDayMode } from '../../shared/contracts'
import { LocaleProvider } from '../context/LocaleContext'
import { publicConfig, TestVisibilityProvider } from '../test/visibility'
import { Hero } from './Hero'
import { QRCodeCard } from './QRCodeCard'

describe('public date presentation', () => {
  for (const locale of ['en', 'ms'] as const) {
    it.each<GalleryDayMode | null>(['solemnisation', 'reception', 'both', null])(`keeps ${locale} hero and printable QR dates within the confirmed %s mode`, mode => {
      window.localStorage.setItem('an-gallery-locale', locale)
      const { container } = render(<LocaleProvider><TestVisibilityProvider config={mode ? publicConfig({ mode }) : null}><Hero onAddMemory={vi.fn()} onTakePhoto={vi.fn()} onChooseMedia={vi.fn()} /><QRCodeCard /></TestVisibilityProvider></LocaleProvider>)
      const text = container.textContent!
      expect(text).not.toMatch(/Nikah|Bride|Groom|Day 1|Day 2|Hari 1|Hari 2|Pengantin Perempuan|Pengantin Lelaki/i)
      if (mode === 'solemnisation') { expect(text).toContain(locale === 'en' ? '21 August 2027' : '21 Ogos 2027'); expect(text).not.toMatch(/22\s*(?:Aug|Ogos)/i) }
      if (mode === 'reception') { expect(text).toContain(locale === 'en' ? '22 August 2027' : '22 Ogos 2027'); expect(text).not.toMatch(/21\s*(?:Aug|Ogos)/i) }
      if (mode === 'both') expect(text).toContain(locale === 'en' ? '21 — 22 August 2027' : '21 — 22 Ogos 2027')
      if (mode === null) { expect(text).not.toMatch(/21|22/); expect(text).toContain(locale === 'en' ? 'Our Wedding' : 'Perkahwinan Kami') }
    })
  }
})
