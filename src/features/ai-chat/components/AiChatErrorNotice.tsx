/**
 * AI 对话失败提示。
 *
 * 错误判定与操作语义由共享对话层提供；桌面端和移动端仅通过 compact 调整密度。
 */
import {Button} from 'flowcloudai-ui'
import {ErrorCode, type ApiError} from '../../../api'
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

interface AiChatErrorNoticeProps {
    error: ApiError
    compact?: boolean
    onRetry?: () => void
    onOpenSettings?: () => void
}

export default function AiChatErrorNotice({
    error,
    compact = false,
    onRetry,
    onOpenSettings,
}: AiChatErrorNoticeProps) {
    const providerMessage = detailString(error, 'provider_message')
    const requestId = detailString(error, 'request_id')
    const retryable = error.detail?.retryable
    const showSettings = SETTINGS_ERROR_CODES.has(error.code) && onOpenSettings
    const showRetry = onRetry && retryable !== false

    return (
        <section
            className={`ai-chat-error-notice${compact ? ' ai-chat-error-notice--compact' : ''}`}
            role="alert"
        >
            <div className="ai-chat-error-notice__title">本轮对话失败</div>
            <div className="ai-chat-error-notice__message">{error.message}</div>
            {providerMessage && providerMessage !== error.message ? (
                <div className="ai-chat-error-notice__provider">{providerMessage}</div>
            ) : null}
            <div className="ai-chat-error-notice__meta">
                <code>{error.code}</code>
                {requestId ? <span>请求 ID：{requestId}</span> : null}
            </div>
            {(showRetry || showSettings) ? (
                <div className="ai-chat-error-notice__actions">
                    {showRetry ? (
                        <Button type="button" size="sm" onClick={onRetry}>重试</Button>
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
