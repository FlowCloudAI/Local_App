import {Button} from 'flowcloudai-ui'
import './AiPluginMissingOverlay.css'

export type AiMissingPluginKind = 'llm' | 'image' | 'tts'

interface AiPluginMissingOverlayProps {
    kind: AiMissingPluginKind
    variant?: 'overlay' | 'panel' | 'inline'
    onOpenPluginManagement?: (kind: AiMissingPluginKind) => void
}

const PLUGIN_COPY: Record<AiMissingPluginKind, { title: string; description: string }> = {
    llm: {
        title: '未安装 LLM 插件',
        description: 'AI 对话需要先安装一个 LLM 插件，安装完成后即可继续使用对话、角色聊天和报告讨论。',
    },
    image: {
        title: '未安装 Image 插件',
        description: 'AI 生图需要先安装一个 Image 插件，安装完成后即可生成词条图片或项目封面。',
    },
    tts: {
        title: '未安装 TTS 插件',
        description: '角色语音需要先安装一个 TTS 插件，安装完成后即可播放或自动朗读角色回复。',
    },
}

export default function AiPluginMissingOverlay({
                                                   kind,
                                                   variant = 'overlay',
                                                   onOpenPluginManagement,
                                               }: AiPluginMissingOverlayProps) {
    const copy = PLUGIN_COPY[kind]

    return (
        <div className={`ai-plugin-missing ai-plugin-missing--${variant}`} role="status" aria-live="polite">
            <div className="ai-plugin-missing__card">
                <div className="ai-plugin-missing__icon" aria-hidden="true">
                    {kind === 'image' ? (
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                            <rect x="3" y="3" width="18" height="18" rx="2" strokeWidth="1.6"/>
                            <circle cx="8.5" cy="8.5" r="1.5" strokeWidth="1.6"/>
                            <path d="M21 15l-5-5L5 21" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                    ) : kind === 'tts' ? (
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                            <path d="M12 2a3 3 0 00-3 3v7a3 3 0 006 0V5a3 3 0 00-3-3z" strokeWidth="1.6"/>
                            <path d="M19 10v2a7 7 0 01-14 0v-2M12 19v3M8 22h8" strokeWidth="1.6" strokeLinecap="round"/>
                        </svg>
                    ) : (
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                            <path d="M21 15a2 2 0 01-2 2H8l-5 4V5a2 2 0 012-2h14a2 2 0 012 2z" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                    )}
                </div>
                <div className="ai-plugin-missing__content">
                    <div className="ai-plugin-missing__title">{copy.title}</div>
                    <p className="ai-plugin-missing__description">{copy.description}</p>
                </div>
                {onOpenPluginManagement && (
                    <Button
                        type="button"
                        size="sm"
                        variant="primary"
                        onClick={() => onOpenPluginManagement(kind)}
                    >
                        去插件管理
                    </Button>
                )}
            </div>
        </div>
    )
}
