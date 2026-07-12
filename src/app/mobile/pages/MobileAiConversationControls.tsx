import {CONVERSATION_TEMPERATURE_MAX, type ConversationSettings} from '../../../features/ai-chat/model/AiControllerTypes'

interface Props {
    disabled: boolean
    settings: ConversationSettings
    onTemperature: (value: number) => void
    onTopP: (value: number) => void
    onFrequencyPenalty: (value: number) => void
    onPresencePenalty: (value: number) => void
    onSystemPrompt: (value: string) => void
}

export default function MobileAiConversationControls({disabled, settings, onTemperature, onTopP, onFrequencyPenalty, onPresencePenalty, onSystemPrompt}: Props) {
    return <div className="mobile-ai-settings-card" aria-label="对话设置">
        <div className="mobile-ai-settings-grid">
            <label className="mobile-ai-setting-field"><span>温度</span><input type="number" min={0} max={CONVERSATION_TEMPERATURE_MAX} step={0.1} value={settings.temperature} disabled={disabled} onChange={event => onTemperature(Number(event.currentTarget.value))}/></label>
            <label className="mobile-ai-setting-field"><span>回答开放度</span><input type="number" min={0} max={1} step={0.05} value={settings.topP} disabled={disabled} onChange={event => onTopP(Number(event.currentTarget.value))}/></label>
        </div>
        <div className="mobile-ai-setting-penalty-grid">
            <div className="mobile-ai-setting-penalty-card"><label className="mobile-ai-setting-field mobile-ai-setting-penalty-field"><span><strong>重复惩罚</strong><small>0 为关闭</small></span><input type="number" min={-2} max={2} step={0.1} value={settings.frequencyPenalty} disabled={disabled} onChange={event => onFrequencyPenalty(Number(event.currentTarget.value))}/></label></div>
            <div className="mobile-ai-setting-penalty-card"><label className="mobile-ai-setting-field mobile-ai-setting-penalty-field"><span><strong>存在惩罚</strong><small>0 为关闭</small></span><input type="number" min={-2} max={2} step={0.1} value={settings.presencePenalty} disabled={disabled} onChange={event => onPresencePenalty(Number(event.currentTarget.value))}/></label></div>
        </div>
        <label className="mobile-ai-setting-prompt"><span>当前对话独有提示词</span><textarea value={settings.systemPrompt} disabled={disabled} onChange={event => onSystemPrompt(event.currentTarget.value)} placeholder="例如：保持回答简洁，优先延续当前世界观设定。"/></label>
    </div>
}
