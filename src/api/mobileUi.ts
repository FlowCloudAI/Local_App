/**
 * 移动端原生 UI 反馈适配层。
 *
 * Android 通过 JavascriptInterface，iOS 通过 WKScriptMessageHandler；业务组件只使用
 * success / warning / selection 三种语义，不感知原生 API，也不会影响桌面浏览器。
 */

export type MobileHapticKind = 'success' | 'warning' | 'selection'

interface AndroidMobileUiBridge {
    haptic: (kind: MobileHapticKind) => void
}

interface IosMessageHandler {
    postMessage: (payload: {type: 'haptic'; value: MobileHapticKind}) => void
}

type MobileBridgeWindow = Window & {
    flowcloudaiMobileUi?: AndroidMobileUiBridge
    webkit?: {
        messageHandlers?: {
            flowcloudaiMobileUi?: IosMessageHandler
        }
    }
}

/** 请求一次原生触觉反馈；桌面端与不支持的 WebView 安静降级为无操作。 */
export function mobile_haptic(kind: MobileHapticKind): void {
    const bridgeWindow = window as MobileBridgeWindow
    try {
        if (bridgeWindow.flowcloudaiMobileUi?.haptic) {
            bridgeWindow.flowcloudaiMobileUi.haptic(kind)
            return
        }
        bridgeWindow.webkit?.messageHandlers?.flowcloudaiMobileUi?.postMessage({
            type: 'haptic',
            value: kind,
        })
    } catch {
        // 原生桥未就绪或页面正在卸载时，触觉反馈不应阻断主操作。
    }
}
