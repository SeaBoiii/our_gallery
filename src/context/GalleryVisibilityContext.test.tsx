import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PublicGalleryConfig } from '../../shared/contracts'
import { GalleryVisibilityProvider } from './GalleryVisibilityContext'
import { useGalleryVisibility } from './useGalleryVisibility'
import { publicConfig } from '../test/visibility'

const api = vi.hoisted(() => ({ getGalleryConfig: vi.fn() }))
vi.mock('../services/api', () => api)

function Probe() {
  const { config, status, refresh } = useGalleryVisibility()
  return <><output>{`${status}:${config?.mode ?? 'neutral'}`}</output><input aria-label="Draft" defaultValue="" /><button onClick={() => void refresh().catch(() => undefined)}>Refresh</button></>
}
const mount = () => render(<GalleryVisibilityProvider><Probe /></GalleryVisibilityProvider>)
const flush = () => act(async () => { await Promise.resolve() })

describe('shared gallery visibility', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2027-08-21T04:00:00Z')); api.getGalleryConfig.mockReset() })
  afterEach(() => { vi.useRealTimers() })

  it('refreshes before expiry without unmounting drafts or clearing a valid unchanged policy', async () => {
    api.getGalleryConfig.mockImplementation(() => Promise.resolve(publicConfig({ mode: 'solemnisation' })))
    mount(); await flush()
    fireEvent.change(screen.getByLabelText('Draft'), { target: { value: 'Unsaved photos and words' } })
    await act(async () => { await vi.advanceTimersByTimeAsync(25_000) })
    expect(api.getGalleryConfig).toHaveBeenCalledTimes(2)
    expect(screen.getByText('ready:solemnisation')).toBeInTheDocument()
    expect(screen.getByLabelText('Draft')).toHaveValue('Unsaved photos and words')
    await act(async () => { await vi.advanceTimersByTimeAsync(5_001) })
    expect(screen.getByText('ready:solemnisation')).toBeInTheDocument()
  })

  it('fails closed on a focus refresh error while keeping the page draft mounted', async () => {
    api.getGalleryConfig.mockResolvedValueOnce(publicConfig()).mockRejectedValueOnce(new Error('offline'))
    mount(); await flush()
    fireEvent.change(screen.getByLabelText('Draft'), { target: { value: 'Keep this draft' } })
    fireEvent(window, new Event('focus')); await flush()
    expect(screen.getByText('error:neutral')).toBeInTheDocument()
    expect(screen.getByLabelText('Draft')).toHaveValue('Keep this draft')
  })

  it('never publishes an older request after a newer revision resolves', async () => {
    let oldResolve!: (config: PublicGalleryConfig) => void
    let newResolve!: (config: PublicGalleryConfig) => void
    api.getGalleryConfig.mockReturnValueOnce(new Promise<PublicGalleryConfig>(resolve => { oldResolve = resolve }))
      .mockReturnValueOnce(new Promise<PublicGalleryConfig>(resolve => { newResolve = resolve }))
    mount()
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    await act(async () => { newResolve(publicConfig({ mode: 'reception', revision: 'new' })) })
    await act(async () => { oldResolve(publicConfig({ mode: 'both', revision: 'old' })) })
    expect(screen.getByText('ready:reception')).toBeInTheDocument()
  })

  it('expires even when the proactive request has not returned', async () => {
    api.getGalleryConfig.mockResolvedValueOnce(publicConfig()).mockImplementation(() => new Promise(() => undefined))
    mount(); await flush()
    await act(async () => { await vi.advanceTimersByTimeAsync(30_001) })
    expect(screen.getByText('loading:neutral')).toBeInTheDocument()
  })

  it('uses the server boundary despite a different device clock', async () => {
    api.getGalleryConfig.mockResolvedValueOnce(publicConfig({ mode: 'solemnisation', serverTime: '2027-08-21T15:59:50Z', nextTransitionAt: '2027-08-21T16:00:00Z', validUntil: '2027-08-21T16:00:20Z' }))
      .mockImplementation(() => new Promise(() => undefined))
    mount(); await flush()
    expect(screen.getByText('ready:solemnisation')).toBeInTheDocument()
    await act(async () => { await vi.advanceTimersByTimeAsync(10_001) })
    expect(screen.getByText('loading:neutral')).toBeInTheDocument()
  })

  it('does not publish a malformed configuration that exposes an extra day', async () => {
    api.getGalleryConfig.mockResolvedValue(publicConfig({ mode: 'solemnisation', events: publicConfig().events }))
    mount(); await flush()
    expect(screen.getByText('error:neutral')).toBeInTheDocument()
  })
})
