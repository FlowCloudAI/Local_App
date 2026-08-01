import {logger} from '../../../shared/logger'
import {useEffect, useState} from 'react'
import {Button, useAlert} from 'flowcloudai-ui'
import {listen} from '../../../api/events'
import {confirm_entry_edit, ENTRY_EDIT_REQUEST, type EntryEditRequestEvent,} from '../../../api'
import {FloatingPanel} from '../../../shared/ui/overlay'
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
            await confirm_entry_edit(requestId, confirmed)
            setPending(current => current?.request_id === requestId ? null : current)
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
            className="eem-dialog"
        >
            {pending && (
                <>
                <div className="eem-entry-name" title={pending.entry_title}>
                    正在修改：<strong>{pending.entry_title}</strong>
                </div>

                <div className="eem-body">
                    <DiffView before={pending.before_content} after={pending.after_content}/>
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

// ── 简单行级 diff 展示 ────────────────────────────────────────────────────────

interface DiffLine {
    type: 'unchanged' | 'removed' | 'added'
    text: string
    lineNo?: number
}

function computeDiff(before: string, after: string): DiffLine[] {
    const a = before === '' ? [] : before.split('\n')
    const b = after === '' ? [] : after.split('\n')

    // Myers diff (O(ND)) — 简化版 LCS
    const m = a.length
    const n = b.length
    const max = m + n
    const v: number[] = new Array(2 * max + 1).fill(0)
    const trace: number[][] = []

    outer: for (let d = 0; d <= max; d++) {
        trace.push([...v])
        for (let k = -d; k <= d; k += 2) {
            const ki = k + max
            let x: number
            if (k === -d || (k !== d && v[ki - 1] < v[ki + 1])) {
                x = v[ki + 1]
            } else {
                x = v[ki - 1] + 1
            }
            let y = x - k
            while (x < m && y < n && a[x] === b[y]) {
                x++;
                y++
            }
            v[ki] = x
            if (x >= m && y >= n) break outer
        }
    }

    // 回溯
    const ops: Array<[number, number, number, number]> = []
    let x = m, y = n
    for (let d = trace.length - 1; d >= 0; d--) {
        const vd = trace[d]
        const k = x - y
        const ki = k + max
        let prevK: number
        if (k === -d || (k !== d && vd[ki - 1] < vd[ki + 1])) {
            prevK = k + 1
        } else {
            prevK = k - 1
        }
        const prevX = vd[prevK + max]
        const prevY = prevX - prevK
        while (x > prevX && y > prevY) {
            x--;
            y--;
            ops.unshift([0, x, y, 0])
        }
        if (d > 0) {
            if (x === prevX) {
                ops.unshift([1, prevX, prevY, 0]);
                y--
            } else {
                ops.unshift([-1, prevX, prevY, 0]);
                x--
            }
        }
        x = prevX;
        y = prevY
    }

    const result: DiffLine[] = []
    let aIdx = 0, bIdx = 0
    for (const [type] of ops) {
        if (type === 0) {
            result.push({type: 'unchanged', text: a[aIdx], lineNo: aIdx + 1})
            aIdx++;
            bIdx++
        } else if (type === -1) {
            result.push({type: 'removed', text: a[aIdx]})
            aIdx++
        } else {
            result.push({type: 'added', text: b[bIdx]})
            bIdx++
        }
    }
    return result
}

function DiffView({before, after}: { before: string; after: string }) {
    const lines = computeDiff(before, after)
    const hasChanges = lines.some(l => l.type !== 'unchanged')

    if (!hasChanges) {
        return <div className="eem-diff-empty">内容无变化</div>
    }

    return (
        <div className="eem-diff">
            {lines.map((line, i) => (
                <div key={i} className={`eem-diff-line eem-diff-${line.type}`}>
                    <span className="eem-diff-marker">
                        {line.type === 'removed' ? '−' : line.type === 'added' ? '+' : ' '}
                    </span>
                    <span className="eem-diff-text">{line.text}</span>
                </div>
            ))}
        </div>
    )
}
