import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { PassThrough } from 'node:stream'
import { once } from 'node:events'
import { ZipArchive } from 'archiver'
import { assignArchiveNames, csvCell, manifestCsv, parseByteSize, partPlanSha256, planShards, sanitizeFilename } from './lib.mjs'

const item = (overrides: Record<string, unknown> = {}) => ({
  mediaId:'00000000-0000-4000-8000-000000000001',eventId:'event-1',eventSlug:'solemnisation',eventDate:'2027-08-21',
  eventDisplayName:'Solemnisation',eventSequence:1,originalObjectKey:'originals/one.jpg',originalFilename:'IMG_0001.JPG',
  mimeType:'image/jpeg',sizeBytes:100,uploadedAt:'2027-08-21T00:00:00.000Z',guestName:null,guestMessage:null,categories:[],aiCaption:null,
  ...overrides,
})

describe('archive builder core', () => {
  it('sanitises traversal, controls, and Windows device names', () => {
    expect(sanitizeFilename('../CON')).toBe('_CON')
    expect(sanitizeFilename('NUL')).toBe('_NUL')
    expect(sanitizeFilename('a/b\\c?.jpg')).toBe('a_b_c_.jpg')
  })

  it('limits filenames by UTF-8 bytes without splitting Unicode characters', () => {
    const safe = sanitizeFilename(`${'😀'.repeat(100)}.jpg`)
    expect(Buffer.byteLength(safe,'utf8')).toBeLessThanOrEqual(180)
    expect(safe.endsWith('.jpg')).toBe(true)
  })

  it('generates readable deterministic names even for duplicates', () => {
    const named = assignArchiveNames([item(),item({ mediaId:'00000000-0000-4000-8000-000000000002',eventSequence:2 })])
    expect(named[0].archiveFilename).toContain('000001_IMG_0001.JPG')
    expect(named[1].archiveFilename).toContain('000002_IMG_0001.JPG')
    expect(new Set(named.map((value) => value.archiveFilename)).size).toBe(2)
  })

  it('plans stable shards without splitting files', () => {
    const plans = planShards([item({ sizeBytes:60 }),item({ mediaId:'00000000-0000-4000-8000-000000000002',eventSequence:2,sizeBytes:60 })], 100, 0)
    expect(plans).toHaveLength(2)
    expect(plans.map((plan) => plan.items.length)).toEqual([1,1])
    expect(partPlanSha256(plans[0])).toHaveLength(64)
    expect(partPlanSha256(plans[0])).toBe(partPlanSha256(planShards([item({ sizeBytes:60 })],100,0)[0]))
  })

  it('caps each shard at ten thousand files even when byte size is tiny', () => {
    const items = Array.from({ length:20_001 },(_,index)=>item({
      mediaId:`00000000-0000-4000-${String(8000 + Math.floor(index / 10_000)).padStart(4,'0')}-${String(index).padStart(12,'0')}`,
      eventSequence:index + 1,
      sizeBytes:1,
    }))
    const plans=planShards(items,10 * 1024 ** 3,0)
    expect(plans.map((plan)=>plan.items.length)).toEqual([10_000,10_000,1])
  })

  it('passes the one-hundred-thousand-item production planner gate', () => {
    const items = Array.from({ length:100_000 },(_,index)=>({
      eventId:'event-1',eventSlug:'solemnisation',eventDisplayName:'Solemnisation',
      archiveFilename:`21-Aug-Solemnisation/originals/${String(index + 1).padStart(6,'0')}.jpg`,
      metadataFilename:`21-Aug-Solemnisation/metadata/${String(index + 1).padStart(6,'0')}.json`,
      sizeBytes:1,
    }))
    const plans=planShards(items,10 * 1024 ** 3,0,10_000,true)
    expect(plans).toHaveLength(10)
    expect(plans.every((plan)=>plan.items.length===10_000)).toBe(true)
  })

  it('escapes CSV and prevents spreadsheet formula execution', () => {
    expect(csvCell('=HYPERLINK("bad")')).toBe('"\'=HYPERLINK(""bad"")"')
    const csv = manifestCsv(assignArchiveNames([item({ guestMessage:'hello, world' })]).map((value) => ({ ...value, sha256:'a'.repeat(64) })))
    expect(csv).toContain('"hello, world"')
  })

  it('parses documented binary shard sizes', () => {
    expect(parseByteSize('5GB')).toBe(5 * 1024 ** 3)
    expect(() => parseByteSize('wat')).toThrow()
  })

  it('emits byte-identical ZIP64 output for the same ordered fixture', async () => {
    const build=async()=>{
      const zip=new ZipArchive({ forceZip64:true,store:true,zlib:{ level:0 } })
      const output=new PassThrough()
      const chunks:Buffer[]=[]
      output.on('data',(chunk:Buffer)=>chunks.push(chunk))
      zip.pipe(output)
      zip.append(Buffer.from('one'),{ name:'01/one.txt',date:new Date('1980-01-01T00:00:00.000Z'),mode:0o644,store:true })
      zip.append(Buffer.from('two'),{ name:'02/two.txt',date:new Date('1980-01-01T00:00:00.000Z'),mode:0o644,store:true })
      const ended=once(output,'end')
      await zip.finalize();await ended
      return Buffer.concat(chunks)
    }
    const [first,second]=await Promise.all([build(),build()])
    expect(createHash('sha256').update(first).digest('hex')).toBe(createHash('sha256').update(second).digest('hex'))
    expect(first.includes(Buffer.from([0x50,0x4b,0x06,0x06]))).toBe(true)
    expect(first.includes(Buffer.from([0x50,0x4b,0x06,0x07]))).toBe(true)
  })
})
