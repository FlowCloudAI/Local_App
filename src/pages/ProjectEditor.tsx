import React, {memo, type MouseEvent as ReactMouseEvent, useCallback, useEffect, useMemo, useRef, useState} from 'react'
import {Tree, flatToTree, type DropPosition} from 'flowcloudai-ui'
import {
    db_count_entries,
    db_create_category,
    db_delete_category,
    db_get_project,
    db_list_all_entry_types,
    db_list_categories,
    db_list_tag_schemas,
    db_update_category,
    db_update_project,
    type Category,
    type CustomEntryType,
    type EntryTypeView,
    type Project,
    type TagSchema,
} from '../api'
import EntryEditor from '../components/EntryEditor'
import EntryTypeCreator from '../components/EntryTypeCreator'
import ProjectRelationGraph from '../components/ProjectRelationGraph'
import TagCreator from '../components/TagCreator'
import {CategoryView, ProjectOverview} from '../components/project-editor'
import './ProjectEditor.css'

const TREE_MIN_WIDTH = '15rem'
const TREE_MAX_WIDTH = '22rem'
const TREE_DEFAULT_PX = 256
const TREE_COLLAPSE_THRESHOLD_RATIO = 1 / 5
const ROOT_ID = '__project_root__'

interface Props {
    projectId: string
    activeEntryId?: string | null
    openEntryIds?: string[]
    onOpenEntry?: (projectId: string, entry: { id: string; title: string }) => void
    onEntryTitleChange?: (projectId: string, entry: { id: string; title: string }) => void
    onBackToProject?: (projectId: string) => void
    onEntryDirtyChange?: (projectId: string, entryId: string, dirty: boolean) => void
}

type Selection = { kind: 'project' } | { kind: 'category'; id: string }
type ProjectPanel = 'overview' | 'relation-graph'

function ProjectEditorInner({projectId, activeEntryId = null, openEntryIds = [], onOpenEntry, onEntryTitleChange, onBackToProject, onEntryDirtyChange}: Props) {
    const [treeWidth, setTreeWidth] = useState(TREE_DEFAULT_PX)
    const [treeCollapsed, setTreeCollapsed] = useState(false)
    const [dividerDragging, setDividerDragging] = useState(false)
    const isDragging = useRef(false)
    const layoutRef = useRef<HTMLDivElement>(null)
    const lastExpandedWidthRef = useRef(TREE_DEFAULT_PX)

    const [project, setProject] = useState<Project | null>(null)
    const [categories, setCategories] = useState<Category[]>([])
    const [entryTypes, setEntryTypes] = useState<EntryTypeView[]>([])
    const [entryCount, setEntryCount] = useState(0)
    const [categoryEntryRefreshToken, setCategoryEntryRefreshToken] = useState(0)
    const [tagSchemas, setTagSchemas] = useState<TagSchema[]>([])
    const [tagCreatorOpen, setTagCreatorOpen] = useState(false)
    const [entryTypeCreatorOpen, setEntryTypeCreatorOpen] = useState(false)
    const [editingTag, setEditingTag] = useState<TagSchema | null>(null)
    const [editingEntryType, setEditingEntryType] = useState<CustomEntryType | null>(null)

    const [selection, setSelection] = useState<Selection>({kind: 'project'})
    const [selectedKey, setSelectedKey] = useState<string | undefined>(ROOT_ID)
    const [projectPanel, setProjectPanel] = useState<ProjectPanel>('overview')

    const touchProjectUpdatedAt = useCallback(() => {
        setProject(current => current ? {...current, updated_at: new Date().toISOString()} : current)
    }, [])

    const refreshProject = useCallback(async () => {
        try {
            const nextProject = await db_get_project(projectId)
            setProject(nextProject)
        } catch (e) {
            console.error('refresh project failed', e)
        }
    }, [projectId])

    const fetchAll = useCallback(async () => {
        const [proj, cats, types, count, tags] = await Promise.all([
            db_get_project(projectId),
            db_list_categories(projectId),
            db_list_all_entry_types(projectId),
            db_count_entries({projectId}),
            db_list_tag_schemas(projectId),
        ])

        return {
            project: proj,
            categories: cats,
            entryTypes: types,
            entryCount: Number(count),
            tagSchemas: tags,
        }
    }, [projectId])

    const loadAll = useCallback(async () => {
        try {
            const data = await fetchAll()
            setProject(data.project)
            setCategories(data.categories)
            setEntryTypes(data.entryTypes)
            setEntryCount(data.entryCount)
            setTagSchemas(data.tagSchemas)
        } catch (e) {
            console.error('ProjectEditor load failed', e)
        }
    }, [fetchAll])

    useEffect(() => {
        let cancelled = false

        void (async () => {
            try {
                const data = await fetchAll()
                if (cancelled) return
                setProject(data.project)
                setCategories(data.categories)
                setEntryTypes(data.entryTypes)
                setEntryCount(data.entryCount)
                setTagSchemas(data.tagSchemas)
            } catch (e) {
                if (!cancelled) {
                    console.error('ProjectEditor load failed', e)
                }
            }
        })()

        return () => {
            cancelled = true
        }
    }, [fetchAll])

    useEffect(() => {
        if (!treeCollapsed) {
            lastExpandedWidthRef.current = treeWidth
        }
    }, [treeCollapsed, treeWidth])

    const expandTree = useCallback(() => {
        const nextWidth = lastExpandedWidthRef.current || TREE_DEFAULT_PX
        setTreeCollapsed(false)
        setTreeWidth(nextWidth)
        layoutRef.current?.style.setProperty('--pe-tree-width', `${nextWidth}px`)
    }, [])

    const collapseTree = useCallback(() => {
        setTreeCollapsed(true)
        layoutRef.current?.style.setProperty('--pe-tree-width', '0px')
    }, [])

    const handleDividerMouseDown = (e: ReactMouseEvent) => {
        e.preventDefault()
        isDragging.current = true
        setDividerDragging(true)
        const rootFontSize = parseFloat(getComputedStyle(document.documentElement).fontSize)
        const minPx = rootFontSize * parseFloat(TREE_MIN_WIDTH)
        const maxPx = rootFontSize * parseFloat(TREE_MAX_WIDTH)
        const startX = e.clientX
        const startWidth = treeCollapsed ? (lastExpandedWidthRef.current || TREE_DEFAULT_PX) : treeWidth
        const collapseThreshold = startWidth * TREE_COLLAPSE_THRESHOLD_RATIO
        let currentWidth = startWidth
        let shouldCollapse = false
        const layout = layoutRef.current
        const collapsePreviewClassName = 'is-divider-collapse-preview'

        if (treeCollapsed) {
            setTreeCollapsed(false)
            layout?.style.setProperty('--pe-tree-width', `${startWidth}px`)
        }
        layout?.classList.remove(collapsePreviewClassName)

        const onMove = (ev: MouseEvent) => {
            const rawWidth = startWidth + ev.clientX - startX
            currentWidth = Math.min(maxPx, Math.max(minPx, rawWidth))
            shouldCollapse = rawWidth <= collapseThreshold
            layout?.classList.toggle(collapsePreviewClassName, shouldCollapse)
            // 直接写 CSS 变量，完全绕过 React 渲染
            layout?.style.setProperty('--pe-tree-width', shouldCollapse ? '0px' : `${currentWidth}px`)
        }
        const onUp = () => {
            isDragging.current = false
            layout?.classList.remove(collapsePreviewClassName)
            if (shouldCollapse) {
                setDividerDragging(false)
                setTreeCollapsed(true)
                layout?.style.setProperty('--pe-tree-width', '0px')
            } else {
                setDividerDragging(false)
                setTreeCollapsed(false)
                setTreeWidth(currentWidth)
            }
            document.removeEventListener('mousemove', onMove)
            document.removeEventListener('mouseup', onUp)
        }
        document.addEventListener('mousemove', onMove)
        document.addEventListener('mouseup', onUp)
    }

    const handleSelect = (key: string) => {
        setSelectedKey(key)
        if (key === ROOT_ID) {
            setSelection({kind: 'project'})
        } else {
            setSelection({kind: 'category', id: key})
            setProjectPanel('overview')
        }

        if (activeEntryId) {
            void onBackToProject?.(projectId)
        }
    }

    const handleRename = async (key: string, newName: string) => {
        if (key === ROOT_ID) {
            const updated = await db_update_project({id: projectId, name: newName})
            setProject({...updated, updated_at: new Date().toISOString()})
        } else {
            await db_update_category({id: key, name: newName})
            setCategories(prev => prev.map(c => c.id === key ? {...c, name: newName} : c))
            await refreshProject()
            touchProjectUpdatedAt()
        }
    }

    const handleCreate = async (parentKey: string | null): Promise<string> => {
        const actualParentId = (!parentKey || parentKey === ROOT_ID) ? null : parentKey
        const siblings = categories.filter(c =>
            actualParentId ? c.parent_id === actualParentId : c.parent_id == null
        )
        const maxOrder = siblings.length > 0
            ? Math.max(...siblings.map(c => c.sort_order))
            : -1
        const newCat = await db_create_category({
            projectId,
            parentId: actualParentId,
            name: '新建分类',
            sortOrder: maxOrder + 1,
        })
        setCategories(prev => [...prev, newCat])
        await refreshProject()
        touchProjectUpdatedAt()
        return newCat.id
    }

    const handleDelete = async (key: string, mode: 'lift' | 'cascade') => {
        if (key === ROOT_ID) return

        if (mode === 'cascade') {
            const toDelete = new Set<string>()
            const collect = (id: string) => {
                toDelete.add(id)
                categories.filter(c => c.parent_id === id).forEach(c => collect(c.id))
            }
            collect(key)
            setCategories(prev => prev.filter(c => !toDelete.has(c.id)))
            if (toDelete.has(key) && (selection.kind === 'category') && toDelete.has(selection.id)) {
                setSelection({kind: 'project'})
                setSelectedKey(ROOT_ID)
            }
            await Promise.all([...toDelete].map(id => db_delete_category(id)))
            await refreshProject()
            touchProjectUpdatedAt()
        } else {
            const target = categories.find(c => c.id === key)
            if (!target) return
            const children = categories.filter(c => c.parent_id === key)
            setCategories(prev =>
                prev
                    .map(c => c.parent_id === key ? {...c, parent_id: target.parent_id ?? null} : c)
                    .filter(c => c.id !== key)
            )
            if (selection.kind === 'category' && selection.id === key) {
                setSelection({kind: 'project'})
                setSelectedKey(ROOT_ID)
            }
            await Promise.all(
                children.map(child =>
                    db_update_category({id: child.id, parentId: target.parent_id ?? null})
                )
            )
            await db_delete_category(key)
            await refreshProject()
            touchProjectUpdatedAt()
        }
    }

    const handleMove = async (key: string, targetKey: string, position: DropPosition) => {
        if (key === ROOT_ID) return
        const target = categories.find(c => c.id === targetKey)
        const dragged = categories.find(c => c.id === key)
        if (!dragged) return

        let newParentId: string | null
        let orderMap: Map<string, number>

        if (position === 'into') {
            newParentId = targetKey === ROOT_ID ? null : targetKey
            const siblings = categories.filter(c => c.parent_id === newParentId && c.id !== key)
            const maxOrder = siblings.length > 0 ? Math.max(...siblings.map(c => c.sort_order)) : -1
            orderMap = new Map([[key, maxOrder + 1]])
        } else {
            if (!target) return
            newParentId = target.parent_id ?? null
            const siblings = categories
                .filter(c => c.parent_id === newParentId && c.id !== key)
                .sort((a, b) => a.sort_order - b.sort_order)
            const targetIndex = siblings.findIndex(c => c.id === targetKey)
            const insertIndex = position === 'before' ? targetIndex : targetIndex + 1
            const reordered = [...siblings]
            reordered.splice(insertIndex, 0, dragged)
            orderMap = new Map<string, number>()
            reordered.forEach((c, i) => orderMap.set(c.id, i))
        }

        setCategories(prev => prev.map(c => {
            if (c.id === key) return {...c, parent_id: newParentId, sort_order: orderMap.get(key)!}
            if (orderMap.has(c.id)) return {...c, sort_order: orderMap.get(c.id)!}
            return c
        }))

        try {
            const parentChanged = dragged.parent_id !== newParentId
            const promises: Promise<unknown>[] = []

            if (parentChanged) {
                promises.push(
                    db_update_category({
                        id: key,
                        parentId: newParentId,
                        sortOrder: orderMap.get(key),
                    })
                )
            }
            for (const [id, order] of orderMap) {
                if (id === key && parentChanged) continue
                const original = categories.find(c => c.id === id)
                if (original && original.sort_order !== order) {
                    promises.push(db_update_category({id, sortOrder: order}))
                }
            }
            await Promise.all(promises)
            await refreshProject()
            touchProjectUpdatedAt()
        } catch (e) {
            console.error('move category failed', e)
            void loadAll()
        }
    }

    const {roots} = useMemo(() => {
        const flatRows = [
            {id: ROOT_ID, parent_id: null as string | null, name: project?.name ?? '…', sort_order: 0},
            ...categories.map(c => ({
                id: c.id,
                parent_id: c.parent_id ?? ROOT_ID,
                name: c.name,
                sort_order: c.sort_order,
            })),
        ]
        return flatToTree(flatRows)
    }, [project?.name, categories])

    const visibleEntryIds = useMemo(() => openEntryIds.slice(-10), [openEntryIds])
    const hasActiveEntry = Boolean(activeEntryId)

    if (!project) {
        return <div className="pe-loading">加载中…</div>
    }

    return (
        <div
            className={`pe-layout ${treeCollapsed ? 'is-tree-collapsed' : ''} ${dividerDragging ? 'is-divider-dragging' : ''}`}
            ref={layoutRef}
            style={{'--pe-tree-width': `${treeCollapsed ? 0 : treeWidth}px`} as React.CSSProperties}
        >
            <div className="pe-tree-panel">
                <div className="pe-tree-panel__header">
                    <button
                        type="button"
                        className="pe-tree-toggle"
                        onClick={treeCollapsed ? expandTree : collapseTree}
                    >
                        {treeCollapsed ? '展开' : '收起'}
                    </button>
                </div>

                <div className="pe-tree-panel__body">
                    <Tree
                        treeData={roots}
                        selectedKey={selectedKey}
                        defaultExpandedKeys={[ROOT_ID]}
                        scrollHeight="100%"
                        onSelect={handleSelect}
                        onRename={handleRename}
                        onCreate={handleCreate}
                        onDelete={handleDelete}
                        onMove={handleMove}
                        searchable
                        collapseDuration={0.13}
                    />
                </div>
            </div>

            <div
                className={`pe-divider ${dividerDragging ? 'is-dragging' : ''}`}
                onMouseDown={handleDividerMouseDown}
            >
                <div className="pe-divider-handle" aria-hidden="true">
                    <span className="pe-divider-dot"/>
                    <span className="pe-divider-dot"/>
                    <span className="pe-divider-dot"/>
                </div>
            </div>

            <div className="pe-content">
                <div className={`pe-project-view${hasActiveEntry ? '' : ' active'}`}>
                    {selection.kind === 'project' ? (
                        projectPanel === 'overview' ? (
                            <ProjectOverview
                                project={project}
                                categories={categories}
                                entryTypes={entryTypes}
                                tagSchemas={tagSchemas}
                                entryCount={entryCount}
                                tagCount={tagSchemas.length}
                                onCreateTag={() => {
                                    setEditingTag(null)
                                    setTagCreatorOpen(true)
                                }}
                                onCreateEntryType={() => {
                                    setEditingEntryType(null)
                                    setEntryTypeCreatorOpen(true)
                                }}
                                onEditTag={(tag) => {
                                    setEditingTag(tag)
                                    setTagCreatorOpen(true)
                                }}
                                onEditEntryType={(entryType) => {
                                    setEditingEntryType(entryType)
                                    setEntryTypeCreatorOpen(true)
                                }}
                                onOpenRelationGraph={() => setProjectPanel('relation-graph')}
                            />
                        ) : (
                            <div className="pe-project-panel">
                                <ProjectRelationGraph
                                    projectId={projectId}
                                    onBack={() => setProjectPanel('overview')}
                                />
                            </div>
                        )
                    ) : (
                        <CategoryView
                            key={selection.id}
                            categoryId={selection.id}
                            projectId={projectId}
                            entryTypes={entryTypes}
                            tagSchemas={tagSchemas}
                            refreshToken={categoryEntryRefreshToken}
                            onEntryCreated={async () => {
                                setEntryCount(count => count + 1)
                                touchProjectUpdatedAt()
                            }}
                            onOpenEntry={(entry) => onOpenEntry?.(projectId, entry)}
                        />
                    )}
                </div>

                <div className={`pe-entry-stack${hasActiveEntry ? ' active' : ''}`}>
                    {visibleEntryIds.map((entryId) => (
                        <div
                            key={entryId}
                            className={`pe-entry-layer${entryId === activeEntryId ? ' active' : ''}`}
                        >
                            <EntryEditor
                                entryId={entryId}
                                projectId={projectId}
                                projectName={project.name}
                                categories={categories}
                                entryTypes={entryTypes}
                                tagSchemas={tagSchemas}
                                openEntryIds={visibleEntryIds}
                                onOpenEntry={(entry) => onOpenEntry?.(projectId, entry)}
                                onTitleChange={async (updatedEntry) => {
                                    onEntryTitleChange?.(projectId, {
                                        id: updatedEntry.id,
                                        title: updatedEntry.title,
                                    })
                                }}
                                onSaved={async () => {
                                    setCategoryEntryRefreshToken(current => current + 1)
                                    touchProjectUpdatedAt()
                                }}
                                onTagSchemasChange={async (schemas) => {
                                    setTagSchemas(schemas)
                                    await refreshProject()
                                    touchProjectUpdatedAt()
                                }}
                                onBack={() => onBackToProject?.(projectId)}
                                onDirtyChange={(dirty) => {
                                    onEntryDirtyChange?.(projectId, entryId, dirty)
                                }}
                            />
                        </div>
                    ))}
                </div>
            </div>

            <TagCreator
                open={tagCreatorOpen}
                projectId={projectId}
                entryTypes={entryTypes}
                initialTag={editingTag}
                existingNames={tagSchemas.map(schema => schema.name)}
                existingCount={tagSchemas.length}
                onClose={() => {
                    setTagCreatorOpen(false)
                    setEditingTag(null)
                }}
                onSaved={async (schema) => {
                    setTagSchemas(prev => {
                        const index = prev.findIndex(item => item.id === schema.id)
                        if (index === -1) return [...prev, schema]
                        return prev.map(item => item.id === schema.id ? schema : item)
                    })
                    await refreshProject()
                    touchProjectUpdatedAt()
                }}
                onDeleted={async (schemaId) => {
                    setTagSchemas(prev => prev.filter(item => item.id !== schemaId))
                    setTagCreatorOpen(false)
                    setEditingTag(null)
                    await refreshProject()
                    touchProjectUpdatedAt()
                }}
            />

            <EntryTypeCreator
                open={entryTypeCreatorOpen}
                projectId={projectId}
                initialEntryType={editingEntryType}
                existingNames={entryTypes.map(entryType => entryType.name)}
                onClose={() => {
                    setEntryTypeCreatorOpen(false)
                    setEditingEntryType(null)
                }}
                onSaved={async (entryType) => {
                    setEntryTypes(prev => {
                        const nextEntryType: EntryTypeView = {kind: 'custom', ...entryType}
                        const index = prev.findIndex(item => item.kind === 'custom' && item.id === entryType.id)
                        if (index === -1) return [...prev, nextEntryType]
                        return prev.map(item =>
                            item.kind === 'custom' && item.id === entryType.id ? nextEntryType : item
                        )
                    })
                    await refreshProject()
                    touchProjectUpdatedAt()
                }}
                onDeleted={async (entryTypeId) => {
                    setEntryTypes(prev => prev.filter(item => !(item.kind === 'custom' && item.id === entryTypeId)))
                    setEntryTypeCreatorOpen(false)
                    setEditingEntryType(null)
                    await refreshProject()
                    touchProjectUpdatedAt()
                }}
            />
        </div>
    )
}

function ProjectEditor(props: Props) {
    return <ProjectEditorInner key={props.projectId} {...props} />
}

export default memo(ProjectEditor)
