import assert from 'node:assert/strict'
import { describe, test } from 'vitest'
import {
  SLOW_MS,
  byLatest,
  bySlowest,
  commandsOf,
  durationOf,
  matchesFilter,
  matchesQuery,
  previewOf,
  surfaceSeqOf,
  tallyOfCommands,
} from '../../src/client/commands'
import type { Command } from '../../src/client/commands'
import type { SurfaceNode } from '../../src/shared/types'

const T0 = 1_700_000_000_000

function cmd(seq: number, over: Partial<Command> = {}): Command {
  return {
    seq,
    time: T0 + seq * 1000,
    tool: 'bash',
    cmd: 'git status',
    start: T0 + seq * 1000,
    status: 'completed',
    err: false,
    ...over,
  }
}

describe('commandsOf — the gone join', () => {
  test('a removed result node stamps its record; live and nested records read their own keys', () => {
    const archive: SurfaceNode[] = [
      { seq: 50, cat: 'tool', tokens: 1, gone: 70 },
      { seq: 60, cat: 'tool', tokens: 1, gone: 71 },
      { seq: 62, cat: 'tool', tokens: 1 }, // a live archived node carries no stamp
    ]
    const records = [
      cmd(1, { resultSeq: 50 }),
      cmd(2, { resultSeq: 55 }),
      cmd(3, { codeMode: true, parent: 60 }),
      cmd(4), // running: no surface node at all
    ]
    const joined = commandsOf(records, archive)
    assert.equal(joined[0].gone, 70)
    assert.equal(joined[1].gone, undefined)
    assert.equal(joined[2].gone, 71, 'nested records join through their parent')
    assert.equal(joined[3].gone, undefined)
  })

  test('an already-stamped record keeps its own stamp', () => {
    const joined = commandsOf([cmd(1, { resultSeq: 50, gone: 99 })], [{ seq: 50, cat: 'tool', tokens: 1, gone: 70 }])
    assert.equal(joined[0].gone, 99)
  })
})

describe('surfaceSeqOf / durationOf', () => {
  test('the reveal target is the parent for nested runs, else the result node', () => {
    assert.equal(surfaceSeqOf(cmd(1, { resultSeq: 9 })), 9)
    assert.equal(surfaceSeqOf(cmd(1, { resultSeq: 9, parent: 12 })), 12)
    assert.equal(surfaceSeqOf(cmd(1)), undefined)
  })

  test('the duration needs both endpoints and never goes negative', () => {
    assert.equal(durationOf(cmd(1, { start: 100, end: 4200 })), 4100)
    assert.equal(durationOf(cmd(1, { start: 100 })), undefined)
    assert.equal(durationOf(cmd(1, { start: 100, end: 50 })), 0)
  })
})

describe('previewOf', () => {
  test('hides a leading workspace cd prefix and takes the first line', () => {
    assert.equal(previewOf(cmd(1, { cmd: 'cd /repo && git status' }), '/repo'), 'git status')
    assert.equal(previewOf(cmd(1, { cmd: 'cd /elsewhere && git status' }), '/repo'), 'cd /elsewhere && git status')
    assert.equal(previewOf(cmd(1, { cmd: 'cd /repo && python3 - <<\'PY\'\nbody\nPY' }), '/repo'), 'python3 - <<\'PY\'')
    assert.equal(previewOf(cmd(1), undefined), 'git status')
  })
})

describe('filters, search, and sort', () => {
  const records = [
    cmd(1, { cmd: 'git status', status: 'completed' }),
    cmd(2, { cmd: 'vitest run', status: 'failed', exit: 1, start: T0 + 2000, end: T0 + 22000, description: 'run the tests' }),
    cmd(3, { cmd: 'pnpm dev', status: 'running', background: true }),
    cmd(4, { cmd: 'tsc --noEmit', status: 'completed', start: T0 + 4000, end: T0 + 4400, cwd: '/repo/sub' }),
  ]

  test('the chips filter on status, slowness, and background', () => {
    const pick = (f: 'all' | 'failed' | 'slow' | 'background') => records.filter(r => matchesFilter(r, f)).map(r => r.seq)
    assert.deepEqual(pick('all'), [1, 2, 3, 4])
    assert.deepEqual(pick('failed'), [2])
    assert.deepEqual(pick('slow'), [2], `the ${SLOW_MS}ms bar`)
    assert.deepEqual(pick('background'), [3])
  })

  test('search reads the command, the description, and the cwd', () => {
    const pick = (q: string) => records.filter(r => matchesQuery(r, q)).map(r => r.seq)
    assert.deepEqual(pick(''), [1, 2, 3, 4])
    assert.deepEqual(pick('vitest'), [2])
    assert.deepEqual(pick('TESTS'), [2])
    assert.deepEqual(pick('/repo/sub'), [4])
    assert.deepEqual(pick('absent'), [])
  })

  test('latest is time-descending; slowest puts duration-less runs last', () => {
    assert.deepEqual(records.slice().sort(byLatest).map(r => r.seq), [4, 3, 2, 1])
    assert.deepEqual(records.slice().sort(bySlowest).map(r => r.seq), [2, 4, 3, 1])
  })

  test('an equal-time tie breaks on the call seq (later call first)', () => {
    const tied = [cmd(1), cmd(2)]
    tied[1] = { ...tied[1], time: tied[0].time }
    assert.deepEqual(tied.slice().sort(byLatest).map(r => r.seq), [2, 1])
  })
})

describe('tallyOfCommands', () => {
  test('the list fallback tallies settled runs only', () => {
    const tally = tallyOfCommands([
      cmd(1, { status: 'completed', start: 0, end: 100 }),
      cmd(2, { status: 'failed', start: 0, end: 900 }),
      cmd(3, { status: 'killed', start: 0 }),
      cmd(4, { status: 'running', background: true }),
      cmd(5, { status: 'completed', background: true, start: 0, end: 50 }),
    ])
    assert.deepEqual(tally, { runs: 4, failed: 2, ms: 1050, bg: 1 })
  })
})
