import {logger} from './shared/logger'
import {StrictMode} from 'react'
import {createRoot} from 'react-dom/client'

import AppShell from './app/index/AppShell'
import {get_platform_info, type PlatformInfo, setting_get_settings} from './api'
import {getFormFactorOverride, isTauriRuntime} from './shared/devPreview'
import {applyPersistedThemeColorConfig} from './pages/settings/themeColorPersistence'
import './i18n' // 初始化 i18n

// ── 全局错误捕获（用于打包环境诊断，无 DevTools 时通过后端 log 可见）────────────
// JS 运行时错误 & 未捕获 Promise rejection
window.addEventListener('error', (e) => {
    const src = e.filename ? ` @ ${e.filename}:${e.lineno}` : ''
    logger.error(`[GlobalError] ${e.message}${src}`)
})
window.addEventListener('unhandledrejection', (e) => {
    const reason = e.reason instanceof Error
        ? `${e.reason.message}\n${e.reason.stack ?? ''}`
        : String(e.reason)
    logger.error(`[UnhandledRejection] ${reason.slice(0, 400)}`)
})

// CSP 违规（能精确定位被拦截的资源/指令）
document.addEventListener('securitypolicyviolation', (e) => {
    logger.error(`[CSPViolation] directive="${e.violatedDirective}" blocked="${e.blockedURI}" src="${e.sourceFile}:${e.lineNumber}"`)
})

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
        const colorThemeApplied = applyPersistedThemeColorConfig(settingsResult.value.theme_color_config)
        logger.info('[Bootstrap] 启动时应用颜色主题配置', {
            recipeId: settingsResult.value.theme_color_config?.recipeId ?? null,
            applied: colorThemeApplied,
        })
    } else if (settingsResult.status === 'rejected') {
        logger.warn('Failed to load settings, using default theme:', settingsResult.reason)
    }
    if (platformResult.status === 'fulfilled') {
        platformInfo = platformResult.value
    } else {
        logger.warn('Failed to load platform info, using fallback:', platformResult.reason)
    }

    // 开发期浏览器预览：用 ?ff=mobile|desktop 覆盖壳层分流（仅 dev 生效，生产为空操作）。
    const formFactorOverride = getFormFactorOverride()
    if (formFactorOverride) {
        platformInfo = {...platformInfo, formFactor: formFactorOverride}
        logger.info('[Bootstrap] 应用 formFactor 覆盖（开发预览）:', formFactorOverride)
    }

    if (isTauriRuntime()) {
        document.documentElement.classList.add('is-tauri')
        document.body.classList.add('is-tauri')
    }

    // 亚克力毛玻璃：仅 Windows 桌面端透明窗启用（windowEffects 的 acrylic 只在 Windows 生效）。
    // 命中后外层 chrome 透出磨砂桌面，颜色统一由 CSS 半透明层控制——
    // Win11 上 windowEffects 的 color 字段无效，故着色不走原生而走 CSS。
    if (isTauriRuntime() && platformInfo.os === 'windows' && platformInfo.formFactor === 'desktop') {
        document.documentElement.setAttribute('data-backdrop', 'acrylic')
    }

    // 在 React 渲染前同步写入 data-theme，避免首帧闪白
    const resolvedTheme = initialTheme === 'system'
        ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
        : initialTheme
    document.documentElement.setAttribute('data-theme', resolvedTheme)

    createRoot(document.getElementById('root')!).render(
        <StrictMode>
            <AppShell
                initialTheme={initialTheme as 'system' | 'light' | 'dark'}
                platformInfo={platformInfo}
            />
        </StrictMode>,
    )
}

initApp().catch(logger.error)
