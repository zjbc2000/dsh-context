import { act, createElement as h } from 'react'
import assert from 'node:assert/strict'
import { describe, test } from 'vitest'
import { makeCommandPanel } from '../../../src/client/components/commandPanel'
import type { Command } from '../../../src/client/commands'
import { makeKit, mount, query, queryAll, text, click } from '../helpers/kit'

const kit = makeKit()
const Panel = makeCommandPanel(kit)

const T0 = 1700000000000

function cmd(seq: number, over: Partial<Command> = {}): Command {
  return {
    seq,
    time: T0 + seq * 1000,
    tool: 'bash',
    cmd: 'git status',
    start: T0 + seq * 1000,
    end: T0 + seq * 1000 + 100,
    status: 'completed',
    err: false,
    ...over,
  }
}

function richCommands(): Command[] {
  return [
    cmd(1, { cmd: 'git status --short', description: 'check the tree', resultSeq: 51, cwd: '/repo' }),
    cmd(2, {
      cmd: 'pnpm exec vitest run tests/client',
      description: 'run the affected tests',
      status: 'failed',
      exit: 1,
      start: T0 + 2000,
      end: T0 + 22000,
      resultSeq: 52,
      stderr: true,
      outChars: 6200,
    }),
    cmd(3, { cmd: 'node .tmp/serve.mjs', status: 'running', background: true, end: undefined, resultSeq: 53 }),
    cmd(4, {
      cmd: "cd /repo && python3 - <<'PY'\nprint('hi')\nPY",
      description: 'inline script',
      start: T0 + 4000,
      end: T0 + 4400,
      derived: true,
      resultSeq: 54,
    }),
  ]
}

function rowTexts(container: ParentNode): string[] {
  return queryAll(container, '.lc-cmd-row').map(r => text(r))
}

async function typeSearch(container: ParentNode, value: string): Promise<void> {
  const input = query<HTMLInputElement>(container, 'input.lc-fa-search')
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    setter?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

describe('CommandPanel — rendering', () => {
  test('rows render time-first with status, duration, badges and the step stamp', async () => {
    const m = await mount(h(Panel, {
      commands: richCommands(),
      workspace: '/repo',
      stampOf: seq => ({ turn: 1, step: seq - 50 }),
    }))
    try {
      const rows = rowTexts(m.container)
      assert.equal(rows.length, 4)
      // Latest first by default.
      assert.ok(rows[0].includes("python3 - <<'PY'"), 'the workspace cd prefix is hidden')
      assert.ok(!rows[0].includes('cd /repo'))
      assert.ok(rows[0].includes('3 lines'))
      assert.ok(rows[0].includes('heredoc'))
      assert.ok(rows[0].includes('T1 S4'))
      assert.ok(rows[1].includes('node .tmp/serve.mjs'))
      assert.ok(rows[1].includes('bg'))
      assert.ok(rows[1].includes('Running'))
      assert.ok(rows[2].includes('pnpm exec vitest run tests/client'))
      assert.ok(rows[2].includes('20.0s'))
      assert.ok(rows[3].includes('git status --short'))
      // The title tally counts the list when no whole-log stats arrive.
      const title = text(query(m.container, '.lc-card-title'))
      assert.ok(title.includes('3 runs'))
      assert.ok(title.includes('1 failed'))
    } finally {
      await m.unmount()
    }
  })

  test('the whole-log stats win the title over the list count', async () => {
    const m = await mount(h(Panel, {
      commands: richCommands(),
      stats: { runs: 128, failed: 9, ms: 42700, bg: 2 },
    }))
    try {
      const title = text(query(m.container, '.lc-card-title'))
      assert.ok(title.includes('128 runs'))
      assert.ok(title.includes('9 failed'))
      assert.ok(title.includes('42.7s'))
    } finally {
      await m.unmount()
    }
  })

  test('the coverage note appears only with a floor', async () => {
    const withFloor = await mount(h(Panel, { commands: richCommands(), floor: 10 }))
    try {
      assert.ok(text(withFloor.container).includes('Covering the latest 4 runs'))
    } finally {
      await withFloor.unmount()
    }
    const without = await mount(h(Panel, { commands: richCommands() }))
    try {
      assert.ok(!text(without.container).includes('Covering'))
    } finally {
      await without.unmount()
    }
  })
})

describe('CommandPanel — filtering, search, sort', () => {
  test('the chips filter the list and toggle back off', async () => {
    const m = await mount(h(Panel, { commands: richCommands() }))
    try {
      const chip = (label: string) => {
        const hit = queryAll(m.container, '.lc-cmd-chips .lc-gran-btn').find(b => text(b).startsWith(label))
        if (hit === undefined) throw new Error(`chip not found: ${label}`)
        return hit
      }
      await click(chip('Failed'))
      assert.equal(rowTexts(m.container).length, 1)
      assert.ok(rowTexts(m.container)[0].includes('vitest'))
      await click(chip('Slow'))
      assert.equal(rowTexts(m.container).length, 1, 'the failed 20s run is also the slow one')
      await click(chip('Background'))
      assert.equal(rowTexts(m.container).length, 1)
      assert.ok(rowTexts(m.container)[0].includes('serve.mjs'))
      await click(chip('Background'))
      assert.equal(rowTexts(m.container).length, 4, 'clicking the active chip resets to all')
    } finally {
      await m.unmount()
    }
  })

  test('search narrows by command, description and cwd', async () => {
    const m = await mount(h(Panel, { commands: richCommands(), workspace: '/repo' }))
    try {
      await typeSearch(m.container, 'vitest')
      assert.equal(rowTexts(m.container).length, 1)
      await typeSearch(m.container, 'affected')
      assert.equal(rowTexts(m.container).length, 1)
      await typeSearch(m.container, '/repo')
      assert.equal(rowTexts(m.container).length, 2, 'the cwd match joins the command match')
      await typeSearch(m.container, 'nothing-matches')
      assert.ok(text(m.container).includes('No commands match the current filters'))
    } finally {
      await m.unmount()
    }
  })

  test('slowest sorts by wall time', async () => {
    const m = await mount(h(Panel, { commands: richCommands() }))
    try {
      const slowest = queryAll(m.container, '.lc-cmd-ctl .lc-gran-btn').find(b => text(b) === 'Slowest')
      assert.ok(slowest !== undefined)
      await click(slowest)
      const rows = rowTexts(m.container)
      assert.ok(rows[0].includes('vitest'))
      assert.ok(rows.at(-1)?.includes('serve.mjs'), 'the running (duration-less) run lands last')
    } finally {
      await m.unmount()
    }
  })
})

describe('CommandPanel — the row detail and actions', () => {
  test('clicking a row expands the full command, facts and actions', async () => {
    const m = await mount(h(Panel, {
      commands: richCommands(),
      workspace: '/repo',
      stampOf: seq => ({ turn: 1, step: seq - 50 }),
      onLocate: () => {},
    }))
    try {
      const rows = queryAll(m.container, '.lc-cmd-row')
      await click(rows[2]) // the failed vitest run
      const detail = query(m.container, '.lc-cmd-detail')
      assert.ok(text(detail).includes('run the affected tests'))
      assert.ok(text(query(m.container, '.lc-cmd-full')).includes('pnpm exec vitest run tests/client'))
      assert.ok(text(detail).includes('exit 1'))
      assert.ok(text(detail).includes('6.2k chars'))
      assert.ok(text(detail).includes('stderr'))
      assert.ok(text(detail).includes('Reveal in Context Browser'))
      await click(rows[2])
      assert.equal(queryAll(m.container, '.lc-cmd-detail').length, 0, 'clicking again collapses')
    } finally {
      await m.unmount()
    }
  })

  test('the derived run marks its duration; the reveal bridge fires with the record', async () => {
    const located: Command[] = []
    const m = await mount(h(Panel, {
      commands: richCommands(),
      workspace: '/repo',
      stampOf: seq => ({ turn: 1, step: seq - 50 }),
      onLocate: rec => { located.push(rec) },
    }))
    try {
      // The derived row (python heredoc, latest) shows the ≈ mark.
      const first = queryAll(m.container, '.lc-cmd-row')[0]
      assert.ok(text(first).includes('≈'))
      // Clicking the trailing time reveals instead of expanding.
      const time = query(first, '.lc-cmd-time')
      await click(time)
      assert.equal(located.length, 1)
      assert.equal(located[0].seq, 4)
      assert.equal(queryAll(m.container, '.lc-cmd-detail').length, 0, 'the reveal does not expand the row')
    } finally {
      await m.unmount()
    }
  })

  test('a running row without a result offers no reveal link', async () => {
    const m = await mount(h(Panel, {
      commands: [cmd(1, { status: 'running', end: undefined })],
      onLocate: () => {},
    }))
    try {
      assert.equal(queryAll(m.container, '.lc-cmd-time-link').length, 0)
      assert.equal(queryAll(m.container, '.lc-cmd-time').length, 1)
    } finally {
      await m.unmount()
    }
  })

  test('the copy action flashes the confirmation when the clipboard lands', async () => {
    const writes: string[] = []
    const Panel2 = makeCommandPanel(kit)
    const m = await mount(h(Panel2, { commands: richCommands() }))
    try {
      const clipboard = { writeText: (t: string) => { writes.push(t); return Promise.resolve() } }
      Object.defineProperty(globalThis.navigator, 'clipboard', { value: clipboard, configurable: true })
      const rows = queryAll(m.container, '.lc-cmd-row')
      await click(rows[3]) // git status --short
      const copyBtn = queryAll(m.container, '.lc-cmd-act').find(b => text(b) === 'Copy command')
      assert.ok(copyBtn !== undefined)
      await click(copyBtn)
      assert.deepEqual(writes, ['git status --short'])
    } finally {
      await m.unmount()
    }
  })
})

describe('CommandPanel — empty and channel states', () => {
  test('an empty log, a loading channel, and a failed channel each render their note', async () => {
    const empty = await mount(h(Panel, { commands: [] }))
    try {
      assert.ok(text(empty.container).includes('No commands executed in this session'))
    } finally {
      await empty.unmount()
    }
    const loading = await mount(h(Panel, { commands: [], state: 'loading' }))
    try {
      assert.equal(queryAll(loading.container, '.lc-detail-note, .lc-empty').length > 0, true)
    } finally {
      await loading.unmount()
    }
    const failed = await mount(h(Panel, { commands: [], state: 'failed', onRetry: () => {} }))
    try {
      assert.equal(queryAll(failed.container, 'button').length > 0, true, 'the retry note carries a button')
    } finally {
      await failed.unmount()
    }
  })

  test('a nested code-mode run shows its badge and reveals on its parent', async () => {
    const located: Command[] = []
    const nested = cmd(7, { codeMode: true, parent: 99, cmd: 'git diff', resultSeq: undefined })
    const m = await mount(h(Panel, {
      commands: [nested],
      stampOf: () => ({ turn: 2, step: 3 }),
      onLocate: rec => { located.push(rec) },
    }))
    try {
      const row = query(m.container, '.lc-cmd-row')
      assert.ok(text(row).includes('nested'))
      await click(query(row, '.lc-cmd-time'))
      assert.equal(located.length, 1)
      assert.equal(located[0].parent, 99)
    } finally {
      await m.unmount()
    }
  })

  test('killed and stopped runs carry their own glyphs; a pwsh run shows its tool tag', async () => {
    const m = await mount(h(Panel, {
      commands: [
        cmd(1, { status: 'killed', signal: 'SIGTERM' }),
        cmd(2, { status: 'killed', stopped: true }),
        cmd(3, { tool: 'pwsh', cmd: 'Get-ChildItem' }),
      ],
    }))
    try {
      assert.equal(queryAll(m.container, '.lc-cmd-st-kill').length, 2)
      assert.ok(rowTexts(m.container).some(r => r.includes('pwsh')))
    } finally {
      await m.unmount()
    }
  })

  test('the detail lists every fact family and its Reveal action locates the record', async () => {
    const located: Command[] = []
    const full = cmd(9, {
      cmd: 'curl -s https://x',
      description: 'fetch it',
      status: 'failed',
      exit: 28,
      timedOut: true,
      denied: true,
      signal: 'SIGTERM',
      timeoutMs: 40000,
      cwd: '/repo/deep',
      outChars: 30000,
      outTruncated: true,
      stderr: true,
      sandbox: 'full',
      resultSeq: 90,
      start: T0 + 9000,
      end: T0 + 49000,
    })
    const m = await mount(h(Panel, {
      commands: [full],
      stampOf: () => ({ turn: 3, step: 2 }),
      onLocate: rec => { located.push(rec) },
    }))
    try {
      await click(query(m.container, '.lc-cmd-row'))
      const detail = text(query(m.container, '.lc-cmd-detail'))
      for (const part of ['fetch it', 'exit 28', '40.0s', '/repo/deep', 'timeout 40.0s', '30.0k chars', 'truncated', 'stderr', 'timed out', 'sandbox denied', 'signal SIGTERM', 'asked full']) {
        assert.ok(detail.includes(part), `detail shows: ${part}`)
      }
      const reveal = queryAll(m.container, '.lc-cmd-act').find(b => text(b).startsWith('Reveal in Context Browser'))
      assert.ok(reveal !== undefined)
      assert.ok(text(reveal).includes('T3 S2'), 'the action carries the step stamp')
      await click(reveal)
      assert.deepEqual(located, [full])
    } finally {
      await m.unmount()
    }
  })

  test('the detail hides the exit badge for run_code and shows the inferred ≈', async () => {
    const m = await mount(h(Panel, {
      commands: [
        cmd(1, { tool: 'run_code', cmd: 'await x()', exit: 0, exitInferred: true }),
        cmd(2, { exit: 0, exitInferred: true, resultSeq: 55 }),
      ],
    }))
    try {
      const rows = queryAll(m.container, '.lc-cmd-row')
      await click(rows[0]) // latest-first: the seq-2 bash row
      assert.ok(text(query(m.container, '.lc-cmd-facts')).includes('exit 0 ≈'), 'the inferred exit is marked')
      await click(rows[0])
      await click(queryAll(m.container, '.lc-cmd-row')[1]) // the run_code row
      assert.ok(!text(query(m.container, '.lc-cmd-facts')).includes('exit 0'), 'a code program has no shell exit code')
    } finally {
      await m.unmount()
    }
  })

  test('the copy action needs a clipboard and survives a rejection', async () => {
    const m = await mount(h(Panel, { commands: [cmd(1, { resultSeq: 2 })] }))
    try {
      await click(query(m.container, '.lc-cmd-row'))
      const copyBtn = queryAll(m.container, '.lc-cmd-act').find(b => text(b) === 'Copy command')
      assert.ok(copyBtn !== undefined)
      // No clipboard at all: the click is a silent no-op.
      Object.defineProperty(globalThis.navigator, 'clipboard', { value: undefined, configurable: true })
      await click(copyBtn)
      assert.equal(text(copyBtn), 'Copy command')
      // A failing write never claims the copy.
      Object.defineProperty(globalThis.navigator, 'clipboard', {
        value: { writeText: () => Promise.reject(new Error('denied')) },
        configurable: true,
      })
      await click(copyBtn)
      await act(async () => {})
      assert.equal(text(copyBtn), 'Copy command')
      // A landed write flashes the label, then resets after the timeout.
      Object.defineProperty(globalThis.navigator, 'clipboard', {
        value: { writeText: () => Promise.resolve() },
        configurable: true,
      })
      await click(copyBtn)
      await act(async () => {})
      assert.equal(text(copyBtn), 'Copied')
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 1300)) })
      assert.equal(text(copyBtn), 'Copy command')
    } finally {
      await m.unmount()
    }
  })

  test('the detail of a running, truncated, or stamp-less record renders its honest edges', async () => {
    const m = await mount(h(Panel, {
      commands: [
        cmd(1, { status: 'running', end: undefined, cmd: 'npm run watch' }),
        cmd(2, { cmd: 'x'.repeat(30), cmdTruncated: true, derived: true, resultSeq: 60 }),
        cmd(3, { cmd: 'node -e "console.log(1)"', resultSeq: 61 }),
      ],
      onLocate: () => {},
      // No stampOf: the reveal action renders without a stamp suffix.
    }))
    try {
      const rows = queryAll(m.container, '.lc-cmd-row')
      // The inline badge marks the one-liner script.
      assert.ok(text(rows[0]).includes('inline'))
      // Expand the running row: no duration fact, still Running.
      await click(rows.at(-1)!)
      let detail = query(m.container, '.lc-cmd-detail')
      assert.ok(text(detail).includes('npm run watch'))
      assert.ok(!text(detail).includes('≈'))
      await click(rows.at(-1)!)
      // Expand the derived+truncated row: ≈ on the duration, the ellipsis on the command body.
      await click(queryAll(m.container, '.lc-cmd-row')[1])
      detail = query(m.container, '.lc-cmd-detail')
      assert.ok(text(detail).includes('≈'))
      assert.ok(text(query(m.container, '.lc-cmd-full')).includes('…'))
      const reveal = queryAll(m.container, '.lc-cmd-act').find(b => text(b) === 'Reveal in Context Browser')
      assert.ok(reveal !== undefined, 'no stamp suffix when the stamp lookup misses')
    } finally {
      await m.unmount()
    }
  })

  test('a second copy within the flash window keeps the newer label lit', async () => {
    const m = await mount(h(Panel, {
      commands: [cmd(1, { resultSeq: 2 }), cmd(2, { cmd: 'git diff', resultSeq: 3 })],
    }))
    try {
      Object.defineProperty(globalThis.navigator, 'clipboard', {
        value: { writeText: () => Promise.resolve() },
        configurable: true,
      })
      const rows = queryAll(m.container, '.lc-cmd-row')
      await click(rows[0])
      const firstCopy = queryAll(m.container, '.lc-cmd-act').find(b => text(b) === 'Copy command')
      assert.ok(firstCopy !== undefined)
      await click(firstCopy)
      await act(async () => {})
      assert.equal(text(firstCopy), 'Copied')
      await click(rows[0]) // collapse the first row
      await click(queryAll(m.container, '.lc-cmd-row')[1])
      const secondCopy = queryAll(m.container, '.lc-cmd-act').find(b => text(b) === 'Copy command')
      assert.ok(secondCopy !== undefined)
      await click(secondCopy)
      await act(async () => {})
      assert.equal(text(secondCopy), 'Copied')
      // The first row's timer now fires while the SECOND seq is lit: it must not clear the newer flash.
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 1300)) })
      assert.equal(text(secondCopy), 'Copy command')
    } finally {
      await m.unmount()
    }
  })
})
