import {
    type CSSProperties,
    useCallback,
    useEffect,
    useMemo,
    type PointerEvent as ReactPointerEvent,
    useRef,
    useState,
} from 'react'
import {Button, Input, useAlert} from 'flowcloudai-ui'
import {logger} from '../../../shared/logger'
import {
    db_cascade_delete_category,
    db_create_category,
    db_delete_category,
    db_delete_category_move_to_parent,
    db_update_category,
    type Category,
    type CategoryCascadeDeleteResult,
    type ProjectStats,
} from '../../../api'
import {ActionMenu, FloatingPanel, RenameDialog} from '../../../shared/ui/overlay'
import './MobileCategoryDrawer.css'

const ROOT_PARENT_KEY = '__root__'

export type MobileCategoryDrawerSelection =
    | {kind: 'all'}
    | {kind: 'uncategorized'}
    | {kind: 'category'; categoryId: string}

interface Props {
    projectId: string
    categories: Category[]
    stats: ProjectStats | null
    selected: MobileCategoryDrawerSelection
    onSelect: (selection: MobileCategoryDrawerSelection, label: string) => void
    onChanged?: () => void | Promise<void>
}

interface CategoryRow {
    category: Category
    depth: number
}

type RenameTarget =
    | {mode: 'create'; parentId: string | null}
    | {mode: 'rename'; category: Category}

type DeleteMode = 'empty' | 'lift' | 'cascade'
type SiblingDirection = 'up' | 'down'
type DragDropPosition = 'before' | 'after' | 'into'

interface CategoryDragState {
    pointerId: number
    categoryId: string
}

interface CategoryDropTarget {
    targetId: string
    position: DragDropPosition
}

function parentKey(parentId: string | null | undefined): string {
    return parentId ?? ROOT_PARENT_KEY
}

function sortCategories(a: Category, b: Category): number {
    return (a.sort_order - b.sort_order) || a.name.localeCompare(b.name, 'zh-Hans-CN')
}

function buildChildrenMap(categories: Category[]): Map<string, Category[]> {
    const map = new Map<string, Category[]>()
    for (const category of categories) {
        const key = parentKey(category.parent_id)
        const siblings = map.get(key)
        if (siblings) {
            siblings.push(category)
        } else {
            map.set(key, [category])
        }
    }
    for (const siblings of map.values()) {
        siblings.sort(sortCategories)
    }
    return map
}

function buildVisibleRows(
    childrenMap: Map<string, Category[]>,
    expandedIds: Set<string>,
    query: string,
): CategoryRow[] {
    const rows: CategoryRow[] = []
    const normalizedQuery = query.trim().toLocaleLowerCase('zh-CN')

    if (normalizedQuery) {
        const categoryById = new Map<string, Category>()
        for (const siblings of childrenMap.values()) {
            for (const category of siblings) {
                categoryById.set(category.id, category)
            }
        }

        const visibleIds = new Set<string>()
        for (const category of categoryById.values()) {
            if (!category.name.toLocaleLowerCase('zh-CN').includes(normalizedQuery)) continue
            visibleIds.add(category.id)
            let parentId = category.parent_id ?? null
            while (parentId) {
                visibleIds.add(parentId)
                parentId = categoryById.get(parentId)?.parent_id ?? null
            }
        }

        const visitSearch = (parentId: string | null, depth: number) => {
            const children = childrenMap.get(parentKey(parentId)) ?? []
            for (const category of children) {
                if (!visibleIds.has(category.id)) continue
                rows.push({category, depth})
                visitSearch(category.id, depth + 1)
            }
        }
        visitSearch(null, 0)
        return rows
    }

    const visit = (parentId: string | null, depth: number) => {
        const children = childrenMap.get(parentKey(parentId)) ?? []
        for (const category of children) {
            rows.push({category, depth})
            if (expandedIds.has(category.id)) {
                visit(category.id, depth + 1)
            }
        }
    }
    visit(null, 0)
    return rows
}

function buildAllRows(childrenMap: Map<string, Category[]>): CategoryRow[] {
    const rows: CategoryRow[] = []
    const visit = (parentId: string | null, depth: number) => {
        const children = childrenMap.get(parentKey(parentId)) ?? []
        for (const category of children) {
            rows.push({category, depth})
            visit(category.id, depth + 1)
        }
    }
    visit(null, 0)
    return rows
}

function collectDescendantIds(categoryId: string, childrenMap: Map<string, Category[]>): string[] {
    const result: string[] = []
    const visit = (parentId: string) => {
        const children = childrenMap.get(parentKey(parentId)) ?? []
        for (const child of children) {
            result.push(child.id)
            visit(child.id)
        }
    }
    visit(categoryId)
    return result
}

function getEntryCountMap(stats: ProjectStats | null): Map<string, number> {
    const map = new Map<string, number>()
    for (const row of stats?.entriesByCategory ?? []) {
        if (row.categoryId) map.set(row.categoryId, row.count)
    }
    return map
}

function getSortedSiblings(categories: Category[], parentId: string | null): Category[] {
    return categories
        .filter(category => (category.parent_id ?? null) === parentId)
        .sort(sortCategories)
}

function TreeIcon({expanded}: {expanded: boolean}) {
    return (
        <svg className="mobile-category-drawer__toggle-icon" viewBox="0 0 20 20" focusable="false">
            <path d={expanded ? 'M5.5 8 10 12.5 14.5 8' : 'M8 5.5 12.5 10 8 14.5'}/>
        </svg>
    )
}

function FolderIcon() {
    return (
        <svg className="mobile-category-drawer__row-icon" viewBox="0 0 24 24" focusable="false">
            <path d="M4 7.5a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z"/>
        </svg>
    )
}

function DragHandleIcon() {
    return (
        <svg className="mobile-category-drawer__drag-icon" viewBox="0 0 24 24" focusable="false">
            <path d="M7 8h10"/>
            <path d="M7 12h10"/>
            <path d="M7 16h10"/>
        </svg>
    )
}

export default function MobileCategoryDrawer({projectId, categories, stats, selected, onSelect, onChanged}: Props) {
    const {showAlert} = useAlert()
    const [searchText, setSearchText] = useState('')
    const [busy, setBusy] = useState(false)
    const [menuTarget, setMenuTarget] = useState<Category | null>(null)
    const [renameTarget, setRenameTarget] = useState<RenameTarget | null>(null)
    const [moveTarget, setMoveTarget] = useState<Category | null>(null)
    const [deleteTarget, setDeleteTarget] = useState<Category | null>(null)
    const [draggingId, setDraggingId] = useState<string | null>(null)
    const [dropTarget, setDropTarget] = useState<CategoryDropTarget | null>(null)
    const listRef = useRef<HTMLDivElement | null>(null)
    const categoryNodeRefs = useRef<Map<string, HTMLDivElement>>(new Map())
    const dragStateRef = useRef<CategoryDragState | null>(null)
    const dragElementRef = useRef<HTMLButtonElement | null>(null)
    const dropTargetRef = useRef<CategoryDropTarget | null>(null)
    const childrenMap = useMemo(() => buildChildrenMap(categories), [categories])
    const initialExpanded = useMemo(() => {
        const ids = new Set<string>()
        for (const category of categories) {
            if ((childrenMap.get(parentKey(category.id)) ?? []).length > 0) {
                ids.add(category.id)
            }
        }
        return ids
    }, [categories, childrenMap])
    const [expandedIds, setExpandedIds] = useState<Set<string>>(initialExpanded)

    useEffect(() => {
        setExpandedIds(current => {
            const next = new Set(current)
            for (const id of initialExpanded) {
                next.add(id)
            }
            return next
        })
    }, [initialExpanded])

    const rows = useMemo(
        () => buildVisibleRows(childrenMap, expandedIds, searchText),
        [childrenMap, expandedIds, searchText],
    )
    const allRows = useMemo(() => buildAllRows(childrenMap), [childrenMap])
    const categoryById = useMemo(() => new Map(categories.map(category => [category.id, category])), [categories])
    const entryCountMap = useMemo(() => getEntryCountMap(stats), [stats])
    const normalizedSearch = searchText.trim().toLocaleLowerCase('zh-CN')
    const showAllRow = !normalizedSearch || '全部词条'.includes(normalizedSearch)
    const showDefaultRow = !normalizedSearch || '默认分类'.includes(normalizedSearch)

    const notifyChanged = useCallback(async () => {
        await onChanged?.()
    }, [onChanged])

    const getRecursiveEntryCount = useCallback((categoryId: string) => {
        const ids = [categoryId, ...collectDescendantIds(categoryId, childrenMap)]
        return ids.reduce((sum, id) => sum + (entryCountMap.get(id) ?? 0), 0)
    }, [childrenMap, entryCountMap])

    const toggleExpanded = (categoryId: string) => {
        setExpandedIds(current => {
            const next = new Set(current)
            if (next.has(categoryId)) {
                next.delete(categoryId)
            } else {
                next.add(categoryId)
            }
            return next
        })
    }

    const handleConfirmName = useCallback(async (name: string) => {
        if (!renameTarget) return
        setBusy(true)
        try {
            if (renameTarget.mode === 'create') {
                const parentId = renameTarget.parentId
                const siblings = categories.filter(category => (category.parent_id ?? null) === parentId)
                const maxOrder = siblings.length > 0 ? Math.max(...siblings.map(category => category.sort_order)) : -1
                await db_create_category({
                    projectId,
                    parentId,
                    name,
                    sortOrder: maxOrder + 1,
                })
            } else {
                await db_update_category({id: renameTarget.category.id, name})
            }
            setRenameTarget(null)
            await notifyChanged()
        } catch (error) {
            await showAlert(`保存分类失败：${String(error)}`, 'error', 'nonInvasive', 3000)
        } finally {
            setBusy(false)
        }
    }, [categories, notifyChanged, projectId, renameTarget, showAlert])

    const handleMoveToParent = useCallback(async (parentId: string | null) => {
        if (!moveTarget) return
        if ((moveTarget.parent_id ?? null) === parentId) {
            setMoveTarget(null)
            return
        }

        setBusy(true)
        try {
            const siblings = categories.filter(category =>
                (category.parent_id ?? null) === parentId && category.id !== moveTarget.id
            )
            const maxOrder = siblings.length > 0 ? Math.max(...siblings.map(category => category.sort_order)) : -1
            await db_update_category({
                id: moveTarget.id,
                parentId,
                sortOrder: maxOrder + 1,
            })
            setMoveTarget(null)
            await notifyChanged()
        } catch (error) {
            await showAlert(`移动分类失败：${String(error)}`, 'error', 'nonInvasive', 3000)
        } finally {
            setBusy(false)
        }
    }, [categories, moveTarget, notifyChanged, showAlert])

    const handleMoveWithinSiblings = useCallback(async (target: Category, direction: SiblingDirection) => {
        const parentId = target.parent_id ?? null
        const siblings = getSortedSiblings(categories, parentId)
        const currentIndex = siblings.findIndex(category => category.id === target.id)
        const nextIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1
        if (currentIndex < 0 || nextIndex < 0 || nextIndex >= siblings.length) return

        const reordered = [...siblings]
        const [moved] = reordered.splice(currentIndex, 1)
        reordered.splice(nextIndex, 0, moved)

        setBusy(true)
        try {
            await Promise.all(reordered.map((category, index) => (
                category.sort_order === index
                    ? Promise.resolve()
                    : db_update_category({id: category.id, sortOrder: index})
            )))
            await notifyChanged()
        } catch (error) {
            await showAlert(`调整分类顺序失败：${String(error)}`, 'error', 'nonInvasive', 3000)
        } finally {
            setBusy(false)
        }
    }, [categories, notifyChanged, showAlert])

    const handleMoveByDrop = useCallback(async (
        draggedId: string,
        target: CategoryDropTarget,
    ) => {
        const dragged = categoryById.get(draggedId)
        const targetCategory = categoryById.get(target.targetId)
        if (!dragged || !targetCategory) return
        logger.info('[移动端分类拖拽] 准备移动', {
            draggedId,
            targetId: target.targetId,
            position: target.position,
            oldParentId: dragged.parent_id ?? null,
        })

        let nextParentId: string | null
        let orderMap: Map<string, number>

        if (target.position === 'into') {
            nextParentId = target.targetId
            const siblings = categories.filter(category =>
                (category.parent_id ?? null) === nextParentId && category.id !== draggedId
            )
            const maxOrder = siblings.length > 0 ? Math.max(...siblings.map(category => category.sort_order)) : -1
            orderMap = new Map([[draggedId, maxOrder + 1]])
        } else {
            nextParentId = targetCategory.parent_id ?? null
            const siblings = getSortedSiblings(categories, nextParentId)
                .filter(category => category.id !== draggedId)
            const targetIndex = siblings.findIndex(category => category.id === target.targetId)
            if (targetIndex < 0) return

            const reordered = [...siblings]
            reordered.splice(target.position === 'before' ? targetIndex : targetIndex + 1, 0, dragged)
            orderMap = new Map<string, number>()
            reordered.forEach((category, index) => orderMap.set(category.id, index))
        }

        const draggedOrder = orderMap.get(draggedId)
        if (draggedOrder === undefined) return

        setBusy(true)
        try {
            const parentChanged = (dragged.parent_id ?? null) !== nextParentId
            const updates: Promise<unknown>[] = []
            for (const [id, sortOrder] of orderMap) {
                const original = categoryById.get(id)
                if (!original) continue
                if (id === draggedId) {
                    if (parentChanged || original.sort_order !== sortOrder) {
                        updates.push(db_update_category({id, parentId: nextParentId, sortOrder}))
                    }
                    continue
                }
                if (original.sort_order !== sortOrder) {
                    updates.push(db_update_category({id, sortOrder}))
                }
            }

            logger.info('[移动端分类拖拽] 提交移动', {
                draggedId,
                nextParentId,
                updateCount: updates.length,
                orders: Array.from(orderMap.entries()),
            })
            if (updates.length === 0) return
            await Promise.all(updates)
            if (target.position === 'into') {
                setExpandedIds(current => {
                    const next = new Set(current)
                    next.add(target.targetId)
                    return next
                })
            }
            await notifyChanged()
        } catch (error) {
            await showAlert(`移动分类失败：${String(error)}`, 'error', 'nonInvasive', 3000)
        } finally {
            setBusy(false)
        }
    }, [categories, categoryById, notifyChanged, showAlert])

    const handleDelete = useCallback(async (mode: DeleteMode) => {
        if (!deleteTarget) return
        setBusy(true)
        try {
            let result: CategoryCascadeDeleteResult | null = null
            if (mode === 'empty') {
                await db_delete_category(deleteTarget.id)
            } else if (mode === 'lift') {
                await db_delete_category_move_to_parent(deleteTarget.id)
            } else {
                result = await db_cascade_delete_category(deleteTarget.id)
            }
            setDeleteTarget(null)
            await notifyChanged()
            if (result) {
                await showAlert(
                    `已删除 ${result.deletedCategories} 个分类、${result.deletedEntries} 个词条。`,
                    'success',
                    'nonInvasive',
                    2600,
                )
            }
        } catch (error) {
            await showAlert(`删除分类失败：${String(error)}`, 'error', 'nonInvasive', 3200)
        } finally {
            setBusy(false)
        }
    }, [deleteTarget, notifyChanged, showAlert])

    const moveCandidates = useMemo(() => {
        if (!moveTarget) return allRows
        const blocked = new Set([moveTarget.id, ...collectDescendantIds(moveTarget.id, childrenMap)])
        return allRows.filter(row => !blocked.has(row.category.id))
    }, [allRows, childrenMap, moveTarget])

    const menuTargetSiblingState = useMemo(() => {
        if (!menuTarget) return {canMoveUp: false, canMoveDown: false}
        const siblings = getSortedSiblings(categories, menuTarget.parent_id ?? null)
        const index = siblings.findIndex(category => category.id === menuTarget.id)
        return {
            canMoveUp: index > 0,
            canMoveDown: index >= 0 && index < siblings.length - 1,
        }
    }, [categories, menuTarget])

    const deleteImpact = useMemo(() => {
        if (!deleteTarget) return null
        const descendantIds = collectDescendantIds(deleteTarget.id, childrenMap)
        return {
            childCount: (childrenMap.get(parentKey(deleteTarget.id)) ?? []).length,
            categoryCount: descendantIds.length + 1,
            entryCount: getRecursiveEntryCount(deleteTarget.id),
        }
    }, [childrenMap, deleteTarget, getRecursiveEntryCount])

    const renameInitialValue = renameTarget?.mode === 'rename' ? renameTarget.category.name : ''
    const renameTitle = renameTarget?.mode === 'rename' ? '重命名分类' : '新建分类'

    const getDropTarget = useCallback((pointerY: number, draggedId: string): CategoryDropTarget | null => {
        const blockedIds = new Set([draggedId, ...collectDescendantIds(draggedId, childrenMap)])
        const candidates = rows.filter(row => !blockedIds.has(row.category.id))
        if (candidates.length === 0) return null

        for (const row of candidates) {
            const element = categoryNodeRefs.current.get(row.category.id)
            if (!element) continue
            const rect = element.getBoundingClientRect()
            if (pointerY < rect.top || pointerY > rect.bottom) continue

            const ratio = (pointerY - rect.top) / rect.height
            const position: DragDropPosition = ratio < 0.25 ? 'before' : ratio > 0.75 ? 'after' : 'into'
            return {targetId: row.category.id, position}
        }

        const firstElement = categoryNodeRefs.current.get(candidates[0].category.id)
        const lastElement = categoryNodeRefs.current.get(candidates[candidates.length - 1].category.id)
        if (firstElement && pointerY < firstElement.getBoundingClientRect().top) {
            return {targetId: candidates[0].category.id, position: 'before'}
        }
        if (lastElement && pointerY > lastElement.getBoundingClientRect().bottom) {
            return {targetId: candidates[candidates.length - 1].category.id, position: 'after'}
        }

        return null
    }, [childrenMap, rows])

    const scrollListDuringDrag = useCallback((pointerY: number) => {
        const list = listRef.current
        if (!list) return

        const rect = list.getBoundingClientRect()
        const edgeSize = 58
        const maxStep = 18
        if (pointerY < rect.top + edgeSize) {
            const strength = (rect.top + edgeSize - pointerY) / edgeSize
            list.scrollTop -= Math.ceil(maxStep * strength)
        } else if (pointerY > rect.bottom - edgeSize) {
            const strength = (pointerY - (rect.bottom - edgeSize)) / edgeSize
            list.scrollTop += Math.ceil(maxStep * strength)
        }
    }, [])

    const clearDragState = useCallback(() => {
        dragStateRef.current = null
        dragElementRef.current = null
        dropTargetRef.current = null
        setDraggingId(null)
        setDropTarget(null)
    }, [])

    const updateDragTarget = useCallback((pointerY: number, draggedId: string) => {
        scrollListDuringDrag(pointerY)
        const nextTarget = getDropTarget(pointerY, draggedId)
        dropTargetRef.current = nextTarget
        setDropTarget(nextTarget)
    }, [getDropTarget, scrollListDuringDrag])

    const finishDrag = useCallback((pointerId: number, commit: boolean, reason: string) => {
        const dragState = dragStateRef.current
        if (!dragState || dragState.pointerId !== pointerId) return

        const nextTarget = dropTargetRef.current
        const draggedId = dragState.categoryId
        const dragElement = dragElementRef.current
        clearDragState()
        if (dragElement?.hasPointerCapture(pointerId)) {
            dragElement.releasePointerCapture(pointerId)
        }

        logger.info('[移动端分类拖拽] 结算', {
            pointerId,
            draggedId,
            commit,
            reason,
            target: nextTarget,
        })
        if (commit && nextTarget) {
            void handleMoveByDrop(draggedId, nextTarget)
        }
    }, [clearDragState, handleMoveByDrop])

    const handleDragPointerDown = useCallback((
        event: ReactPointerEvent<HTMLButtonElement>,
        category: Category,
    ) => {
        if (busy || normalizedSearch) return
        if (!event.isPrimary) return
        if (event.pointerType === 'mouse' && event.button !== 0) return

        event.preventDefault()
        event.stopPropagation()
        event.currentTarget.setPointerCapture(event.pointerId)
        dragElementRef.current = event.currentTarget
        dragStateRef.current = {
            pointerId: event.pointerId,
            categoryId: category.id,
        }
        setDraggingId(category.id)
        setDropTarget(null)
        dropTargetRef.current = null
        logger.info('[移动端分类拖拽] 开始', {
            pointerId: event.pointerId,
            categoryId: category.id,
            name: category.name,
        })
    }, [busy, normalizedSearch])

    const handleDragPointerMove = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
        const dragState = dragStateRef.current
        if (!dragState || dragState.pointerId !== event.pointerId) return

        event.preventDefault()
        event.stopPropagation()
        updateDragTarget(event.clientY, dragState.categoryId)
    }, [updateDragTarget])

    const handleDragPointerUp = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
        const dragState = dragStateRef.current
        if (!dragState || dragState.pointerId !== event.pointerId) return

        event.preventDefault()
        event.stopPropagation()
        finishDrag(event.pointerId, true, 'react-pointerup')
    }, [finishDrag])

    const handleDragPointerCancel = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
        const dragState = dragStateRef.current
        if (!dragState || dragState.pointerId !== event.pointerId) return

        event.preventDefault()
        event.stopPropagation()
        finishDrag(event.pointerId, false, 'react-pointercancel')
    }, [finishDrag])

    const handleDragLostPointerCapture = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
        const dragState = dragStateRef.current
        if (!dragState || dragState.pointerId !== event.pointerId) return

        event.preventDefault()
        event.stopPropagation()
        finishDrag(event.pointerId, true, 'react-lostpointercapture')
    }, [finishDrag])

    useEffect(() => {
        if (!draggingId) return

        const handleWindowPointerMove = (event: PointerEvent) => {
            const dragState = dragStateRef.current
            if (!dragState || dragState.pointerId !== event.pointerId) return

            event.preventDefault()
            updateDragTarget(event.clientY, dragState.categoryId)
        }
        const handleWindowPointerUp = (event: PointerEvent) => {
            const dragState = dragStateRef.current
            if (!dragState || dragState.pointerId !== event.pointerId) return
            event.preventDefault()
            finishDrag(event.pointerId, true, 'window-pointerup')
        }
        const handleWindowPointerCancel = (event: PointerEvent) => {
            const dragState = dragStateRef.current
            if (!dragState || dragState.pointerId !== event.pointerId) return
            event.preventDefault()
            finishDrag(event.pointerId, false, 'window-pointercancel')
        }

        window.addEventListener('pointermove', handleWindowPointerMove, {passive: false})
        window.addEventListener('pointerup', handleWindowPointerUp, {passive: false})
        window.addEventListener('pointercancel', handleWindowPointerCancel, {passive: false})
        return () => {
            window.removeEventListener('pointermove', handleWindowPointerMove)
            window.removeEventListener('pointerup', handleWindowPointerUp)
            window.removeEventListener('pointercancel', handleWindowPointerCancel)
        }
    }, [draggingId, finishDrag, updateDragTarget])

    return (
        <aside className="mobile-category-drawer" aria-label="分类树">
            <div className="mobile-category-drawer__toolbar">
                <div className="mobile-category-drawer__search">
                    <Input
                        placeholder="搜索分类…"
                        value={searchText}
                        onValueChange={setSearchText}
                        radius="full"
                        size="lg"
                        allowClear
                    />
                </div>
                <button
                    type="button"
                    className="mobile-category-drawer__add"
                    aria-label="新建根级分类"
                    onClick={() => setRenameTarget({mode: 'create', parentId: null})}
                >
                    +
                </button>
            </div>

            <div className="mobile-category-drawer__list" role="tree" aria-label="词条分类" ref={listRef}>
                {showAllRow && (
                    <button
                        type="button"
                        role="treeitem"
                        aria-selected={selected.kind === 'all'}
                        className={`mobile-category-drawer__row${selected.kind === 'all' ? ' is-active' : ''}`}
                        onClick={() => onSelect({kind: 'all'}, '全部词条')}
                    >
                        <span className="mobile-category-drawer__toggle-placeholder"/>
                        <FolderIcon/>
                        <span className="mobile-category-drawer__text">
                            <strong>全部词条</strong>
                            <small>{stats?.entryCount ?? 0} 个词条</small>
                        </span>
                    </button>
                )}

                {showDefaultRow && (
                    <button
                        type="button"
                        role="treeitem"
                        aria-selected={selected.kind === 'uncategorized'}
                        className={`mobile-category-drawer__row${selected.kind === 'uncategorized' ? ' is-active' : ''}`}
                        onClick={() => onSelect({kind: 'uncategorized'}, '默认分类')}
                    >
                        <span className="mobile-category-drawer__toggle-placeholder"/>
                        <FolderIcon/>
                        <span className="mobile-category-drawer__text">
                            <strong>默认分类</strong>
                            <small>{stats?.uncategorizedEntryCount ?? 0} 个词条</small>
                        </span>
                    </button>
                )}

                {rows.map(({category, depth}) => {
                    const childCount = (childrenMap.get(parentKey(category.id)) ?? []).length
                    const expanded = expandedIds.has(category.id) || Boolean(normalizedSearch)
                    const active = selected.kind === 'category' && selected.categoryId === category.id
                    return (
                        <div
                            key={category.id}
                            ref={(element) => {
                                if (element) {
                                    categoryNodeRefs.current.set(category.id, element)
                                } else {
                                    categoryNodeRefs.current.delete(category.id)
                                }
                            }}
                            className={[
                                'mobile-category-drawer__node',
                                draggingId === category.id ? 'is-dragging-source' : '',
                                dropTarget?.targetId === category.id ? `is-drop-${dropTarget.position}` : '',
                            ].filter(Boolean).join(' ')}
                            style={{'--mobile-category-drawer-depth': depth} as CSSProperties}
                            role="none"
                        >
                            <button
                                type="button"
                                className="mobile-category-drawer__toggle"
                                aria-label={expanded ? `收起 ${category.name}` : `展开 ${category.name}`}
                                disabled={childCount === 0 || Boolean(normalizedSearch)}
                                onClick={() => toggleExpanded(category.id)}
                            >
                                {childCount > 0 ? <TreeIcon expanded={expanded}/> : null}
                            </button>
                            <button
                                type="button"
                                role="treeitem"
                                aria-selected={active}
                                aria-expanded={childCount > 0 ? expanded : undefined}
                                className={`mobile-category-drawer__row mobile-category-drawer__row--category${active ? ' is-active' : ''}`}
                                onClick={() => onSelect({kind: 'category', categoryId: category.id}, category.name)}
                            >
                                <FolderIcon/>
                                <span className="mobile-category-drawer__text">
                                    <strong>{category.name}</strong>
                                    <small>
                                        {entryCountMap.get(category.id) ?? 0} 个词条{childCount > 0 ? ` · ${childCount} 个子分类` : ''}
                                    </small>
                                </span>
                            </button>
                            <button
                                type="button"
                                className="mobile-category-drawer__drag"
                                aria-label={`拖拽移动分类 ${category.name}`}
                                disabled={busy || Boolean(normalizedSearch)}
                                onPointerDown={(event) => handleDragPointerDown(event, category)}
                                onPointerMove={handleDragPointerMove}
                                onPointerUp={handleDragPointerUp}
                                onPointerCancel={handleDragPointerCancel}
                                onLostPointerCapture={handleDragLostPointerCapture}
                            >
                                <DragHandleIcon/>
                            </button>
                            <button
                                type="button"
                                className="mobile-category-drawer__menu"
                                aria-label={`管理分类 ${category.name}`}
                                onClick={() => setMenuTarget(category)}
                            >
                                ⋯
                            </button>
                        </div>
                    )
                })}

                {normalizedSearch && rows.length === 0 && !showAllRow && !showDefaultRow ? (
                    <div className="mobile-category-drawer__empty">没有匹配的分类</div>
                ) : null}
            </div>

            <ActionMenu
                open={!!menuTarget}
                onClose={() => setMenuTarget(null)}
                title={menuTarget?.name}
                items={[
                    {
                        key: 'open',
                        label: '浏览词条',
                        onSelect: () => menuTarget && onSelect({kind: 'category', categoryId: menuTarget.id}, menuTarget.name),
                    },
                    {
                        key: 'create-child',
                        label: '新建子分类',
                        onSelect: () => menuTarget && setRenameTarget({mode: 'create', parentId: menuTarget.id}),
                    },
                    {
                        key: 'rename',
                        label: '重命名',
                        onSelect: () => menuTarget && setRenameTarget({mode: 'rename', category: menuTarget}),
                    },
                    {
                        key: 'move',
                        label: '移动到…',
                        onSelect: () => menuTarget && setMoveTarget(menuTarget),
                    },
                    {
                        key: 'move-up',
                        label: '上移一位',
                        disabled: !menuTargetSiblingState.canMoveUp || busy,
                        onSelect: () => menuTarget && void handleMoveWithinSiblings(menuTarget, 'up'),
                    },
                    {
                        key: 'move-down',
                        label: '下移一位',
                        disabled: !menuTargetSiblingState.canMoveDown || busy,
                        onSelect: () => menuTarget && void handleMoveWithinSiblings(menuTarget, 'down'),
                    },
                    {
                        key: 'delete',
                        label: '删除分类',
                        danger: true,
                        onSelect: () => menuTarget && setDeleteTarget(menuTarget),
                    },
                ]}
            />

            <RenameDialog
                open={!!renameTarget}
                title={renameTitle}
                label={renameTarget?.mode === 'create' && renameTarget.parentId
                    ? `父分类：${categoryById.get(renameTarget.parentId)?.name ?? '未知分类'}`
                    : undefined}
                initialValue={renameInitialValue}
                placeholder="分类名称"
                confirmText={renameTarget?.mode === 'create' ? '新建' : '保存'}
                busy={busy}
                onClose={() => setRenameTarget(null)}
                onConfirm={(name) => void handleConfirmName(name)}
            />

            <FloatingPanel
                open={!!moveTarget}
                onClose={() => setMoveTarget(null)}
                dismissible={!busy}
                ariaLabel="移动分类"
                className="mobile-category-drawer-dialog"
            >
                <div className="mobile-category-drawer-dialog__title">移动分类</div>
                <div className="mobile-category-drawer-dialog__summary">
                    将「{moveTarget?.name ?? ''}」移动到新的父分类。
                </div>
                <div className="mobile-category-drawer-parent-list">
                    <button
                        type="button"
                        className={`mobile-category-drawer-parent-list__item${(moveTarget?.parent_id ?? null) === null ? ' is-current' : ''}`}
                        disabled={busy}
                        onClick={() => void handleMoveToParent(null)}
                    >
                        根级分类
                    </button>
                    {moveCandidates.map(row => (
                        <button
                            type="button"
                            key={row.category.id}
                            className={`mobile-category-drawer-parent-list__item${moveTarget?.parent_id === row.category.id ? ' is-current' : ''}`}
                            style={{'--mobile-category-drawer-depth': row.depth} as CSSProperties}
                            disabled={busy}
                            onClick={() => void handleMoveToParent(row.category.id)}
                        >
                            {row.category.name}
                        </button>
                    ))}
                </div>
                <div className="mobile-category-drawer-dialog__actions">
                    <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => setMoveTarget(null)}>
                        取消
                    </Button>
                </div>
            </FloatingPanel>

            <FloatingPanel
                open={!!deleteTarget}
                onClose={() => setDeleteTarget(null)}
                dismissible={!busy}
                ariaLabel="删除分类"
                className="mobile-category-drawer-dialog"
            >
                <div className="mobile-category-drawer-dialog__title">删除分类</div>
                <div className="mobile-category-drawer-dialog__summary">
                    「{deleteTarget?.name ?? ''}」包含 {deleteImpact?.categoryCount ?? 0} 个分类节点、
                    {deleteImpact?.entryCount ?? 0} 个词条。
                </div>
                <div className="mobile-category-drawer-delete-options">
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        block
                        disabled={busy}
                        onClick={() => void handleDelete('empty')}
                    >
                        仅删除空分类
                    </Button>
                    <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        block
                        disabled={busy}
                        onClick={() => void handleDelete('lift')}
                    >
                        子项上移保留
                    </Button>
                    <Button
                        type="button"
                        variant="danger"
                        size="sm"
                        block
                        disabled={busy}
                        onClick={() => void handleDelete('cascade')}
                    >
                        连同子分类和词条删除
                    </Button>
                </div>
                {deleteImpact && deleteImpact.childCount > 0 && (
                    <div className="mobile-category-drawer-dialog__hint">
                        “子项上移保留”会把直接子分类和词条移动到当前分类的父级。
                    </div>
                )}
                <div className="mobile-category-drawer-dialog__actions">
                    <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => setDeleteTarget(null)}>
                        取消
                    </Button>
                </div>
            </FloatingPanel>
        </aside>
    )
}
