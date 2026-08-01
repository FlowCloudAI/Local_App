/**
 * AI 对话失败提示。
 *
 * 错误判定与操作语义由共享对话层提供；桌面端和移动端仅通过 compact 调整密度。
 */
import {Button} from 'flowcloudai-ui'
import {ErrorCode, type ApiError} from '../../../api'
import {formatTokenCount} from '../lib/contextUsage'
import './AiChatErrorNotice.css'

const SETTINGS_ERROR_CODES = new Set<string>([
    ErrorCode.AuthApiKeyMissing,
    ErrorCode.AuthKeyInvalid,
    ErrorCode.HttpUnauthorized,
    ErrorCode.HttpPaymentRequired,
    ErrorCode.HttpForbidden,
])

const detailString = (error: ApiError, key: string) => {
    const value = error.detail?.[key]
    return typeof value === 'string' && value.trim() ? value.trim() : null
}

const detailNumber = (error: ApiError, key: string) => {
    const value = error.detail?.[key]
    return typeof value === 'number' && Number.isFinite(value) ? value : null
}

interface LargestMessage {
    index: number
    role: string
    tokens: number
}

const largestMessages = (error: ApiError): LargestMessage[] => {
    const value = error.detail?.top_3_largest_messages
    if (!Array.isArray(value)) return []
    return value.flatMap(item => {
        if (!item || typeof item !== 'object') return []
        const record = item as Record<string, unknown>
        return typeof record.index === 'number'
        && typeof record.role === 'string'
        && typeof record.tokens === 'number'
            ? [{index: record.index, role: record.role, tokens: record.tokens}]
            : []
    })
}

const roleLabel = (role: string) => ({
    system: '系统',
    user: '用户',
    assistant: '助手',
    tool: '工具',
}[role] ?? role)

interface AiChatErrorNoticeProps {
    error: ApiError
    compact?: boolean
    onRetry?: () => void
    retryLabel?: string
    onOpenSettings?: () => void
}

export default function AiChatErrorNotice({
    error,
    compact = false,
    onRetry,
    retryLabel = '重试',
    onOpenSettings,
}: AiChatErrorNoticeProps) {
    const providerMessage = detailString(error, 'provider_message')
    const requestId = detailString(error, 'request_id')
    const retryable = error.detail?.retryable
    const contextBudgetExceeded = error.code === ErrorCode.ContextBudgetExceeded
    const budget = detailNumber(error, 'budget')
    const actual = detailNumber(error, 'actual')
    const largest = largestMessages(error)
    const showSettings = SETTINGS_ERROR_CODES.has(error.code) && onOpenSettings
    const showRetry = onRetry && retryable !== false

    return (
        <section
            className={`ai-chat-error-notice${compact ? ' ai-chat-error-notice--compact' : ''}`}
            role="alert"
        >
            <div className="ai-chat-error-notice__title">
                {contextBudgetExceeded ? '上下文超过模型预算' : '本轮对话失败'}
            </div>
            <div className="ai-chat-error-notice__message">{error.message}</div>
            {providerMessage && providerMessage !== error.message ? (
                <div className="ai-chat-error-notice__provider">{providerMessage}</div>
            ) : null}
            {contextBudgetExceeded ? (
                <div className="ai-chat-error-notice__diagnostic">
                    {budget != null && actual != null ? (
                        <span>
                            可用 {formatTokenCount(budget)} tokens，当前估算 {formatTokenCount(actual)} tokens。
                        </span>
                    ) : null}
                    {largest.length > 0 ? (
                        <ul>
                            {largest.map(item => (
                                <li key={`${item.index}:${item.role}`}>
                                    第 {item.index + 1} 条{roleLabel(item.role)}消息约占{' '}
                                    {formatTokenCount(item.tokens)} tokens
                                </li>
                            ))}
                        </ul>
                    ) : null}
                </div>
            ) : null}
            <div className="ai-chat-error-notice__meta">
                <code>{error.code}</code>
                {requestId ? <span>请求 ID：{requestId}</span> : null}
            </div>
            {(showRetry || showSettings) ? (
                <div className="ai-chat-error-notice__actions">
                    {showRetry ? (
                        <Button type="button" size="sm" onClick={onRetry}>{retryLabel}</Button>
                    ) : null}
                    {showSettings ? (
                        <Button type="button" size="sm" variant="outline" onClick={onOpenSettings}>
                            检查 AI 设置
                        </Button>
                    ) : null}
                </div>
            ) : null}
        </section>
    )
}
