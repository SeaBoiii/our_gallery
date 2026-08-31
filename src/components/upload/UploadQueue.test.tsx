import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { UploadQueueItem } from '../../types/upload'
import { UploadQueue } from './UploadQueue'
import { LocaleProvider } from '../../context/LocaleContext'

const item = (state: UploadQueueItem['state']): UploadQueueItem => ({
  clientId: '9f195d3d-52f4-4c24-94d6-ef9bbd3604b4',
  file: new File(['memory'], 'memory.jpg', { type: 'image/jpeg' }),
  mediaType: 'photo',
  previewUrl: '',
  derivatives: [],
  derivativeStatus: 'unavailable',
  state,
  progress: state === 'complete' ? 100 : 42,
  error: state === 'failed' ? 'Connection interrupted' : undefined,
})

describe('upload queue', () => {
  it('shows successful upload progress', () => {
    render(<LocaleProvider><UploadQueue items={[item('complete')]} canRemove={false} onRemove={() => undefined} /></LocaleProvider>)
    expect(screen.getByText('Checked in')).toBeInTheDocument()
  })

  it('retries only the failed file', () => {
    const retry = vi.fn()
    render(<LocaleProvider><UploadQueue items={[item('failed')]} canRemove={false} onRemove={() => undefined} onRetry={retry} /></LocaleProvider>)
    fireEvent.click(screen.getByRole('button', { name: /Retry memory.jpg/i }))
    expect(retry).toHaveBeenCalledWith('9f195d3d-52f4-4c24-94d6-ef9bbd3604b4')
    expect(screen.getByRole('alert')).toHaveTextContent('Connection interrupted')
  })
})
