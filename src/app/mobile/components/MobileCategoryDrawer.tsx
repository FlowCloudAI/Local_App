import {type CSSProperties, useEffect, useMemo, useState} from 'react'
import {Input} from 'flowcloudai-ui'
import {type Category, type ProjectStats} from '../../../api'
import './MobileCategoryDrawer.css'

const ROOT_PARENT_KEY = '__root__'

export type MobileCategoryDrawerSelection =
    | {kind: 'all'}
    | {kind: 'uncategorized'}
    | {kind: 'category'; categoryId: string}

interface Props {
    categories: Category[]
    stats: ProjectStats | null
    selected: MobileCategoryDrawerSelection
    onSelect: (selection: MobileCategoryDrawerSelection, label: string) => void
}

interface CategoryRow {
    category: Category
    depth: number
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

function getEntryCountMap(stats: ProjectStats | null): Map<string, number> {
    const map = new Map<string, number>()
    for (const row of stats?.entriesByCategory ?? []) {
        if (row.categoryId) map.set(row.categoryId, row.count)
    }
    return map
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

export default function MobileCategoryDrawer({categories, stats, selected, onSelect}: Props) {
    const [searchText, setSearchText] = useState('')
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
    const entryCountMap = useMemo(() => getEntryCountMap(stats), [stats])
    const normalizedSearch = searchText.trim().toLocaleLowerCase('zh-CN')
    const showAllRow = !normalizedSearch || '全部词条'.includes(normalizedSearch)
    const showDefaultRow = !normalizedSearch || '默认分类'.includes(normalizedSearch)

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

    return (
        <aside className="mobile-category-drawer" aria-label="分类树">
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

            <div className="mobile-category-drawer__list" role="tree" aria-label="词条分类">
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
                            className="mobile-category-drawer__node"
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
                        </div>
                    )
                })}

                {normalizedSearch && rows.length === 0 && !showAllRow && !showDefaultRow ? (
                    <div className="mobile-category-drawer__empty">没有匹配的分类</div>
                ) : null}
            </div>
        </aside>
    )
}
