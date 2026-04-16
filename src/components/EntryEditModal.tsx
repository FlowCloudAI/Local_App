import {useEffect, useState} from 'react'
import {listen} from '@tauri-apps/api/event'
import {confirm_entry_edit, ENTRY_EDIT_REQUEST, type EntryEditRequestEvent,} from '../api'
import './EntryEditModal.css'

export default function EntryEditModal() {
    const [pending, setPending] = useState<EntryEditRequestEvent | null>(null)
    const [busy, setBusy] = useState(false)

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
        setBusy(true)
        await confirm_entry_edit(pending.request_id, confirmed).catch(console.error)
        setPending(null)
        setBusy(false)
    }

    if (!pending) return null

    return (
        <div className="eem-overlay">
            <div className="eem-dialog">
                <div className="eem-header">
                    <span className="eem-title">AI 编辑请求</span>
                    <span className="eem-entry-name">{pending.entry_title}</span>
                </div>

                <div className="eem-body">
                    <DiffView before={pending.before_content} after={pending.after_content}/>
                </div>

                <div className="eem-footer">
                    <button
                        className="eem-btn eem-btn-cancel"
                        onClick={() => void respond(false)}
                        disabled={busy}
                    >
                        取消
                    </button>
                    <button
                        className="eem-btn eem-btn-confirm"
                        onClick={() => void respond(true)}
                        disabled={busy}
                    >
                        确认修改
                    </button>
                </div>
            </div>
        </div>
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

    // backtrack
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
