import {type ChangeEvent, type KeyboardEvent, useEffect, useMemo, useState} from 'react'
import {Button, RollingBox, Select, useAlert,} from 'flowcloudai-ui'
import {ai_list_plugins, ai_text_to_image, type ImageData, type PluginInfo,} from '../api'
import './AIImageGenerator.css'

type GenerateState = 'idle' | 'generating' | 'success' | 'error'

export default function AIImageGenerator() {
    const [plugins, setPlugins] = useState<PluginInfo[]>([])
    const [selectedPlugin, setSelectedPlugin] = useState('')
    const [selectedModel, setSelectedModel] = useState('')
    const [selectedSize, setSelectedSize] = useState('')
    const [prompt, setPrompt] = useState('')
    const [generateState, setGenerateState] = useState<GenerateState>('idle')
    const [results, setResults] = useState<ImageData[]>([])
    const [errorMessage, setErrorMessage] = useState('')
    const {showAlert} = useAlert()

    // ── 初始化插件列表 ──
    useEffect(() => {
        console.log('[AIImageGenerator] 开始加载 image 类插件')
        ai_list_plugins('image')
            .then((data) => {
                console.log('[AIImageGenerator] 插件加载成功，数量:', data.length)
                console.log('[AIImageGenerator] 插件列表:', data.map((p) => ({
                    id: p.id,
                    name: p.name,
                    models: p.models
                })))
                setPlugins(data)
                if (data.length > 0) {
                    const first = data[0]
                    console.log('[AIImageGenerator] 自动选择第一个插件:', first.id)
                    setSelectedPlugin(first.id)
                } else {
                    console.warn('[AIImageGenerator] 未找到任何 image 类插件')
                }
            })
            .catch((err) => {
                console.error('[AIImageGenerator] 插件加载失败:', err)
            })
    }, [])

    // ── 自动选择默认模型 ──
    useEffect(() => {
        const plugin = plugins.find((p) => p.id === selectedPlugin)
        if (plugin) {
            const defaultModel = plugin.default_model ?? plugin.models[0] ?? ''
            const defaultSize = plugin.supported_sizes[0] ?? ''
            console.log('[AIImageGenerator] 插件变化，自动选择模型与尺寸:', {
                pluginId: plugin.id,
                defaultModel,
                defaultSize
            })
            queueMicrotask(() => {
                setSelectedModel(defaultModel)
                setSelectedSize(defaultSize)
            })
        } else {
            console.log('[AIImageGenerator] 清空模型与尺寸选择（插件未选中或不存在）')
            queueMicrotask(() => {
                setSelectedModel('')
                setSelectedSize('')
            })
        }
    }, [selectedPlugin, plugins])

    const selectedPluginInfo = useMemo(
        () => plugins.find((p) => p.id === selectedPlugin),
        [plugins, selectedPlugin]
    )

    const canGenerate = useMemo(() => {
        const ok = prompt.trim().length > 0 && selectedPlugin.length > 0 && selectedModel.length > 0
        console.log('[AIImageGenerator] canGenerate 变化:', ok, {
            promptLength: prompt.trim().length,
            selectedPlugin,
            selectedModel
        })
        return ok
    }, [prompt, selectedPlugin, selectedModel])

    const handleGenerate = async () => {
        if (!canGenerate) {
            console.warn('[AIImageGenerator] 生成被阻止，条件不满足:', {
                canGenerate,
                prompt,
                selectedPlugin,
                selectedModel
            })
            return
        }

        const requestPayload = {
            pluginId: selectedPlugin,
            model: selectedModel,
            prompt: prompt.trim(),
            size: selectedSize || null,
        }
        console.log('[AIImageGenerator] ========== 开始图像生成 ==========')
        console.log('[AIImageGenerator] 请求参数:', requestPayload)

        setGenerateState('generating')
        setErrorMessage('')

        try {
            const startTime = performance.now()
            const images = await ai_text_to_image(requestPayload)
            const duration = Math.round(performance.now() - startTime)

            console.log('[AIImageGenerator] 生成成功，耗时:', duration, 'ms')
            console.log('[AIImageGenerator] 返回结果数量:', images.length)
            images.forEach((img, idx) => {
                console.log(`[AIImageGenerator] 结果[${idx}]:`, {url: img.url?.slice(0, 120) ?? null, size: img.size})
            })

            setResults(images)
            setGenerateState('success')
        } catch (e) {
            const raw = e
            const msg = e instanceof Error ? e.message : String(e)
            const stack = e instanceof Error ? e.stack : undefined

            console.error('[AIImageGenerator] 生成失败 ==========')
            console.error('[AIImageGenerator] 错误对象:', raw)
            console.error('[AIImageGenerator] 错误消息:', msg)
            if (stack) {
                console.error('[AIImageGenerator] 调用栈:', stack)
            }

            setErrorMessage(msg)
            setGenerateState('error')
            void showAlert(msg, 'error', 'toast', 3000)
        }
    }

    const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault()
            console.log('[AIImageGenerator] 用户通过快捷键触发生成')
            void handleGenerate()
        }
    }

    const handlePromptChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
        const value = e.target.value
        console.log('[AIImageGenerator] Prompt 变化，长度:', value.length)
        setPrompt(value)
    }

    const handlePluginChange = (value: string) => {
        console.log('[AIImageGenerator] 用户切换插件:', value)
        setSelectedPlugin(value)
    }

    const handleModelChange = (value: string) => {
        console.log('[AIImageGenerator] 用户切换模型:', value)
        setSelectedModel(value)
    }

    return (
        <RollingBox className="ai-image-generator" thumbSize="thin">
            <div className="ai-image-generator__header">
                <div>
                    <p className="ai-image-generator__eyebrow">AI 图像生成示例</p>
                    <h1 className="ai-image-generator__title">AI 绘图 Demo</h1>
                    <p className="ai-image-generator__description">
                        这个页面演示了如何通过前端直接调用文生图 API，选择 image 类插件与模型，
                        输入 Prompt 后一次性获取生成结果并在页面中展示。
                    </p>
                </div>
            </div>

            <div className="ai-image-generator__workspace">
                <section className="ai-image-generator__panel">
                    <div className="ai-image-generator__panel-header">
                        <h3 className="ai-image-generator__panel-title">生成配置</h3>
                    </div>
                    <div className="ai-image-generator__panel-body">
                        <div className="ai-image-generator__field-row">
                            <div className="ai-image-generator__field">
                                <label className="ai-image-generator__label">插件</label>
                                <Select
                                    className="ai-image-generator__select"
                                    value={selectedPlugin}
                                    onChange={(v) => handlePluginChange(String(v))}
                                    placeholder="选择插件"
                                    options={plugins.map((p) => ({value: p.id, label: p.name}))}
                                />
                            </div>
                            <div className="ai-image-generator__field">
                                <label className="ai-image-generator__label">模型</label>
                                <Select
                                    className="ai-image-generator__select"
                                    value={selectedModel}
                                    onChange={(v) => handleModelChange(String(v))}
                                    placeholder="选择模型"
                                    options={selectedPluginInfo?.models.map((m) => ({value: m, label: m})) ?? []}
                                />
                            </div>
                            <div className="ai-image-generator__field">
                                <label className="ai-image-generator__label">尺寸</label>
                                <Select
                                    className="ai-image-generator__select"
                                    value={selectedSize}
                                    onChange={(v) => setSelectedSize(String(v))}
                                    placeholder="选择尺寸"
                                    options={selectedPluginInfo?.supported_sizes.map((size) => ({
                                        value: size,
                                        label: size
                                    })) ?? []}
                                    disabled={!selectedPluginInfo || selectedPluginInfo.supported_sizes.length === 0}
                                />
                            </div>
                        </div>
                        {selectedPluginInfo && selectedPluginInfo.supported_sizes.length === 0 && (
                            <span className="ai-image-generator__hint">当前插件未声明可选尺寸，将使用模型默认尺寸。</span>
                        )}

                        <div className="ai-image-generator__field">
                            <label className="ai-image-generator__label">提示词（Prompt）</label>
                            <textarea
                                className="ai-image-generator__textarea"
                                value={prompt}
                                onChange={handlePromptChange}
                                onKeyDown={handleKeyDown}
                                placeholder="描述你想要生成的图像内容…"
                                rows={4}
                                disabled={generateState === 'generating'}
                            />
                            <span className="ai-image-generator__hint">按 Cmd / Ctrl + Enter 快速生成</span>
                        </div>

                        <div className="ai-image-generator__actions">
                            <Button
                                size="sm"
                                disabled={!canGenerate || generateState === 'generating'}
                                onClick={() => {
                                    console.log('[AIImageGenerator] 用户点击生成按钮')
                                    void handleGenerate()
                                }}
                            >
                                {generateState === 'generating' ? '生成中…' : '开始生成'}
                            </Button>
                        </div>

                        {generateState === 'error' && (
                            <div className="ai-image-generator__error">
                                生成失败：{errorMessage}
                            </div>
                        )}
                    </div>
                </section>

                <section className="ai-image-generator__panel ai-image-generator__panel--result">
                    <div className="ai-image-generator__panel-header">
                        <h3 className="ai-image-generator__panel-title">生成结果</h3>
                        <span className="ai-image-generator__result-count">
                            共 {results.length} 张
                        </span>
                    </div>
                    <div className="ai-image-generator__panel-body">
                        {results.length === 0 && generateState !== 'generating' && (
                            <div className="ai-image-generator__empty">
                                <p>暂无生成结果</p>
                                <span>在左侧输入 Prompt 并点击生成按钮</span>
                            </div>
                        )}

                        {generateState === 'generating' && results.length === 0 && (
                            <div className="ai-image-generator__empty">
                                <p>正在生成中…</p>
                                <span>请稍候，结果将在此展示</span>
                            </div>
                        )}

                        <div className="ai-image-generator__result-grid">
                            {results.map((img, idx) => (
                                <div key={`${img.url ?? idx}`} className="ai-image-generator__result-card">
                                    {img.url ? (
                                        <img
                                            src={img.url}
                                            alt={`生成结果 ${idx + 1}`}
                                            className="ai-image-generator__result-image"
                                            onLoad={() => {
                                                console.log(`[AIImageGenerator] 图片[${idx}] 加载完成`)
                                            }}
                                            onError={() => {
                                                console.error(`[AIImageGenerator] 图片[${idx}] 加载失败，url:`, img.url?.slice(0, 120))
                                            }}
                                        />
                                    ) : (
                                        <div className="ai-image-generator__result-placeholder">
                                            无法显示图片
                                        </div>
                                    )}
                                    {img.size && (
                                        <div className="ai-image-generator__result-meta">
                                            {img.size}
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>
                </section>
            </div>
        </RollingBox>
    )
}
