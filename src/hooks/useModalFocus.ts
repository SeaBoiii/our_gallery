import { useEffect, type RefObject } from 'react'

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"]):not([tabindex="-1"])',
  'textarea:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

/** Keeps keyboard focus inside a modal surface and restores it to its trigger. */
export function useModalFocus(ref: RefObject<HTMLElement | null>, active: boolean) {
  useEffect(() => {
    if (!active || !ref.current) return
    const root = ref.current
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const focusable = () => Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((node) => !node.hidden && !node.closest('[hidden],[aria-hidden="true"]'))
    const firstFocusTarget = () => {
      const preferred = root.querySelector<HTMLElement>('[data-modal-autofocus]:not([disabled])')
      return preferred && focusable().includes(preferred) ? preferred : focusable()[0] || root
    }
    const recoveryFocusTarget = () => root.querySelector<HTMLElement>('[data-modal-focus-recovery]') || root
    const frame = window.requestAnimationFrame(() => {
      firstFocusTarget().focus()
    })
    let recoveryFrame: number | null = null

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return
      const controls = focusable()
      if (!controls.length) {
        event.preventDefault()
        root.focus()
        return
      }
      const first = controls[0]
      const last = controls[controls.length - 1]
      const focusedInside = document.activeElement instanceof Node && root.contains(document.activeElement)
      if (!focusedInside || document.activeElement === root) {
        event.preventDefault()
        ;(event.shiftKey ? last : first).focus()
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    const onFocusIn = (event: FocusEvent) => {
      if (!root.isConnected || !(event.target instanceof Node) || root.contains(event.target)) return
      firstFocusTarget().focus()
    }

    const observer = new MutationObserver(() => {
      const focusedInside = document.activeElement instanceof Node && root.contains(document.activeElement)
      if (focusedInside || !root.isConnected) return
      if (recoveryFrame !== null) window.cancelAnimationFrame(recoveryFrame)
      recoveryFrame = window.requestAnimationFrame(() => {
        recoveryFrame = null
        if (root.isConnected && !(document.activeElement instanceof Node && root.contains(document.activeElement))) recoveryFocusTarget().focus()
      })
    })
    observer.observe(root, { childList: true, subtree: true })
    document.addEventListener('keydown', onKeyDown, true)
    document.addEventListener('focusin', onFocusIn, true)
    return () => {
      window.cancelAnimationFrame(frame)
      if (recoveryFrame !== null) window.cancelAnimationFrame(recoveryFrame)
      observer.disconnect()
      document.removeEventListener('keydown', onKeyDown, true)
      document.removeEventListener('focusin', onFocusIn, true)
      if (previous?.isConnected) previous.focus()
    }
  }, [active, ref])
}
