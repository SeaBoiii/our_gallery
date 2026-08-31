import { useLocale } from '../context/useLocale'
import { copy } from '../i18n/copy'

export function LanguageToggle() {
  const { locale, toggleLocale } = useLocale()
  return (
    <button
      type="button"
      className="language-toggle"
      onClick={toggleLocale}
      aria-label={copy[locale].switchLanguage}
      title={copy[locale].switchLanguage}
    >
      {locale === 'en' ? 'BM' : 'EN'}
    </button>
  )
}
