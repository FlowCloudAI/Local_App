import {log_message, type LogLevel} from '../api/worldflow'

type ConsoleWriter = (...args: unknown[]) => void

const BACKEND_SOURCE = 'frontend'
const MAX_BACKEND_MESSAGE_LENGTH = 4000

function shouldMirrorToConsole(level: LogLevel): boolean {
    return import.meta.env.DEV || level === 'error'
}

function consoleWriter(level: LogLevel): ConsoleWriter {
    switch (level) {
        case 'debug':
            return console.debug.bind(console)
        case 'info':
            return console.info.bind(console)
        case 'warn':
            return console.warn.bind(console)
        case 'error':
            return console.error.bind(console)
    }
}

function formatError(error: Error): string {
    return error.stack ? `${error.message}\n${error.stack}` : error.message
}

function stringifyForBackend(value: unknown): string {
    if (typeof value === 'string') return value
    if (value instanceof Error) return formatError(value)
    if (typeof value === 'undefined') return 'undefined'

    try {
        const seen = new WeakSet<object>()
        const text = JSON.stringify(value, (_key, item: unknown) => {
            if (item instanceof Error) return formatError(item)
            if (typeof item === 'object' && item !== null) {
                if (seen.has(item)) return '[Circular]'
                seen.add(item)
            }
            return item
        })
        return text ?? String(value)
    } catch {
        return String(value)
    }
}

function backendMessage(args: readonly unknown[]): string {
    const message = args.map(stringifyForBackend).join(' ')
    if (message.length <= MAX_BACKEND_MESSAGE_LENGTH) return message
    return `${message.slice(0, MAX_BACKEND_MESSAGE_LENGTH)}...(truncated)`
}

function write(level: LogLevel, args: readonly unknown[]) {
    if (shouldMirrorToConsole(level)) {
        consoleWriter(level)(...args)
    }

    const message = backendMessage(args)
    if (!message.trim()) return

    try {
        void log_message(level, message, BACKEND_SOURCE).catch(() => {
            // 纯前端调试时没有 Tauri IPC，忽略转发失败。
        })
    } catch {
        // 某些浏览器环境下 Tauri invoke 可能同步抛错。
    }
}

export const logger = {
    debug: (...args: unknown[]) => write('debug', args),
    log: (...args: unknown[]) => write('info', args),
    info: (...args: unknown[]) => write('info', args),
    warn: (...args: unknown[]) => write('warn', args),
    error: (...args: unknown[]) => write('error', args),
}
