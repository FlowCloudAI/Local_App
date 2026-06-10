import {useEffect, useRef, useState} from 'react'
import {createPortal} from 'react-dom'
import {
    formatMobileIdeaDate,
    MOBILE_IDEA_STATUS_LABELS,
    type MobileIdeaController,
    useMobileIdeaController,
} from '../hooks/useMobileIdeaController'
import MobileIdeaDrawer from '../components/MobileIdeaDrawer'
import {
    MobileAnchoredActionMenu,
    type MobileAnchoredMenuItem,
    MobileTopActionPill,
    MobileTopIconButton,
} from '../components/MobileTopControls'
import {type MobilePage} from '../usePageStack'
import './MobileIdea.css'

interface Props {
    push: (page: MobilePage) => void
    setAiFocus: (f: {projectId: string | null; entryId: string | null}) => void
    ideaDrawerOpen?: boolean
    onOpenIdeaDrawer?: () => void
    onCloseIdeaDrawer?: () => void
}

function MobileIdeaIcon({type}: {type: 'menu' | 'pin' | 'archive' | 'delete' | 'status' | 'refresh'}) {
    if (type === 'menu') {
        return (
            <svg className="mobile-idea-svg" viewBox="0 0 24 24" focusable="false">
                <path d="M5 7h14"/>
                <path d="M5 12h14"/>
                <path d="M5 17h14"/>
            </svg>
        )
    }
    if (type === 'pin') {
        return (
            <svg className="mobile-idea-svg" viewBox="0 0 24 24" focusable="false">
                <path d="M12 17v5"/>
                <path d="M8.5 10.8 6.2 13.1A1.7 1.7 0 0 0 7.4 16h9.2a1.7 1.7 0 0 0 1.2-2.9l-2.3-2.3V6.5l1.5-1.5H7l1.5 1.5Z"/>
            </svg>
        )
    }
    if (type === 'archive') {
        return (
            <svg className="mobile-idea-svg" viewBox="0 0 24 24" focusable="false">
                <path d="M5.5 7.5h13"/>
                <path d="M7 8.5v10h10v-10"/>
                <path d="M9.5 12h5"/>
                <path d="M6.5 4.5h11l1.5 3h-13Z"/>
            </svg>
        )
    }
    if (type === 'delete') {
        return (
            <svg className="mobile-idea-svg" viewBox="0 0 24 24" focusable="false">
                <path d="M5.5 7h13"/>
                <path d="M9 7V5.5h6V7"/>
                <path d="M8 10v8"/>
                <path d="M12 10v8"/>
                <path d="M16 10v8"/>
                <path d="M7 7.5 8 20h8l1-12.5"/>
            </svg>
        )
    }
    if (type === 'refresh') {
        return (
            <svg className="mobile-idea-svg" viewBox="0 0 24 24" focusable="false">
                <path d="M19 9a7 7 0 0 0-12.2-3.3L5 7.5"/>
                <path d="M5 4.5v3h3"/>
                <path d="M5 15a7 7 0 0 0 12.2 3.3L19 16.5"/>
                <path d="M19 19.5v-3h-3"/>
            </svg>
        )
    }
    return (
        <svg className="mobile-idea-svg" viewBox="0 0 24 24" focusable="false">
            <path d="M5 12h14"/>
            <path d="M12 5v14"/>
        </svg>
    )
}

function buildIdeaMenuItems(controller: MobileIdeaController): MobileAnchoredMenuItem[] {
    const {
        selectedIdea,
        draftStatus,
        draftPinned,
        setDraftPinned,
        setDraftStatus,
        deleteSelectedIdea,
        loadIdeas,
    } = controller

    return [
        {
            key: 'pin',
            label: draftPinned ? '取消置顶' : '置顶灵感',
            description: selectedIdea ? '自动保存到当前便签' : '新建后保存置顶状态',
            icon: <MobileIdeaIcon type="pin"/>,
            onSelect: () => setDraftPinned(!draftPinned),
        },
        {
            key: 'inbox',
            label: '标记为待整理',
            description: MOBILE_IDEA_STATUS_LABELS.inbox,
            icon: <MobileIdeaIcon type="status"/>,
            disabled: draftStatus === 'inbox',
            onSelect: () => setDraftStatus('inbox'),
        },
        {
            key: 'processed',
            label: '标记为已处理',
            description: MOBILE_IDEA_STATUS_LABELS.processed,
            icon: <MobileIdeaIcon type="status"/>,
            disabled: draftStatus === 'processed',
            onSelect: () => setDraftStatus('processed'),
        },
        {
            key: 'archive',
            label: '归档灵感',
            description: MOBILE_IDEA_STATUS_LABELS.archived,
            icon: <MobileIdeaIcon type="archive"/>,
            disabled: draftStatus === 'archived',
            onSelect: () => setDraftStatus('archived'),
        },
        {
            key: 'refresh',
            label: '刷新列表',
            description: '重新同步灵感便签',
            icon: <MobileIdeaIcon type="refresh"/>,
            onSelect: () => void loadIdeas(),
        },
        {
            key: 'delete',
            label: '删除灵感',
            description: selectedIdea ? '删除当前便签' : '当前没有已保存便签',
            icon: <MobileIdeaIcon type="delete"/>,
            danger: true,
            disabled: !selectedIdea,
            onSelect: () => void deleteSelectedIdea(),
        },
    ]
}

function getSaveStateText(controller: MobileIdeaController): string {
    if (controller.saveState === 'saving') return '保存中…'
    if (controller.saveState === 'error') return '保存失败，继续编辑会重试'
    if (controller.lastSavedAt) return `已保存 ${formatMobileIdeaDate(controller.lastSavedAt)}`
    return '输入后自动保存'
}

export default function MobileIdea({
    ideaDrawerOpen = false,
    onOpenIdeaDrawer,
    onCloseIdeaDrawer,
}: Props) {
    const controller = useMobileIdeaController()
    const pageRef = useRef<HTMLDivElement>(null)
    const topActionsRef = useRef<HTMLDivElement>(null)
    const contentRef = useRef<HTMLTextAreaElement>(null)
    const [drawerRoot, setDrawerRoot] = useState<HTMLElement | null>(null)
    const [menuOpen, setMenuOpen] = useState(false)

    useEffect(() => {
        setDrawerRoot(document.getElementById('mobile-idea-drawer-root'))
    }, [ideaDrawerOpen])

    const menuItems = buildIdeaMenuItems(controller)

    return (
        <div ref={pageRef} className="mobile-idea">
            {drawerRoot ? createPortal(
                <MobileIdeaDrawer controller={controller} onClose={onCloseIdeaDrawer}/>,
                drawerRoot,
            ) : null}

            <header className="mobile-idea__topbar">
                <MobileTopIconButton
                    type="button"
                    icon={<MobileIdeaIcon type="menu"/>}
                    aria-label="打开灵感列表"
                    aria-expanded={ideaDrawerOpen}
                    onClick={onOpenIdeaDrawer}
                />
                <div className="mobile-idea__title-pill">
                    <span>{controller.selectedIdea ? '编辑灵感' : '新灵感'}</span>
                    <small>{getSaveStateText(controller)}</small>
                </div>
                <MobileTopActionPill
                    ref={topActionsRef}
                    actions={[
                        {
                            key: 'new',
                            label: '新建灵感',
                            icon: '+',
                            kind: 'add',
                            onClick: () => {
                                setMenuOpen(false)
                                controller.startNewIdea()
                                requestAnimationFrame(() => contentRef.current?.focus())
                            },
                        },
                        {
                            key: 'menu',
                            label: '灵感操作',
                            icon: '…',
                            kind: 'more',
                            ariaHasPopup: 'menu',
                            ariaExpanded: menuOpen,
                            onClick: () => setMenuOpen(open => !open),
                        },
                    ]}
                />
            </header>

            <main className="mobile-idea__editor">
                <section className="mobile-idea__meta">
                    <input
                        className="mobile-idea__title-input"
                        value={controller.draftTitle}
                        onChange={event => controller.setDraftTitle(event.target.value)}
                        placeholder="标题（可选）"
                    />
                    <div className="mobile-idea__select-row">
                        <label>
                            <span>项目</span>
                            <select
                                value={controller.draftProjectId}
                                onChange={event => controller.setDraftProjectId(event.target.value)}
                            >
                                <option value="">全局灵感</option>
                                {controller.projects.map(project => (
                                    <option key={project.id} value={project.id}>{project.name}</option>
                                ))}
                            </select>
                        </label>
                        <label>
                            <span>状态</span>
                            <select
                                value={controller.draftStatus}
                                onChange={event => controller.setDraftStatus(event.target.value as typeof controller.draftStatus)}
                            >
                                <option value="inbox">待整理</option>
                                <option value="processed">已处理</option>
                                <option value="archived">归档</option>
                            </select>
                        </label>
                    </div>
                    <div className="mobile-idea__summary">
                        <span>{controller.selectedProjectName}</span>
                        {controller.draftPinned ? <span>已置顶</span> : null}
                    </div>
                </section>

                <textarea
                    ref={contentRef}
                    className="mobile-idea__content"
                    value={controller.draftContent}
                    onChange={event => controller.setDraftContent(event.target.value)}
                    placeholder="写下一个灵感、片段、设定疑问或待整理素材…"
                    autoFocus
                />
            </main>

            <MobileAnchoredActionMenu
                open={menuOpen}
                onClose={() => setMenuOpen(false)}
                anchorRef={topActionsRef}
                containerRef={pageRef}
                ariaLabel="灵感操作"
                items={menuItems}
            />
        </div>
    )
}
