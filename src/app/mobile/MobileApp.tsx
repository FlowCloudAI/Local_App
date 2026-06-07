import {logger} from '../../shared/logger'
import {isBrowserPreview} from '../../shared/devPreview'
import {closeTopOverlay} from '../../shared/ui/overlay/overlayStack'
import AiConfirmModal from '../../features/ai-chat/components/AiConfirmModal'
import './MobileApp.css'
import {useAlert} from 'flowcloudai-ui'
import {useCallback, useEffect, useMemo, useRef, useState} from 'react'
import {listen} from '@tauri-apps/api/event'
import {exit_app, setting_is_backend_ready, showWindow, type PlatformInfo} from '../../api'
import {type AiFocus} from '../../features/ai-chat/hooks/useAiController'
import MobileNav, {type MobileTab} from './MobileNav'
import MobileAiChat from './pages/MobileAiChat'
import MobileEntryDetail from './pages/MobileEntryDetail'
import MobileEntryList from './pages/MobileEntryList'
import MobileIdea from './pages/MobileIdea'
import MobileProjectHome from './pages/MobileProjectHome'
import MobileProjectList from './pages/MobileProjectList'
import MobileSettings from './pages/MobileSettings'
import MobileTypeTagManager from './pages/MobileTypeTagManager'
import {type MobilePage, usePageStack} from './usePageStack'

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

function getPageTitle(type: string, params?: Record<string, unknown>): string {
    const name = params?.displayName as string | undefined
    switch (type) {
        case 'projectList': return '项目'
        case 'projectHome': return name || '项目'
        case 'entryList':   return name || '词条'
        case 'entryDetail': return name || '词条'
        case 'projectDefs': return name || '类型与标签'
        case 'aiChat': return 'AI 对话'
        case 'ideas': return '灵感便签'
        case 'settings': return '设置'
        case 'settingsAi': return 'AI 设置'
        case 'settingsPlugins': return '插件安装'
        case 'settingsAppearance': return '外观'
        case 'settingsAbout': return '关于'
        default: return ''
    }
}

// 顶部标题收口：栈内页用 getPageTitle，无栈页（Tab 根）回退到 Tab 名称。
function getHeaderTitle(activeTab: MobileTab, page: MobilePage | null): string {
    if (page) {
        const title = getPageTitle(page.type, page.params)
        if (title) return title
    }
    switch (activeTab) {
        case 'projects': return '项目'
        case 'ai': return 'AI 对话'
        case 'ideas': return '灵感便签'
        case 'settings': return '设置'
        default: return ''
    }
}

export default function MobileApp({platformInfo}: MobileAppProps) {
    const {showAlert} = useAlert()
    const closingRef = useRef(false)
    const beforeBackRef = useRef<MobileBeforeBack | null>(null)
    const [activeTab, setActiveTab] = useState<MobileTab>('projects')

    const projectsStack = usePageStack()
    const aiStack = usePageStack()
    const ideasStack = usePageStack()
    const settingsStack = usePageStack()

    const stacks = useMemo(() => ({
        projects: projectsStack,
        ai: aiStack,
        ideas: ideasStack,
        settings: settingsStack,
    }), [projectsStack, aiStack, ideasStack, settingsStack])

    const activeStack = stacks[activeTab]
    const currentPage = activeStack.currentPage

    // 开发期浏览器预览没有后端，直接视为就绪，避免卡在启动屏。
    const [backendReady, setBackendReady] = useState(() => isBrowserPreview())
    const [aiFocus, setAiFocus] = useState<AiFocus>({projectId: null, entryId: null})

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

    const handleTabChange = useCallback((tab: MobileTab) => {
        setActiveTab(tab)
    }, [])

    const setBeforeBack = useCallback((handler: MobileBeforeBack | null) => {
        beforeBackRef.current = handler
    }, [])

    const handleBack = useCallback(() => {
        // 有浮层打开时，返回优先关闭浮层，而非回退页面/退出应用。
        if (closeTopOverlay()) return
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
    }, [activeStack, showAlert])

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

    const pageType = currentPage?.type ?? ''

    return (
        <div className="mobile-app">
            <header className="mobile-app__header">
                {activeStack.canGoBack ? (
                    <button className="mobile-app__back-btn" onClick={handleBack}>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="15 18 9 12 15 6"/>
                        </svg>
                    </button>
                ) : (
                    <div className="mobile-app__header-spacer"/>
                )}
                <h1 className="mobile-app__title">{getHeaderTitle(activeTab, currentPage)}</h1>
                <div className="mobile-app__header-spacer"/>
            </header>

            <div className="mobile-app__content">
                {/* 项目 Tab */}
                {activeTab === 'projects' && (
                    <>
                        {(!currentPage || pageType === 'projectList') && (
                            <MobileProjectList {...pageProps}/>
                        )}
                        {pageType === 'projectHome' && currentPage && (
                            <MobileProjectHome {...pageProps} params={currentPage.params}/>
                        )}
                        {pageType === 'entryList' && currentPage && (
                            <MobileEntryList {...pageProps} params={currentPage.params}/>
                        )}
                        {pageType === 'entryDetail' && currentPage && (
                            <MobileEntryDetail {...pageProps} params={currentPage.params}/>
                        )}
                        {pageType === 'projectDefs' && currentPage && (
                            <MobileTypeTagManager params={currentPage.params}/>
                        )}
                    </>
                )}

                {/* AI Tab */}
                {activeTab === 'ai' && (
                    <MobileAiChat {...pageProps}/>
                )}

                {/* 灵感 Tab */}
                {activeTab === 'ideas' && (
                    <MobileIdea {...pageProps}/>
                )}

                {/* 设置 Tab */}
                {activeTab === 'settings' && (
                    <MobileSettings {...pageProps} page={currentPage}/>
                )}
            </div>

            <MobileNav activeTab={activeTab} onTabChange={handleTabChange}/>

            <AiConfirmModal/>
        </div>
    )
}
