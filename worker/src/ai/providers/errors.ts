export class AiProviderError extends Error {
  code: string
  retryable: boolean

  constructor(code: string, message: string, retryable = true) {
    super(message)
    this.name = 'AiProviderError'
    this.code = code
    this.retryable = retryable
  }
}

