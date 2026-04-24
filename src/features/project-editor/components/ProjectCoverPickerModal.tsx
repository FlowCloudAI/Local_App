import {open as openFileDialog} from '@tauri-apps/plugin-dialog'
import {createPortal} from 'react-dom'
import {type ChangeEvent, type KeyboardEvent, useEffect, useMemo, useState} from 'react'
import {Button, Select, useAlert} from 'flowcloudai-ui'
import {
    ai_list_plugins,
    ai_text_to_image,
    db_get_entry,
    db_list_entries,
    type Entry,
    type ImageData,
    import_entry_images,
    import_remote_images,
    type PluginInfo,
} from '../../../api'
import type {EntryImage} from '../../entries/lib/entryImage'
import {normalizeEntryImages, toEntryImageSrc} from '../../entries/lib/entryImage'

type Tab = 'existing' | 'local' | 'ai'
type GenerateState = 'idle' | 'generating' | 'success' | 'error'

interface CoverLibraryItem {
    key: string
    entryId: string
    entryTitle: string
    image: EntryImage
    src: string
}

interface ProjectCoverPickerModalProps {
    open: boolean
    projectId: string
    currentCoverPath?: string | null
    onClose: () => void
    onSelectCover: (coverPath: string | null) => Promise<void> | void
}

function extractEntryImages(entry: Entry): CoverLibraryItem[] {
    const normalizedImages = normalizeEntryImages(entry.images)
    return normalizedImages
        .map((image, index) => {
            const src = toEntryImageSrc(image)
            const path = image.path ?? null
            if (!src || !path) return null

            return {
                key: `${entry.id}:${path}:${index}`,
                entryId: entry.id,
                entryTitle: entry.title ?? '未命名词条',
                image,
                src,
            } satisfies CoverLibraryItem
        })
        .filter((item): item is NonNullable<typeof item> => item !== null)
}

export default function ProjectCoverPickerModal({
                                                    open,
                                                    projectId,
                                                    currentCoverPath,
                                                    onClose,
                                                    onSelectCover,
                                                }: ProjectCoverPickerModalProps) {
    const [activeTab, setActiveTab] = useState<Tab>('existing')
    const [loadingLibrary, setLoadingLibrary] = useState(false)
    const [libraryItems, setLibraryItems] = useState<CoverLibraryItem[]>([])
    const [libraryQuery, setLibraryQuery] = useState('')
    const [plugins, setPlugins] = useState<PluginInfo[]>([])
    const [selectedPlugin, setSelectedPlugin] = useState('')
    const [selectedModel, setSelectedModel] = useState('')
    const [selectedSize, setSelectedSize] = useState('')
    const [prompt, setPrompt] = useState('')
    const [generateState, setGenerateState] = useState<GenerateState>('idle')
    const [results, setResults] = useState<ImageData[]>([])
    const [selectedResultIndex, setSelectedResultIndex] = useState(0)
    const [errorMessage, setErrorMessage] = useState('')
    const [applying, setApplying] = useState(false)
    const {showAlert} = useAlert()

    useEffect(() => {
        if (!open) return

        let cancelled = false
        setActiveTab('existing')
        setLoadingLibrary(true)
        setLibraryItems([])
        setLibraryQuery('')
        setPlugins([])
        setSelectedPlugin('')
        setSelectedModel('')
        setSelectedSize('')
        setPrompt('')
        setGenerateState('idle')
        setResults([])
        setSelectedResultIndex(0)
        setErrorMessage('')
        setApplying(false)

        void (async () => {
            try {
                const [briefs, imagePlugins] = await Promise.all([
                    db_list_entries({projectId, limit: 1000, offset: 0}),
                    ai_list_plugins('image'),
                ])
                if (cancelled) return

                setPlugins(imagePlugins)
                const defaultPlugin = imagePlugins[0]
                setSelectedPlugin(defaultPlugin?.id ?? '')
                setSelectedModel(defaultPlugin?.default_model ?? defaultPlugin?.models[0] ?? '')
                setSelectedSize(defaultPlugin?.supported_sizes[0] ?? '')

                const detailResults = await Promise.all(
                    briefs.map(async (brief) => {
                        try {
                            return await db_get_entry(brief.id)
                        } catch {
                            return null
                        }
                    }),
                )
                if (cancelled) return

                const images = detailResults
                    .filter((entry): entry is Entry => Boolean(entry))
                    .flatMap((entry) => extractEntryImages(entry))
                setLibraryItems(images)
            } catch (error) {
                if (!cancelled) {
                    const message = error instanceof Error ? error.message : String(error)
                    setErrorMessage(message)
                    void showAlert(message, 'error', 'toast', 3000)
                }
            } finally {
                if (!cancelled) {
                    setLoadingLibrary(false)
                }
            }
        })()

        return () => {
            cancelled = true
        }
    }, [open, projectId, showAlert])

    useEffect(() => {
        if (!open) return

        const handler = (event: globalThis.KeyboardEvent) => {
            if (event.key === 'Escape' && !applying) {
                onClose()
            }
        }
        window.addEventListener('keydown', handler)
        return () => window.removeEventListener('keydown', handler)
    }, [applying, onClose, open])

    const selectedPluginInfo = useMemo(
        () => plugins.find((plugin) => plugin.id === selectedPlugin) ?? null,
        [plugins, selectedPlugin],
    )

    useEffect(() => {
        if (!selectedPluginInfo) return
        setSelectedModel((current) => (
            current && selectedPluginInfo.models.includes(current)
                ? current
                : selectedPluginInfo.default_model || selectedPluginInfo.models[0] || ''
        ))
        setSelectedSize((current) => (
            current && selectedPluginInfo.supported_sizes.includes(current)
                ? current
                : selectedPluginInfo.supported_sizes[0] || ''
        ))
    }, [selectedPluginInfo])

    const filteredLibraryItems = useMemo(() => {
        const keyword = libraryQuery.trim().toLowerCase()
        if (!keyword) return libraryItems
        return libraryItems.filter((item) => {
            const title = item.entryTitle.toLowerCase()
            const alt = String(item.image.alt ?? '').toLowerCase()
            const caption = String(item.image.caption ?? '').toLowerCase()
            return title.includes(keyword) || alt.includes(keyword) || caption.includes(keyword)
        })
    }, [libraryItems, libraryQuery])

    const canGenerate = useMemo(
        () => prompt.trim().length > 0 && selectedPlugin.length > 0 && selectedModel.length > 0,
        [prompt, selectedPlugin, selectedModel],
    )

    const handleApplyCover = async (coverPath: string | null) => {
        if (applying) return
        setApplying(true)
        try {
            await onSelectCover(coverPath)
            onClose()
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            void showAlert(message, 'error', 'toast', 3000)
        } finally {
            setApplying(false)
        }
    }

    const handleLocalUpload = async () => {
        try {
            const selected = await openFileDialog({
                multiple: false,
                filters: [{
                    name: 'Images',
                    extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'],
                }],
            })
            const paths = selected ? [String(selected)] : []
            if (!paths.length) return

            const importedImages = await import_entry_images(projectId, paths)
            const firstImage = importedImages[0]
            if (!firstImage?.path) {
                throw new Error('导入图片后未获得有效路径')
            }
            await handleApplyCover(firstImage.path)
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            void showAlert(message, 'error', 'toast', 3000)
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
            setSelectedResultIndex(0)
            setGenerateState('success')
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            setErrorMessage(message)
            setGenerateState('error')
            void showAlert(message, 'error', 'toast', 3000)
        }
    }

    const handleAddAiCover = async () => {
        const target = results[selectedResultIndex]
        if (!target?.url) return

        try {
            const importedImages = await import_remote_images(projectId, [target.url])
            const firstImage = importedImages[0]
            if (!firstImage?.path) {
                throw new Error('下载图片后未获得有效路径')
            }
            await handleApplyCover(firstImage.path)
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            setErrorMessage(message)
            setGenerateState('error')
            void showAlert(message, 'error', 'toast', 3000)
        }
    }

    const handlePromptKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
        if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
            event.preventDefault()
            void handleGenerate()
        }
    }

    if (!open) return null

    return createPortal(
        <div
            className="pe-cover-picker-backdrop"
            onClick={(event) => {
                if (event.target === event.currentTarget && !applying) {
                    onClose()
                }
            }}
        >
            <div
                className="pe-cover-picker-dialog"
                role="dialog"
                aria-modal="true"
                aria-label="设置项目封面"
            >
                <div className="pe-cover-picker__header">
                    <div>
                        <h3 className="pe-cover-picker__title">设置项目封面</h3>
                        <p className="pe-cover-picker__desc">可以从已有词条图片中选择，也可以上传或 AI 生成。</p>
                    </div>
                    <button
                        type="button"
                        className="pe-cover-picker__close"
                        onClick={onClose}
                        disabled={applying}
                        aria-label="关闭"
                    >
                        ×
                    </button>
                </div>

                <div className="pe-cover-picker__tabs">
                    {([
                        {key: 'existing', label: '词条图片'},
                        {key: 'local', label: '本地上传'},
                        {key: 'ai', label: 'AI 生成'},
                    ] as Array<{ key: Tab; label: string }>).map((tab) => (
                        <button
                            key={tab.key}
                            type="button"
                            className={`pe-cover-picker__tab${activeTab === tab.key ? ' active' : ''}`}
                            onClick={() => setActiveTab(tab.key)}
                        >
                            {tab.label}
                        </button>
                    ))}
                </div>

                <div className="pe-cover-picker__body">
                    {activeTab === 'existing' && (
                        <div className="pe-cover-picker__panel">
                            <div className="pe-cover-picker__toolbar">
                                <input
                                    className="pe-cover-picker__search"
                                    value={libraryQuery}
                                    onChange={(event: ChangeEvent<HTMLInputElement>) => setLibraryQuery(event.target.value)}
                                    placeholder="按词条标题或图片说明筛选"
                                />
                                <span className="pe-cover-picker__count">共 {filteredLibraryItems.length} 张</span>
                            </div>

                            {loadingLibrary ? (
                                <div className="pe-cover-picker__empty">正在加载词条图片…</div>
                            ) : filteredLibraryItems.length === 0 ? (
                                <div className="pe-cover-picker__empty">当前项目还没有可用图片。</div>
                            ) : (
                                <div className="pe-cover-picker__grid">
                                    {filteredLibraryItems.map((item) => {
                                        const isCurrent = item.image.path === currentCoverPath
                                        return (
                                            <button
                                                key={item.key}
                                                type="button"
                                                className={`pe-cover-picker__card${isCurrent ? ' is-current' : ''}`}
                                                onClick={() => void handleApplyCover(item.image.path ?? null)}
                                                disabled={applying}
                                            >
                                                <img
                                                    src={item.src}
                                                    alt={item.image.alt || item.entryTitle}
                                                    className="pe-cover-picker__card-image"
                                                />
                                                <span className="pe-cover-picker__card-body">
                                                    <span
                                                        className="pe-cover-picker__card-title">{item.entryTitle}</span>
                                                    <span className="pe-cover-picker__card-meta">
                                                        {item.image.alt || item.image.caption || '词条图片'}
                                                    </span>
                                                    {isCurrent && (
                                                        <span className="pe-cover-picker__card-badge">当前封面</span>
                                                    )}
                                                </span>
                                            </button>
                                        )
                                    })}
                                </div>
                            )}
                        </div>
                    )}

                    {activeTab === 'local' && (
                        <div className="pe-cover-picker__panel pe-cover-picker__panel--center">
                            <p className="pe-cover-picker__hint">
                                从本地文件系统导入一张图片，导入后会直接设为项目封面。
                            </p>
                            <Button size="sm" onClick={() => void handleLocalUpload()} disabled={applying}>
                                选择本地图片
                            </Button>
                        </div>
                    )}

                    {activeTab === 'ai' && (
                        <div className="pe-cover-picker__panel pe-cover-picker__panel--ai">
                            <div className="pe-cover-picker__field-row">
                                <div className="pe-cover-picker__field">
                                    <label className="pe-cover-picker__label">插件</label>
                                    <Select
                                        value={selectedPlugin}
                                        onChange={(value) => setSelectedPlugin(value ? String(value) : '')}
                                        placeholder="选择插件"
                                        options={plugins.map((plugin) => ({value: plugin.id, label: plugin.name}))}
                                    />
                                </div>
                                <div className="pe-cover-picker__field">
                                    <label className="pe-cover-picker__label">模型</label>
                                    <Select
                                        value={selectedModel}
                                        onChange={(value) => setSelectedModel(value ? String(value) : '')}
                                        placeholder="选择模型"
                                        options={selectedPluginInfo?.models.map((model) => ({
                                            value: model,
                                            label: model
                                        })) ?? []}
                                    />
                                </div>
                                <div className="pe-cover-picker__field">
                                    <label className="pe-cover-picker__label">尺寸</label>
                                    <Select
                                        value={selectedSize}
                                        onChange={(value) => setSelectedSize(value ? String(value) : '')}
                                        placeholder="选择尺寸"
                                        options={selectedPluginInfo?.supported_sizes.map((size) => ({
                                            value: size,
                                            label: size
                                        })) ?? []}
                                        disabled={!selectedPluginInfo || selectedPluginInfo.supported_sizes.length === 0}
                                    />
                                </div>
                            </div>

                            <div className="pe-cover-picker__field">
                                <label className="pe-cover-picker__label">提示词</label>
                                <textarea
                                    className="pe-cover-picker__textarea"
                                    value={prompt}
                                    onChange={(event: ChangeEvent<HTMLTextAreaElement>) => setPrompt(event.target.value)}
                                    onKeyDown={handlePromptKeyDown}
                                    placeholder="描述项目封面想要的画面，比如场景、风格、主体和氛围。"
                                    rows={4}
                                    disabled={generateState === 'generating' || applying}
                                />
                                <span className="pe-cover-picker__hint">按 Ctrl / Cmd + Enter 可直接生成。</span>
                            </div>

                            <div className="pe-cover-picker__actions">
                                <Button
                                    size="sm"
                                    onClick={() => void handleGenerate()}
                                    disabled={!canGenerate || generateState === 'generating' || applying}
                                >
                                    {generateState === 'generating' ? '生成中…' : '开始生成'}
                                </Button>
                            </div>

                            {generateState === 'error' && (
                                <div className="pe-cover-picker__error">生成失败：{errorMessage}</div>
                            )}

                            {results.length > 0 && (
                                <div className="pe-cover-picker__result-section">
                                    <div className="pe-cover-picker__toolbar">
                                        <span className="pe-cover-picker__count">生成结果 {results.length} 张</span>
                                        <Button
                                            size="sm"
                                            variant="outline"
                                            onClick={() => void handleAddAiCover()}
                                            disabled={!results[selectedResultIndex]?.url || applying}
                                        >
                                            导入并设为封面
                                        </Button>
                                    </div>
                                    <div className="pe-cover-picker__grid">
                                        {results.map((image, index) => (
                                            <button
                                                key={`${image.url ?? index}`}
                                                type="button"
                                                className={`pe-cover-picker__card${selectedResultIndex === index ? ' is-selected' : ''}`}
                                                onClick={() => setSelectedResultIndex(index)}
                                                disabled={!image.url || applying}
                                            >
                                                {image.url ? (
                                                    <img
                                                        src={image.url}
                                                        alt={`AI 生成结果 ${index + 1}`}
                                                        className="pe-cover-picker__card-image"
                                                    />
                                                ) : (
                                                    <div
                                                        className="pe-cover-picker__image-placeholder">无法显示图片</div>
                                                )}
                                                <span className="pe-cover-picker__card-body">
                                                    <span
                                                        className="pe-cover-picker__card-title">方案 {index + 1}</span>
                                                    {selectedResultIndex === index && (
                                                        <span className="pe-cover-picker__card-badge">已选中</span>
                                                    )}
                                                </span>
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>,
        document.body,
    )
}
