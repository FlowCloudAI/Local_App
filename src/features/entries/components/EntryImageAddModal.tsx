import {logger} from '../../../shared/logger'
import {type ChangeEvent, type KeyboardEvent, useEffect, useMemo, useState} from 'react'
import {createPortal} from 'react-dom'
import {Button, Select, useAlert} from 'flowcloudai-ui'
import {
    ai_fill_image_prompt,
    ai_list_plugins,
    ai_text_to_image,
    type FCImage,
    type ImageData,
    import_remote_images,
    type PluginInfo,
} from '../../../api'
import {buildEntryImageMarkdownRef, type EntryImage, toEntryImageSrc} from '../lib/entryImage'
import AiPluginMissingOverlay, {type AiMissingPluginKind} from '../../../shared/ui/AiPluginMissingOverlay'
import './EntryImageAddModal.css'

type Tab = 'existing' | 'local' | 'ai'
type GenerateState = 'idle' | 'generating' | 'success' | 'error'
type ModalMode = 'add' | 'insert'

interface EntryImageAddModalProps {
    open: boolean
    projectId: string
    projectName?: string | null
    entryTitle?: string | null
    entrySummary?: string | null
    entryType?: string | null
    aiPluginId?: string | null
    aiModel?: string | null
    mode?: ModalMode
    existingImages?: EntryImage[]
    onClose: () => void
    onUploadLocal: () => void | EntryImage[] | Promise<void | EntryImage[]>
    onAddAiImages: (images: EntryImage[]) => void
    onInsertImage?: (image: EntryImage) => void
    onOpenPluginManagement?: (kind: AiMissingPluginKind) => void
}

export default function EntryImageAddModal({
                                               open,
                                               projectId,
                                               projectName = null,
                                               entryTitle = null,
                                               entrySummary = null,
                                               entryType = null,
                                               aiPluginId = null,
                                               aiModel = null,
                                               mode = 'add',
                                               existingImages = [],
                                               onClose,
                                               onUploadLocal,
                                               onAddAiImages,
                                               onInsertImage,
                                               onOpenPluginManagement,
                                           }: EntryImageAddModalProps) {
    const insertMode = mode === 'insert'
    const [activeTab, setActiveTab] = useState<Tab>(insertMode ? 'existing' : 'local')

    // ── AI 生成相关状态 ──
    const [plugins, setPlugins] = useState<PluginInfo[]>([])
    const [pluginsLoaded, setPluginsLoaded] = useState(false)
    const [pluginLoadError, setPluginLoadError] = useState('')
    const [selectedPlugin, setSelectedPlugin] = useState('')
    const [selectedModel, setSelectedModel] = useState('')
    const [selectedSize, setSelectedSize] = useState('')
    const [prompt, setPrompt] = useState('')
    const [fillingPrompt, setFillingPrompt] = useState(false)
    const [generateState, setGenerateState] = useState<GenerateState>('idle')
    const [results, setResults] = useState<ImageData[]>([])
    const [errorMessage, setErrorMessage] = useState('')
    const {showAlert} = useAlert()

    useEffect(() => {
        if (!open) return
        queueMicrotask(() => {
            setActiveTab(insertMode ? 'existing' : 'local')
            setPrompt('')
            setFillingPrompt(false)
            setGenerateState('idle')
            setResults([])
            setErrorMessage('')
            setPlugins([])
            setPluginLoadError('')
            setSelectedPlugin('')
            setSelectedModel('')
            setSelectedSize('')
            setPluginsLoaded(false)
        })

        ai_list_plugins('image')
            .then((data) => {
                setPlugins(data)
                setPluginsLoaded(true)
                if (data.length > 0) {
                    queueMicrotask(() => {
                        setSelectedPlugin(data[0].id)
                    })
                } else if (!insertMode) {
                    queueMicrotask(() => {
                        setActiveTab('ai')
                    })
                }
            })
            .catch((err) => {
                logger.error('[EntryImageAddModal] 插件加载失败:', err)
                setPluginLoadError(err instanceof Error ? err.message : String(err))
                setPluginsLoaded(true)
            })
    }, [open, insertMode])

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

    const handleFillPrompt = async () => {
        if (fillingPrompt || generateState === 'generating') return
        if (!aiPluginId) {
            void showAlert('当前还没有可用的 LLM 插件，请先在 AI 面板选择或配置模型。', 'warning', 'nonInvasive', 2200)
            return
        }

        setFillingPrompt(true)
        setErrorMessage('')
        try {
            const result = await ai_fill_image_prompt({
                pluginId: aiPluginId,
                model: aiModel || null,
                currentPrompt: prompt.trim() || null,
                usage: 'entry_image',
                projectName,
                entryTitle,
                entrySummary,
                entryType,
            })
            setPrompt(result.prompt)
            void showAlert('已填充绘图提示词', 'success', 'nonInvasive', 1500)
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error)
            setErrorMessage(msg)
            void showAlert(msg, 'error', 'nonInvasive', 3000)
        } finally {
            setFillingPrompt(false)
        }
    }

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
            void showAlert(msg, 'error', 'nonInvasive', 3000)
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
            if (insertMode && entryImages[0]) {
                onInsertImage?.(entryImages[0])
            }
            onClose()
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e)
            setErrorMessage(`下载图片失败: ${msg}`)
            setGenerateState('error')
            void showAlert(msg, 'error', 'nonInvasive', 3000)
        }
    }

    const handleLocalUpload = async () => {
        const uploadedImages = await onUploadLocal()
        if (insertMode && Array.isArray(uploadedImages) && uploadedImages[0]) {
            onInsertImage?.(uploadedImages[0])
        }
        onClose()
    }

    const handleInsertExisting = (image: EntryImage) => {
        if (!buildEntryImageMarkdownRef(image)) {
            void showAlert('当前图片没有可插入的 uuid 引用。', 'warning', 'nonInvasive', 1800)
            return
        }
        onInsertImage?.(image)
        onClose()
    }

    const handleOpenPluginManagement = () => {
        onClose()
        onOpenPluginManagement?.('image')
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
                    <span className="entry-image-add-title">{insertMode ? '插入图片' : '添加图片'}</span>
                    <button
                        className="entry-image-add-close app-dialog-close"
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
                    {insertMode && (
                        <button
                            type="button"
                            className={`entry-image-add-tab${activeTab === 'existing' ? ' active' : ''}`}
                            onClick={() => setActiveTab('existing')}
                        >
                            设定集
                        </button>
                    )}
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
                    {activeTab === 'existing' ? (
                        <div className="entry-image-add-existing">
                            {existingImages.length > 0 ? (
                                <div className="entry-image-add-existing__grid">
                                    {existingImages.map((image, index) => {
                                        const src = toEntryImageSrc(image)
                                        const canInsert = Boolean(buildEntryImageMarkdownRef(image))
                                        return (
                                            <button
                                                key={`${image.path ?? image.url ?? index}`}
                                                type="button"
                                                className="entry-image-add-existing__item"
                                                onClick={() => handleInsertExisting(image)}
                                                disabled={!canInsert}
                                            >
                                                <div className="entry-image-add-existing__media">
                                                    {src ? (
                                                        <img src={src} alt={image.alt || image.caption || `图片 ${index + 1}`}/>
                                                    ) : (
                                                        <span>无预览</span>
                                                    )}
                                                </div>
                                                <div className="entry-image-add-existing__meta">
                                                    <span>{image.alt || image.caption || `图片 ${index + 1}`}</span>
                                                    {!canInsert && <small>缺少 uuid 引用</small>}
                                                </div>
                                            </button>
                                        )
                                    })}
                                </div>
                            ) : (
                                <div className="entry-image-add-existing__empty">
                                    当前设定集还没有图片，可上传本地图片或使用 AI 生成后插入。
                                </div>
                            )}
                        </div>
                    ) : activeTab === 'local' ? (
                        <div className="entry-image-add-local">
                            <p className="entry-image-add-local-desc">
                                从本地文件系统选择图片文件，支持 PNG、JPG、JPEG、GIF、WebP、BMP 格式。
                            </p>
                            <Button type="button" size="sm" onClick={handleLocalUpload}>
                                选择本地图片
                            </Button>
                        </div>
                    ) : (
                        <div className="entry-image-add-ai">
                            {pluginLoadError ? (
                                <div className="entry-image-add-ai__error">
                                    读取 Image 插件失败：{pluginLoadError}
                                </div>
                            ) : pluginsLoaded && plugins.length === 0 ? (
                                <AiPluginMissingOverlay
                                    kind="image"
                                    variant="panel"
                                    onOpenPluginManagement={handleOpenPluginManagement}
                                />
                            ) : (
                                <>
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
                                    disabled={generateState === 'generating' || fillingPrompt}
                                />
                                <span className="entry-image-add-ai__hint">按 Cmd / Ctrl + Enter 快速生成</span>
                            </div>

                            <div className="entry-image-add-ai__actions">
                                <Button type="button"
                                    size="sm"
                                    disabled={fillingPrompt || generateState === 'generating'}
                                    onClick={() => void handleFillPrompt()}
                                >
                                    {fillingPrompt ? '填充中…' : 'AI 填充提示词'}
                                </Button>
                                <Button type="button"
                                    size="sm"
                                    disabled={!canGenerate || generateState === 'generating' || fillingPrompt}
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
                                        <Button type="button"
                                            size="sm"
                                            variant="primary"
                                            onClick={handleAddToEntry}
                                        >
                                            {insertMode ? '添加并插入' : '添加到词条'}
                                        </Button>
                                    </div>
                                </div>
                            )}
                                </>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>,
        document.body
    )
}
