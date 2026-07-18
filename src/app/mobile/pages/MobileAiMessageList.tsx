import {type RefObject} from 'react'
import {Button, MessageBox} from 'flowcloudai-ui'
import {type AiContextValue} from '../../../features/ai-chat/model/AiControllerTypes'

interface MobileAiMessageListProps {
    messages: AiContextValue['messages']
    streamingBlocks: AiContextValue['streamingBlocks']
    isStreaming: boolean
    focusEntryId: string | null
    hasActiveConversation: boolean
    conversationCreationDisabled: boolean
    setupActionLabel: string | null
    messagesEndRef: RefObject<HTMLDivElement | null>
    onNewConversation: () => void
    onOpenSettings: () => void
}

export default function MobileAiMessageList({
    messages,
    streamingBlocks,
    isStreaming,
    focusEntryId,
    hasActiveConversation,
    conversationCreationDisabled,
    setupActionLabel,
    messagesEndRef,
    onNewConversation,
    onOpenSettings,
}: MobileAiMessageListProps) {
    return (
        <main className="mobile-ai-chat__messages">
            {messages.length === 0 && !isStreaming && (
                <div className="mobile-ai-chat__empty">
                    <p>开始 AI 对话</p>
                    <span>{focusEntryId ? '围绕当前词条继续创作。' : '与 AI 讨论世界观设定、资料整理和后续创作。'}</span>
                    {!hasActiveConversation && (
                        <Button type="button" onClick={onNewConversation} disabled={conversationCreationDisabled}>
                            开始新对话
                        </Button>
                    )}
                    {setupActionLabel ? (
                        <Button type="button" variant="outline" onClick={onOpenSettings}>
                            {setupActionLabel}
                        </Button>
                    ) : null}
                </div>
            )}
            {messages.map(message => (
                <MessageBox
                    key={message.id}
                    role={message.role}
                    blocks={message.blocks}
                    content={message.content}
                    markdown={message.role === 'assistant'}
                    contextDisplay={message.role === 'assistant' ? 'compact' : 'full'}
                    toolCallDetail="verbose"
                    lineHeight={1.5}
                />
            ))}
            {isStreaming && streamingBlocks.length > 0 && (
                <MessageBox
                    role="assistant"
                    blocks={streamingBlocks}
                    streaming
                    markdown
                    toolCallDetail="verbose"
                    lineHeight={1.5}
                />
            )}
            <div ref={messagesEndRef}/>
        </main>
    )
}
