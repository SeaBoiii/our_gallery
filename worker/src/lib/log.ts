type SafeLogValue = string | number | boolean | null | undefined

export function safeLog(
  level: 'info' | 'warn' | 'error',
  event: string,
  fields: Record<string, SafeLogValue> = {},
) {
  const entry = JSON.stringify({
    level,
    event,
    timestamp: new Date().toISOString(),
    ...fields,
  })
  if (level === 'error') console.error(entry)
  else if (level === 'warn') console.warn(entry)
  else console.log(entry)
}

export function safeErrorCode(error: unknown, fallback = 'PROVIDER_ERROR') {
  if (error && typeof error === 'object' && typeof (error as { code?: unknown }).code === 'string') {
    return (error as { code: string }).code.slice(0, 80)
  }
  return fallback
}

export function safeErrorMessage(error: unknown, fallback = 'The operation failed.') {
  if (error instanceof Error && error.message) return error.message.replace(/[\r\n\t]+/g, ' ').slice(0, 240)
  return fallback
}

