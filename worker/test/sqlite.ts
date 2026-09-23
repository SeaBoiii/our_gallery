import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import type { Env } from '../src/env'
import { fakeEnv } from './fake'

// Execute route SQL and migrations against SQLite itself, including constraints,
// uniqueness and transactions. R2 is deliberately the existing inert fake.
export function sqliteEnv(migrations = 3) {
  const database = new DatabaseSync(':memory:')
  const applyMigration = (name: string) => database.exec(readFileSync(resolve('worker/migrations', name), 'utf8'))
  const names = ['0001_initial.sql', '0002_upload_requests.sql', '0003_greetings.sql']
  names.slice(0, migrations).forEach(applyMigration)

  class Statement {
    values: SQLInputValue[] = []
    constructor(readonly sql: string) {}
    bind(...values: unknown[]) {
      if (values.length > 100) throw new Error('D1 supports at most 100 bound parameters')
      this.values = values as SQLInputValue[]
      return this
    }
    async first<T>() { return (database.prepare(this.sql).get(...this.values) || null) as T | null }
    async all<T>() { return { results: database.prepare(this.sql).all(...this.values) as T[], success: true, meta: {} } }
    execute() {
      const result = database.prepare(this.sql).run(...this.values)
      return { results: [], success: true, meta: { changes: Number(result.changes) } }
    }
    async run() { return this.execute() }
  }

  const db = {
    prepare: (sql: string) => new Statement(sql),
    batch: async (statements: Statement[]) => {
      database.exec('BEGIN')
      try {
        const results = statements.map((statement) => statement.execute())
        database.exec('COMMIT')
        return results
      } catch (error) {
        database.exec('ROLLBACK')
        throw error
      }
    },
  } as unknown as D1Database
  const env: Env = { ...fakeEnv(), DB: db }
  return { env, database, applyMigration, close: () => database.close() }
}
