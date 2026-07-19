import {
    type CSSProperties,
    type MouseEvent as ReactMouseEvent,
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
} from 'react'
import {useDrag} from '@use-gesture/react'
import {Input, useAlert} from 'flowcloudai-ui'
import {logger} from '../../../shared/logger'
import {ProjectHomeIcon} from '../../../shared/ui/ProjectHomeIcon'
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
import MobileCategoryDrawerDialogs from './MobileCategoryDrawerDialogs'
import {MobileAddIcon, MobileMoreIcon, MobileSearchIcon} from './MobileTopControls'
import {
    buildAllRows,
    buildChildrenMap,
    buildVisibleRows,
    CATEGORY_REORDER_LONG_PRESS_MS,
    CATEGORY_REORDER_MOVE_TOLERANCE,
    collectDescendantIds,
    dropTargetSignature,
    getEntryCountMap,
    getGesturePointerId,
    getGesturePointerType,
    getSortedSiblings,
    parentKey,
    ROW_DRAG_START_DISTANCE,
    ROW_DRAG_VERTICAL_DOMINANCE,
    TreeIcon,
    type CategoryDragState,
    type CategoryDropTarget,
    type DeleteMode,
    type DragDropPosition,
    type RenameTarget,
    type SiblingDirection,
} from './mobileCategoryTree'
import './MobileCategoryDrawer.css'

export type MobileCategoryDrawerSelection =
    | {kind: 'projectHome'}
    | {kind: 'allEntries'}
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
    const dropTargetRef = useRef<CategoryDropTarget | null>(null)
    const loggedDropTargetRef = useRef<string>('none')
    const suppressCategoryClickRef = useRef<string | null>(null)
    const suppressCategoryClickTimerRef = useRef<number | null>(null)
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
    const showProjectHomeRow = !normalizedSearch || '项目主页'.includes(normalizedSearch)
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
                await db_update_category({id: renameTarget.category.id, projectId, name})
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
                projectId,
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
    }, [categories, moveTarget, notifyChanged, projectId, showAlert])

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
                    : db_update_category({id: category.id, projectId, sortOrder: index})
            )))
            await notifyChanged()
        } catch (error) {
            await showAlert(`调整分类顺序失败：${String(error)}`, 'error', 'nonInvasive', 3000)
        } finally {
            setBusy(false)
        }
    }, [categories, notifyChanged, projectId, showAlert])

    const handleMoveByDrop = useCallback(async (
        draggedId: string,
        target: CategoryDropTarget,
    ) => {
        const dragged = categoryById.get(draggedId)
        const targetCategory = categoryById.get(target.targetId)
        if (!dragged || !targetCategory) {
            logger.info('[移动端分类拖拽] 放弃移动：分类数据缺失', {
                draggedId,
                targetId: target.targetId,
                hasDragged: Boolean(dragged),
                hasTarget: Boolean(targetCategory),
                categoryCount: categories.length,
            })
            return
        }
        logger.info('[移动端分类拖拽] 准备移动', {
            draggedId,
            draggedName: dragged.name,
            targetId: target.targetId,
            targetName: targetCategory.name,
            position: target.position,
            oldParentId: dragged.parent_id ?? null,
            oldSortOrder: dragged.sort_order,
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
            if (targetIndex < 0) {
                logger.info('[移动端分类拖拽] 放弃移动：目标不在同级列表中', {
                    draggedId,
                    targetId: target.targetId,
                    nextParentId,
                    siblingIds: siblings.map(category => category.id),
                })
                return
            }

            const reordered = [...siblings]
            reordered.splice(target.position === 'before' ? targetIndex : targetIndex + 1, 0, dragged)
            orderMap = new Map<string, number>()
            reordered.forEach((category, index) => orderMap.set(category.id, index))
        }

        const draggedOrder = orderMap.get(draggedId)
        if (draggedOrder === undefined) {
            logger.info('[移动端分类拖拽] 放弃移动：没有计算出拖拽项顺序', {
                draggedId,
                target,
                orders: Array.from(orderMap.entries()),
            })
            return
        }

        setBusy(true)
        try {
            const parentChanged = (dragged.parent_id ?? null) !== nextParentId
            const updateInputs: Array<{id: string; projectId: string; parentId?: string | null; sortOrder?: number}> = []
            for (const [id, sortOrder] of orderMap) {
                const original = categoryById.get(id)
                if (!original) continue
                if (id === draggedId) {
                    if (parentChanged || original.sort_order !== sortOrder) {
                        updateInputs.push({id, projectId, parentId: nextParentId, sortOrder})
                    }
                    continue
                }
                if (original.sort_order !== sortOrder) {
                    updateInputs.push({id, projectId, sortOrder})
                }
            }

            logger.info('[移动端分类拖拽] 提交移动', {
                draggedId,
                nextParentId,
                updateCount: updateInputs.length,
                updates: updateInputs,
                orders: Array.from(orderMap.entries()),
            })
            if (updateInputs.length === 0) return
            await Promise.all(updateInputs.map(input => db_update_category(input)))
            logger.info('[移动端分类拖拽] 后端更新成功', {
                draggedId,
                updateCount: updateInputs.length,
            })
            if (target.position === 'into') {
                setExpandedIds(current => {
                    const next = new Set(current)
                    next.add(target.targetId)
                    return next
                })
            }
            await notifyChanged()
            logger.info('[移动端分类拖拽] 刷新回调完成', {draggedId})
        } catch (error) {
            logger.error('[移动端分类拖拽] 移动失败', error)
            await showAlert(`移动分类失败：${String(error)}`, 'error', 'nonInvasive', 3000)
        } finally {
            setBusy(false)
        }
    }, [categories, categoryById, notifyChanged, projectId, showAlert])

    const handleDelete = useCallback(async (mode: DeleteMode) => {
        if (!deleteTarget) return
        setBusy(true)
        try {
            let result: CategoryCascadeDeleteResult | null = null
            if (mode === 'empty') {
                await db_delete_category(deleteTarget.id, projectId)
            } else if (mode === 'lift') {
                await db_delete_category_move_to_parent(deleteTarget.id, projectId)
            } else {
                result = await db_cascade_delete_category(deleteTarget.id, projectId)
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
    }, [deleteTarget, notifyChanged, projectId, showAlert])

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
        const draggedElement = categoryNodeRefs.current.get(draggedId)
        if (draggedElement) {
            const draggedRect = draggedElement.getBoundingClientRect()
            if (pointerY >= draggedRect.top && pointerY <= draggedRect.bottom) return null
        }

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
        dropTargetRef.current = null
        loggedDropTargetRef.current = 'none'
        setDraggingId(null)
        setDropTarget(null)
    }, [])

    const suppressNextCategoryClick = useCallback((categoryId: string) => {
        suppressCategoryClickRef.current = categoryId
        if (suppressCategoryClickTimerRef.current !== null) {
            window.clearTimeout(suppressCategoryClickTimerRef.current)
        }
        suppressCategoryClickTimerRef.current = window.setTimeout(() => {
            if (suppressCategoryClickRef.current === categoryId) {
                suppressCategoryClickRef.current = null
            }
            suppressCategoryClickTimerRef.current = null
        }, 350)
    }, [])

    useEffect(() => {
        return () => {
            if (suppressCategoryClickTimerRef.current !== null) {
                window.clearTimeout(suppressCategoryClickTimerRef.current)
            }
        }
    }, [])

    const activateDrag = useCallback((dragState: CategoryDragState, pointerX: number, pointerY: number, reason: string) => {
        if (!dragState.active) {
            dragState.active = true
            setDraggingId(dragState.categoryId)
            logger.info('[移动端分类拖拽] 进入拖拽', {
                pointerId: dragState.pointerId,
                categoryId: dragState.categoryId,
                reason,
                pointerX: Math.round(pointerX),
                pointerY: Math.round(pointerY),
            })
        }
    }, [])

    const updateDragTarget = useCallback((pointerX: number, pointerY: number, draggedId: string, source: string) => {
        scrollListDuringDrag(pointerY)
        const nextTarget = getDropTarget(pointerY, draggedId)
        dropTargetRef.current = nextTarget
        setDropTarget(nextTarget)
        const signature = dropTargetSignature(nextTarget)
        if (loggedDropTargetRef.current !== signature) {
            loggedDropTargetRef.current = signature
            logger.info('[移动端分类拖拽] 目标变化', {
                source,
                draggedId,
                pointerX: Math.round(pointerX),
                pointerY: Math.round(pointerY),
                target: nextTarget,
                targetName: nextTarget ? categoryById.get(nextTarget.targetId)?.name ?? null : null,
            })
        }
    }, [categoryById, getDropTarget, scrollListDuringDrag])

    const finishDrag = useCallback((pointerId: number | string, commit: boolean, reason: string) => {
        const dragState = dragStateRef.current
        if (!dragState || dragState.pointerId !== pointerId) return

        const wasActive = dragState.active
        const nextTarget = dropTargetRef.current
        const draggedId = dragState.categoryId
        clearDragState()

        logger.info('[移动端分类拖拽] 结算', {
            pointerId,
            draggedId,
            commit,
            reason,
            active: wasActive,
            target: nextTarget,
        })
        if (!wasActive) {
            logger.info('[移动端分类拖拽] 结束但未进入拖拽', {
                pointerId,
                draggedId,
                reason,
            })
            return
        }
        suppressNextCategoryClick(draggedId)
        if (commit && !nextTarget) {
            logger.info('[移动端分类拖拽] 结算但没有有效目标', {
                pointerId,
                draggedId,
                reason,
            })
        }
        if (commit && nextTarget) {
            void handleMoveByDrop(draggedId, nextTarget)
        }
    }, [clearDragState, handleMoveByDrop, suppressNextCategoryClick])

    const bindCategoryDrag = useDrag(({
        args: [category],
        cancel,
        event,
        first,
        last,
        movement: [moveX, moveY],
        xy: [pointerX, pointerY],
    }) => {
        const targetCategory = category as Category | undefined
        if (!targetCategory) return

        const pointerId = getGesturePointerId(event)
        const pointerType = getGesturePointerType(event)
        if (first) {
            if (busy || normalizedSearch) {
                logger.info('[移动端分类拖拽] 忽略按下', {
                    reason: busy ? 'busy' : 'searching',
                    categoryId: targetCategory.id,
                    normalizedSearch,
                })
                cancel()
                return
            }

            event.stopPropagation()
            const dragState: CategoryDragState = {
                pointerId,
                categoryId: targetCategory.id,
                active: false,
            }
            dragStateRef.current = dragState
            if (pointerType === 'touch' || pointerType === 'pen' || pointerType.startsWith('touch')) {
                activateDrag(dragState, pointerX, pointerY, 'long-press')
            }
            setDropTarget(null)
            dropTargetRef.current = null
            logger.info('[移动端分类拖拽] 按下', {
                pointerId,
                pointerType,
                categoryId: targetCategory.id,
                name: targetCategory.name,
                startX: Math.round(pointerX),
                startY: Math.round(pointerY),
            })
        }

        const dragState = dragStateRef.current
        if (!dragState || dragState.pointerId !== pointerId) return

        event.stopPropagation()
        if (!dragState.active) {
            const horizontal = Math.abs(moveX)
            const vertical = Math.abs(moveY)
            if (
                vertical < ROW_DRAG_START_DISTANCE
                || vertical < horizontal * ROW_DRAG_VERTICAL_DOMINANCE
            ) {
                if (last) finishDrag(pointerId, true, 'use-drag-tap')
                return
            }
            activateDrag(dragState, pointerX, pointerY, 'row-vertical-drag')
        }

        if (event.cancelable) event.preventDefault()
        updateDragTarget(pointerX, pointerY, dragState.categoryId, 'use-drag')
        if (last) finishDrag(pointerId, true, 'use-drag-end')
    }, {
        axisThreshold: {
            pen: CATEGORY_REORDER_MOVE_TOLERANCE,
            touch: CATEGORY_REORDER_MOVE_TOLERANCE,
        },
        filterTaps: false,
        pointer: {capture: false, keys: false, touch: true},
        preventScroll: CATEGORY_REORDER_LONG_PRESS_MS,
        preventScrollAxis: 'xy',
    })

    const handleCategoryRowClick = useCallback((
        event: ReactMouseEvent<HTMLButtonElement>,
        category: Category,
    ) => {
        if (suppressCategoryClickRef.current === category.id) {
            suppressCategoryClickRef.current = null
            event.preventDefault()
            event.stopPropagation()
            logger.info('[移动端分类拖拽] 抑制拖拽后的点击', {
                categoryId: category.id,
                name: category.name,
            })
            return
        }
        onSelect({kind: 'category', categoryId: category.id}, category.name)
    }, [onSelect])

    return (
        <aside className="mobile-category-drawer" aria-label="分类树">
            <div className="mobile-category-drawer__toolbar">
                <div className="mobile-category-drawer__search">
                    <Input
                        placeholder="搜索分类…"
                        value={searchText}
                        onValueChange={setSearchText}
                        prefix={<MobileSearchIcon className="mobile-drawer-search-icon"/>}
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
                    <MobileAddIcon/>
                </button>
            </div>

            <div className="mobile-category-drawer__list" role="tree" aria-label="词条分类" ref={listRef}>
                {showProjectHomeRow && (
                    <button
                        type="button"
                        role="treeitem"
                        aria-selected={selected.kind === 'projectHome'}
                        className={`mobile-category-drawer__row mobile-category-drawer__row--home${selected.kind === 'projectHome' ? ' is-active' : ''}`}
                        onClick={() => onSelect({kind: 'projectHome'}, '项目主页')}
                    >
                        <span className="mobile-category-drawer__toggle-placeholder"/>
                        <ProjectHomeIcon className="mobile-category-drawer__home-icon"/>
                        <span className="mobile-category-drawer__text">项目主页</span>
                    </button>
                )}

                {showDefaultRow && (
                    <button
                        type="button"
                        role="treeitem"
                        aria-selected={selected.kind === 'uncategorized'}
                        className={`mobile-category-drawer__row mobile-category-drawer__row--default${selected.kind === 'uncategorized' ? ' is-active' : ''}`}
                        onClick={() => onSelect({kind: 'uncategorized'}, '默认分类')}
                    >
                        <span className="mobile-category-drawer__toggle-placeholder"/>
                        <span className="mobile-category-drawer__text">默认分类</span>
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
                            data-mobile-side-drawer-gesture-ignore="true"
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
                                {...bindCategoryDrag(category)}
                                onClick={(event) => handleCategoryRowClick(event, category)}
                            >
                                <span className="mobile-category-drawer__text">{category.name}</span>
                            </button>
                            <button
                                type="button"
                                className="mobile-category-drawer__menu"
                                aria-label={`管理分类 ${category.name}`}
                                onClick={() => setMenuTarget(category)}
                            >
                                <MobileMoreIcon/>
                            </button>
                        </div>
                    )
                })}

                {normalizedSearch && rows.length === 0 && !showProjectHomeRow && !showDefaultRow ? (
                    <div className="mobile-category-drawer__empty">没有匹配的分类</div>
                ) : null}
            </div>

            <MobileCategoryDrawerDialogs
                busy={busy}
                menuTarget={menuTarget}
                onCloseMenu={() => setMenuTarget(null)}
                onOpenCategory={category => onSelect({kind: 'category', categoryId: category.id}, category.name)}
                onCreateChild={category => setRenameTarget({mode: 'create', parentId: category.id})}
                onRenameCategory={category => setRenameTarget({mode: 'rename', category})}
                onChooseMove={setMoveTarget}
                canMoveUp={menuTargetSiblingState.canMoveUp}
                canMoveDown={menuTargetSiblingState.canMoveDown}
                onMoveSibling={(category, direction) => void handleMoveWithinSiblings(category, direction)}
                onChooseDelete={setDeleteTarget}
                renameOpen={!!renameTarget}
                renameTitle={renameTitle}
                renameLabel={renameTarget?.mode === 'create' && renameTarget.parentId ? `父分类：${categoryById.get(renameTarget.parentId)?.name ?? '未知分类'}` : undefined}
                renameInitialValue={renameInitialValue}
                renameConfirmText={renameTarget?.mode === 'create' ? '新建' : '保存'}
                onCloseRename={() => setRenameTarget(null)}
                onConfirmRename={name => void handleConfirmName(name)}
                moveTarget={moveTarget}
                moveCandidates={moveCandidates}
                onCloseMove={() => setMoveTarget(null)}
                onMove={parentId => void handleMoveToParent(parentId)}
                deleteTarget={deleteTarget}
                deleteImpact={deleteImpact}
                onCloseDelete={() => setDeleteTarget(null)}
                onDelete={mode => void handleDelete(mode)}
            />
        </aside>
    )
}
