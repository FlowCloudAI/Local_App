import {type ChangeEvent, type KeyboardEvent, useEffect, useMemo, useState} from 'react'
import {createPortal} from 'react-dom'
import {Button, Select, useAlert} from 'flowcloudai-ui'
import {
    ai_list_plugins,
    ai_text_to_image,
    type FCImage,
    type ImageData,
    import_remote_images,
    type PluginInfo,
} from '../api'
import type {EntryImage} from './utils/entryImage'
import './EntryImageAddModal.css'

type Tab = 'local' | 'ai'
type GenerateState = 'idle' | 'generating' | 'success' | 'error'

interface EntryImageAddModalProps {
    open: boolean
    projectId: string
    onClose: () => void
    onUploadLocal: () => void
    onAddAiImages: (images: EntryImage[]) => void
}

export default function EntryImageAddModal({
                                               open,
                                               projectId,
                                               onClose,
                                               onUploadLocal,
                                               onAddAiImages,
                                           }: EntryImageAddModalProps) {
    const [activeTab, setActiveTab] = useState<Tab>('local')

    // ── AI 生成相关状态 ──
    const [plugins, setPlugins] = useState<PluginInfo[]>([])
    const [selectedPlugin, setSelectedPlugin] = useState('')
    const [selectedModel, setSelectedModel] = useState('')
    const [selectedSize, setSelectedSize] = useState('')
    const [prompt, setPrompt] = useState('')
    const [generateState, setGenerateState] = useState<GenerateState>('idle')
    const [results, setResults] = useState<ImageData[]>([])
    const [errorMessage, setErrorMessage] = useState('')
    const {showAlert} = useAlert()

    useEffect(() => {
        if (!open) return
        queueMicrotask(() => {
            setActiveTab('local')
            setPrompt('')
            setGenerateState('idle')
            setResults([])
            setErrorMessage('')
            setSelectedPlugin('')
            setSelectedModel('')
            setSelectedSize('')
        })

        ai_list_plugins('image')
            .then((data) => {
                setPlugins(data)
                if (data.length > 0) {
                    queueMicrotask(() => {
                        setSelectedPlugin(data[0].id)
                    })
                }
            })
            .catch((err) => {
                console.error('[EntryImageAddModal] 插件加载失败:', err)
            })
    }, [open])

    useEffect(() => {
        const plugin = plugins.find((p) => p.id === selectedPlugin)
        if (plugin) {
            const defaultModel = plugin.default_model ?? plugin.models[0] ?? ''
            const defaultSize = plugin.supported_sizes[0] ?? ''
            queueMicrotask(() => {
                setSelectedModel(defaultModel)
                setSelectedSize(defaultSize)
            })
        } else {
            queueMicrotask(() => {
                setSelectedModel('')
                setSelectedSize('')
            })
        }
    }, [selectedPlugin, plugins])

    useEffect(() => {
        if (!open) return
        const handler = (e: globalThis.KeyboardEvent) => {
            if (e.key === 'Escape') onClose()
        }
        window.addEventListener('keydown', handler)
        return () => window.removeEventListener('keydown', handler)
    }, [open, onClose])

    const selectedPluginInfo = useMemo(
        () => plugins.find((p) => p.id === selectedPlugin),
        [plugins, selectedPlugin]
    )

    const canGenerate = useMemo(() => {
        return prompt.trim().length > 0 && selectedPlugin.length > 0 && selectedModel.length > 0
    }, [prompt, selectedPlugin, selectedModel])

    const handleGenerate = async () => {
        if (!canGenerate) return

        setGenerateState('generating')
        setErrorMessage('')

        try {
            const images = await ai_text_to_image({
                pluginId: selectedPlugin,
                model: selectedModel,
                prompt: prompt.trim(),
                size: selectedSize || null,
            })
            setResults(images)
            setGenerateState('success')
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e)
            setErrorMessage(msg)
            setGenerateState('error')
            void showAlert(msg, 'error', 'toast', 3000)
        }
    }

    const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault()
            void handleGenerate()
        }
    }

    const handleAddToEntry = async () => {
        if (results.length === 0) return

        try {
            const remoteUrls = results
                .filter((img) => img.url)
                .map((img) => img.url!)

            const localImages: FCImage[] = await import_remote_images(projectId, remoteUrls)

            const entryImages: EntryImage[] = localImages.map((img: FCImage) => ({
                ...img,
                path: img.path,
                url: null,
                alt: prompt.trim().slice(0, 50),
                is_cover: false,
            }))

            onAddAiImages(entryImages)
            onClose()
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e)
            setErrorMessage(`下载图片失败: ${msg}`)
            setGenerateState('error')
            void showAlert(msg, 'error', 'toast', 3000)
        }
    }

    const handleLocalUpload = () => {
        onUploadLocal()
        onClose()
    }

    if (!open) return null

    return createPortal(
        <div
            className="entry-image-add-backdrop"
            onClick={(e) => {
                if (e.target === e.currentTarget) onClose()
            }}
        >
            <div
                className="entry-image-add-dialog"
                role="dialog"
                aria-modal="true"
                aria-label="添加图片"
            >
                <div className="entry-image-add-header">
                    <span className="entry-image-add-title">添加图片</span>
                    <button
                        className="entry-image-add-close"
                        onClick={onClose}
                        aria-label="关闭"
                    >
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                            <path d="M1 1l10 10M11 1L1 11" stroke="currentColor" strokeWidth="1.75"
                                  strokeLinecap="round"/>
                        </svg>
                    </button>
                </div>

                <div className="entry-image-add-tabs">
                    <button
                        type="button"
                        className={`entry-image-add-tab${activeTab === 'local' ? ' active' : ''}`}
                        onClick={() => setActiveTab('local')}
                    >
                        本地上传
                    </button>
                    <button
                        type="button"
                        className={`entry-image-add-tab${activeTab === 'ai' ? ' active' : ''}`}
                        onClick={() => setActiveTab('ai')}
                    >
                        AI 生成
                    </button>
                </div>

                <div className="entry-image-add-body">
                    {activeTab === 'local' ? (
                        <div className="entry-image-add-local">
                            <p className="entry-image-add-local-desc">
                                从本地文件系统选择图片文件，支持 PNG、JPG、JPEG、GIF、WebP、BMP 格式。
                            </p>
                            <Button size="sm" onClick={handleLocalUpload}>
                                选择本地图片
                            </Button>
                        </div>
                    ) : (
                        <div className="entry-image-add-ai">
                            <div className="entry-image-add-ai__field-row">
                                <div className="entry-image-add-ai__field">
                                    <label className="entry-image-add-ai__label">插件</label>
                                    <Select
                                        className="entry-image-add-ai__select"
                                        value={selectedPlugin}
                                        onChange={(v) => setSelectedPlugin(String(v))}
                                        placeholder="选择插件"
                                        options={plugins.map((p) => ({value: p.id, label: p.name}))}
                                    />
                                </div>
                                <div className="entry-image-add-ai__field">
                                    <label className="entry-image-add-ai__label">模型</label>
                                    <Select
                                        className="entry-image-add-ai__select"
                                        value={selectedModel}
                                        onChange={(v) => setSelectedModel(String(v))}
                                        placeholder="选择模型"
                                        options={selectedPluginInfo?.models.map((m) => ({value: m, label: m})) ?? []}
                                    />
                                </div>
                                <div className="entry-image-add-ai__field">
                                    <label className="entry-image-add-ai__label">尺寸</label>
                                    <Select
                                        className="entry-image-add-ai__select"
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
                                <span
                                    className="entry-image-add-ai__hint">当前插件未声明可选尺寸，将使用模型默认尺寸。</span>
                            )}

                            <div className="entry-image-add-ai__field">
                                <label className="entry-image-add-ai__label">提示词（Prompt）</label>
                                <textarea
                                    className="entry-image-add-ai__textarea"
                                    value={prompt}
                                    onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setPrompt(e.target.value)}
                                    onKeyDown={handleKeyDown}
                                    placeholder="描述你想要生成的图像内容…"
                                    rows={3}
                                    disabled={generateState === 'generating'}
                                />
                                <span className="entry-image-add-ai__hint">按 Cmd / Ctrl + Enter 快速生成</span>
                            </div>

                            <div className="entry-image-add-ai__actions">
                                <Button
                                    size="sm"
                                    disabled={!canGenerate || generateState === 'generating'}
                                    onClick={() => void handleGenerate()}
                                >
                                    {generateState === 'generating' ? '生成中…' : '开始生成'}
                                </Button>
                            </div>

                            {generateState === 'error' && (
                                <div className="entry-image-add-ai__error">
                                    生成失败：{errorMessage}
                                </div>
                            )}

                            {results.length > 0 && (
                                <div className="entry-image-add-ai__results">
                                    <div className="entry-image-add-ai__results-header">
                                        <span className="entry-image-add-ai__results-title">生成结果</span>
                                        <span
                                            className="entry-image-add-ai__results-count">共 {results.length} 张</span>
                                    </div>
                                    <div className="entry-image-add-ai__result-grid">
                                        {results.map((img, idx) => (
                                            <div key={`${img.url ?? idx}`} className="entry-image-add-ai__result-card">
                                                {img.url ? (
                                                    <img
                                                        src={img.url}
                                                        alt={`生成结果 ${idx + 1}`}
                                                        className="entry-image-add-ai__result-image"
                                                    />
                                                ) : (
                                                    <div className="entry-image-add-ai__result-placeholder">
                                                        无法显示图片
                                                    </div>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                    <div className="entry-image-add-ai__results-footer">
                                        <Button
                                            size="sm"
                                            variant="primary"
                                            onClick={handleAddToEntry}
                                        >
                                            添加到词条
                                        </Button>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>,
        document.body
    )
}
