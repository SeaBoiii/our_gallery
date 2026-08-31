type WeddingMonogramProps = {
  compact?: boolean
  label?: string
}

export function WeddingMonogram({ compact = false, label }: WeddingMonogramProps) {
  return (
    <img
      className={`monogram${compact ? ' monogram--compact' : ''}`}
      src="/monogram.png"
      width="599"
      height="381"
      alt={label || ''}
      decoding="async"
      draggable={false}
    />
  )
}
