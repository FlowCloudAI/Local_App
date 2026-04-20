import {type ChangeEvent, type KeyboardEvent, useEffect, useMemo, useRef, useState} from 'react'
import {Button, RollingBox, Select, useAlert} from 'flowcloudai-ui'
import {ai_list_plugins, ai_play_tts, ai_speak, type PluginInfo, type TtsResult} from '../api'
import {buildTtsVoiceOptions, resolveVoiceIdWithPlugin} from './utils/ttsVoice'
import './AITtsDemo.css'

type GenerateState = 'idle' | 'generating' | 'playing' | 'success' | 'error'

function createAudioObjectUrl(result: TtsResult): string {
    const binary = atob(result.audio_base64)
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
    const mime = result.format ? `audio/${result.format}` : 'audio/mpeg'
    return URL.createObjectURL(new Blob([bytes], {type: mime}))
}

function resolvePlayableAudioUrl(result: TtsResult): string {
    if (result.audio_base64) {
        return createAudioObjectUrl(result)
    }
    return result.audio_url ?? ''
}

export default function AITtsDemo() {
    const [plugins, setPlugins] = useState<PluginInfo[]>([])
    const [selectedPlugin, setSelectedPlugin] = useState('')
    const [selectedModel, setSelectedModel] = useState('')
    const [voiceId, setVoiceId] = useState('Ethan')
    const [text, setText] = useState('你好，这里是 FlowCloudAI 的 TTS 演示页面。你可以直接输入文本，选择模型和音色，然后试听或调用系统播放。')
    const [generateState, setGenerateState] = useState<GenerateState>('idle')
    const [errorMessage, setErrorMessage] = useState('')
    const [result, setResult] = useState<TtsResult | null>(null)
    const [audioUrl, setAudioUrl] = useState('')
    const audioUrlRef = useRef('')
    const {showAlert} = useAlert()

    useEffect(() => {
        console.log('[AITtsDemo] 开始加载 tts 类插件')
        ai_list_plugins('tts')
            .then((data) => {
                console.log('[AITtsDemo] 插件加载成功，数量:', data.length)
                setPlugins(data)
                if (data.length > 0) {
                    setSelectedPlugin(data[0].id)
                }
            })
            .catch((err) => {
                console.error('[AITtsDemo] 插件加载失败:', err)
            })
    }, [])

    useEffect(() => {
        const plugin = plugins.find((p) => p.id === selectedPlugin)
        if (plugin) {
            const defaultModel = plugin.default_model ?? plugin.models[0] ?? ''
            queueMicrotask(() => {
                setSelectedModel(defaultModel)
                setVoiceId(resolveVoiceIdWithPlugin(plugin, [voiceId], ''))
            })
            return
        }
        queueMicrotask(() => {
            setSelectedModel('')
            setVoiceId('')
        })
    }, [selectedPlugin, plugins, voiceId])

    useEffect(() => () => {
        if (audioUrlRef.current) {
            URL.revokeObjectURL(audioUrlRef.current)
        }
    }, [])

    const selectedPluginInfo = useMemo(
        () => plugins.find((p) => p.id === selectedPlugin),
        [plugins, selectedPlugin]
    )

    const voiceOptions = useMemo(
        () => buildTtsVoiceOptions(selectedPluginInfo ?? null, '请选择音色'),
        [selectedPluginInfo],
    )

    const canGenerate = useMemo(() => {
        return (
            text.trim().length > 0 &&
            voiceId.trim().length > 0 &&
            selectedPlugin.length > 0 &&
            selectedModel.length > 0
        )
    }, [selectedModel, selectedPlugin, text, voiceId])

    const updateAudioUrl = (nextResult: TtsResult) => {
        if (audioUrlRef.current && audioUrlRef.current.startsWith('blob:')) {
            URL.revokeObjectURL(audioUrlRef.current)
        }
        const nextAudioUrl = resolvePlayableAudioUrl(nextResult)
        audioUrlRef.current = nextAudioUrl
        setAudioUrl(nextAudioUrl)
    }

    const handleSpeak = async () => {
        if (!canGenerate) return

        setGenerateState('generating')
        setErrorMessage('')
        try {
            const payload = {
                pluginId: selectedPlugin,
                model: selectedModel,
                text: text.trim(),
                voiceId: voiceId.trim(),
            }
            console.log('[AITtsDemo] 开始请求 ai_speak:', payload)
            const nextResult = await ai_speak(payload)
            setResult(nextResult)
            updateAudioUrl(nextResult)
            setGenerateState('success')
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            console.error('[AITtsDemo] ai_speak 失败:', error)
            setErrorMessage(message)
            setGenerateState('error')
            void showAlert(message, 'error', 'toast', 3000)
        }
    }

    const handleSystemPlay = async () => {
        if (!canGenerate) return

        setGenerateState('playing')
        setErrorMessage('')
        try {
            const payload = {
                pluginId: selectedPlugin,
                model: selectedModel,
                text: text.trim(),
                voiceId: voiceId.trim(),
            }
            console.log('[AITtsDemo] 开始请求 ai_play_tts:', payload)
            await ai_play_tts(payload)
            setGenerateState('success')
            void showAlert('已提交系统播放请求', 'success', 'toast', 1800)
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            console.error('[AITtsDemo] ai_play_tts 失败:', error)
            setErrorMessage(message)
            setGenerateState('error')
            void showAlert(message, 'error', 'toast', 3000)
        }
    }

    const handleTextChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
        setText(event.target.value)
    }

    const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
        if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
            event.preventDefault()
            void handleSpeak()
        }
    }

    return (
        <RollingBox className="ai-tts-demo" thumbSize="thin">
            <div className="ai-tts-demo__header">
                <div>
                    <p className="ai-tts-demo__eyebrow">AI 语音合成示例</p>
                    <h1 className="ai-tts-demo__title">TTS Demo</h1>
                    <p className="ai-tts-demo__description">
                        这里演示了 `ai_speak` 与 `ai_play_tts` 的基础接法。
                        你可以先生成音频在页面内试听，也可以直接调用系统音频设备播放。
                    </p>
                </div>
            </div>

            <div className="ai-tts-demo__workspace">
                <section className="ai-tts-demo__panel">
                    <div className="ai-tts-demo__panel-header">
                        <h3 className="ai-tts-demo__panel-title">合成配置</h3>
                    </div>
                    <div className="ai-tts-demo__panel-body">
                        <div className="ai-tts-demo__field-row">
                            <div className="ai-tts-demo__field">
                                <label className="ai-tts-demo__label">插件</label>
                                <Select
                                    className="ai-tts-demo__select"
                                    value={selectedPlugin}
                                    onChange={(value) => setSelectedPlugin(String(value))}
                                    placeholder="选择插件"
                                    options={plugins.map((plugin) => ({value: plugin.id, label: plugin.name}))}
                                />
                            </div>
                            <div className="ai-tts-demo__field">
                                <label className="ai-tts-demo__label">模型</label>
                                <Select
                                    className="ai-tts-demo__select"
                                    value={selectedModel}
                                    onChange={(value) => setSelectedModel(String(value))}
                                    placeholder="选择模型"
                                    options={selectedPluginInfo?.models.map((model) => ({
                                        value: model,
                                        label: model
                                    })) ?? []}
                                />
                            </div>
                        </div>

                        <div className="ai-tts-demo__field">
                            <label className="ai-tts-demo__label">音色 ID</label>
                            <Select
                                className="ai-tts-demo__select"
                                value={voiceId}
                                onChange={(value) => setVoiceId(String(value))}
                                placeholder="选择音色"
                                options={voiceOptions}
                                disabled={
                                    generateState === 'generating'
                                    || generateState === 'playing'
                                    || !selectedPluginInfo
                                    || selectedPluginInfo.supported_voices.length === 0
                                }
                            />
                        </div>

                        <div className="ai-tts-demo__field">
                            <label className="ai-tts-demo__label">文本内容</label>
                            <textarea
                                className="ai-tts-demo__textarea"
                                value={text}
                                onChange={handleTextChange}
                                onKeyDown={handleKeyDown}
                                rows={6}
                                placeholder="输入要朗读的文本…"
                                disabled={generateState === 'generating' || generateState === 'playing'}
                            />
                            <span className="ai-tts-demo__hint">按 Cmd / Ctrl + Enter 快速合成</span>
                        </div>

                        <div className="ai-tts-demo__actions">
                            <Button
                                size="sm"
                                disabled={!canGenerate || generateState === 'generating' || generateState === 'playing'}
                                onClick={() => void handleSpeak()}
                            >
                                {generateState === 'generating' ? '合成中…' : '合成并预览'}
                            </Button>
                            <Button
                                size="sm"
                                variant="secondary"
                                disabled={!canGenerate || generateState === 'generating' || generateState === 'playing'}
                                onClick={() => void handleSystemPlay()}
                            >
                                {generateState === 'playing' ? '提交中…' : '系统播放'}
                            </Button>
                        </div>

                        {generateState === 'error' && (
                            <div className="ai-tts-demo__error">
                                调用失败：{errorMessage}
                            </div>
                        )}
                    </div>
                </section>

                <section className="ai-tts-demo__panel ai-tts-demo__panel--result">
                    <div className="ai-tts-demo__panel-header">
                        <h3 className="ai-tts-demo__panel-title">合成结果</h3>
                    </div>
                    <div className="ai-tts-demo__panel-body">
                        {!result && generateState !== 'generating' && (
                            <div className="ai-tts-demo__empty">
                                <p>暂无音频结果</p>
                                <span>点击“合成并预览”后可在此试听与查看格式信息</span>
                            </div>
                        )}

                        {generateState === 'generating' && !result && (
                            <div className="ai-tts-demo__empty">
                                <p>正在合成中…</p>
                                <span>请稍候，返回的音频会在这里展示</span>
                            </div>
                        )}

                        {result && (
                            <div className="ai-tts-demo__result">
                                <div className="ai-tts-demo__meta">
                                    <div className="ai-tts-demo__meta-item">
                                        <span>音频格式</span>
                                        <strong>{result.format || '未知'}</strong>
                                    </div>
                                    <div className="ai-tts-demo__meta-item">
                                        <span>时长</span>
                                        <strong>{result.duration_ms != null ? `${result.duration_ms} ms` : '未返回'}</strong>
                                    </div>
                                    <div className="ai-tts-demo__meta-item">
                                        <span>音色</span>
                                        <strong>{voiceId}</strong>
                                    </div>
                                </div>

                                {audioUrl && (
                                    <audio
                                        className="ai-tts-demo__audio"
                                        src={audioUrl}
                                        controls
                                    />
                                )}
                                {!audioUrl && (
                                    <div className="ai-tts-demo__error">
                                        当前返回里没有可直接预览的音频数据或 URL。
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </section>
            </div>
        </RollingBox>
    )
}
