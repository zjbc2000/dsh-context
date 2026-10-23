/** The ONE read of "what the agent ran": the host fold books one record per shell/code call. Argument and result-marker
 * parsing live here so the fold and the tests share them; every reader is TOTAL (a hostile payload degrades, never throws). */

import type { CommandRecord } from './types'
import { parseCallArgs } from './fileOps'

/** The tools whose calls are command executions. `bash` also covers the persistent-shell variant (same tool name; its
 * result carries the `[Command finished with exit code N]` marker family instead). */
export function commandTool(tool: string | undefined): 'bash' | 'pwsh' | 'run_code' | null {
  if (tool === 'bash' || tool === 'pwsh' || tool === 'run_code') return tool
  return null
}

/** The call-argument facts a record books. Every field is optional in the wild except the command text itself. */
export interface CommandArgs {
  cmd: string
  description?: string
  cwd?: string
  timeoutMs?: number
  background?: true
  sandbox?: string
}

function stringOf(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}

/** Normalize the durable call arguments (a JSON string in `tool/call`, an already-normalized object in a PTC dispatch). */
export function commandArgsRecordOf(value: unknown): Record<string, unknown> | null {
  if (typeof value === 'string') return parseCallArgs(value)
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
  return null
}

/** Parse the arguments of a command-bearing call. The command text caps at `maxChars`; an unreadable or command-less
 * payload books nothing. */
export function commandArgsOf(tool: string, raw: unknown, maxChars: number): (CommandArgs & { truncated?: true }) | null {
  const args = commandArgsRecordOf(raw)
  const cmd = tool === 'run_code' ? stringOf(args?.code) : stringOf(args?.command)
  if (cmd === undefined) return null
  const out: CommandArgs & { truncated?: true } = {
    cmd: cmd.length > maxChars ? cmd.slice(0, maxChars) : cmd,
    ...(cmd.length > maxChars ? { truncated: true as const } : {}),
  }
  const description = stringOf(args?.description)
  if (description !== undefined) out.description = description
  const workdir = stringOf(args?.workdir)
  if (workdir !== undefined) out.cwd = workdir
  const timeoutMs = args?.timeoutMs
  if (typeof timeoutMs === 'number' && Number.isFinite(timeoutMs) && timeoutMs > 0) out.timeoutMs = timeoutMs
  if (args?.run_in_background === true) out.background = true
  const sandbox = stringOf(args?.sandbox_permissions)
  if (sandbox !== undefined) out.sandbox = sandbox
  return out
}

/** The facts the fold parses off a shell result's rendered text. The shell tools append their status markers at the
 * very end (render.ts keeps the exit marker last), so the exit/signal reads anchor at the tail like dsh's own
 * `parseExitStatus`; the persistent-shell family prints `[Command finished with exit code N]` (also on a clean exit). */
export interface CommandMarkers {
  /** An explicit exit code, from either marker family. */
  exit?: number
  signal?: string
  timedOut?: true
  stopped?: true
  denied?: true
  truncated?: true
  stderr?: true
  /** The result is a background hand-off ack, not an outcome (`started background job …` / `[still running …]`). */
  backgroundAck?: true
}

// The promoted marker is followed by dsh's fixed hand-off guidance sentence (both shell tools share it), so it
// matches the marker only with that sentence attached — a spoofed lookalike line mid-output never qualifies.
const PROMOTED_ACK = new RegExp(
  '(?:^|\\n)\\[still running after \\d+ms; moved to background job [^\\]\\n]+\\]'
  + '(?:\\nThe command keeps running in the background\\.[^\\n]*)?\\s*$',
)

export function markersOfText(text: string): CommandMarkers {
  const out: CommandMarkers = {}
  const acked = /(?:^|\n)started background job \S+\s*$/.test(text) || PROMOTED_ACK.test(text)
  if (acked) {
    out.backgroundAck = true
    return out
  }
  const signal = /(?:^|\n)\[killed by signal: ([^\]\n]+)\]\s*$/.exec(text)
    ?? /(?:^|\n)\[shell killed by signal: ([^\]\n]+)\](?=\n|$)/.exec(text)
  if (signal?.[1] !== undefined) out.signal = signal[1]
  else {
    const exit = /(?:^|\n)\[exit code: (\d+)\]\s*$/.exec(text)
      ?? /(?:^|\n)\[Command finished with exit code (\d+)\]\s*$/.exec(text)
      ?? /(?:^|\n)\[shell exited: code (\d+)\](?=\n|$)/.exec(text)
    if (exit?.[1] !== undefined) out.exit = Number(exit[1])
    // The persistent shell died without a code: the run was interrupted.
    else if (/(?:^|\n)\[shell exited\](?=\n|$)/.test(text)) out.stopped = true
  }
  if (/(?:^|\n)\[timed out after \d+ms\](?=\n|$)/.test(text)) out.timedOut = true
  if (/(?:^|\n)\[Command timed out or OOM\](?=\n|$)/.test(text)) out.timedOut = true
  if (/(?:^|\n)\[stopped: [^\]\n]+\](?=\n|$)/.test(text)) out.stopped = true
  if (/(?:^|\n)\[sandbox: file access denied under [^\]\n]+\](?=\n|$)/.test(text)) out.denied = true
  if (/(?:^|\n)\[output truncated; /.test(text)) out.truncated = true
  if (/(?:^|\n)\[stderr\]\n/.test(text)) out.stderr = true
  return out
}

/** The exit code out of a settled job's detail line (`exit code: 3`, optionally followed by sandbox notes). */
export function exitOfJobDetail(detail: unknown): number | undefined {
  if (typeof detail !== 'string') return undefined
  const match = /(?:^|;\s*)exit code: (\d+)\b/.exec(detail)
  return match?.[1] === undefined ? undefined : Number(match[1])
}

/** The signal out of a killed job's detail line (`signal: SIGTERM`, or `killed before exit` → none). */
export function signalOfJobDetail(detail: unknown): string | undefined {
  if (typeof detail !== 'string') return undefined
  const match = /(?:^|;\s*)signal: ([^;]+)/.exec(detail)
  return match?.[1]?.trim() || undefined
}

/** Terminal status off the parsed markers: a signal/stop kills, a denial or nonzero exit or an infrastructure error
 * fails, anything else completes. `exit`/`exitInferred` land on the record — the inferred 0 is the shell tools' own
 * convention (no marker on a clean exit), never a fabricated value. */
export function outcomeOfMarkers(markers: CommandMarkers, isError: boolean): Pick<CommandRecord, 'status' | 'exit' | 'exitInferred'> {
  if (markers.signal !== undefined || markers.stopped === true) return { status: 'killed' }
  if (markers.exit !== undefined) return markers.exit === 0 ? { status: 'completed', exit: 0 } : { status: 'failed', exit: markers.exit }
  // A bare timeout with no exit resolution (the persistent shell's `[Command timed out or OOM]`) is an interruption, not a success.
  if (markers.denied === true || markers.timedOut === true || isError) return { status: 'failed' }
  return { status: 'completed', exit: 0, exitInferred: true }
}

/** The first line for the collapsed row; multi-line commands show it with a line-count badge. */
export function firstLineOf(cmd: string): string {
  const nl = cmd.indexOf('\n')
  return (nl < 0 ? cmd : cmd.slice(0, nl)).trim()
}

/** A leading `cd <workspace> && ` prefix is navigation noise when it targets the session's own workspace; the collapsed
 * row hides exactly that one prefix (anything else stays — it carries real information). */
export function hideableCdPrefix(cmd: string, workspace: string | undefined): number {
  if (workspace === undefined || workspace === '') return 0
  const root = workspace.replace(/\/+$/, '')
  if (root === '') return 0
  const match = /^\s*cd\s+(\S+|"[^"]*"|'[^']*')\s*&&\s*/.exec(cmd)
  if (match === null) return 0
  const target = match[1].replace(/^["']|["']$/g, '').replace(/\/+$/, '')
  return target === root ? match[0].length : 0
}

export interface CommandShape {
  lines: number
  heredoc: boolean
  /** An inline interpreter script (`node -e`, `python3 -c`, …). */
  inline: boolean
}

/** Cheap display badges off the raw text; deliberately NOT a shell parser — the row is a preview, not an audit. */
export function shapeOfCmd(cmd: string): CommandShape {
  let lines = 1
  for (let i = 0; i < cmd.length; i++) if (cmd[i] === '\n') lines++
  return {
    lines,
    heredoc: /<<-?\s*['"]?\w/.test(cmd),
    inline: /(?:^|[|;&]\s*)(?:node|deno|bun|python3?|ruby|perl|php)\s+(?:[^\n|;&]*\s)?-[ec]\s/.test(cmd),
  }
}
