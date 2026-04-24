import {command} from './base'

/**
 * 尝试挂起 WebView2 运行时，释放内存占用。
 * 建议在窗口最小化或切换到后台时调用。
 * @returns 是否成功挂起
 */
export const suspend_webview = () => command<boolean>('suspend_webview')

/**
 * 恢复已挂起的 WebView2 运行时。
 * 建议在窗口重新显示或切换到前台时调用。
 */
export const resume_webview = () => command<void>('resume_webview')
