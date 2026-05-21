import {type ReactNode, useEffect, useMemo, useRef, useState} from 'react'
import type {DockableSidePanelMode} from '../../shared/ui/layout/DockableSidePanel'
import {
    DockPanelIconButton,
    DockPanelMain,
    DockPanelTitle,
    DockPanelTopbar,
} from '../../shared/ui/layout/DockPanelScaffold'
import '../../shared/ui/layout/DockPanelScaffold.css'
import {
    filterHelpTopics,
    getHelpModule,
    getHelpSectionDomId,
    groupHelpTopicsByModule,
    HELP_TOPICS,
    type HelpModuleKey,
    type HelpTopicKey,
    normalizeHelpTopicKey,
} from '../../shared/help/helpCatalog'
import HelpArticle from './components/HelpArticle'
import HelpHome from './components/HelpHome'
import HelpModuleHome from './components/HelpModuleHome'
import HelpSidebar from './components/HelpSidebar'
import './components/HelpPanel.css'

export interface HelpPanelRequest {
    topicKey?: string | null
    sectionId?: string | null
    requestId: number
}

interface UseHelpPanelOptions {
    panelMode?: DockableSidePanelMode
    request?: HelpPanelRequest | null
    onTogglePanelMode?: () => void
    onToggleCollapsed?: () => void
}

export interface HelpPanelSlots {
    side: ReactNode
    main: ReactNode
}

function scrollToSection(topicKey: HelpTopicKey, sectionId: string | null, bodyEl: HTMLDivElement | null) {
    if (!sectionId) {
        bodyEl?.scrollTo({top: 0, behavior: 'smooth'})
        return
    }

    document
        .getElementById(getHelpSectionDomId(topicKey, sectionId))
        ?.scrollIntoView({block: 'start', behavior: 'smooth'})
}

export function useHelpPanel({
    panelMode,
    request,
    onTogglePanelMode,
    onToggleCollapsed,
}: UseHelpPanelOptions = {}): HelpPanelSlots {
    const resolvedPanelMode = panelMode ?? 'floating'
    const [activeModuleKey, setActiveModuleKey] = useState<HelpModuleKey | null>(null)
    const [activeTopicKey, setActiveTopicKey] = useState<HelpTopicKey | null>(null)
    const [activeSectionId, setActiveSectionId] = useState<string | null>(null)
    const [searchText, setSearchText] = useState('')
    const [sidebarCollapsed, setSidebarCollapsed] = useState(true)
    const articleBodyRef = useRef<HTMLDivElement | null>(null)
    const requestId = request?.requestId
    const requestTopicKey = request?.topicKey
    const requestSectionId = request?.sectionId

    useEffect(() => {
        if (requestId === undefined) return
        const nextTopicKey = normalizeHelpTopicKey(requestTopicKey)
        const nextTopic = HELP_TOPICS.find(topic => topic.key === nextTopicKey) ?? HELP_TOPICS[0]
        setActiveModuleKey(nextTopic.moduleKey)
        setActiveTopicKey(nextTopic.key)
        setActiveSectionId(requestSectionId ?? null)
    }, [requestId, requestSectionId, requestTopicKey])

    useEffect(() => {
        if (panelMode === 'fullscreen') {
            setSidebarCollapsed(false)
            return
        }
        if (panelMode === 'floating') {
            setSidebarCollapsed(true)
        }
    }, [panelMode])

    useEffect(() => {
        const frame = window.requestAnimationFrame(() => {
            if (!activeTopicKey) {
                articleBodyRef.current?.scrollTo({top: 0, behavior: 'smooth'})
                return
            }
            scrollToSection(activeTopicKey, activeSectionId, articleBodyRef.current)
        })
        return () => window.cancelAnimationFrame(frame)
    }, [activeModuleKey, activeSectionId, activeTopicKey])

    const activeTopic = useMemo(
        () => activeTopicKey ? HELP_TOPICS.find(topic => topic.key === activeTopicKey) ?? HELP_TOPICS[0] : null,
        [activeTopicKey],
    )

    const activeModule = useMemo(
        () => activeModuleKey ? getHelpModule(activeModuleKey) : null,
        [activeModuleKey],
    )

    const activeModuleTopics = useMemo(
        () => activeModuleKey ? HELP_TOPICS.filter(topic => topic.moduleKey === activeModuleKey) : [],
        [activeModuleKey],
    )

    const allTopicGroups = useMemo(
        () => groupHelpTopicsByModule(HELP_TOPICS),
        [],
    )

    const topicGroups = useMemo(
        () => groupHelpTopicsByModule(filterHelpTopics(HELP_TOPICS, searchText)),
        [searchText],
    )

    const handleSelectTopic = (topicKey: HelpTopicKey, sectionId: string | null = null) => {
        const nextTopic = HELP_TOPICS.find(topic => topic.key === topicKey) ?? HELP_TOPICS[0]
        setActiveModuleKey(nextTopic.moduleKey)
        setActiveTopicKey(nextTopic.key)
        setActiveSectionId(sectionId)
        if (panelMode !== 'fullscreen') {
            setSidebarCollapsed(true)
        }
    }

    const handleSelectHome = () => {
        setActiveModuleKey(null)
        setActiveTopicKey(null)
        setActiveSectionId(null)
    }

    const handleSelectModule = (moduleKey: HelpModuleKey) => {
        setActiveModuleKey(moduleKey)
        setActiveTopicKey(null)
        setActiveSectionId(null)
    }

    const handleSelectSection = (sectionId: string) => {
        if (!activeTopicKey) return
        setActiveSectionId(sectionId)
        window.requestAnimationFrame(() => {
            scrollToSection(activeTopicKey, sectionId, articleBodyRef.current)
        })
    }

    const sideContent = (
        <HelpSidebar
            groups={topicGroups}
            activeHome={!activeModuleKey && !activeTopicKey}
            activeModuleKey={activeModuleKey}
            activeTopicKey={activeTopic?.key ?? null}
            searchText={searchText}
            showCollapseButton={panelMode !== 'fullscreen'}
            onSearchTextChange={setSearchText}
            onSelectHome={handleSelectHome}
            onSelectModule={handleSelectModule}
            onSelectTopic={handleSelectTopic}
            onCollapse={() => setSidebarCollapsed(true)}
        />
    )

    const mainContent = (
        <DockPanelMain className={`help-main help-main--${resolvedPanelMode}`}>
            <DockPanelTopbar className="help-main__topbar">
                <div className="help-main__topbar-left">
                    {panelMode !== 'fullscreen' && sidebarCollapsed ? (
                        <DockPanelIconButton
                            type="button"
                            className="help-main__sidebar-toggle"
                            onClick={() => setSidebarCollapsed(false)}
                            title="展开目录"
                            aria-label="展开帮助目录"
                            aria-expanded={!sidebarCollapsed}
                        >
                            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                                <path d="M6 3 11 8l-5 5"/>
                            </svg>
                        </DockPanelIconButton>
                    ) : null}
                    <DockPanelTitle>帮助中心</DockPanelTitle>
                </div>
                <div className="help-main__topbar-actions">
                    <DockPanelIconButton
                        type="button"
                        onClick={() => onTogglePanelMode?.()}
                        title={panelMode === 'fullscreen' ? '退出全屏' : '全屏模式'}
                        aria-label={panelMode === 'fullscreen' ? '退出全屏' : '全屏模式'}
                    >
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                            {panelMode === 'fullscreen' ? (
                                <path d="M4 10v2h2M10 12h2v-2M12 4v2h-2M6 4H4v2"/>
                            ) : (
                                <path d="M2 6V2h4M14 6V2h-4M2 10v4h4M14 10v4h-4"/>
                            )}
                        </svg>
                    </DockPanelIconButton>
                    <DockPanelIconButton
                        type="button"
                        onClick={() => onToggleCollapsed?.()}
                        title="最小化"
                        aria-label="最小化帮助中心"
                    >
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                            <path d="M6 4l4 4-4 4"/>
                        </svg>
                    </DockPanelIconButton>
                </div>
            </DockPanelTopbar>
            {activeTopic ? (
                <HelpArticle
                    topic={activeTopic}
                    bodyRef={articleBodyRef}
                    onSelectHome={handleSelectHome}
                    onSelectSection={handleSelectSection}
                />
            ) : activeModule ? (
                <HelpModuleHome
                    module={activeModule}
                    topics={activeModuleTopics}
                    bodyRef={articleBodyRef}
                    onSelectHome={handleSelectHome}
                    onSelectTopic={handleSelectTopic}
                />
            ) : (
                <HelpHome
                    groups={allTopicGroups}
                    bodyRef={articleBodyRef}
                    onSelectModule={handleSelectModule}
                    onSelectTopic={handleSelectTopic}
                />
            )}
        </DockPanelMain>
    )

    if (panelMode === 'fullscreen') {
        return {side: sideContent, main: mainContent}
    }

    return {
        side: null,
        main: (
            <div className={`help-panel${sidebarCollapsed ? ' sidebar-collapsed' : ''}`}>
                {!sidebarCollapsed ? (
                    <button
                        type="button"
                        className="help-panel__sidebar-backdrop"
                        aria-label="关闭帮助目录"
                        onClick={() => setSidebarCollapsed(true)}
                    />
                ) : null}
                {sideContent}
                {mainContent}
            </div>
        ),
    }
}
