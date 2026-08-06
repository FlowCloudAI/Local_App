// AI 首个响应到达前的共享处理中反馈，由桌面端与移动端消息列表共同使用。
import './AiResponsePendingIndicator.css'

export default function AiResponsePendingIndicator() {
    return (
        <div className="ai-response-pending" role="status" aria-label="AI 正在处理中">
            <span aria-hidden="true"/>
            <span aria-hidden="true"/>
            <span aria-hidden="true"/>
        </div>
    )
}
