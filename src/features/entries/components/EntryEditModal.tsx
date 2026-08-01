import {logger} from '../../../shared/logger'
import {useEffect, useMemo, useRef, useState} from 'react'
import {Button, useAlert} from 'flowcloudai-ui'
import {listen} from '../../../api/events'
import {confirm_entry_edit, ENTRY_EDIT_REQUEST, type EntryEditRequestEvent,} from '../../../api'
import {FloatingPanel} from '../../../shared/ui/overlay'
import {
    buildEntryContentDiffPresentation,
    computeEntryContentDiff,
    type EntryContentDiffDisplayLine,
    resolveActiveEntryContentDiffHunk,
} from '../lib/entryContentDiff'
import './EntryEditModal.css'

export default function EntryEditModal() {
    const [pending, setPending] = useState<EntryEditRequestEvent | null>(null)
    const [busy, setBusy] = useState(false)
    const {showAlert} = useAlert()

    useEffect(() => {
        const unlisten = listen<EntryEditRequestEvent>(ENTRY_EDIT_REQUEST, event => {
            setPending(event.payload)
            setBusy(false)
        })
        return () => {
            unlisten.then(fn => fn())
        }
    }, [])

    const respond = async (confirmed: boolean) => {
        if (!pending || busy) return
        const requestId = pending.request_id
        setBusy(true)
        try {
            const delivered = await confirm_entry_edit(requestId, confirmed)
            setPending(current => current?.request_id === requestId ? null : current)
            if (!delivered) {
                void showAlert(
                    '审阅请求已结束，修改未应用。',
                    'info',
                    'nonInvasive',
                    2200,
                )
            }
        } catch (error) {
            logger.error('confirm entry edit failed', error)
            void showAlert(
                confirmed ? '应用修改失败，请重试。' : '未能拒绝此次修改，请重试。',
                'error',
                'nonInvasive',
                2200,
            )
        } finally {
            setBusy(false)
        }
    }

    return (
        <FloatingPanel
            open={!!pending}
            onClose={() => void respond(false)}
            dismissible={!busy}
            title="AI 编辑请求"
            ariaLabel="AI 编辑请求"
            closeLabel="不应用并关闭"
            className="eem-dialog"
        >
            {pending && (
                <>
                <div className="eem-entry-name" title={pending.entry_title}>
                    正在修改：<strong>{pending.entry_title}</strong>
                </div>

                <div className="eem-body">
                    <DiffView
                        key={pending.request_id}
                        before={pending.before_content}
                        after={pending.after_content}
                    />
                </div>

                <div className="eem-footer">
                    <Button
                        type="button"
                        className="eem-btn eem-btn-cancel"
                        variant="outline"
                        size="sm"
                        onClick={() => void respond(false)}
                        disabled={busy}
                    >
                        不应用
                    </Button>
                    <Button
                        type="button"
                        className="eem-btn eem-btn-confirm"
                        variant="primary"
                        size="sm"
                        onClick={() => void respond(true)}
                        disabled={busy}
                    >
                        应用全部修改
                    </Button>
                </div>
                </>
            )}
        </FloatingPanel>
    )
}

function DiffView({before, after}: { before: string; after: string }) {
    const [expanded, setExpanded] = useState(false)
    const [activeHunk, setActiveHunk] = useState(0)
    const hunkElements = useRef<Array<HTMLDivElement | null>>([])
    const diffElement = useRef<HTMLDivElement | null>(null)
    const lines = useMemo(() => computeEntryContentDiff(before, after), [after, before])
    const presentation = useMemo(
        () => buildEntryContentDiffPresentation(lines, expanded),
        [expanded, lines],
    )
    const hasChanges = lines.some(l => l.type !== 'unchanged')

    useEffect(() => {
        const scrollContainer = diffElement.current
        if (!scrollContainer || presentation.hunkCount < 2) return
        let frame = 0

        const syncActiveHunk = () => {
            cancelAnimationFrame(frame)
            frame = requestAnimationFrame(() => {
                const anchorTop = scrollContainer.getBoundingClientRect().top
                const hunkTops = hunkElements.current
                    .slice(0, presentation.hunkCount)
                    .map(element => element?.getBoundingClientRect().top ?? Number.POSITIVE_INFINITY)
                setActiveHunk(current => {
                    const next = resolveActiveEntryContentDiffHunk(hunkTops, anchorTop)
                    return current === next ? current : next
                })
            })
        }

        syncActiveHunk()
        scrollContainer.addEventListener('scroll', syncActiveHunk, {passive: true})
        return () => {
            cancelAnimationFrame(frame)
            scrollContainer.removeEventListener('scroll', syncActiveHunk)
        }
    }, [expanded, presentation.hunkCount])

    if (!hasChanges) {
        return <div className="eem-diff-empty">内容无变化</div>
    }

    const jumpToHunk = (nextHunk: number) => {
        const normalizedHunk = (nextHunk + presentation.hunkCount) % presentation.hunkCount
        setActiveHunk(normalizedHunk)
        hunkElements.current[normalizedHunk]?.scrollIntoView({behavior: 'smooth', block: 'center'})
    }

    return (
        <>
            <div className="eem-diff-toolbar-shell">
                <div className="eem-diff-toolbar">
                    <div className="eem-diff-summary">
                        <strong>{presentation.hunkCount} 处变更</strong>
                        <span className="eem-diff-summary-removed">删除 {presentation.removedCount} 行</span>
                        <span className="eem-diff-summary-added">新增 {presentation.addedCount} 行</span>
                    </div>
                    <div className="eem-diff-actions">
                        {presentation.hunkCount > 1 && (
                            <>
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => jumpToHunk(activeHunk - 1)}
                                >
                                    上一处
                                </Button>
                                <span className="eem-diff-position">{activeHunk + 1}/{presentation.hunkCount}</span>
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => jumpToHunk(activeHunk + 1)}
                                >
                                    下一处
                                </Button>
                            </>
                        )}
                        <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => setExpanded(current => !current)}
                            aria-pressed={expanded}
                        >
                            {expanded ? '只看变更' : '展开全文'}
                        </Button>
                    </div>
                </div>
            </div>
            <div ref={diffElement} className="eem-diff" role="list" aria-label="正文修改差异">
                {presentation.rows.map(row => row.kind === 'omitted' ? (
                    <div key={`omitted-${row.sourceIndex}`} className="eem-diff-omitted">
                        已收起 {row.count} 行未修改内容
                    </div>
                ) : (
                    <DiffLine
                        key={row.sourceIndex}
                        line={row}
                        hunkRef={element => {
                            if (row.hunkStart && row.hunkIndex !== undefined) {
                                hunkElements.current[row.hunkIndex] = element
                            }
                        }}
                    />
                ))}
            </div>
        </>
    )
}

function DiffLine({
                      line,
                      hunkRef,
                  }: {
    line: EntryContentDiffDisplayLine
    hunkRef: (element: HTMLDivElement | null) => void
}) {
    const changeLabel = line.type === 'removed'
        ? `删除内容：${line.text}`
        : line.type === 'added'
            ? `新增内容：${line.text}`
            : undefined

    return (
        <div
            ref={hunkRef}
            className={`eem-diff-line eem-diff-${line.type}`}
            role="listitem"
            aria-label={changeLabel}
        >
            <span className="eem-diff-marker" aria-hidden="true">
                {line.type === 'removed' ? '−' : line.type === 'added' ? '+' : ' '}
            </span>
            <span className="eem-diff-text" aria-hidden={changeLabel ? 'true' : undefined}>
                {line.segments.map((segment, index) => (
                    <span
                        key={index}
                        className={segment.changed ? `eem-diff-inline-${line.type}` : undefined}
                    >
                        {segment.text}
                    </span>
                ))}
            </span>
        </div>
    )
}
