/**
 * formFactor 判定的唯一来源：壳层分流（桌面/移动 App）、控件密度、启动前的属性预写都读这里。
 *
 * 判定顺序是「构建目标优先于运行时探测」：安卓/iOS 包里不该因为后端探测异常而落到桌面壳，
 * 反之亦然；只有平台无关的构建（浏览器预览、未知目标）才回退到 `platformInfo.formFactor`，
 * 而后者已在 `main.tsx` 里吃过 `?ff=` 覆盖，所以开发预览的切换在这里自动生效。
 *
 * 注意 `isMobileBuild` / `isDesktopBuild` 还兼任 `AppRoot` 里 `lazy()` 的裁剪开关，
 * 依赖 `import.meta.env.TAURI_ENV_PLATFORM` 被构建期替换成字面量后常量折叠——
 * 别把它们改成运行时才能求值的形式，否则另一端的壳层会被打进产物。
 */
import type {PlatformFormFactor, PlatformInfo} from '../api/platform'

const buildPlatform = import.meta.env.TAURI_ENV_PLATFORM

export const isMobileBuild = buildPlatform === 'android' || buildPlatform === 'ios'
export const isDesktopBuild = buildPlatform === 'windows'
    || buildPlatform === 'macos'
    || buildPlatform === 'linux'

export function resolveFormFactor(platformInfo: PlatformInfo): PlatformFormFactor {
    if (isMobileBuild) return 'mobile'
    if (isDesktopBuild) return 'desktop'
    return platformInfo.formFactor
}

/**
 * 控件密度：移动端走触控密度，把 `flowcloudai-ui` 的输入框/按钮/下拉项抬到 44 像素触控下限。
 * 具体数值见 `flowcloudai-ui` 的 `--fc-control-*`；页面若刻意要别的高度，自己的选择器仍然优先。
 */
export function resolveDensity(platformInfo: PlatformInfo): 'comfortable' | 'touch' {
    return resolveFormFactor(platformInfo) === 'mobile' ? 'touch' : 'comfortable'
}
