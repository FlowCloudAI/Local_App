import './App.css'
import "./api"
import {Button, SideBar, type SideBarItem, TabBar, type TabItem, useAlert} from 'flowcloudai-ui'
import type {AiFocus} from './features/ai-chat/hooks/useAiController'
import {useAiController} from './features/ai-chat/hooks/useAiController'
import {getCurrentWindow} from "@tauri-apps/api/window";
import {useCallback, useEffect, useMemo, useState} from "react";
import ProjectList from "./pages/ProjectList.tsx";
import ProjectEditor from "./pages/ProjectEditor";
import Settings from "./pages/Settings";
import Idea from "./pages/Idea";
import type {Project} from "./api";
import AIChatContent from "./features/ai-chat/components/AIChatContent";
import DockableSidePanel from "./shared/ui/layout/DockableSidePanel";
import RelationDemo from "./features/relation-graph/dev/RelationDemo";
import MapShapeEditorDemo from "./features/maps/dev/MapShapeEditorDemo";
import SnapshotPanel from "./features/snapshots/components/SnapshotPanel";
import EntryEditModal from "./features/entries/components/EntryEditModal";
import AiConfirmModal from "./features/ai-chat/components/AiConfirmModal";
import type {ReportConversationContext} from "./features/ai-chat/model/AiControllerTypes";

type EntryTabMeta = {
    projectId: string
    entryId: string
}

type ProjectToolPanel = 'relation-graph' | 'timeline' | 'contradiction' | 'world-map'

type ProjectToolTabMeta = {
    projectId: string
    panel: ProjectToolPanel
}

type MainContentKey = 'home' | 'relation' | 'map-editor' | 'settings'
type SidePanelContentKey = 'idea' | 'ai-chat' | 'snapshot'

function App() {
    const AI_MIN_PANEL_WIDTH = 470
    const win = getCurrentWindow();
    const {showAlert} = useAlert()

    const [isMaximized, setIsMaximized] = useState(false);
    useEffect(() => {
        win.isMaximized().then(setIsMaximized);
        const unlisten = win.onResized(() => win.isMaximized().then(setIsMaximized));
        return () => {
            unlisten.then(f => f());
        };
    }, [win]);

    // Tabs 相关状态
    const [tabs, setTabs] = useState<TabItem[]>([]);
    const [activeKey, setActiveKey] = useState('');
    // projectTabMap: tabKey → projectId（仅项目标签页）
    const [projectTabMap, setProjectTabMap] = useState<Record<string, string>>({});
    const [entryTabMap, setEntryTabMap] = useState<Record<string, EntryTabMeta>>({});
    const [toolTabMap, setToolTabMap] = useState<Record<string, ProjectToolTabMeta>>({});

    const aiFocus = useMemo<AiFocus>(() => ({
        projectId: projectTabMap[activeKey] ?? toolTabMap[activeKey]?.projectId ?? entryTabMap[activeKey]?.projectId ?? null,
        entryId: entryTabMap[activeKey]?.entryId ?? null,
    }), [activeKey, entryTabMap, projectTabMap, toolTabMap])

    const aiController = useAiController(aiFocus)
    const [entryDirtyMap, setEntryDirtyMap] = useState<Record<string, boolean>>({});
    const [recentPageKeys, setRecentPageKeys] = useState<string[]>([])

    const [selectedKey, setSelectedKey] = useState<string>('')
    const [mainContentKey, setMainContentKey] = useState<MainContentKey>('home')
    const [sidePanelContentKey, setSidePanelContentKey] = useState<SidePanelContentKey>('ai-chat')
    const [mountedSidePanelKeys, setMountedSidePanelKeys] = useState<SidePanelContentKey[]>(['ai-chat'])
    const [collapsed, setCollapsed] = useState(false)
    const [aiPanelWidth, setAiPanelWidth] = useState(AI_MIN_PANEL_WIDTH)
    const [aiPanelCollapsed, setAiPanelCollapsed] = useState(true)
    const [aiPanelMode, setAiPanelMode] = useState<'floating' | 'fullscreen'>('floating')

    useEffect(() => {
        setMountedSidePanelKeys(prev => (
            prev.includes(sidePanelContentKey) ? prev : [...prev, sidePanelContentKey]
        ))
    }, [sidePanelContentKey])

    const showHomeWorkspace = useCallback(() => {
        setMainContentKey('home')
        setCollapsed(true)
    }, [])

    const touchRecentPage = useCallback((tabKey: string) => {
        setRecentPageKeys((prev) => {
            const next = [...prev.filter((key) => key !== tabKey), tabKey]
            return next.slice(-10)
        })
    }, [])

    const getProjectToolLabel = useCallback((projectName: string, panel: ProjectToolPanel) => {
        switch (panel) {
            case 'relation-graph':
                return `${projectName} · 关系图谱`
            case 'timeline':
                return `${projectName} · 时间线`
            case 'contradiction':
                return `${projectName} · 矛盾检查`
            case 'world-map':
                return `${projectName} · 世界地图`
        }
    }, [])

    // 新增标签（通用）
    const handleAdd = useCallback(() => {
        if (mainContentKey === 'settings') {
            setMainContentKey('home')
            setSelectedKey('')
        }
        const newKey = `tab-${Date.now()}`;
        setTabs(prev => [...prev, {key: newKey, label: `新标签`, closable: true}]);
        setActiveKey(newKey);
    }, [mainContentKey]);

    // 打开项目标签页
    const handleOpenProject = useCallback((project: Project) => {
        const tabKey = `proj-${project.id}`;
        setTabs((prev) => {
            const index = prev.findIndex((tab) => tab.key === tabKey)
            if (index === -1) return [...prev, {key: tabKey, label: project.name, closable: true}]
            return prev.map((tab) => tab.key === tabKey ? {...tab, label: project.name, closable: true} : tab)
        });
        setProjectTabMap(prev => prev[tabKey] === project.id ? prev : {...prev, [tabKey]: project.id});
        setActiveKey(tabKey);
        touchRecentPage(tabKey)
        showHomeWorkspace();
    }, [showHomeWorkspace, touchRecentPage]);

    const handleOpenEntry = useCallback((projectId: string, entry: { id: string; title: string }) => {
        const tabKey = `entry-${projectId}-${entry.id}`;
        setTabs((prev) => {
            const index = prev.findIndex((tab) => tab.key === tabKey)
            if (index === -1) return [...prev, {key: tabKey, label: entry.title, closable: true}]
            return prev.map((tab) => tab.key === tabKey ? {...tab, label: entry.title, closable: true} : tab)
        });
        setEntryTabMap(prev => ({
            ...prev,
            [tabKey]: {
                projectId,
                entryId: entry.id,
            },
        }));
        setActiveKey(tabKey);
        touchRecentPage(tabKey)
        showHomeWorkspace();
    }, [showHomeWorkspace, touchRecentPage]);

    const handleOpenProjectTool = useCallback((panel: ProjectToolPanel, project: { id: string; name: string }) => {
        const tabKey = `tool-${project.id}-${panel}`
        setTabs((prev) => {
            const label = getProjectToolLabel(project.name, panel)
            const index = prev.findIndex((tab) => tab.key === tabKey)
            if (index === -1) return [...prev, {key: tabKey, label, closable: true}]
            return prev.map((tab) => tab.key === tabKey ? {...tab, label, closable: true} : tab)
        })
        setToolTabMap((prev) => ({
            ...prev,
            [tabKey]: {
                projectId: project.id,
                panel,
            },
        }))
        setActiveKey(tabKey)
        touchRecentPage(tabKey)
        showHomeWorkspace()
    }, [getProjectToolLabel, showHomeWorkspace, touchRecentPage])

    const handleEntryTitleChange = useCallback((projectId: string, entry: { id: string; title: string }) => {
        const tabKey = `entry-${projectId}-${entry.id}`;
        setTabs(prev => prev.map(tab => tab.key === tabKey ? {...tab, label: entry.title} : tab));
    }, []);

    const handleEntryDirtyChange = useCallback((projectId: string, entryId: string, dirty: boolean) => {
        const tabKey = `entry-${projectId}-${entryId}`
        setEntryDirtyMap(prev => {
            if (!dirty) {
                if (!prev[tabKey]) return prev
                const next = {...prev}
                delete next[tabKey]
                return next
            }
            if (prev[tabKey]) return prev
            return {...prev, [tabKey]: true}
        })
    }, [])

    const activateProjectTab = useCallback((projectId: string) => {
        const tabKey = `proj-${projectId}`
        setActiveKey(tabKey);
        touchRecentPage(tabKey)
        showHomeWorkspace();
    }, [showHomeWorkspace, touchRecentPage]);

    const handleBackToProject = useCallback((projectId: string) => {
        activateProjectTab(projectId);
    }, [activateProjectTab]);

    const closeTabsForKeys = useCallback((keysToRemove: Set<string>) => {
        const newTabs = tabs.filter((tab) => !keysToRemove.has(tab.key))
        setTabs(newTabs)
        setProjectTabMap((prev) => {
            const next = {...prev}
            for (const k of keysToRemove) delete next[k]
            return next
        })
        setEntryTabMap((prev) => {
            const next = {...prev}
            for (const k of keysToRemove) delete next[k]
            return next
        })
        setToolTabMap((prev) => {
            const next = {...prev}
            for (const k of keysToRemove) delete next[k]
            return next
        })
        setEntryDirtyMap((prev) => {
            const next = {...prev}
            for (const k of keysToRemove) delete next[k]
            return next
        })
        setRecentPageKeys((prev) => prev.filter((k) => !keysToRemove.has(k)))
        if (keysToRemove.has(activeKey)) {
            const closedIndex = tabs.findIndex((tab) => keysToRemove.has(tab.key))
            const nextTab = newTabs[closedIndex] ?? newTabs[closedIndex - 1]
            if (nextTab?.key) {
                if (projectTabMap[nextTab.key] || toolTabMap[nextTab.key] || entryTabMap[nextTab.key]) {
                    touchRecentPage(nextTab.key)
                    showHomeWorkspace()
                }
            } else {
                setMainContentKey('home')
                setSelectedKey('home')
            }
            setActiveKey(nextTab?.key ?? '')
        }
    }, [activeKey, entryTabMap, projectTabMap, tabs, toolTabMap, touchRecentPage, showHomeWorkspace])

    const handleDeleteProject = useCallback((projectId: string) => {
        const projKey = `proj-${projectId}`
        const relatedToolKeys = Object.entries(toolTabMap)
            .filter(([, meta]) => meta.projectId === projectId)
            .map(([k]) => k)
        const relatedEntryKeys = Object.entries(entryTabMap)
            .filter(([, meta]) => meta.projectId === projectId)
            .map(([k]) => k)
        closeTabsForKeys(new Set([projKey, ...relatedToolKeys, ...relatedEntryKeys]))
        window.dispatchEvent(new CustomEvent('fc:project-list-changed'))
    }, [closeTabsForKeys, entryTabMap, toolTabMap])

    const handleDeleteEntry = useCallback((projectId: string, entryId: string) => {
        const entryKey = `entry-${projectId}-${entryId}`
        closeTabsForKeys(new Set([entryKey]))
        activateProjectTab(projectId)
    }, [activateProjectTab, closeTabsForKeys])

    const handleTabChange = useCallback((key: string) => {
        const shouldShowHomeWorkspace = Boolean(projectTabMap[key] || toolTabMap[key] || entryTabMap[key])
        if (key === activeKey) {
            if (shouldShowHomeWorkspace && mainContentKey !== 'home') {
                if (mainContentKey === 'settings') {
                    setSelectedKey('')
                }
                touchRecentPage(key)
                showHomeWorkspace()
            }
            return
        }
        setActiveKey(key);
        if (shouldShowHomeWorkspace) {
            if (mainContentKey === 'settings') {
                setSelectedKey('')
            }
            touchRecentPage(key)
            showHomeWorkspace()
        }
    }, [activeKey, entryTabMap, mainContentKey, projectTabMap, showHomeWorkspace, toolTabMap, touchRecentPage])

    // 删除标签
    const handleClose = useCallback(async (key: string) => {
        const closingProjectId = projectTabMap[key];
        const relatedToolKeys = closingProjectId
            ? Object.entries(toolTabMap)
                .filter(([, meta]) => meta.projectId === closingProjectId)
                .map(([toolKey]) => toolKey)
            : [];
        const relatedEntryKeys = closingProjectId
            ? Object.entries(entryTabMap)
                .filter(([, meta]) => meta.projectId === closingProjectId)
                .map(([entryKey]) => entryKey)
            : [];
        const keysToRemove = new Set([key, ...relatedToolKeys, ...relatedEntryKeys]);
        const dirtyEntryKeys = [...keysToRemove].filter(tabKey => entryDirtyMap[tabKey])
        if (dirtyEntryKeys.length > 0) {
            const message = dirtyEntryKeys.length === 1
                ? '当前词条有未保存更改，关闭标签页会丢失这些修改。是否继续关闭？'
                : `有 ${dirtyEntryKeys.length} 个词条标签存在未保存更改，关闭后会丢失这些修改。是否继续关闭？`
            const res = await showAlert(message, 'warning', 'confirm')
            if (res !== 'yes') return
        }
        const newTabs = tabs.filter(tab => !keysToRemove.has(tab.key));
        setTabs(newTabs);
        setProjectTabMap(prev => {
            const next = {...prev};
            for (const removedKey of keysToRemove) {
                delete next[removedKey];
            }
            return next;
        });
        setEntryTabMap(prev => {
            const next = {...prev};
            for (const removedKey of keysToRemove) {
                delete next[removedKey];
            }
            return next;
        });
        setToolTabMap(prev => {
            const next = {...prev}
            for (const removedKey of keysToRemove) {
                delete next[removedKey]
            }
            return next
        })
        setEntryDirtyMap(prev => {
            const next = {...prev}
            for (const removedKey of keysToRemove) {
                delete next[removedKey]
            }
            return next
        })
        setRecentPageKeys(prev => prev.filter((tabKey) => !keysToRemove.has(tabKey)))
        if (keysToRemove.has(activeKey)) {
            const closedIndex = tabs.findIndex(tab => tab.key === key);
            const nextTab = newTabs[closedIndex] || newTabs[closedIndex - 1];
            if (nextTab?.key) {
                if (projectTabMap[nextTab.key] || toolTabMap[nextTab.key] || entryTabMap[nextTab.key]) {
                    touchRecentPage(nextTab.key)
                    showHomeWorkspace()
                }
            } else {
                setMainContentKey('home')
                setSelectedKey('home')
            }
            setActiveKey(nextTab?.key ?? '');
        }
    }, [activeKey, entryDirtyMap, entryTabMap, projectTabMap, showAlert, showHomeWorkspace, tabs, toolTabMap, touchRecentPage]);

    const handleSideBarSelect = useCallback((key: string) => {
        if (key === 'idea' || key === 'ai-chat' || key === 'snapshot') {
            if (!aiPanelCollapsed && sidePanelContentKey === key) {
                setAiPanelCollapsed(true)
                setSelectedKey('')
                return
            }
            setSelectedKey(key)
            setSidePanelContentKey(key as SidePanelContentKey)
            setAiPanelCollapsed(false)
            if (mainContentKey === 'settings') {
                setMainContentKey('home')
            }
            return
        }
        if (key === 'settings') {
            setSelectedKey('settings')
            setMainContentKey('settings')
            setAiPanelCollapsed(true)
            return
        }
    }, [aiPanelCollapsed, mainContentKey, sidePanelContentKey])

    const handleStartCharacterChat = useCallback(async (projectId: string, entry: { id: string; title: string }) => {
        setSelectedKey('ai-chat')
        setSidePanelContentKey('ai-chat')
        setAiPanelCollapsed(false)
        const entryTabKey = `entry-${projectId}-${entry.id}`
        if (activeKey !== entryTabKey) {
            setActiveKey(entryTabKey)
        }
        touchRecentPage(entryTabKey)
        showHomeWorkspace()
        try {
            await aiController.startCharacterConversation({
                projectId,
                entryId: entry.id,
            })
        } catch (error) {
            console.error('启动角色对话失败', error)
        }
    }, [activeKey, aiController, showHomeWorkspace, touchRecentPage])

    const handleStartReportDiscussion = useCallback(async (params: {
        title: string
        pluginId: string
        model: string
        reportContext: ReportConversationContext
    }) => {
        setSelectedKey('ai-chat')
        setSidePanelContentKey('ai-chat')
        setAiPanelCollapsed(false)
        try {
            await aiController.startReportDiscussion(params)
        } catch (error) {
            console.error('启动报告讨论失败', error)
        }
    }, [aiController])

    const activeHomeProjectId = projectTabMap[activeKey] ?? toolTabMap[activeKey]?.projectId ?? entryTabMap[activeKey]?.projectId ?? ''
    const activeEntryMeta = entryTabMap[activeKey] ?? null
    const recentPageKeySet = useMemo(() => new Set(recentPageKeys), [recentPageKeys])
    const homeProjectIds = useMemo(() => [...new Set(
        recentPageKeys
            .map((key) => projectTabMap[key] ?? toolTabMap[key]?.projectId ?? entryTabMap[key]?.projectId ?? null)
            .filter((projectId): projectId is string => Boolean(projectId))
    )], [entryTabMap, projectTabMap, recentPageKeys, toolTabMap])
    const openEntryIdsByProject = useMemo(() => {
        const next: Record<string, string[]> = {}
        for (const item of tabs) {
            const entryMeta = entryTabMap[item.key]
            if (!entryMeta || !recentPageKeySet.has(item.key)) continue
            if (!next[entryMeta.projectId]) {
                next[entryMeta.projectId] = []
            }
            next[entryMeta.projectId].push(entryMeta.entryId)
        }
        return next
    }, [entryTabMap, recentPageKeySet, tabs])

    // 侧边栏相关状态
    const IdeaIcon = (
        <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="none">
            <defs>
                <linearGradient id="ideaGrad" x1="0" y1="0" x2="1" y2="1" gradientUnits="objectBoundingBox">
                    <stop offset="0" stopColor="#0DBDED"/>
                    <stop offset="1" stopColor="#9C1FED"/>
                </linearGradient>
            </defs>
            <path
                d="M12 3C14 8 16 10 21 12C16 14 14 16 12 21C10 16 8 14 3 12C8 10 10 8 12 3Z"
                stroke="url(#ideaGrad)"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
        </svg>)

    const AiChatIcon = (
        <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="none">
            <path
                d="M5 9.5A3.5 3.5 0 0 1 8.5 6h7A3.5 3.5 0 0 1 19 9.5v4A3.5 3.5 0 0 1 15.5 17H10l-4 3v-3.6A3.48 3.48 0 0 1 5 13.5v-4Z"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
            <path
                d="M9 10h5M9 13h3.5"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
            />
            <path
                d="M17.5 4.5 18 6l1.5.5-1.5.5-.5 1.5-.5-1.5L15.5 6.5 17 6l.5-1.5Z"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
        </svg>)

    const SnapshotIcon = (
        <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="none">
            <circle cx="8" cy="6" r="2" stroke="currentColor" strokeWidth="1.5"/>
            <circle cx="8" cy="18" r="2" stroke="currentColor" strokeWidth="1.5"/>
            <circle cx="16" cy="12" r="2" stroke="currentColor" strokeWidth="1.5"/>
            <path
                d="M8 8v8m2-10h3.5A2.5 2.5 0 0 1 16 8.5v1.5M10 18h3.5A2.5 2.5 0 0 0 16 15.5V14"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
        </svg>)

    const SettingsIcon = (
        <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
            <circle cx="12" cy="12" r="3" strokeWidth="1.5"/>
            <path
                d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15 1.65 1.65 0 003.17 14H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06A1.65 1.65 0 009 4.68 1.65 1.65 0 0010 3.17V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"
                strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>)

    const menuItems: SideBarItem[] = [
        {key: 'idea', label: '灵感便签', icon: IdeaIcon},
        {key: 'ai-chat', label: 'AI 对话', icon: AiChatIcon},
        {key: 'snapshot', label: '版本管理', icon: SnapshotIcon},
    ]
    const bottomItems: SideBarItem[] = [
        {key: 'settings', label: '设置', icon: SettingsIcon},
    ]

    return (
        <div className="app-layout">
            <div className="top-bar" data-tauri-drag-region>
                <button className="menu-btn" data-tauri-drag-region>
                    <svg data-tauri-drag-region
                         xmlns="http://www.w3.org/2000/svg" width="512" height="512"
                         viewBox="0 0 512 512" fill="none">
                        <path
                            d="M362.34 234.141C324.97 212.705 258.916 226.767 258.728 286.513C241.793 230.641 315.033 173.27 382.462 199.768C418.083 213.767 439.643 242.766 447.642 275.326C466.139 350.384 405.459 389.506 333.594 385.944C280.288 383.319 255.541 352.071 218.108 330.823C209.484 325.885 195.674 319.011 183.3 317.948C158.178 315.824 141.743 322.386 127.37 331.323C146.742 310.511 174.926 298.637 199.611 299.45C245.105 300.949 277.101 334.072 324.032 335.76C407.397 342.947 405.834 259.14 362.277 234.141L362.34 234.141ZM209.984 134.21C241.48 117.024 281.1 118.149 312.534 136.522C322.47 142.335 340.718 157.271 344.967 168.02C336.093 160.271 318.033 142.772 268.227 150.709C227.982 157.146 199.673 199.206 202.298 236.453C177.488 234.079 152.304 232.454 131.119 254.202C117.183 268.514 106.497 290.263 108.059 316.886C109.434 340.384 125.557 360.508 142.118 369.695C151.992 375.132 162.615 378.445 174.676 380.007C189.924 382.007 216.421 378.882 232.106 370.57C164.053 410.443 85.9373 384.632 66.5022 332.26C46.6298 278.701 82.3752 217.205 144.93 211.955C152.179 211.33 155.429 211.018 159.366 211.33C167.74 170.27 178.926 151.146 209.922 134.21L209.984 134.21Z"
                            fill="url(#linear_fill_jAZk9lqyiGGO3cP1dJ5WO)"/>
                        <defs>
                            <linearGradient id="linear_fill_jAZk9lqyiGGO3cP1dJ5WO" x1="94.38400268554688"
                                            y1="140.4921875"
                                            x2="417.6159973144531" y2="371.5078125" gradientUnits="userSpaceOnUse">
                                <stop offset="0" stopColor="#0DBDED"/>
                                <stop offset="1" stopColor="#9C1FED"/>
                            </linearGradient>
                        </defs>
                    </svg>
                </button>
                <div className={"tab-bar-wrapper"} data-tauri-drag-region>
                    <TabBar
                        background={"transparent"}
                        variant={"floating"}
                        tabRadius={"md"}
                        closable
                        draggable
                        addable
                        fillWidth={false}
                        tauriDragRegion
                        minTabWidth={"10rem"}
                        items={tabs}
                        activeKey={activeKey}
                        onReorder={setTabs}
                        onChange={(key) => {
                            void handleTabChange(key);
                        }}
                        onClose={(key) => {
                            handleClose(key).then();
                        }}
                        onAdd={() => {
                            handleAdd();
                        }}
                    />
                </div>
                <div className="top-bar-actions" data-tauri-drag-region>
                    <Button
                        className="window-control-btn"
                        variant="ghost"
                        onClick={() => win.minimize()}
                        hoverBackground={"var(--fc-color-bg-tertiary)"}
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"
                             fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
                             strokeLinejoin="round">
                            <line x1="5" y1="12" x2="19" y2="12"/>
                        </svg>
                    </Button>
                    <Button
                        className="window-control-btn"
                        variant="ghost"
                        onClick={() => win.toggleMaximize()}
                        hoverBackground={"var(--fc-color-bg-tertiary)"}
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"
                             fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
                             strokeLinejoin="round">
                            {isMaximized ? (
                                <>
                                    <rect x="2" y="6" width="16" height="12" rx="2"/>
                                    <path d="M 6 2 L 20 2 A 2 2 0 0 1 22 4 L 22 13"/>
                                </>
                            ) : (
                                <rect x="3" y="4.5" width="18" height="15" rx="2"/>
                            )}
                        </svg>
                    </Button>
                    <Button
                        className="window-control-btn window-control-btn--danger"
                        variant="ghost"
                        onClick={() => win.close()}
                        hoverBackground={"#aa1111"}
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"
                             fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
                             strokeLinejoin="round">
                            <line x1="19" y1="5" x2="5" y2="19"/>
                            <line x1="5" y1="5" x2="19" y2="19"/>
                        </svg>
                    </Button>
                </div>
            </div>
            <div className="main-content">
                <div className="workspace-content">
                    <div className="page-container">
                        <div className={`page-wrapper ${mainContentKey === 'home' ? 'active' : ''}`}>
                            <div className="home-page-stack">
                                <div className={`home-page-layer ${!activeHomeProjectId ? 'active' : ''}`}>
                                    <ProjectList onOpenProject={handleOpenProject}/>
                                </div>
                                {homeProjectIds.map(projectId => (
                                    <div
                                        key={projectId}
                                        className={`home-page-layer ${activeHomeProjectId === projectId ? 'active' : ''}`}
                                    >
                                        <ProjectEditor
                                            projectId={projectId}
                                            activeToolPanel={toolTabMap[activeKey]?.projectId === projectId ? toolTabMap[activeKey].panel : null}
                                            onOpenProjectPanel={handleOpenProjectTool}
                                                aiPluginId={aiController.selectedPlugin || null}
                                                aiModel={aiController.selectedModel || null}
                                                activeEntryId={activeEntryMeta?.projectId === projectId ? activeEntryMeta.entryId : null}
                                                openEntryIds={openEntryIdsByProject[projectId] ?? []}
                                                onOpenEntry={handleOpenEntry}
                                                onEntryTitleChange={handleEntryTitleChange}
                                                onBackToProject={handleBackToProject}
                                                onEntryDirtyChange={handleEntryDirtyChange}
                                                onStartCharacterChat={handleStartCharacterChat}
                                            onStartReportDiscussion={handleStartReportDiscussion}
                                            onDeleteProject={handleDeleteProject}
                                            onDeleteEntry={handleDeleteEntry}
                                        />
                                    </div>
                                ))}
                            </div>
                        </div>
                        <div className={`page-wrapper ${mainContentKey === 'relation' ? 'active' : ''}`}>
                            <RelationDemo/>
                        </div>
                        <div className={`page-wrapper ${mainContentKey === 'map-editor' ? 'active' : ''}`}>
                            <MapShapeEditorDemo/>
                        </div>
                        <div className={`page-wrapper ${mainContentKey === 'settings' ? 'active' : ''}`}>
                            <Settings onBack={() => {
                                setMainContentKey('home')
                                setSelectedKey('')
                            }}/>
                        </div>
                    </div>
                    <DockableSidePanel
                        mode={aiPanelMode}
                        width={aiPanelWidth}
                        minWidth={AI_MIN_PANEL_WIDTH}
                        maxWidthRatio={0.7}
                        collapsed={aiPanelCollapsed}
                        onCollapsedChange={setAiPanelCollapsed}
                        onWidthChange={setAiPanelWidth}
                        onModeChange={setAiPanelMode}
                        className="ai-shell"
                        handleTitle="拖拽调整宽度"
                    >
                        <div className="side-panel-stack">
                            {mountedSidePanelKeys.includes('idea') && (
                                <div
                                    className={`side-panel-layer ${sidePanelContentKey === 'idea' ? 'active' : ''}`}
                                    aria-hidden={sidePanelContentKey !== 'idea'}
                                >
                                    <Idea
                                        contextProjectId={aiFocus.projectId}
                                        onOpenEntry={handleOpenEntry}
                                        panelMode={aiPanelMode}
                                        onTogglePanelMode={() =>
                                            setAiPanelMode(
                                                (prev) => prev === 'floating' ? 'fullscreen' : 'floating')
                                        }
                                        onToggleCollapsed={() => setAiPanelCollapsed(true)}/>
                                </div>
                            )}
                            {mountedSidePanelKeys.includes('snapshot') && (
                                <div
                                    className={`side-panel-layer ${sidePanelContentKey === 'snapshot' ? 'active' : ''}`}
                                    aria-hidden={sidePanelContentKey !== 'snapshot'}
                                >
                                    <SnapshotPanel
                                        className={`ai-chat-layout ${aiController.sidebarCollapsed ? 'sidebar-collapsed' : ''}`}
                                        panelMode={aiPanelMode}
                                        onTogglePanelMode={() => setAiPanelMode((prev) => prev === 'floating' ? 'fullscreen' : 'floating')}
                                        onToggleCollapsed={() => setAiPanelCollapsed(true)}
                                    />
                                </div>
                            )}
                            <div
                                className={`side-panel-layer ${sidePanelContentKey === 'ai-chat' ? 'active' : ''}`}
                                aria-hidden={sidePanelContentKey !== 'ai-chat'}
                            >
                                <div
                                    className={`ai-chat-layout ${aiController.sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
                                    <AIChatContent controller={aiController} panelMode={aiPanelMode}
                                                   onTogglePanelMode={() => setAiPanelMode((prev) => prev === 'floating' ? 'fullscreen' : 'floating')}
                                                   onToggleCollapsed={() => setAiPanelCollapsed(true)}/>
                                </div>
                            </div>
                        </div>
                    </DockableSidePanel>
                </div>
                <SideBar
                    className={"side-bar"}
                    items={menuItems}
                    bottomItems={bottomItems}
                    selectedKey={selectedKey}
                    collapsed={collapsed}
                    width={150}
                    collapsedWidth={50}
                    onSelect={handleSideBarSelect}
                    onCollapse={setCollapsed}
                    placement={"right"}
                />
            </div>
            <EntryEditModal/>
            <AiConfirmModal/>
        </div>
    )
}

export default App
