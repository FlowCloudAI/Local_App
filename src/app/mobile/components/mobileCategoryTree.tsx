import type {Category, ProjectStats} from '../../../api'

const ROOT_PARENT_KEY = '__root__'

export interface CategoryRow { category: Category; depth: number }
export type RenameTarget = {mode: 'create'; parentId: string | null} | {mode: 'rename'; category: Category}
export type DeleteMode = 'empty' | 'lift' | 'cascade'
export type SiblingDirection = 'up' | 'down'
export type DragDropPosition = 'before' | 'after' | 'into'
export interface CategoryDropTarget { targetId: string; position: DragDropPosition }

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
