/**
 * 开发期浏览器预览辅助（仅 dev 生效，生产构建下全部为安全空操作）。
 *
 * 用途：在普通浏览器里 `npm run dev` 走查移动端/桌面端布局与交互，
 * 无需每次起 Tauri / 安卓，加速 UI 迭代。
 *
 * 重要边界：浏览器没有 Tauri 运行时，后端 IPC（db_* / ai_* / setting_* 等）
 * 全部不可用，因此预览仅验证布局、手势与动画手感；数据加载与 AI 不会工作，
 * 词条/项目等页面会停在加载失败或空态，属正常现象。
 */
import type {PlatformFormFactor} from '../api/platform'

const PREVIEW_FORM_FACTOR_KEY = 'fc:preview-form-factor'

/** 当前是否运行在 Tauri 运行时（注入了 __TAURI_INTERNALS__ / __TAURI__）。 */
export function isTauriRuntime(): boolean {
    return typeof window !== 'undefined'
        && (Object.prototype.hasOwnProperty.call(window, '__TAURI_INTERNALS__')
            || Object.prototype.hasOwnProperty.call(window, '__TAURI__'))
}

/** 是否处于「开发期浏览器预览」模式：dev 构建且不在 Tauri 中。生产恒为 false。 */
export function isBrowserPreview(): boolean {
    return import.meta.env.DEV && !isTauriRuntime()
}

/**
 * 读取 formFactor 覆盖：URL `?ff=mobile|desktop`（亦兼容 `?formFactor=`）。
 * 命中后写入 localStorage，刷新后仍保持；下次无参数时回读 localStorage。
 * 仅 dev 生效，生产恒返回 null。
 */
export function getFormFactorOverride(): PlatformFormFactor | null {
    if (!import.meta.env.DEV || typeof window === 'undefined') return null
    let raw: string | null = null
    try {
        const params = new URLSearchParams(window.location.search)
        const fromUrl = params.get('ff') ?? params.get('formFactor')
        if (fromUrl) {
            raw = fromUrl
            window.localStorage.setItem(PREVIEW_FORM_FACTOR_KEY, fromUrl)
        } else {
            raw = window.localStorage.getItem(PREVIEW_FORM_FACTOR_KEY)
        }
    } catch {
        return null
    }
    return raw === 'mobile' || raw === 'desktop' ? raw : null
}
