import assert from 'node:assert/strict'
import { describe, test } from 'vitest'
import {
  commandArgsOf,
  commandArgsRecordOf,
  commandTool,
  exitOfJobDetail,
  firstLineOf,
  hideableCdPrefix,
  markersOfText,
  outcomeOfMarkers,
  shapeOfCmd,
  signalOfJobDetail,
} from '../../src/shared/commands'

describe('commandTool', () => {
  test('the shell tools and run_code are command-bearing; everything else is not', () => {
    assert.equal(commandTool('bash'), 'bash')
    assert.equal(commandTool('pwsh'), 'pwsh')
    assert.equal(commandTool('run_code'), 'run_code')
    assert.equal(commandTool('read'), null)
    assert.equal(commandTool('job_output'), null)
    assert.equal(commandTool(undefined), null)
    assert.equal(commandTool('bashful'), null)
  })
})

describe('commandArgsOf', () => {
  test('parses the durable JSON-string form with every field', () => {
    const parsed = commandArgsOf('bash', JSON.stringify({
      command: 'git status',
      description: 'check the tree',
      workdir: '/repo',
      timeoutMs: 5000,
      run_in_background: true,
      sandbox_permissions: 'full',
    }), 4096)
    assert.deepEqual(parsed, {
      cmd: 'git status',
      description: 'check the tree',
      cwd: '/repo',
      timeoutMs: 5000,
      background: true,
      sandbox: 'full',
    })
  })

  test('a run_code call carries the program source and description instead', () => {
    const parsed = commandArgsOf('run_code', JSON.stringify({ code: 'const x = 1', description: 'compute' }), 4096)
    assert.deepEqual(parsed, { cmd: 'const x = 1', description: 'compute' })
  })

  test('accepts the PTC dispatch\'s already-normalized object arguments', () => {
    const parsed = commandArgsOf('bash', { command: 'ls', description: 'list' }, 4096)
    assert.deepEqual(parsed, { cmd: 'ls', description: 'list' })
  })

  test('caps an overlong command and flags the truncation', () => {
    const parsed = commandArgsOf('bash', JSON.stringify({ command: 'x'.repeat(100) }), 10)
    assert.equal(parsed?.cmd, 'x'.repeat(10))
    assert.equal(parsed?.truncated, true)
  })

  test('a command-less or unreadable payload books nothing; junk fields drop silently', () => {
    assert.equal(commandArgsOf('bash', JSON.stringify({ description: 'no command' }), 4096), null)
    assert.equal(commandArgsOf('bash', 'not json', 4096), null)
    assert.equal(commandArgsOf('bash', '[1,2]', 4096), null)
    assert.equal(commandArgsOf('bash', undefined, 4096), null)
    assert.equal(commandArgsOf('run_code', JSON.stringify({ command: 'ls' }), 4096), null)
    const junk = commandArgsOf('bash', JSON.stringify({
      command: 'ls',
      timeoutMs: -3,
      run_in_background: 'yes',
      description: 7,
      workdir: '',
    }), 4096)
    assert.deepEqual(junk, { cmd: 'ls' })
  })
})

describe('commandArgsRecordOf', () => {
  test('normalizes the string and object forms and rejects the rest', () => {
    assert.deepEqual(commandArgsRecordOf('{"a":1}'), { a: 1 })
    assert.deepEqual(commandArgsRecordOf({ a: 1 }), { a: 1 })
    assert.equal(commandArgsRecordOf('nope'), null)
    assert.equal(commandArgsRecordOf(42), null)
    assert.equal(commandArgsRecordOf(null), null)
    assert.equal(commandArgsRecordOf([1]), null)
  })
})

describe('markersOfText', () => {
  test('a clean exit carries no marker at all', () => {
    assert.deepEqual(markersOfText('total 8\nfile.ts'), {})
  })

  test('the exit marker anchors at the very tail, like dsh’s own parser', () => {
    assert.deepEqual(markersOfText('boom\n[exit code: 3]'), { exit: 3 })
    // A marker-like line mid-output is output, not a status.
    assert.deepEqual(markersOfText('[exit code: 3]\nmore output'), {})
  })

  test('the persistent-shell family marker reads the same (including a clean exit)', () => {
    assert.deepEqual(markersOfText('ok\n[Command finished with exit code 0]'), { exit: 0 })
    assert.deepEqual(markersOfText('bad\n[Command finished with exit code 2]'), { exit: 2 })
  })

  test('a kill reports the signal instead of an exit code', () => {
    assert.deepEqual(markersOfText('partial\n[killed by signal: SIGTERM]'), { signal: 'SIGTERM' })
  })

  test('timeout, stop, denial, truncation and stderr are independent flags', () => {
    assert.deepEqual(markersOfText('out\n[timed out after 5000ms]'), { timedOut: true })
    assert.deepEqual(markersOfText('out\n[stopped: user request]'), { stopped: true })
    assert.deepEqual(markersOfText('[sandbox: file access denied under strict mode]'), { denied: true })
    assert.deepEqual(markersOfText('partial\n[output truncated; full output: /tmp/x]'), { truncated: true })
    assert.deepEqual(markersOfText('out\n[stderr]\nboom'), { stderr: true })
    const several = markersOfText('o\n[stderr]\ne\n[timed out after 5ms]\n[exit code: 28]')
    assert.deepEqual(several, { stderr: true, timedOut: true, exit: 28 })
  })

  test('a background hand-off is an ack, not an outcome', () => {
    assert.deepEqual(markersOfText('started background job abc123'), { backgroundAck: true })
    // The REAL promoted shape: dsh's renderPromoted always appends the hand-off guidance after the marker.
    const realPromoted = 'partial output\n[still running after 10000ms; moved to background job abc123]\n'
      + 'The command keeps running in the background. You will be notified when it finishes; '
      + 'read newer output with job_output, stop it with job_kill.'
    assert.deepEqual(markersOfText(realPromoted), { backgroundAck: true })
    // A marker at the very tail with no guidance (a trimmed spill read) still matches.
    assert.deepEqual(markersOfText('partial output\n[still running after 10000ms; moved to background job abc123]'), { backgroundAck: true })
    // A spoofed marker line with unrelated output after it is output, not an ack.
    assert.deepEqual(markersOfText('[still running after 10ms; moved to background job x]\nother output'), {})
  })

  test('the persistent-shell failure family: OOM timeout, shell kill, shell exit', () => {
    assert.deepEqual(markersOfText('out\n[Command timed out or OOM]\n[shell reset]'), { timedOut: true })
    assert.deepEqual(markersOfText('out\n[shell killed by signal: SIGKILL]\nreset'), { signal: 'SIGKILL' })
    assert.deepEqual(markersOfText('out\n[shell exited: code 3]\nreset'), { exit: 3 })
    assert.deepEqual(markersOfText('out\n[shell exited]'), { stopped: true })
    // The persistent clean-exit marker still wins when it is the tail.
    assert.deepEqual(markersOfText('ok\n[Command finished with exit code 0]'), { exit: 0 })
  })

  test('hostile text yields no markers', () => {
    assert.deepEqual(markersOfText(''), {})
    assert.deepEqual(markersOfText('[exit code: abc]'), {})
    assert.deepEqual(markersOfText('[killed by signal: ]'), {})
  })
})

describe('outcomeOfMarkers', () => {
  test('killed beats failed beats completed; the inferred clean exit is flagged', () => {
    assert.deepEqual(outcomeOfMarkers({ signal: 'SIGKILL' }, false), { status: 'killed' })
    assert.deepEqual(outcomeOfMarkers({ stopped: true }, false), { status: 'killed' })
    assert.deepEqual(outcomeOfMarkers({ exit: 2 }, false), { status: 'failed', exit: 2 })
    assert.deepEqual(outcomeOfMarkers({ denied: true }, false), { status: 'failed' })
    assert.deepEqual(outcomeOfMarkers({}, true), { status: 'failed' })
    // A bare timeout with no exit resolution is an interruption, not a success.
    assert.deepEqual(outcomeOfMarkers({ timedOut: true }, false), { status: 'failed' })
    // A timeout WITH a clean exit stays completed (a command can trap the signal and exit 0).
    assert.deepEqual(outcomeOfMarkers({ timedOut: true, exit: 0 }, false), { status: 'completed', exit: 0 })
    assert.deepEqual(outcomeOfMarkers({ exit: 0 }, false), { status: 'completed', exit: 0 })
    assert.deepEqual(outcomeOfMarkers({}, false), { status: 'completed', exit: 0, exitInferred: true })
  })
})

describe('job detail parsing', () => {
  test('the exit code reads out of the detail line, including with sandbox notes appended', () => {
    assert.equal(exitOfJobDetail('exit code: 3'), 3)
    assert.equal(exitOfJobDetail('exit code: 0; [sandbox: file access denied under strict mode]'), 0)
    assert.equal(exitOfJobDetail('killed before exit'), undefined)
    assert.equal(exitOfJobDetail(undefined), undefined)
    assert.equal(exitOfJobDetail(42), undefined)
  })

  test('the signal reads out of a killed job’s detail', () => {
    assert.equal(signalOfJobDetail('signal: SIGTERM'), 'SIGTERM')
    assert.equal(signalOfJobDetail('signal: SIGKILL; [sandbox: x]'), 'SIGKILL')
    assert.equal(signalOfJobDetail('exit code: 1'), undefined)
    assert.equal(signalOfJobDetail(null), undefined)
  })
})

describe('display shaping', () => {
  test('firstLineOf takes the first line of a multi-line command', () => {
    assert.equal(firstLineOf('ls'), 'ls')
    assert.equal(firstLineOf('git status\ngit diff'), 'git status')
    assert.equal(firstLineOf('  indented  '), 'indented')
  })

  test('the hideable cd prefix is exactly the workspace one', () => {
    assert.equal(hideableCdPrefix('cd /repo && git status', '/repo'), 'cd /repo && '.length)
    assert.equal(hideableCdPrefix('cd /repo/ && git status', '/repo'), 'cd /repo/ && '.length)
    assert.equal(hideableCdPrefix('cd /repo && git status', '/repo/'), 'cd /repo && '.length)
    assert.equal(hideableCdPrefix('cd "/my repo" && ls', '/my repo'), 'cd "/my repo" && '.length)
    assert.equal(hideableCdPrefix('cd /elsewhere && ls', '/repo'), 0)
    assert.equal(hideableCdPrefix('git status', '/repo'), 0)
    assert.equal(hideableCdPrefix('cd /repo && ls', undefined), 0)
    assert.equal(hideableCdPrefix('cd /repo && ls', ''), 0)
    assert.equal(hideableCdPrefix('cd /repo && ls', '/'), 0)
  })

  test('shapeOfCmd counts lines and spots heredocs and inline scripts', () => {
    assert.deepEqual(shapeOfCmd('git status'), { lines: 1, heredoc: false, inline: false })
    assert.deepEqual(shapeOfCmd('cat <<\'EOF\'\nbody\nEOF'), { lines: 3, heredoc: true, inline: false })
    assert.deepEqual(shapeOfCmd('node -e "console.log(1)"'), { lines: 1, heredoc: false, inline: true })
    assert.deepEqual(shapeOfCmd('python3 -c \'print(1)\''), { lines: 1, heredoc: false, inline: true })
    assert.deepEqual(shapeOfCmd('git diff | node -e "x"'), { lines: 1, heredoc: false, inline: true })
    assert.deepEqual(shapeOfCmd('echo "a <<- not a heredoc in spirit but matches the cheap test"'), { lines: 1, heredoc: true, inline: false })
  })
})
