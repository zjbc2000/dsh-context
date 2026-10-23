import { memo, useMemo, useState, type ChangeEvent, type ComponentType, type MouseEvent, type ReactElement } from 'react'
import { byLatest, bySlowest, durationOf, matchesFilter, matchesQuery, previewOf, tallyOfCommands } from '../commands'
import type { Command, CommandFilter, CommandSort } from '../commands'
import { shapeOfCmd } from '../../shared/commands'
import type { CommandStats } from '../../shared/types'
import type { DetailState } from '../timelineSource'
import type { ViewKit } from '../viewkit'
import { makeDetailNote } from './detailNote'

export interface CommandPanelProps {
  commands: Command[]
  /** Whole-log tallies (survive list trimming); absent = the retained list counts itself. */
  stats?: CommandStats
  /** Set when the log trimmed: the list covers only the latest runs. */
  floor?: number
  workspace?: string
  /** The turn/step whose request first carried a run's result node, by node seq; absent = rows print no stamps. */
  stampOf?: (seq: number) => { turn: number; step: number } | null
  /** Reveal the run's result message in the Context Browser; absent = no reveal affordance. */
  onLocate?: (rec: Command) => void
  state?: DetailState
  onRetry?: () => void
}

export function makeCommandPanel(kit: ViewKit): ComponentType<CommandPanelProps> {
  const { t, fmt, fmtTime, fmtDuration } = kit
  const DetailNote = makeDetailNote(kit)

  const FILTERS: readonly CommandFilter[] = ['all', 'failed', 'slow', 'background']
  const SORTS: readonly CommandSort[] = ['latest', 'slowest']

  function statusGlyphOf(rec: Command): { glyph: string; cls: string; tip: string } {
    if (rec.status === 'running') return { glyph: '◐', cls: 'run', tip: t('cmds.status.running') }
    if (rec.status === 'completed') return { glyph: '✓', cls: 'ok', tip: t('cmds.status.completed') }
    if (rec.status === 'failed') return { glyph: '✕', cls: 'fail', tip: t('cmds.status.failed') }
    return { glyph: '⊘', cls: 'kill', tip: t(rec.stopped === true ? 'cmds.status.stopped' : 'cmds.status.killed') }
  }

  return memo(function CommandPanel(props: CommandPanelProps): ReactElement {
    const { commands } = props
    const [filter, setFilter] = useState<CommandFilter>('all')
    const [sort, setSort] = useState<CommandSort>('latest')
    const [query, setQuery] = useState('')
    const [openSeq, setOpenSeq] = useState<number | null>(null)
    const [copiedSeq, setCopiedSeq] = useState<number | null>(null)

    const q = query.trim().toLowerCase()
    // Every matched row renders — the list is the whole point. Offscreen rows skip their paint via
    // `content-visibility: auto` (the file card's own idiom), so a 400-row log costs no layout storm.
    const shown = useMemo(
      () => commands
        .filter(rec => matchesFilter(rec, filter) && matchesQuery(rec, q))
        .sort(sort === 'slowest' ? bySlowest : byLatest),
      [commands, filter, q, sort],
    )
    const tally = props.stats ?? tallyOfCommands(commands)
    const counts = useMemo(() => ({
      all: commands.length,
      failed: commands.filter(r => matchesFilter(r, 'failed')).length,
      slow: commands.filter(r => matchesFilter(r, 'slow')).length,
      background: commands.filter(r => matchesFilter(r, 'background')).length,
    }), [commands])

    const copyCommand = (rec: Command): void => {
      const clipboard = (globalThis.navigator as { clipboard?: { writeText?: unknown } } | undefined)?.clipboard
      if (typeof clipboard?.writeText !== 'function') return
      void (clipboard.writeText as (text: string) => Promise<void>).call(clipboard, rec.cmd).then(() => {
        setCopiedSeq(rec.seq)
        setTimeout(() => { setCopiedSeq(cur => (cur === rec.seq ? null : cur)) }, 1200)
      }, () => {})
    }

    const detailOf = (rec: Command): ReactElement => {
      const target = rec.parent ?? rec.resultSeq
      const locatable = props.onLocate !== undefined && target !== undefined
      const facts: ReactElement[] = []
      if (rec.exit !== undefined && rec.tool !== 'run_code') {
        facts.push(
          <span key="exit" title={rec.exitInferred === true ? t('cmds.exitInferredTip') : undefined}>
            {t('cmds.exit', { n: rec.exit })}{rec.exitInferred === true ? ' ≈' : ''}
          </span>,
        )
      }
      const d = durationOf(rec)
      if (d !== undefined) {
        facts.push(
          <span key="dur" title={rec.derived === true ? t('cmds.derivedTip') : undefined}>
            {rec.derived === true ? '≈' : ''}{fmtDuration(d)}
          </span>,
        )
      }
      if (rec.cwd !== undefined) facts.push(<span key="cwd" className="lc-cmd-fact-cwd" title={rec.cwd}>{rec.cwd}</span>)
      if (rec.timeoutMs !== undefined) facts.push(<span key="to">{t('cmds.timeoutSet', { t: fmtDuration(rec.timeoutMs) })}</span>)
      if (rec.outChars !== undefined) {
        facts.push(
          <span key="out">
            {t('cmds.output', { n: fmt(rec.outChars) })}
            {rec.outTruncated === true ? <em>{t('cmds.outTruncated')}</em> : null}
          </span>,
        )
      }
      if (rec.stderr === true) facts.push(<span key="err">{t('cmds.hasStderr')}</span>)
      if (rec.timedOut === true) facts.push(<span key="tout">{t('cmds.timedOut')}</span>)
      if (rec.denied === true) facts.push(<span key="deny">{t('cmds.denied')}</span>)
      if (rec.signal !== undefined) facts.push(<span key="sig">{t('cmds.signalOf', { s: rec.signal })}</span>)
      if (rec.sandbox !== undefined) facts.push(<span key="sand">{t('cmds.sandboxAsk', { s: rec.sandbox })}</span>)
      const stamp = target !== undefined ? props.stampOf?.(target) ?? null : null
      return (
        <div className="lc-cmd-detail">
          {rec.description !== undefined ? <div className="lc-cmd-why">{rec.description}</div> : null}
          <pre className="lc-cmd-full">{rec.cmd}{rec.cmdTruncated === true ? ' …' : ''}</pre>
          <div className="lc-cmd-facts">{facts}</div>
          <div className="lc-cmd-actions">
            {locatable ? (
              <button type="button" className="lc-cmd-act" onClick={() => { props.onLocate?.(rec) }}>
                {t('cmds.reveal')}{stamp !== null ? ` · ${t('browser.stepAt', { t: stamp.turn, s: stamp.step })}` : ''}
              </button>
            ) : null}
            <button type="button" className="lc-cmd-act" onClick={() => { copyCommand(rec) }}>
              {copiedSeq === rec.seq ? t('cmds.copied') : t('cmds.copy')}
            </button>
          </div>
        </div>
      )
    }

    const rowOf = (rec: Command): ReactElement => {
      const open = openSeq === rec.seq
      const shape = shapeOfCmd(rec.cmd)
      const st = statusGlyphOf(rec)
      const preview = previewOf(rec, props.workspace)
      const d = durationOf(rec)
      const target = rec.parent ?? rec.resultSeq
      const stamp = target !== undefined ? props.stampOf?.(target) ?? null : null
      const locatable = props.onLocate !== undefined && target !== undefined
      return (
        <div key={rec.seq} className={'lc-cmd-item' + (open ? ' lc-cmd-item-on' : '')}>
          <button
            type="button"
            className="lc-cmd-row hover:bg-(--dsw-alias-interactive-bg-hover)"
            title={rec.description ?? preview}
            onClick={() => { setOpenSeq(open ? null : rec.seq) }}
          >
            <span className={'lc-br-chev' + (open ? ' lc-br-chev-on' : '')} />
            <span className={'lc-cmd-st lc-cmd-st-' + st.cls} title={st.tip}>{st.glyph}</span>
            <span className="lc-cmd-cmd">
              {rec.tool !== 'bash' ? <span className="lc-cmd-tool">{rec.tool === 'run_code' ? t('cmds.tool.code') : rec.tool}</span> : null}
              {rec.codeMode === true && rec.tool === 'bash' ? <span className="lc-cmd-tool">{t('cmds.tool.nested')}</span> : null}
              {preview}
            </span>
            <span className="lc-cmd-badges">
              {shape.lines > 1 ? <span className="lc-cmd-badge">{t('cmds.lines', { n: shape.lines })}</span> : null}
              {shape.heredoc ? <span className="lc-cmd-badge">{t('cmds.heredoc')}</span> : null}
              {shape.inline ? <span className="lc-cmd-badge">{t('cmds.inline')}</span> : null}
              {rec.background === true ? <span className="lc-cmd-badge lc-cmd-badge-bg">{t('cmds.bgBadge')}</span> : null}
            </span>
            {d !== undefined
              ? (
                <span className="lc-cmd-dur" title={rec.derived === true ? t('cmds.derivedTip') : undefined}>
                  {rec.derived === true ? '≈' : ''}{fmtDuration(d)}
                </span>
              )
              : <span className="lc-cmd-dur lc-cmd-dur-run">{t('cmds.status.running')}</span>}
            {locatable
              ? (
                <span
                  className="lc-cmd-time lc-cmd-time-link"
                  role="link"
                  title={t('cmds.revealTip')}
                  onClick={(ev: MouseEvent) => {
                    ev.stopPropagation()
                    props.onLocate?.(rec)
                  }}
                >
                  {stamp !== null ? t('browser.stepAt', { t: stamp.turn, s: stamp.step }) + ' · ' : ''}{fmtTime(rec.time)}
                </span>
              )
              : <span className="lc-cmd-time">{stamp !== null ? t('browser.stepAt', { t: stamp.turn, s: stamp.step }) + ' · ' : ''}{fmtTime(rec.time)}</span>}
          </button>
          {open ? detailOf(rec) : null}
        </div>
      )
    }

    return (
      <div className="lc-card lc-cmd-card lc-col flex-1 min-w-[min(360px,100%)]">
        <div className="lc-card-title">
          <span className="lc-card-title-text">{t('cmds.title')}</span>
          <span className="lc-cmd-meta">
            <span>{t('cmds.runs', { n: fmt(tally.runs) })}</span>
            {tally.failed > 0 ? <span className="lc-cmd-meta-fail">{t('cmds.failed', { n: fmt(tally.failed) })}</span> : null}
            {tally.ms > 0 ? <span>{fmtDuration(tally.ms)}</span> : null}
          </span>
          <div className="lc-gran lc-cmd-chips @max-[380px]/lc-card:flex-wrap">
            {FILTERS.map(f => (
              <button
                key={f}
                type="button"
                className={'lc-gran-btn' + (filter === f ? ' lc-gran-on' : '')}
                onClick={() => { setFilter(cur => (cur === f ? 'all' : f)) }}
              >
                {t('cmds.filter.' + f)}
                <b className="lc-fa-n">{fmt(counts[f])}</b>
              </button>
            ))}
          </div>
        </div>
        <div>
          <div className="lc-cmd-ctl">
            <input
              className="lc-fa-search focus:border-(--dsw-alias-label-dimmed)"
              value={query}
              placeholder={t('cmds.search')}
              onChange={(ev: ChangeEvent<HTMLInputElement>) => { setQuery(ev.target.value) }}
            />
            <span className="lc-gran lc-fa-sort" role="group" title={t('cmds.sortTip')}>
              {SORTS.map(k => (
                <button
                  key={k}
                  type="button"
                  className={'lc-gran-btn' + (sort === k ? ' lc-gran-on' : '')}
                  onClick={() => { setSort(k) }}
                >
                  {t('cmds.sort.' + k)}
                </button>
              ))}
            </span>
          </div>
          {/* The trim floor sits ahead of the list: below a long list it would never be seen. */}
          {props.floor !== undefined && commands.length > 0 ? (
            <div className="lc-cmd-floor">{t('cmds.coverage', { n: fmt(commands.length) })}</div>
          ) : null}
          {commands.length === 0 && props.state === 'loading' ? (
            <DetailNote state="loading" className="lc-empty lc-lane" />
          ) : commands.length === 0 && props.state === 'failed' && props.onRetry !== undefined ? (
            <DetailNote state="failed" onRetry={props.onRetry} className="lc-empty lc-lane" />
          ) : shown.length === 0 ? (
            <div className="lc-empty lc-lane">{t(commands.length === 0 ? 'cmds.empty' : 'cmds.noMatch')}</div>
          ) : (
            <div className="lc-cmd-list">
              {shown.map(rowOf)}
            </div>
          )}
        </div>
      </div>
    )
  })
}
