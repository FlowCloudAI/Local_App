import {logger} from '../../shared/logger'
import {isBrowserPreview} from '../../shared/devPreview'
import {closeTopOverlay} from '../../shared/ui/overlay/overlayStack'
import AiConfirmModal from '../../features/ai-chat/components/AiConfirmModal'
import './MobileApp.css'
import {useAlert} from 'flowcloudai-ui'
import {
    type CSSProperties,
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
} from 'react'
import {listen} from '@tauri-apps/api/event'
import {
    type Category,
    db_get_project_stats,
    db_list_categories,
    exit_app,
    type ProjectStats,
    setting_is_backend_ready,
    showWindow,
    type PlatformInfo,
} from '../../api'
import {type AiFocus} from '../../features/ai-chat/hooks/useAiController'
import MobileCategoryDrawer, {type MobileCategoryDrawerSelection} from './components/MobileCategoryDrawer'
import MobileNav, {type MobileTab} from './MobileNav'
import MobileAiChat from './pages/MobileAiChat'
import MobileCategoryManager from './pages/MobileCategoryManager'
import MobileEntryDetail from './pages/MobileEntryDetail'
import MobileEntryList from './pages/MobileEntryList'
import MobileHome, {type MobileHomePanel} from './pages/MobileHome'
import MobileIdea from './pages/MobileIdea'
import MobileProjectHome from './pages/MobileProjectHome'
import MobileProjectList from './pages/MobileProjectList'
import MobileSettings from './pages/MobileSettings'
import MobileTypeTagManager from './pages/MobileTypeTagManager'
import {type MobilePage, usePageStack} from './usePageStack'
import {getMobileSideDrawerWidth, useMobileSideDrawerGesture} from './useMobileSideDrawerGesture'

interface MobileAppProps {
    platformInfo: PlatformInfo
}

let mobileWindowShown = false
type MobileBeforeBack = () => boolean | Promise<boolean>

type PageProps = {
    push: (page: MobilePage) => void
    pop: () => void
    replace: (page: MobilePage) => void
    navigateToTab: (tab: MobileTab, page?: MobilePage) => void
    setBeforeBack: (handler: MobileBeforeBack | null) => void
    aiFocus: AiFocus
    setAiFocus: (focus: AiFocus) => void
}

export default function MobileApp({platformInfo}: MobileAppProps) {
    const {showAlert} = useAlert()
    const closingRef = useRef(false)
    const beforeBackRef = useRef<MobileBeforeBack | null>(null)
    const [activeTab, setActiveTab] = useState<MobileTab>('home')
    const [homePanel, setHomePanel] = useState<MobileHomePanel>('dashboard')

    const homeStack = usePageStack()
    const aiStack = usePageStack()
    const ideasStack = usePageStack()
    const settingsStack = usePageStack()

    const stacks = useMemo(() => ({
        home: homeStack,
        ai: aiStack,
        ideas: ideasStack,
        settings: settingsStack,
    }), [homeStack, aiStack, ideasStack, settingsStack])

    const activeStack = stacks[activeTab]
    const currentPage = activeStack.currentPage
    const pageType = currentPage?.type ?? ''

    // 开发期浏览器预览没有后端，直接视为就绪，避免卡在启动屏。
    const [backendReady, setBackendReady] = useState(() => isBrowserPreview())
    const [aiFocus, setAiFocus] = useState<AiFocus>({projectId: null, entryId: null})
    const [categoryDrawerWidth, setCategoryDrawerWidth] = useState(getMobileSideDrawerWidth)
    const [categoryDrawerCategories, setCategoryDrawerCategories] = useState<Category[]>([])
    const [categoryDrawerStats, setCategoryDrawerStats] = useState<ProjectStats | null>(null)

    const categoryDrawerProjectId = activeTab === 'home'
        && (pageType === 'projectHome' || pageType === 'entryList')
        ? currentPage?.params?.projectId as string | undefined
        : undefined
    const categoryDrawerEnabled = Boolean(categoryDrawerProjectId)
    const aiConversationDrawerEnabled = activeTab === 'ai'
    const ideaDrawerEnabled = activeTab === 'ideas'
    const mobileSideDrawerEnabled = categoryDrawerEnabled || aiConversationDrawerEnabled || ideaDrawerEnabled
    const mobileSideDrawerKind = categoryDrawerEnabled ? 'category' : aiConversationDrawerEnabled ? 'ai' : ideaDrawerEnabled ? 'idea' : null
    const {
        open: sideDrawerOpen,
        dragging: sideDrawerDragging,
        surfaceOffset: sideDrawerSurfaceOffset,
        openDrawer: openSideDrawer,
        closeDrawer: closeSideDrawer,
        pointerHandlers: sideDrawerPointerHandlers,
    } = useMobileSideDrawerGesture({
        enabled: mobileSideDrawerEnabled,
        width: categoryDrawerWidth,
        allowTextEditingTargetGestures: ideaDrawerEnabled,
    })
    const categoryDrawerSelection = useMemo<MobileCategoryDrawerSelection>(() => {
        if (pageType === 'projectHome') return {kind: 'projectHome'}
        if (pageType !== 'entryList' || !currentPage?.params) return {kind: 'projectHome'}
        if (currentPage.params.uncategorizedOnly) return {kind: 'uncategorized'}
        const categoryId = (currentPage.params.categoryId as string | undefined) || ''
        return categoryId ? {kind: 'category', categoryId} : {kind: 'allEntries'}
    }, [currentPage?.params, pageType])

    useEffect(() => {
        // 浏览器预览无后端信号，跳过监听（backendReady 初始已为 true）。
        if (isBrowserPreview()) return
        let disposed = false
        const mark = () => { if (!disposed) setBackendReady(true) }
        const p = listen('backend-ready', mark)
        setting_is_backend_ready().then(ready => { if (ready) mark() }).catch(() => {})
        return () => { disposed = true; p.then(fn => fn()) }
    }, [])

    useEffect(() => {
        if (!backendReady || !platformInfo.windowControls || mobileWindowShown) return
        mobileWindowShown = true
        requestAnimationFrame(() => {
            showWindow().catch((error) => {
                mobileWindowShown = false
                logger.error('显示移动端窗口失败', error)
            })
        })
    }, [backendReady, platformInfo.windowControls])

    useEffect(() => {
        const updateCategoryDrawerWidth = () => {
            setCategoryDrawerWidth(getMobileSideDrawerWidth())
        }
        updateCategoryDrawerWidth()
        window.addEventListener('resize', updateCategoryDrawerWidth)
        window.visualViewport?.addEventListener('resize', updateCategoryDrawerWidth)
        return () => {
            window.removeEventListener('resize', updateCategoryDrawerWidth)
            window.visualViewport?.removeEventListener('resize', updateCategoryDrawerWidth)
        }
    }, [])

    useEffect(() => {
        if (!categoryDrawerProjectId) {
            setCategoryDrawerCategories([])
            setCategoryDrawerStats(null)
            return
        }
        let disposed = false
        Promise.all([
            db_list_categories(categoryDrawerProjectId),
            db_get_project_stats(categoryDrawerProjectId),
        ]).then(([categories, stats]) => {
            if (disposed) return
            setCategoryDrawerCategories(categories)
            setCategoryDrawerStats(stats)
        }).catch(error => {
            if (disposed) return
            logger.error('加载移动端分类抽屉失败', error)
        })
        return () => {
            disposed = true
        }
    }, [categoryDrawerProjectId])

    const navigation = useMemo<Omit<PageProps, 'aiFocus' | 'setAiFocus' | 'setBeforeBack'>>(() => ({
        push: (page: MobilePage) => stacks[activeTab].push(page),
        pop: () => stacks[activeTab].pop(),
        replace: (page: MobilePage) => stacks[activeTab].replace(page),
        navigateToTab: (tab: MobileTab, page?: MobilePage) => {
            setActiveTab(tab)
            if (page) {
                stacks[tab].push(page)
            }
        },
    }), [activeTab, stacks])

    const closeCategoryDrawer = useCallback(() => {
        closeSideDrawer()
    }, [closeSideDrawer])

    const openCategoryDrawer = useCallback(() => {
        if (!categoryDrawerEnabled) return
        openSideDrawer()
    }, [categoryDrawerEnabled, openSideDrawer])

    const openAiConversationDrawer = useCallback(() => {
        if (!aiConversationDrawerEnabled) return
        openSideDrawer()
    }, [aiConversationDrawerEnabled, openSideDrawer])

    const openIdeaDrawer = useCallback(() => {
        if (!ideaDrawerEnabled) return
        openSideDrawer()
    }, [ideaDrawerEnabled, openSideDrawer])

    const refreshCategoryDrawer = useCallback(async () => {
        if (!categoryDrawerProjectId) return
        const [categories, stats] = await Promise.all([
            db_list_categories(categoryDrawerProjectId),
            db_get_project_stats(categoryDrawerProjectId),
        ])
        setCategoryDrawerCategories(categories)
        setCategoryDrawerStats(stats)
    }, [categoryDrawerProjectId])

    const handleSelectDrawerCategory = useCallback((selection: MobileCategoryDrawerSelection, label: string) => {
        if (!categoryDrawerProjectId) return
        closeCategoryDrawer()
        if (selection.kind === 'projectHome') {
            if (pageType === 'projectHome') return
            const nextPage: MobilePage = {type: 'projectHome', params: {projectId: categoryDrawerProjectId}}
            const previousPage = activeStack.stack[activeStack.stack.length - 2]
            if (
                pageType === 'entryList'
                && previousPage?.type === 'projectHome'
                && previousPage.params?.projectId === categoryDrawerProjectId
            ) {
                activeStack.pop()
            } else if (pageType === 'entryList') {
                navigation.replace(nextPage)
            } else {
                navigation.push(nextPage)
            }
            return
        }

        const nextPage: MobilePage = selection.kind === 'allEntries'
            ? {type: 'entryList', params: {projectId: categoryDrawerProjectId, categoryId: '', displayName: label}}
            : selection.kind === 'uncategorized'
                ? {
                    type: 'entryList',
                    params: {
                        projectId: categoryDrawerProjectId,
                        categoryId: '',
                        uncategorizedOnly: true,
                        displayName: label,
                    },
                }
                : {type: 'entryList', params: {projectId: categoryDrawerProjectId, categoryId: selection.categoryId, displayName: label}}

        if (pageType === 'entryList') {
            navigation.replace(nextPage)
        } else {
            navigation.push(nextPage)
        }
    }, [activeStack, categoryDrawerProjectId, closeCategoryDrawer, navigation, pageType])

    const handleTabChange = useCallback((tab: MobileTab) => {
        closeCategoryDrawer()
        setActiveTab(tab)
    }, [closeCategoryDrawer])

    const setBeforeBack = useCallback((handler: MobileBeforeBack | null) => {
        beforeBackRef.current = handler
    }, [])

    const handleBack = useCallback(() => {
        // 有浮层打开时，返回优先关闭浮层，而非回退页面/退出应用。
        if (closeTopOverlay()) return
        if (sideDrawerOpen) {
            closeCategoryDrawer()
            return
        }
        void (async () => {
            const beforeBack = beforeBackRef.current
            if (beforeBack) {
                const allowed = await beforeBack()
                if (!allowed) return
            }
            if (activeStack.canGoBack) {
                activeStack.pop()
            } else {
                const result = await showAlert('确定要退出当前移动端应用吗？', 'warning', 'confirm')
                if (result === 'yes') {
                    if (closingRef.current) return
                    closingRef.current = true
                    try {
                        await exit_app()
                    } catch (error) {
                        closingRef.current = false
                        logger.error('关闭移动端窗口失败', error)
                    }
                }
            }
        })()
    }, [activeStack, closeCategoryDrawer, showAlert, sideDrawerOpen])

    useEffect(() => {
        const handleAndroidBack = () => {
            handleBack()
        }
        window.addEventListener('flowcloudai:android-back', handleAndroidBack)
        return () => window.removeEventListener('flowcloudai:android-back', handleAndroidBack)
    }, [handleBack])

    useEffect(() => {
        if (platformInfo.os !== 'android') return
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key !== 'Escape' && e.key !== 'Backspace') return
            // 焦点在可编辑元素内时，退格/Esc 应由该元素自己处理
            const t = e.target as HTMLElement
            if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable) return
            e.preventDefault()
            handleBack()
        }
        window.addEventListener('keydown', handleKeyDown)
        return () => window.removeEventListener('keydown', handleKeyDown)
    }, [handleBack, platformInfo.os])

    const pageProps: PageProps = useMemo(() => ({
        ...navigation,
        setBeforeBack,
        aiFocus,
        setAiFocus,
    }), [navigation, setBeforeBack, aiFocus])

    if (!backendReady) {
        return (
            <div className="mobile-app" style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                height: '100vh', background: 'var(--fc-color-bg)',
                color: 'var(--fc-color-text-secondary)', fontSize: 'var(--fc-font-size-sm)',
            }}>
                正在启动…
            </div>
        )
    }

    return (
        <div className="mobile-app">
            <div
                className={`mobile-app-category-shell${mobileSideDrawerEnabled ? ' is-enabled' : ''}${sideDrawerOpen ? ' is-open' : ''}${sideDrawerDragging ? ' is-dragging' : ''}${mobileSideDrawerKind ? ` is-${mobileSideDrawerKind}` : ''}`}
                style={{
                    '--mobile-entry-drawer-width': `${categoryDrawerWidth}px`,
                    '--mobile-entry-drawer-shift': `${sideDrawerSurfaceOffset}px`,
                } as CSSProperties}
            >
                {mobileSideDrawerEnabled && (
                    <div
                        className="mobile-app-category-shell__drawer"
                        {...sideDrawerPointerHandlers}
                    >
                        {categoryDrawerEnabled ? (
                            <MobileCategoryDrawer
                                projectId={categoryDrawerProjectId!}
                                categories={categoryDrawerCategories}
                                stats={categoryDrawerStats}
                                selected={categoryDrawerSelection}
                                onSelect={handleSelectDrawerCategory}
                                onChanged={refreshCategoryDrawer}
                            />
                        ) : aiConversationDrawerEnabled ? (
                            <div id="mobile-ai-conversation-drawer-root" className="mobile-app-ai-drawer-root"/>
                        ) : (
                            <div id="mobile-idea-drawer-root" className="mobile-app-idea-drawer-root"/>
                        )}
                    </div>
                )}
                <div
                    className="mobile-app-category-shell__surface"
                    {...sideDrawerPointerHandlers}
                >
                    <button
                        type="button"
                        className="mobile-app-category-shell__surface-close"
                        aria-label={mobileSideDrawerKind === 'ai' ? '关闭对话列表' : mobileSideDrawerKind === 'idea' ? '关闭灵感列表' : '关闭分类树'}
                        tabIndex={sideDrawerOpen ? 0 : -1}
                        onClick={closeCategoryDrawer}
                    />
                    <div className="mobile-app__content">
                        {/* 首页 Tab */}
                        {activeTab === 'home' && (
                            <>
                                {!currentPage && (
                                    <MobileHome
                                        {...pageProps}
                                        activePanel={homePanel}
                                        onActivePanelChange={setHomePanel}
                                    />
                                )}
                                {pageType === 'projectList' && currentPage && (
                                    <MobileProjectList {...pageProps}/>
                                )}
                                {pageType === 'projectHome' && currentPage && (
                                    <MobileProjectHome
                                        {...pageProps}
                                        params={currentPage.params}
                                        categoryDrawerOpen={sideDrawerOpen}
                                        onOpenCategoryDrawer={openCategoryDrawer}
                                    />
                                )}
                                {pageType === 'entryList' && currentPage && (
                                    <MobileEntryList
                                        {...pageProps}
                                        params={currentPage.params}
                                        categoryDrawerOpen={sideDrawerOpen}
                                        onOpenCategoryDrawer={openCategoryDrawer}
                                    />
                                )}
                                {pageType === 'entryDetail' && currentPage && (
                                    <MobileEntryDetail {...pageProps} params={currentPage.params}/>
                                )}
                                {pageType === 'projectDefs' && currentPage && (
                                    <MobileTypeTagManager params={currentPage.params}/>
                                )}
                                {pageType === 'categoryManager' && currentPage && (
                                    <MobileCategoryManager {...pageProps} params={currentPage.params}/>
                                )}
                            </>
                        )}

                        {/* AI Tab */}
                        {activeTab === 'ai' && (
                            <MobileAiChat
                                {...pageProps}
                                conversationDrawerOpen={sideDrawerOpen && aiConversationDrawerEnabled}
                                onOpenConversationDrawer={openAiConversationDrawer}
                                onCloseConversationDrawer={closeCategoryDrawer}
                            />
                        )}

                        {/* 灵感 Tab */}
                        {activeTab === 'ideas' && (
                            <MobileIdea
                                {...pageProps}
                                ideaDrawerOpen={sideDrawerOpen && ideaDrawerEnabled}
                                onOpenIdeaDrawer={openIdeaDrawer}
                                onCloseIdeaDrawer={closeCategoryDrawer}
                            />
                        )}

                        {/* 设置 Tab */}
                        {activeTab === 'settings' && (
                            <MobileSettings {...pageProps} page={currentPage}/>
                        )}
                    </div>

                    <MobileNav activeTab={activeTab} onTabChange={handleTabChange}/>
                </div>
            </div>

            <AiConfirmModal/>
        </div>
    )
}
