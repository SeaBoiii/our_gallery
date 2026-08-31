export function WeddingMonogram({ compact = false }: { compact?: boolean }) {
  return (
    <span className={`monogram${compact ? ' monogram--compact' : ''}`} aria-label="Aleem and Nurul">
      <span>A</span>
      <i aria-hidden="true" />
      <span>N</span>
    </span>
  )
}
