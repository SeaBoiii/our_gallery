import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useDownloadAvailability } from './useDownloadAvailability'

const api = vi.hoisted(() => ({ getGalleryDownloadStatus: vi.fn() }))
vi.mock('../services/api', () => api)

const released = {
  available: true,
  availableAt: '2027-08-23T00:00:00+08:00',
  serverTime: '2027-08-23T00:00:01+08:00',
}

describe('download availability', () => {
  beforeEach(() => api.getGalleryDownloadStatus.mockReset())
  afterEach(() => vi.useRealTimers())

  it('stays locked when the server reports a future release', async () => {
    api.getGalleryDownloadStatus.mockResolvedValue({ ...released, available: false, serverTime: '2027-08-22T23:59:00+08:00' })
    const { result } = renderHook(() => useDownloadAvailability())

    await waitFor(() => expect(result.current.availableAt).toBe(released.availableAt))
    expect(result.current.downloadsAvailable).toBe(false)
  })

  it('keeps a confirmed release through network errors and re-locks on an endpoint rejection', async () => {
    api.getGalleryDownloadStatus.mockResolvedValueOnce(released)
    const { result } = renderHook(() => useDownloadAvailability())
    await waitFor(() => expect(result.current.downloadsAvailable).toBe(true))

    api.getGalleryDownloadStatus.mockRejectedValueOnce(new Error('offline'))
    act(() => window.dispatchEvent(new Event('focus')))
    await waitFor(() => expect(api.getGalleryDownloadStatus).toHaveBeenCalledTimes(2))
    expect(result.current.downloadsAvailable).toBe(true)

    act(() => result.current.markDownloadsLocked())
    expect(result.current.downloadsAvailable).toBe(false)
  })

  it('stays locked when the initial status request fails', async () => {
    api.getGalleryDownloadStatus.mockRejectedValueOnce(new Error('offline'))
    const { result } = renderHook(() => useDownloadAvailability())

    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(api.getGalleryDownloadStatus).toHaveBeenCalledOnce()
    expect(result.current.downloadsAvailable).toBe(false)
    expect(result.current.availableAt).toBeNull()
  })

  it('refreshes at the release boundary and unlocks without a reload', async () => {
    vi.useFakeTimers()
    const locked = {
      ...released,
      available: false,
      serverTime: '2027-08-22T23:59:59+08:00',
    }
    api.getGalleryDownloadStatus.mockResolvedValueOnce(locked).mockResolvedValueOnce(released)
    const { result, unmount } = renderHook(() => useDownloadAvailability())

    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(result.current.downloadsAvailable).toBe(false)
    expect(api.getGalleryDownloadStatus).toHaveBeenCalledTimes(1)

    act(() => vi.advanceTimersByTime(1_249))
    expect(api.getGalleryDownloadStatus).toHaveBeenCalledTimes(1)
    await act(async () => {
      vi.advanceTimersByTime(1)
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(api.getGalleryDownloadStatus).toHaveBeenCalledTimes(2)
    expect(result.current.downloadsAvailable).toBe(true)
    unmount()
  })
})
