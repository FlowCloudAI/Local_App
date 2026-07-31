/**
 * 验证正文编辑器在防抖窗口内仍可撤销，并保持明确的保存状态。
 */
import assert from 'node:assert/strict'
import {UndoRedoHistory} from '../src/shared/hooks/useUndoRedo.ts'
import {resolveEntrySaveStatus} from '../src/features/entries/hooks/useEntrySaveStatus.ts'
import {resolveSelectionToolbarPlacement} from '../src/features/entries/components/entrySelectionToolbar.ts'
import {ensureEntryDetailLoaded} from '../src/features/entries/lib/entryDetailLoading.ts'
import {resolveMarkdownPreviewSourceContent} from '../src/features/entries/lib/entryMarkdownPreviewState.ts'
import {resolveSavedState, shouldAutoSave} from '../src/features/entries/lib/entrySaveState.ts'

const history = new UndoRedoHistory('初始内容')
history.setPending('刚输入的内容')

assert.equal(history.canUndo, true)
assert.equal(history.undo(), '初始内容')
assert.equal(history.canRedo, true)
assert.equal(history.redo(), '刚输入的内容')

history.undo()
history.setPending('新的分支')
assert.equal(history.canRedo, false)
history.commitPending()
assert.equal(history.redo(), null)

const selectionHistory = new UndoRedoHistory({
    content: '初始内容',
    selection: {start: 2, end: 4},
})
selectionHistory.setPending({
    content: '修改后的内容',
    selection: {start: 6, end: 6},
})
assert.deepEqual(selectionHistory.undo()?.selection, {start: 2, end: 4})
assert.deepEqual(selectionHistory.redo()?.selection, {start: 6, end: 6})

const savedHistory = new UndoRedoHistory('保存前')
savedHistory.setPending('已提交保存')
savedHistory.commitPending()
savedHistory.push('数据库归一化结果')
assert.equal(savedHistory.undo(), '已提交保存')
assert.equal(savedHistory.undo(), '保存前')

assert.deepEqual(
    resolveEntrySaveStatus({
        entryLoaded: true,
        hasChanges: true,
        trimmedTitle: '词条',
        hasInvalidRelationDrafts: false,
        saving: false,
        saveError: '磁盘写入失败',
    }),
    {
        kind: 'error',
        text: '保存失败',
        detail: '磁盘写入失败',
    },
)

assert.equal(
    resolveEntrySaveStatus({
        entryLoaded: true,
        hasChanges: true,
        trimmedTitle: '词条',
        hasInvalidRelationDrafts: false,
        saving: false,
        saveError: null,
    }).kind,
    'dirty',
)

assert.equal(resolveSelectionToolbarPlacement({
    selectionTop: 120,
    selectionBottom: 180,
    visibleTop: 0,
    visibleBottom: 400,
    pointerY: 170,
}), 'below')
assert.equal(resolveSelectionToolbarPlacement({
    selectionTop: 120,
    selectionBottom: 380,
    visibleTop: 0,
    visibleBottom: 400,
    pointerY: 370,
}), 'above')
assert.equal(resolveSelectionToolbarPlacement({
    selectionTop: 30,
    selectionBottom: 380,
    visibleTop: 0,
    visibleBottom: 400,
}), null)

const loadedEntryDetailIds = new Set()
const pendingEntryDetailLoads = new Map()
let entryDetailLoadCount = 0
let finishEntryDetailLoad
const loadEntryDetail = () => {
    entryDetailLoadCount += 1
    return new Promise((resolve) => {
        finishEntryDetailLoad = resolve
    })
}
const firstEntryDetailLoad = ensureEntryDetailLoaded(
    'entry',
    loadedEntryDetailIds,
    pendingEntryDetailLoads,
    loadEntryDetail,
)
const secondEntryDetailLoad = ensureEntryDetailLoaded(
    'entry',
    loadedEntryDetailIds,
    pendingEntryDetailLoads,
    loadEntryDetail,
)
assert.equal(firstEntryDetailLoad, secondEntryDetailLoad)
assert.equal(entryDetailLoadCount, 1)
finishEntryDetailLoad()
await firstEntryDetailLoad
assert.equal(pendingEntryDetailLoads.size, 0)

assert.equal(resolveMarkdownPreviewSourceContent('edit', false, '新内容', '旧内容'), null)
assert.equal(resolveMarkdownPreviewSourceContent('edit', true, '新内容', '旧内容'), '旧内容')
assert.equal(resolveMarkdownPreviewSourceContent('browse', false, '新内容', '旧内容'), '新内容')

const submittedDraft = {content: '已提交'}
const refreshedDraft = {content: '数据库结果'}
assert.equal(resolveSavedState(submittedDraft, submittedDraft, refreshedDraft), refreshedDraft)
const concurrentDraft = {content: '保存期间继续输入'}
assert.equal(resolveSavedState(concurrentDraft, submittedDraft, refreshedDraft), concurrentDraft)
assert.equal(shouldAutoSave(true, true, false, true), false)
assert.equal(shouldAutoSave(true, true, true, true), true)
