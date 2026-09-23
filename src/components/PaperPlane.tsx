import { useId } from 'react'

/** A lightweight folded-paper illustration; no canvas or animation runtime. */
export function PaperPlane() {
  const id = useId().replaceAll(':', '')
  return <svg viewBox="0 0 400 280" fill="none" aria-hidden="true" focusable="false">
    <defs>
      <linearGradient id={`${id}-wing`} x1="69" y1="80" x2="328" y2="191" gradientUnits="userSpaceOnUse"><stop stopColor="#fffef9" /><stop offset="1" stopColor="#e9dfca" /></linearGradient>
      <linearGradient id={`${id}-fold`} x1="107" y1="186" x2="350" y2="41" gradientUnits="userSpaceOnUse"><stop stopColor="#bba884" /><stop offset="1" stopColor="#e4d5b9" /></linearGradient>
      <linearGradient id={`${id}-base`} x1="193" y1="177" x2="279" y2="221" gradientUnits="userSpaceOnUse"><stop stopColor="#fffdf5" /><stop offset="1" stopColor="#d9c9ac" /></linearGradient>
      <filter id={`${id}-shadow`} x="0" y="0" width="400" height="280" filterUnits="userSpaceOnUse"><feDropShadow dx="0" dy="14" stdDeviation="12" floodColor="#243c49" floodOpacity=".16" /></filter>
    </defs>
    <g filter={`url(#${id}-shadow)`}>
      <path d="M38 126 360 38 142 173Z" fill={`url(#${id}-wing)`} stroke="#e7dcc8" />
      <path d="m142 173 218-135-176 163-26 29Z" fill={`url(#${id}-fold)`} />
      <path d="m158 230 26-29 25 9Z" fill="#a99573" />
      <path d="M360 38 184 201 279 236Z" fill={`url(#${id}-base)`} stroke="#e3d7c0" />
      <path d="M39 126 359 38 184 201" stroke="#fffef9" strokeWidth="1.5" />
      <path d="m65 127 35 16M80 123l35 16" stroke="#c4a367" strokeWidth="2" opacity=".6" />
    </g>
  </svg>
}
