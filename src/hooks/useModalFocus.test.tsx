import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useRef, useState } from 'react'
import { describe, expect, it } from 'vitest'
import { useModalFocus } from './useModalFocus'

function ModalHarness() {
  const ref = useRef<HTMLDivElement>(null)
  const [step, setStep] = useState(0)
  useModalFocus(ref, true)

  return (
    <>
      <button type="button">Outside control</button>
      <div ref={ref} role="dialog" aria-modal="true" tabIndex={-1}>
        <button type="button" data-modal-autofocus>Close</button>
        {step === 0
          ? <button key="continue" type="button" onClick={() => setStep(1)}>Continue</button>
          : <button key="current" type="button">Current step control</button>}
      </div>
    </>
  )
}

describe('useModalFocus', () => {
  it('traps focus at document level and cycles at the boundaries', async () => {
    render(<ModalHarness />)
    const close = screen.getByRole('button', { name: 'Close' })
    const outside = screen.getByRole('button', { name: 'Outside control' })
    await waitFor(() => expect(close).toHaveFocus())

    outside.focus()
    expect(close).toHaveFocus()

    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
    expect(screen.getByRole('button', { name: 'Continue' })).toHaveFocus()
  })

  it('recovers focus when a focused step control unmounts', async () => {
    render(<ModalHarness />)
    const dialog = screen.getByRole('dialog')
    const continueButton = screen.getByRole('button', { name: 'Continue' })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus())

    continueButton.focus()
    fireEvent.click(continueButton)

    await waitFor(() => expect(dialog).toHaveFocus())
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus()
  })
})
