/**
 * 生成词条正文的行级差异，并为审阅界面补充变更分组、上下文折叠与段内高亮信息。
 */

export type EntryContentDiffLineType = 'unchanged' | 'removed' | 'added'

export interface EntryContentDiffSegment {
    text: string
    changed: boolean
}

export interface EntryContentDiffLine {
    type: EntryContentDiffLineType
    text: string
}

export interface EntryContentDiffDisplayLine extends EntryContentDiffLine {
    kind: 'line'
    sourceIndex: number
    hunkIndex?: number
    hunkStart: boolean
    segments: EntryContentDiffSegment[]
}

export interface EntryContentDiffOmission {
    kind: 'omitted'
    sourceIndex: number
    count: number
}

export type EntryContentDiffRow = EntryContentDiffDisplayLine | EntryContentDiffOmission

export interface EntryContentDiffPresentation {
    rows: EntryContentDiffRow[]
    addedCount: number
    removedCount: number
    hunkCount: number
}

export function computeEntryContentDiff(before: string, after: string): EntryContentDiffLine[] {
    const a = before === '' ? [] : before.split('\n')
    const b = after === '' ? [] : after.split('\n')
    if (a.length === 0 && b.length === 0) return []
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
                x++
                y++
            }
            v[ki] = x
            if (x >= m && y >= n) break outer
        }
    }

    const ops: number[] = []
    let x = m
    let y = n
    for (let d = trace.length - 1; d >= 0; d--) {
        const vd = trace[d]
        const k = x - y
        const ki = k + max
        const prevK = k === -d || (k !== d && vd[ki - 1] < vd[ki + 1]) ? k + 1 : k - 1
        const prevX = vd[prevK + max]
        const prevY = prevX - prevK
        while (x > prevX && y > prevY) {
            x--
            y--
            ops.unshift(0)
        }
        if (d > 0) {
            if (x === prevX) {
                ops.unshift(1)
                y--
            } else {
                ops.unshift(-1)
                x--
            }
        }
        x = prevX
        y = prevY
    }

    const result: EntryContentDiffLine[] = []
    let aIndex = 0
    let bIndex = 0
    for (const type of ops) {
        if (type === 0) {
            result.push({type: 'unchanged', text: a[aIndex]})
            aIndex++
            bIndex++
        } else if (type === -1) {
            result.push({type: 'removed', text: a[aIndex]})
            aIndex++
        } else {
            result.push({type: 'added', text: b[bIndex]})
            bIndex++
        }
    }
    return result
}

export function buildEntryContentDiffPresentation(
    lines: EntryContentDiffLine[],
    expanded: boolean,
    contextLines = 1,
): EntryContentDiffPresentation {
    const displayLines: EntryContentDiffDisplayLine[] = lines.map((line, sourceIndex) => ({
        ...line,
        kind: 'line',
        sourceIndex,
        hunkStart: false,
        segments: [{text: line.text, changed: line.type !== 'unchanged'}],
    }))
    let hunkIndex = -1

    for (let index = 0; index < displayLines.length; index++) {
        const line = displayLines[index]
        if (line.type === 'unchanged') continue
        if (index === 0 || displayLines[index - 1].type === 'unchanged') {
            hunkIndex++
            line.hunkStart = true
        }
        line.hunkIndex = hunkIndex
    }

    for (let currentHunk = 0; currentHunk <= hunkIndex; currentHunk++) {
        const removed = displayLines.filter(line => line.hunkIndex === currentHunk && line.type === 'removed')
        const added = displayLines.filter(line => line.hunkIndex === currentHunk && line.type === 'added')
        for (let index = 0; index < Math.min(removed.length, added.length); index++) {
            const segments = splitChangedMiddle(removed[index].text, added[index].text)
            removed[index].segments = segments.before
            added[index].segments = segments.after
        }
    }

    const visible = displayLines.map(line => expanded || line.type !== 'unchanged')
    if (!expanded) {
        displayLines.forEach((line, index) => {
            if (line.type === 'unchanged') return
            for (
                let contextIndex = Math.max(0, index - contextLines);
                contextIndex <= Math.min(displayLines.length - 1, index + contextLines);
                contextIndex++
            ) {
                visible[contextIndex] = true
            }
        })
    }

    const rows: EntryContentDiffRow[] = []
    for (let index = 0; index < displayLines.length;) {
        if (visible[index]) {
            rows.push(displayLines[index])
            index++
            continue
        }
        const start = index
        while (index < displayLines.length && !visible[index]) index++
        rows.push({kind: 'omitted', sourceIndex: start, count: index - start})
    }

    return {
        rows,
        addedCount: lines.filter(line => line.type === 'added').length,
        removedCount: lines.filter(line => line.type === 'removed').length,
        hunkCount: hunkIndex + 1,
    }
}

export function resolveActiveEntryContentDiffHunk(hunkTops: number[], anchorTop: number): number {
    let activeHunk = 0
    for (let index = 0; index < hunkTops.length; index++) {
        if (hunkTops[index] > anchorTop) break
        activeHunk = index
    }
    return activeHunk
}

function splitChangedMiddle(before: string, after: string): {
    before: EntryContentDiffSegment[]
    after: EntryContentDiffSegment[]
} {
    // ponytail: 只对齐共同前后缀；出现复杂段内移动时再升级为词级 diff。
    const beforeChars = [...before]
    const afterChars = [...after]
    let prefixLength = 0
    while (
        prefixLength < beforeChars.length
        && prefixLength < afterChars.length
        && beforeChars[prefixLength] === afterChars[prefixLength]
    ) {
        prefixLength++
    }

    let suffixLength = 0
    while (
        suffixLength < beforeChars.length - prefixLength
        && suffixLength < afterChars.length - prefixLength
        && beforeChars[beforeChars.length - 1 - suffixLength] === afterChars[afterChars.length - 1 - suffixLength]
    ) {
        suffixLength++
    }

    return {
        before: buildSegments(beforeChars, prefixLength, suffixLength),
        after: buildSegments(afterChars, prefixLength, suffixLength),
    }
}

function buildSegments(chars: string[], prefixLength: number, suffixLength: number): EntryContentDiffSegment[] {
    const segments = [
        {text: chars.slice(0, prefixLength).join(''), changed: false},
        {text: chars.slice(prefixLength, chars.length - suffixLength).join(''), changed: true},
        {text: chars.slice(chars.length - suffixLength).join(''), changed: false},
    ]
    return segments.filter(segment => segment.text)
}
