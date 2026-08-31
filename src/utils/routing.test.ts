import { describe, expect, it, vi } from 'vitest'
import { restoreGitHubPagesRoute } from './routing'

describe('GitHub Pages route restoration', () => {
  it('restores a clean route including its query and hash', () => {
    const replace = vi.fn()
    expect(restoreGitHubPagesRoute('?route=%2Flive%3Fevent%3Dreception%23wall', replace)).toBe(true)
    expect(replace).toHaveBeenCalledWith('/live?event=reception#wall')
  })

  it('rejects protocol-relative and non-path values', () => {
    const replace = vi.fn()
    expect(restoreGitHubPagesRoute('?route=%2F%2Fevil.example', replace)).toBe(false)
    expect(restoreGitHubPagesRoute('?route=https%3A%2F%2Fevil.example', replace)).toBe(false)
    expect(replace).not.toHaveBeenCalled()
  })
})
