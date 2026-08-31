import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { LocaleProvider } from '../context/LocaleContext'
import { useLocale } from '../context/useLocale'
import { LanguageToggle } from './LanguageToggle'

function LocaleProbe() {
  const { locale } = useLocale()
  return <output>{locale}</output>
}

describe('language toggle', () => {
  it('switches to Bahasa Melayu and stores the preference', () => {
    render(<LocaleProvider><LanguageToggle /><LocaleProbe /></LocaleProvider>)
    fireEvent.click(screen.getByRole('button', { name: /Bahasa Melayu/i }))
    expect(screen.getByText('ms')).toBeInTheDocument()
    expect(window.localStorage.getItem('an-gallery-locale')).toBe('ms')
    expect(screen.getByRole('button', { name: /English/i })).toHaveTextContent('EN')
  })
})
