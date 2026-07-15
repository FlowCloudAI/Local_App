/**
 * 开发期浏览器预览辅助（仅 dev 生效，生产构建下全部为安全空操作）。
 *
 * 用途：在普通浏览器里 `npm run dev` 走查移动端/桌面端布局与交互，
 * 无需每次起 Tauri / 安卓，加速 UI 迭代。
 *
 * 重要边界：浏览器没有 Tauri 运行时，后端 IPC（db_* / ai_* / setting_* 等）
 * 本身不可用。为此预览默认会装上内存 mock 后端（见 shared/devPreviewBackend），
 * 让核心创作闭环（项目 → 词条 → 编辑 → 保存）可以真跑；`?mock=off` 可关掉它，
 * 回到「每页加载失败」的裸预览，用于走查错误态。
 * mock 未覆盖的领域（AI、插件、地图等）仍会失败，属正常现象。
 */
import type {PlatformFormFactor} from '../api/platform'

const PREVIEW_FORM_FACTOR_KEY = 'fc:preview-form-factor'
const PREVIEW_MOCK_KEY = 'fc:preview-mock'

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
    const raw = readPreviewFlag('ff', 'formFactor', PREVIEW_FORM_FACTOR_KEY)
    return raw === 'mobile' || raw === 'desktop' ? raw : null
}

/**
 * 浏览器预览是否启用内存 mock 后端。默认开，`?mock=off` 关闭。
 * 与 `?ff` 一样写入 localStorage 保持。仅 dev + 非 Tauri 下为 true。
 */
export function isDevPreviewBackendEnabled(): boolean {
    if (!isBrowserPreview()) return false
    return readPreviewFlag('mock', null, PREVIEW_MOCK_KEY) !== 'off'
}

/** 读取预览开关：URL 参数优先并写入 localStorage，无参数时回读 localStorage。 */
function readPreviewFlag(param: string, altParam: string | null, storageKey: string): string | null {
    if (typeof window === 'undefined') return null
    try {
        const params = new URLSearchParams(window.location.search)
        const fromUrl = params.get(param) ?? (altParam ? params.get(altParam) : null)
        if (fromUrl) {
            window.localStorage.setItem(storageKey, fromUrl)
            return fromUrl
        }
        return window.localStorage.getItem(storageKey)
    } catch {
        return null
    }
}
