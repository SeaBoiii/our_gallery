import type { Env } from '../src/env'

type Handlers = {
  first?: (sql: string, bindings: unknown[]) => unknown
  all?: (sql: string, bindings: unknown[]) => unknown[]
  run?: (sql: string, bindings: unknown[]) => { changes?: number }
  batch?: (statements: FakeStatement[]) => void
}

export class FakeStatement {
  bindings: unknown[] = []
  constructor(public sql: string, private handlers: Handlers) {}
  bind(...values: unknown[]) { this.bindings = values; return this }
  async first<T>() { return (this.handlers.first?.(this.sql,this.bindings) ?? null) as T | null }
  async all<T>() { return { results: (this.handlers.all?.(this.sql,this.bindings) ?? []) as T[], success: true, meta: {} } as D1Result<T> }
  async run<T>() { const value = this.handlers.run?.(this.sql,this.bindings); return { success: true, results: [], meta: { changes: value?.changes ?? 1 } } as unknown as D1Result<T> }
}

export function fakeEnv(handlers: Handlers = {}): Env {
  const db = {
    prepare: (sql: string) => new FakeStatement(sql,handlers),
    batch: async (statements: FakeStatement[]) => {
      handlers.batch?.(statements)
      return statements.map((statement) => ({ success:true,results:[],meta:{ changes:handlers.run?.(statement.sql,statement.bindings)?.changes ?? 1 } }))
    },
  } as unknown as D1Database
  const media = {
    head: async () => null,
    get: async () => null,
    delete: async () => undefined,
  } as unknown as R2Bucket
  return {
    DB: db, MEDIA: media, ENVIRONMENT: 'development', R2_ACCOUNT_ID: 'test-account', R2_BUCKET_NAME: 'test-bucket', R2_ACCESS_KEY_ID: 'test-key', R2_SECRET_ACCESS_KEY: 'test-secret', ALLOWED_ORIGIN: 'http://localhost:5173', TURNSTILE_SECRET_KEY: 'test-turnstile', TURNSTILE_EXPECTED_HOSTNAME: 'localhost', TURNSTILE_BYPASS: 'true', ADMIN_PASSWORD: 'correct horse battery staple', ADMIN_SESSION_SECRET: '0123456789abcdef0123456789abcdef', RATE_LIMIT_SECRET: 'abcdef0123456789abcdef0123456789', AUTO_APPROVE_UPLOADS: 'false', UPLOAD_URL_TTL_SECONDS: '600', ADMIN_SESSION_TTL_SECONDS: '28800', SOFT_STORAGE_WARNING_GB: '450', HARD_STORAGE_LIMIT_GB: '',
  }
}
