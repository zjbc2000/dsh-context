/** The command panel's derivation: the served execution log joined with the archive's `gone` stamps, plus the display
 * reads (preview text, duration, filter/sort) the card maps over. */

import type { CommandRecord, CommandStats, SurfaceNode } from '../shared/types'
import { firstLineOf, hideableCdPrefix } from '../shared/commands'

export type Command = CommandRecord
export type CommandFilter = 'all' | 'failed' | 'slow' | 'background'
export type CommandSort = 'latest' | 'slowest'

/** A run at or past this wall time earns the Slow chip. */
export const SLOW_MS = 10_000

/** The surface node the run's result lives on: a nested Code-Mode record reveals on its parent run_code result;
 * a run without a result yet has nothing to reveal. */
export function surfaceSeqOf(rec: CommandRecord): number | undefined {
  return rec.parent ?? rec.resultSeq
}

/** `gone` joins off the archive exactly like the file-op log's (fileActivity.activityOfOps). */
export function commandsOf(records: readonly CommandRecord[], archive: readonly SurfaceNode[]): Command[] {
  const goneBySeq = new Map<number, number>()
  for (const n of archive) if (n.gone !== undefined) goneBySeq.set(n.seq, n.gone)
  return records.map((rec) => {
    const key = surfaceSeqOf(rec)
    const gone = key === undefined ? undefined : goneBySeq.get(key)
    return gone !== undefined && rec.gone === undefined ? { ...rec, gone } : rec
  })
}

export function durationOf(rec: CommandRecord): number | undefined {
  return rec.end === undefined ? undefined : Math.max(0, rec.end - rec.start)
}

/** The collapsed row's command text: the first line, minus a leading `cd <workspace> && ` prefix. */
export function previewOf(rec: CommandRecord, workspace: string | undefined): string {
  return firstLineOf(rec.cmd.slice(hideableCdPrefix(rec.cmd, workspace)))
}

export function matchesFilter(rec: CommandRecord, filter: CommandFilter): boolean {
  if (filter === 'failed') return rec.status === 'failed' || rec.status === 'killed'
  if (filter === 'slow') {
    const d = durationOf(rec)
    return d !== undefined && d >= SLOW_MS
  }
  if (filter === 'background') return rec.background === true
  return true
}

export function matchesQuery(rec: CommandRecord, q: string): boolean {
  if (q === '') return true
  const needle = q.toLowerCase()
  if (rec.cmd.toLowerCase().includes(needle)) return true
  if (rec.description !== undefined && rec.description.toLowerCase().includes(needle)) return true
  return rec.cwd !== undefined && rec.cwd.toLowerCase().includes(needle)
}

export function byLatest(a: CommandRecord, b: CommandRecord): number {
  return (b.time - a.time) || (b.seq - a.seq)
}

export function bySlowest(a: CommandRecord, b: CommandRecord): number {
  return (durationOf(b) ?? -1) - (durationOf(a) ?? -1) || byLatest(a, b)
}

/** The title tally's fallback when the host serves no whole-log stats (a pre-field row): count the retained list. */
export function tallyOfCommands(records: readonly CommandRecord[]): CommandStats {
  const stats: CommandStats = { runs: 0, failed: 0, ms: 0, bg: 0 }
  for (const rec of records) {
    if (rec.status === 'running') continue
    stats.runs += 1
    if (rec.status === 'failed' || rec.status === 'killed') stats.failed += 1
    const d = durationOf(rec)
    if (d !== undefined) stats.ms += d
    if (rec.background === true) stats.bg += 1
  }
  return stats
}
