export function CloudBackdrop() {
  return (
    <div className="cloud-backdrop" aria-hidden="true">
      <picture>
        <source type="image/avif" srcSet="/clouds-480.avif 480w, /clouds-768.avif 768w, /clouds-1280.avif 1280w" />
        <source type="image/webp" srcSet="/clouds-480.webp 480w, /clouds-768.webp 768w, /clouds-1280.webp 1280w" />
        <img src="/clouds-768.webp" alt="" width="1280" height="720" fetchPriority="high" />
      </picture>
      <span className="cloud-wash" />
    </div>
  )
}
