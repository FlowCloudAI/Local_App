import {logger} from '../../shared/logger'
import './MobileApp.css'
import {useAlert} from 'flowcloudai-ui'
import {useCallback, useEffect, useMemo, useRef, useState} from 'react'
import {listen} from '@tauri-apps/api/event'
import {exit_app, setting_is_backend_ready, type PlatformInfo} from '../../api'
import {type AiFocus} from '../../features/ai-chat/hooks/useAiController'
import MobileNav, {type MobileTab} from './MobileNav'
import MobileAiChat from './pages/MobileAiChat'
import MobileEntryDetail from './pages/MobileEntryDetail'
import MobileEntryEditor from './pages/MobileEntryEditor'
import MobileEntryList from './pages/MobileEntryList'
import MobileIdea from './pages/MobileIdea'
import MobileProjectHome from './pages/MobileProjectHome'
import MobileProjectList from './pages/MobileProjectList'
import MobileSettings from './pages/MobileSettings'
import {type MobilePage, usePageStack} from './usePageStack'

interface MobileAppProps {
    platformInfo: PlatformInfo
}

type PageProps = {
    push: (page: MobilePage) => void
    pop: () => void
    replace: (page: MobilePage) => void
    navigateToTab: (tab: MobileTab, page?: MobilePage) => void
    aiFocus: AiFocus
    setAiFocus: (focus: AiFocus) => void
}

function getPageTitle(type: string, params?: Record<string, unknown>): string {
    const name = params?.displayName as string | undefined
    switch (type) {
        case 'projectList': return '项目'
        case 'projectHome': return name || '项目'
        case 'entryList':   return name || '词条'
        case 'entryDetail': return name || '词条详情'
        case 'entryEditor': return name ? `编辑・${name}` : '编辑词条'
        case 'aiChat': return 'AI 对话'
        case 'ideas': return '灵感便签'
        case 'settings': return '设置'
        default: return ''
    }
}

export default function MobileApp({platformInfo}: MobileAppProps) {
    const {showAlert} = useAlert()
    const closingRef = useRef(false)
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

    const [backendReady, setBackendReady] = useState(false)
    const [aiFocus, setAiFocus] = useState<AiFocus>({projectId: null, entryId: null})

    useEffect(() => {
        let disposed = false
        const mark = () => { if (!disposed) setBackendReady(true) }
        const p = listen('backend-ready', mark)
        setting_is_backend_ready().then(ready => { if (ready) mark() }).catch(() => {})
        return () => { disposed = true; p.then(fn => fn()) }
    }, [])

    const navigation = useMemo<Omit<PageProps, 'aiFocus' | 'setAiFocus'>>(() => ({
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

    const handleBack = useCallback(() => {
        if (activeStack.canGoBack) {
            activeStack.pop()
        } else {
            void (async () => {
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
            })()
        }
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
        aiFocus,
        setAiFocus,
    }), [navigation, aiFocus])

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
    const pageTitle = getPageTitle(pageType, currentPage?.params)

    return (
        <div className="mobile-app">
            <header className="mobile-app__header">
                {activeStack.canGoBack ? (
                    <button className="mobile-app__back-btn" onClick={() => activeStack.pop()}>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="15 18 9 12 15 6"/>
                        </svg>
                    </button>
                ) : (
                    <div className="mobile-app__header-spacer"/>
                )}
                <h1 className="mobile-app__title">{pageTitle || (
                    activeTab === 'projects' ? '项目' :
                        activeTab === 'ai' ? 'AI 对话' :
                            activeTab === 'ideas' ? '灵感便签' : '设置'
                )}</h1>
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
                        {pageType === 'entryEditor' && currentPage && (
                            <MobileEntryEditor {...pageProps} params={currentPage.params}/>
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
                    <MobileSettings {...pageProps}/>
                )}
            </div>

            <MobileNav activeTab={activeTab} onTabChange={handleTabChange}/>
        </div>
    )
}
