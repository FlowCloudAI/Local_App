import {lazy, StrictMode, Suspense} from 'react'
import {createRoot} from 'react-dom/client'

import {get_platform_info, type PlatformInfo, setting_get_settings, showWindow} from './api'
import './i18n' // 初始化 i18n

const AppShell = lazy(() => import('./app/index/AppShell'))

// ── 全局错误捕获（用于打包环境诊断，无 DevTools 时通过后端 log 可见）────────────
// JS 运行时错误 & 未捕获 Promise rejection
window.addEventListener('error', (e) => {
    const src = e.filename ? ` @ ${e.filename}:${e.lineno}` : ''
    console.error(`[GlobalError] ${e.message}${src}`)
})
window.addEventListener('unhandledrejection', (e) => {
    const reason = e.reason instanceof Error
        ? `${e.reason.message}\n${e.reason.stack ?? ''}`
        : String(e.reason)
    console.error(`[UnhandledRejection] ${reason.slice(0, 400)}`)
})

// CSP 违规（能精确定位被拦截的资源/指令）
document.addEventListener('securitypolicyviolation', (e) => {
    console.error(`[CSPViolation] directive="${e.violatedDirective}" blocked="${e.blockedURI}" src="${e.sourceFile}:${e.lineNumber}"`)
})

function isTauriRuntime(): boolean {
    return typeof window !== 'undefined'
        && (Object.prototype.hasOwnProperty.call(window, '__TAURI_INTERNALS__')
            || Object.prototype.hasOwnProperty.call(window, '__TAURI__'))
}

function getFallbackPlatformInfo(): PlatformInfo {
    return {
        os: 'unknown',
        formFactor: 'desktop',
        windowControls: isTauriRuntime(),
    }
}

// 异步初始化主题
const initApp = async () => {
    let initialTheme = 'system'
    let platformInfo = getFallbackPlatformInfo()

    // 并行发起两个 IPC，节省一个往返延迟
    const [settingsResult, platformResult] = await Promise.allSettled([
        setting_get_settings(),
        get_platform_info(),
    ])
    if (settingsResult.status === 'fulfilled' && settingsResult.value.theme) {
        initialTheme = settingsResult.value.theme
    } else if (settingsResult.status === 'rejected') {
        console.warn('Failed to load settings, using default theme:', settingsResult.reason)
    }
    if (platformResult.status === 'fulfilled') {
        platformInfo = platformResult.value
    } else {
        console.warn('Failed to load platform info, using fallback:', platformResult.reason)
    }

    if (isTauriRuntime()) {
        document.documentElement.classList.add('is-tauri')
        document.body.classList.add('is-tauri')
    }

    // 在 React 渲染前同步写入 data-theme，避免首帧闪白
    const resolvedTheme = initialTheme === 'system'
        ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
        : initialTheme
    document.documentElement.setAttribute('data-theme', resolvedTheme)

    // data-theme 已同步写入，下一帧再显示窗口，确保浏览器绘制的第一帧已带有正确主题
    if (platformInfo.windowControls) {
        requestAnimationFrame(() => {
            showWindow().catch(console.error)
        })
    }

    createRoot(document.getElementById('root')!).render(
        <StrictMode>
            <Suspense fallback={<div className="app-loading">加载中…</div>}>
                <AppShell
                    initialTheme={initialTheme as 'system' | 'light' | 'dark'}
                    platformInfo={platformInfo}
                />
            </Suspense>
        </StrictMode>,
    )
}

initApp().catch(console.error)
