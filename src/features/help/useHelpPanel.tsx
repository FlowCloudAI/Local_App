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
    getHelpSectionDomId,
    groupHelpTopicsByModule,
    HELP_TOPICS,
    type HelpTopicKey,
    normalizeHelpTopicKey,
} from '../../shared/help/helpCatalog'
import HelpArticle from './components/HelpArticle'
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
    const [activeTopicKey, setActiveTopicKey] = useState<HelpTopicKey>('getting-started')
    const [activeSectionId, setActiveSectionId] = useState<string | null>(null)
    const [searchText, setSearchText] = useState('')
    const [sidebarCollapsed, setSidebarCollapsed] = useState(true)
    const articleBodyRef = useRef<HTMLDivElement | null>(null)
    const requestId = request?.requestId
    const requestTopicKey = request?.topicKey
    const requestSectionId = request?.sectionId

    useEffect(() => {
        if (requestId === undefined) return
        setActiveTopicKey(normalizeHelpTopicKey(requestTopicKey))
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
            scrollToSection(activeTopicKey, activeSectionId, articleBodyRef.current)
        })
        return () => window.cancelAnimationFrame(frame)
    }, [activeSectionId, activeTopicKey])

    const activeTopic = useMemo(
        () => HELP_TOPICS.find(topic => topic.key === activeTopicKey) ?? HELP_TOPICS[0],
        [activeTopicKey],
    )

    const topicGroups = useMemo(
        () => groupHelpTopicsByModule(filterHelpTopics(HELP_TOPICS, searchText)),
        [searchText],
    )

    const handleSelectTopic = (topicKey: HelpTopicKey) => {
        setActiveTopicKey(topicKey)
        setActiveSectionId(null)
        if (panelMode !== 'fullscreen') {
            setSidebarCollapsed(true)
        }
    }

    const handleSelectModule = (topicKey: HelpTopicKey) => {
        setActiveTopicKey(topicKey)
        setActiveSectionId(null)
    }

    const handleSelectSection = (sectionId: string) => {
        setActiveSectionId(sectionId)
        window.requestAnimationFrame(() => {
            scrollToSection(activeTopicKey, sectionId, articleBodyRef.current)
        })
    }

    const sideContent = (
        <HelpSidebar
            groups={topicGroups}
            activeTopicKey={activeTopic.key}
            searchText={searchText}
            showCollapseButton={panelMode !== 'fullscreen'}
            onSearchTextChange={setSearchText}
            onSelectModule={handleSelectModule}
            onSelectTopic={handleSelectTopic}
            onCollapse={() => setSidebarCollapsed(true)}
        />
    )

    const mainContent = (
        <DockPanelMain className="help-main">
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
            <HelpArticle
                topic={activeTopic}
                activeSectionId={activeSectionId}
                bodyRef={articleBodyRef}
                onSelectSection={handleSelectSection}
            />
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
