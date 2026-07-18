/* eslint-disable react-refresh/only-export-components */
import type {Category, ProjectStats} from '../../../api'

const ROOT_PARENT_KEY = '__root__'

export interface CategoryRow { category: Category; depth: number }
export type RenameTarget = {mode: 'create'; parentId: string | null} | {mode: 'rename'; category: Category}
export type DeleteMode = 'empty' | 'lift' | 'cascade'
export type SiblingDirection = 'up' | 'down'
export type DragDropPosition = 'before' | 'after' | 'into'
export type CategoryDragSource = 'row' | 'handle'
export const ROW_DRAG_START_DISTANCE = 10
export const ROW_DRAG_VERTICAL_DOMINANCE = 1.12
export interface CategoryDragState { pointerId: number | string; categoryId: string; source: CategoryDragSource; active: boolean }
export interface CategoryDropTarget { targetId: string; position: DragDropPosition }

export function dropTargetSignature(target: CategoryDropTarget | null) {
    return target ? `${target.targetId}:${target.position}` : 'none'
}

export function getGesturePointerId(event: Event): number | string {
    return 'pointerId' in event && typeof event.pointerId === 'number' ? event.pointerId : 'gesture'
}

export function getGesturePointerType(event: Event): string {
    return 'pointerType' in event && typeof event.pointerType === 'string' ? event.pointerType : event.type
}

export function parentKey(parentId: string | null | undefined) { return parentId ?? ROOT_PARENT_KEY }
function sortCategories(a: Category, b: Category) { return (a.sort_order - b.sort_order) || a.name.localeCompare(b.name, 'zh-Hans-CN') }

export function buildChildrenMap(categories: Category[]) {
    const map = new Map<string, Category[]>()
    for (const category of categories) {
        const key = parentKey(category.parent_id)
        const siblings = map.get(key)
        if (siblings) siblings.push(category)
        else map.set(key, [category])
    }
    for (const siblings of map.values()) siblings.sort(sortCategories)
    return map
}

export function buildVisibleRows(childrenMap: Map<string, Category[]>, expandedIds: Set<string>, query: string) {
    const rows: CategoryRow[] = []
    const normalizedQuery = query.trim().toLocaleLowerCase('zh-CN')
    if (normalizedQuery) {
        const categoryById = new Map<string, Category>()
        for (const siblings of childrenMap.values()) for (const category of siblings) categoryById.set(category.id, category)
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
        const visit = (parentId: string | null, depth: number) => {
            for (const category of childrenMap.get(parentKey(parentId)) ?? []) {
                if (!visibleIds.has(category.id)) continue
                rows.push({category, depth})
                visit(category.id, depth + 1)
            }
        }
        visit(null, 0)
        return rows
    }
    const visit = (parentId: string | null, depth: number) => {
        for (const category of childrenMap.get(parentKey(parentId)) ?? []) {
            rows.push({category, depth})
            if (expandedIds.has(category.id)) visit(category.id, depth + 1)
        }
    }
    visit(null, 0)
    return rows
}

export function buildAllRows(childrenMap: Map<string, Category[]>) {
    const rows: CategoryRow[] = []
    const visit = (parentId: string | null, depth: number) => {
        for (const category of childrenMap.get(parentKey(parentId)) ?? []) {
            rows.push({category, depth}); visit(category.id, depth + 1)
        }
    }
    visit(null, 0)
    return rows
}

export function collectDescendantIds(categoryId: string, childrenMap: Map<string, Category[]>) {
    const result: string[] = []
    const visit = (parentId: string) => {
        for (const child of childrenMap.get(parentKey(parentId)) ?? []) { result.push(child.id); visit(child.id) }
    }
    visit(categoryId)
    return result
}

export function getEntryCountMap(stats: ProjectStats | null) {
    const map = new Map<string, number>()
    for (const row of stats?.entriesByCategory ?? []) if (row.categoryId) map.set(row.categoryId, row.count)
    return map
}

export function getSortedSiblings(categories: Category[], parentId: string | null) {
    return categories.filter(category => (category.parent_id ?? null) === parentId).sort(sortCategories)
}

export function TreeIcon({expanded}: {expanded: boolean}) {
    return <svg className="mobile-category-drawer__toggle-icon" viewBox="0 0 20 20" focusable="false"><path d={expanded ? 'M5.5 8 10 12.5 14.5 8' : 'M8 5.5 12.5 10 8 14.5'}/></svg>
}
export function HomeIcon() {
    return <svg className="mobile-category-drawer__row-icon mobile-category-drawer__home-icon" viewBox="0 0 24 24" focusable="false" aria-hidden="true"><path d="M4.5 11.2 12 5l7.5 6.2"/><path d="M6.5 10.5v8h11v-8"/><path d="M10 18.5v-4h4v4"/></svg>
}
export function DragHandleIcon() {
    return <svg className="mobile-category-drawer__drag-icon" viewBox="0 0 24 24" focusable="false"><path d="M7 8h10"/><path d="M7 12h10"/><path d="M7 16h10"/></svg>
}
