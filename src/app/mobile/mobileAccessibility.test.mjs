import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import test from 'node:test'
import {URL} from 'node:url'

const mobileAppSource = readFileSync(new URL('./MobileApp.tsx', import.meta.url), 'utf8')
const mobileAppCss = readFileSync(new URL('./MobileApp.css', import.meta.url), 'utf8')
const mobileNavSource = readFileSync(new URL('./MobileNav.tsx', import.meta.url), 'utf8')
const mobileNavCss = readFileSync(new URL('./MobileNav.css', import.meta.url), 'utf8')
const mobileAiComposerSource = readFileSync(new URL('./pages/MobileAiComposer.tsx', import.meta.url), 'utf8')
const mobileAiChatCss = readFileSync(new URL('./pages/MobileAiChat.css', import.meta.url), 'utf8')
const mobileAiConversationDrawerSource = readFileSync(new URL('./pages/MobileAiConversationDrawer.tsx', import.meta.url), 'utf8')
const mobileSettingsSectionsSource = readFileSync(new URL('./pages/MobileSettingsSections.tsx', import.meta.url), 'utf8')
const mobileWorldCheckSource = readFileSync(new URL('./pages/MobileWorldCheck.tsx', import.meta.url), 'utf8')
const accessibilityCss = readFileSync(new URL('./mobileAccessibility.css', import.meta.url), 'utf8')
const tokensCss = readFileSync(new URL('./mobileTokens.css', import.meta.url), 'utf8')
const androidBridge = readFileSync(new URL('../../../src-tauri/gen/android/app/src/main/java/cn/flowcloudai/www/MainActivity.kt', import.meta.url), 'utf8')
const androidManifest = readFileSync(new URL('../../../src-tauri/gen/android/app/src/main/AndroidManifest.xml', import.meta.url), 'utf8')
const iosBridge = readFileSync(new URL('../../../src-tauri/ios/Sources/MobileUiBridge.m', import.meta.url), 'utf8')
const mobileUiApi = readFileSync(new URL('../../api/mobileUi.ts', import.meta.url), 'utf8')
const androidPredictiveBackHook = readFileSync(new URL('./useAndroidPredictiveBack.ts', import.meta.url), 'utf8')
const appBootstrapSource = readFileSync(new URL('../../main.tsx', import.meta.url), 'utf8')
const appShellSource = readFileSync(new URL('../index/AppShell.tsx', import.meta.url), 'utf8')
const themeProviderSource = readFileSync(new URL('../../../node_modules/flowcloudai-ui/src/ThemeProvider.tsx', import.meta.url), 'utf8')

test('移动窗口在后端就绪后直接显示，不依赖 requestAnimationFrame', () => {
    assert.match(mobileAppSource, /mobileWindowShown = true\s+showWindow\(\)\.catch/)
    assert.doesNotMatch(mobileAppSource, /requestAnimationFrame\([\s\S]{0,120}showWindow\(/)
})

test('页面 gutter 与底栏共同消费左右安全区', () => {
    assert.match(tokensCss, /--mobile-safe-left:\s*max\(env\(safe-area-inset-left/)
    assert.match(tokensCss, /--mobile-safe-right:\s*max\(env\(safe-area-inset-right/)
    assert.match(tokensCss, /--mobile-page-x:\s*max\(/)
    assert.match(mobileNavCss, /var\(--mobile-safe-left\)/)
    assert.match(mobileNavCss, /var\(--mobile-safe-right\)/)
    assert.doesNotMatch(mobileAppCss, /env\(safe-area-inset-/)
})

test('Android 通过 WindowInsets 补齐系统栏安全区并允许横屏', () => {
    assert.match(androidBridge, /WindowInsetsCompat\.Type\.systemBars\(\)/)
    assert.match(androidBridge, /WindowInsetsCompat\.Type\.displayCutout\(\)/)
    assert.match(androidBridge, /--mobile-native-inset-bottom/)
    assert.doesNotMatch(androidManifest, /android:screenOrientation="portrait"/)
})

test('输入模式下底栏同时退出视觉、点击和辅助技术树', () => {
    assert.match(mobileAppSource, /suppressed=\{mobileInputModeActive\}/)
    assert.match(mobileNavSource, /aria-hidden=\{suppressed \|\| undefined\}/)
    assert.match(mobileNavSource, /inert=\{suppressed\}/)
    assert.match(mobileNavCss, /\.mobile-nav\.is-suppressed[\s\S]*pointer-events:\s*none/)
    assert.match(mobileNavCss, /\.mobile-nav\.is-suppressed[\s\S]*visibility:\s*hidden/)
})

test('可读三级文字和统一 48px 命中区只覆盖 touch density', () => {
    assert.match(accessibilityCss, /:root\[data-fc-density="touch"\]/)
    assert.match(accessibilityCss, /--fc-color-text-tertiary:\s*var\(--mobile-color-text-readable-tertiary\)/)
    assert.match(accessibilityCss, /::placeholder[\s\S]*opacity:\s*1/)
    assert.match(accessibilityCss, /min-inline-size:\s*var\(--fc-control-tap-min\)/)
    assert.match(accessibilityCss, /min-block-size:\s*var\(--fc-control-tap-min\)/)
    assert.match(tokensCss, /--mobile-tap-min:\s*3rem/)
    assert.match(tokensCss, /--fc-control-tap-min:\s*var\(--mobile-tap-min\)/)
})

test('可选择状态同时提供非颜色视觉提示与 ARIA 状态', () => {
    assert.match(mobileNavSource, /aria-current=\{activeTab === key \? 'page'/)
    assert.match(mobileNavCss, /\.mobile-nav__item\.active \.mobile-nav__label[\s\S]*font-weight:\s*var\(--mobile-weight-strong\)/)
    assert.match(mobileAiComposerSource, /aria-pressed=\{p\.thinking\}/)
    assert.match(mobileAiConversationDrawerSource, /aria-current=\{conversation\.id === props\.activeConversationId/)
    assert.match(mobileSettingsSectionsSource, /aria-pressed=\{pluginKindFilter === value\}/)
    assert.match(mobileWorldCheckSource, /role="option"[\s\S]{0,120}aria-selected=\{entry\.id === targetEntryId\}/)
})

test('AI 输入区使用紧凑 capsule，同时保留独立的透明命中层', () => {
    const capsuleRule = mobileAiChatCss.match(/\.mobile-ai-composer-card__chip\s*\{([\s\S]*?)\}/)?.[1] ?? ''
    assert.match(capsuleRule, /padding:\s*var\(--mobile-gap-text\) var\(--mobile-gap-inline\)/)
    assert.match(capsuleRule, /border-radius:\s*var\(--fc-radius-full\)/)
    assert.match(capsuleRule, /line-height:\s*var\(--mobile-leading-snug\)/)
    assert.doesNotMatch(capsuleRule, /(?:^|\n)\s*(?:min-)?height:/)
    assert.match(mobileAiChatCss, /--mobile-ai-composer-icon-size:\s*calc\([\s\S]*?var\(--mobile-tap-min\) - var\(--mobile-gap-item\) - var\(--mobile-gap-inline\)[\s\S]*?\)/)
    assert.match(mobileAiChatCss, /--mobile-ai-composer-more-size:\s*calc\([\s\S]*?var\(--mobile-ai-composer-icon-size\) - var\(--mobile-ai-composer-outline-width\)/)
    assert.match(mobileAiChatCss, /--mobile-ai-composer-send-size:\s*calc\([\s\S]*?var\(--mobile-ai-composer-icon-size\) \+ var\(--mobile-gap-text\)/)
    assert.match(mobileAiChatCss, /--mobile-ai-composer-card-min-height:\s*calc\([\s\S]*?var\(--mobile-tap-min\) \+ var\(--mobile-tap-min\) \+ var\(--mobile-gap-item\)/)
    assert.match(mobileAiChatCss, /\.mobile-ai-composer-card__chip::after\s*\{[\s\S]*?inset-block:\s*calc\(0px - var\(--mobile-gap-inline\)\)/)
    assert.match(mobileAiChatCss, /\.mobile-ai-composer-card textarea\s*\{[\s\S]*?flex:\s*1 1 auto/)
    assert.match(mobileAiChatCss, /\.mobile-ai-composer-card__bar\s*\{[\s\S]*?margin-top:\s*auto/)
    assert.match(mobileAiChatCss, /\.mobile-ai-composer-card__actions\s*\{\s*gap:\s*var\(--mobile-gap-group\)/)
    assert.match(mobileAiChatCss, /\.mobile-ai-composer-card__icon-btn::after\s*\{[\s\S]*?width:\s*var\(--mobile-ai-composer-icon-hit-size\);[\s\S]*?height:\s*var\(--mobile-ai-composer-icon-hit-size\)/)
    assert.match(mobileAiChatCss, /\.mobile-ai-composer-card__icon-btn\s*\{[\s\S]*?border:\s*var\(--mobile-ai-composer-outline-width\) solid currentColor;[\s\S]*?background:\s*transparent;/)
    assert.match(mobileAiChatCss, /\.mobile-ai-composer-card__icon-btn \.mobile-top-control-svg--add\s*\{[\s\S]*?stroke-width:\s*3;/)
    assert.match(mobileAiChatCss, /\.mobile-ai-composer-card__icon-btn--send\s*\{[\s\S]*?background:\s*var\(--fc-color-primary\)/)
    assert.match(mobileAiChatCss, /\.mobile-ai-composer-card__icon-btn--send \.mobile-ai-svg\s*\{[\s\S]*?width:\s*var\(--mobile-gap-group\)/)
    assert.match(mobileAiChatCss, /\.mobile-ai-composer-card__icon-btn--send \.mobile-ai-svg :is\(path, rect\)\s*\{[\s\S]*?vector-effect:\s*non-scaling-stroke/)
})

test('系统主题偏好与解析结果分离，iOS system 模式不反向锁死 WebView 外观', () => {
    assert.match(appBootstrapSource, /setAttribute\('data-theme-preference', initialTheme\)[\s\S]*prefers-color-scheme: dark/)
    assert.match(appShellSource, /const \{theme\} = useTheme\(\)/)
    assert.match(appShellSource, /setAttribute\('data-theme-preference', theme\)/)
    assert.match(themeProviderSource, /const handler = \(\) => setSystemTheme[\s\S]*handler\(\)[\s\S]*addEventListener\('change', handler\)/)
    assert.match(iosBridge, /UIUserInterfaceStyleUnspecified/)
    assert.match(iosBridge, /preference === 'light' \|\| preference === 'dark'/)
    assert.match(iosBridge, /attributeFilter: \['data-theme', 'data-theme-preference'\]/)
})

test('iOS 与 Android 系统栏跟随应用解析后的主题', () => {
    assert.match(androidBridge, /MutationObserver\(syncNativeTheme\)/)
    assert.match(androidBridge, /isAppearanceLightStatusBars = light/)
    assert.match(androidBridge, /isAppearanceLightNavigationBars = light/)
    assert.match(iosBridge, /MutationObserver\(syncNativeTheme\)/)
    assert.match(iosBridge, /window\.overrideUserInterfaceStyle = style/)
    assert.match(iosBridge, /setNeedsStatusBarAppearanceUpdate/)
})

test('两端原生桥实现 success、warning、selection 三种触觉语义', () => {
    assert.match(androidManifest, /android\.permission\.VIBRATE/)
    assert.match(androidBridge, /VibrationEffect\.EFFECT_DOUBLE_CLICK/)
    assert.match(androidBridge, /VibrationEffect\.EFFECT_HEAVY_CLICK/)
    assert.match(androidBridge, /VibrationEffect\.EFFECT_TICK/)
    assert.match(iosBridge, /UINotificationFeedbackTypeSuccess/)
    assert.match(iosBridge, /UINotificationFeedbackTypeWarning/)
    assert.match(iosBridge, /UISelectionFeedbackGenerator/)
    assert.match(mobileUiApi, /'success' \| 'warning' \| 'selection'/)
    assert.match(mobileNavSource, /mobile_haptic\('selection'\)/)
})

test('Android 按系统导航模式选择预测式返回或应用内边缘手势', () => {
    assert.match(androidBridge, /handleOnBackStarted\(backEvent: BackEventCompat\)/)
    assert.match(androidBridge, /handleOnBackProgressed\(backEvent: BackEventCompat\)/)
    assert.match(androidBridge, /handleOnBackCancelled\(\)/)
    assert.match(androidBridge, /flowcloudai:android-back-invoked/)
    assert.match(androidBridge, /fun getNavigationMode\(\): String/)
    assert.match(mobileUiApi, /getAndroidNavigationMode/)
    assert.match(mobileAppSource, /platformInfo\.os === 'android' \? getAndroidNavigationMode\(\) : 'unknown'/)
    assert.match(mobileAppSource, /platformInfo\.os === 'android' && androidNavigationMode === 'buttons'/)
    assert.match(mobileAppSource, /useAndroidPredictiveBack\(/)
    assert.match(androidPredictiveBackHook, /flowcloudai:android-back-progress/)
    assert.match(androidPredictiveBackHook, /setPhase\('tracking'\)/)
    assert.match(androidPredictiveBackHook, /setProgress\(latestProgressRef\.current\)/)
})
