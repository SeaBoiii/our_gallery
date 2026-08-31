import { describe, expect, it } from 'vitest'
import { parseJson } from './http'

function chunkedJsonRequest(value: unknown) {
  const bytes = new TextEncoder().encode(JSON.stringify(value))
  const midpoint = Math.floor(bytes.byteLength / 2)
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes.slice(0, midpoint))
      controller.enqueue(bytes.slice(midpoint))
      controller.close()
    },
  })
  return new Request('https://api.test/json', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    duplex: 'half',
  } as RequestInit & { duplex: 'half' })
}

describe('JSON request parsing', () => {
  it('parses a chunked JSON body without Content-Length', async () => {
    const request = chunkedJsonRequest({ memory: 'safe' })
    expect(request.headers.get('Content-Length')).toBeNull()

    await expect(parseJson<{ memory: string }>(request)).resolves.toEqual({ memory: 'safe' })
  })

  it('rejects a chunked body that exceeds 128 KiB', async () => {
    const request = chunkedJsonRequest({ padding: 'x'.repeat(128 * 1024) })
    expect(request.headers.get('Content-Length')).toBeNull()

    await expect(parseJson(request)).rejects.toMatchObject({ status: 413, code: 'REQUEST_TOO_LARGE' })
  })
})
