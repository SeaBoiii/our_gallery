import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { copy } from '../../i18n/copy'
import { TurnstileWidget } from './TurnstileWidget'

vi.mock('../../config', () => ({ TURNSTILE_SITE_KEY: 'test-site-key', USE_MOCK_DATA: false }))
vi.mock('../../context/useLocale', () => ({ useLocale: () => ({ locale: 'en' }) }))

type WidgetOptions = {
  action: string
  callback: (token: string) => void
  'expired-callback': () => void
  'error-callback': () => void
}

function installTurnstile() {
  let nextId = 0
  const api = {
    render: vi.fn((_element: HTMLElement, _options: Record<string, unknown>) => `widget-${++nextId}`),
    reset: vi.fn(),
    remove: vi.fn(),
  }
  window.turnstile = api
  return api
}

function verificationScript() {
  const script = document.querySelector<HTMLScriptElement>('#turnstile-script')
  expect(script).not.toBeNull()
  return script!
}

async function scriptEvent(script: HTMLScriptElement, event: 'load' | 'error') {
  await act(async () => { fireEvent(script, new Event(event)) })
}

afterEach(async () => {
  cleanup()
  // Settle any pending loader even if a test fails before dispatching its event.
  const script = document.querySelector<HTMLScriptElement>('#turnstile-script')
  if (script) {
    await scriptEvent(script, 'error')
    script.remove()
  }
  delete window.turnstile
})

describe('TurnstileWidget', () => {
  it('downloads a new script after a failed load and resetKey retry', async () => {
    const onToken = vi.fn()
    const onError = vi.fn()
    const view = render(<TurnstileWidget onToken={onToken} onError={onError} action="greeting_submit" />)
    const failedScript = verificationScript()

    await scriptEvent(failedScript, 'error')
    expect(onError).toHaveBeenCalledWith(copy.en.upload.verificationOffline)
    expect(document.querySelector('#turnstile-script')).toBeNull()

    view.rerender(<TurnstileWidget onToken={onToken} onError={onError} action="greeting_submit" resetKey={1} />)
    const retryScript = verificationScript()
    expect(retryScript).not.toBe(failedScript)
    expect(retryScript.src).toBe('https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit')

    const api = installTurnstile()
    await scriptEvent(retryScript, 'load')
    expect(api.render).toHaveBeenCalledOnce()
    const options = api.render.mock.calls[0][1] as WidgetOptions
    expect(options.action).toBe('greeting_submit')
    act(() => options.callback('recovered-token'))
    expect(onToken).toHaveBeenLastCalledWith('recovered-token')
    expect(onError).toHaveBeenCalledOnce()
  })

  it('shares one script between simultaneous upload and greeting widgets', async () => {
    const uploadToken = vi.fn()
    const greetingToken = vi.fn()
    const onError = vi.fn()
    const view = render(<>
      <TurnstileWidget onToken={uploadToken} onError={onError} />
      <TurnstileWidget onToken={greetingToken} onError={onError} action="greeting_submit" />
    </>)
    expect(document.querySelectorAll('#turnstile-script')).toHaveLength(1)

    const api = installTurnstile()
    await scriptEvent(verificationScript(), 'load')
    expect(api.render).toHaveBeenCalledTimes(2)
    expect(api.render.mock.calls[0][0]).not.toBe(api.render.mock.calls[1][0])
    expect(api.render.mock.calls.map(([, options]) => options.action)).toEqual(['upload_prepare', 'greeting_submit'])
    const uploadOptions = api.render.mock.calls[0][1] as WidgetOptions
    const greetingOptions = api.render.mock.calls[1][1] as WidgetOptions
    act(() => { uploadOptions.callback('upload-token'); greetingOptions.callback('greeting-token') })
    expect(uploadToken).toHaveBeenLastCalledWith('upload-token')
    expect(greetingToken).toHaveBeenLastCalledWith('greeting-token')

    view.unmount()
    expect(api.remove.mock.calls).toEqual([['widget-1'], ['widget-2']])
  })

  it('does not render an unmounted upload widget when its shared script finishes later', async () => {
    const oldToken = vi.fn()
    const oldError = vi.fn()
    const oldView = render(<TurnstileWidget onToken={oldToken} onError={oldError} />)
    const script = verificationScript()
    oldView.unmount()

    const newToken = vi.fn()
    const newError = vi.fn()
    render(<TurnstileWidget onToken={newToken} onError={newError} action="greeting_submit" />)
    expect(verificationScript()).toBe(script)
    const api = installTurnstile()
    await scriptEvent(script, 'load')

    expect(api.render).toHaveBeenCalledOnce()
    expect(api.render.mock.calls[0][1].action).toBe('greeting_submit')
    const options = api.render.mock.calls[0][1] as WidgetOptions
    act(() => options.callback('current-token'))
    expect(oldToken.mock.calls).toEqual([['']])
    expect(oldError).not.toHaveBeenCalled()
    expect(newToken).toHaveBeenLastCalledWith('current-token')
  })

  it('uses only the latest action when the action changes before script completion', async () => {
    const onToken = vi.fn()
    const onError = vi.fn()
    const view = render(<TurnstileWidget onToken={onToken} onError={onError} />)
    const script = verificationScript()
    view.rerender(<TurnstileWidget onToken={onToken} onError={onError} action="greeting_submit" />)
    expect(verificationScript()).toBe(script)

    const api = installTurnstile()
    await scriptEvent(script, 'load')
    expect(api.render).toHaveBeenCalledOnce()
    expect(api.render.mock.calls[0][1].action).toBe('greeting_submit')
  })

  it('clears expired and failed tokens and ignores callbacks after unmount', async () => {
    const api = installTurnstile()
    const onToken = vi.fn()
    const onError = vi.fn()
    const view = render(<TurnstileWidget onToken={onToken} onError={onError} action="greeting_submit" />)
    await waitFor(() => expect(api.render).toHaveBeenCalledOnce())
    expect(document.querySelector('#turnstile-script')).toBeNull()
    const options = api.render.mock.calls[0][1] as WidgetOptions

    act(() => options.callback('first-token'))
    expect(onToken).toHaveBeenLastCalledWith('first-token')
    act(() => options['expired-callback']())
    expect(onToken).toHaveBeenLastCalledWith('')
    expect(onError).not.toHaveBeenCalled()
    act(() => options.callback('second-token'))
    act(() => options['error-callback']())
    expect(onToken).toHaveBeenLastCalledWith('')
    expect(onError).toHaveBeenLastCalledWith(copy.en.upload.verificationFailed)

    view.unmount()
    expect(api.remove).toHaveBeenCalledWith('widget-1')
    onToken.mockClear()
    onError.mockClear()
    act(() => { options.callback('stale-token'); options['expired-callback'](); options['error-callback']() })
    expect(onToken).not.toHaveBeenCalled()
    expect(onError).not.toHaveBeenCalled()
  })
})
