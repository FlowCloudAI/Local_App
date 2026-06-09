import {
    type MouseEvent as ReactMouseEvent,
    type PointerEvent as ReactPointerEvent,
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
} from 'react'
import {createPortal} from 'react-dom'
import {save as saveFileDialog} from '@tauri-apps/plugin-dialog'
import {Button, MessageBox, useAlert} from 'flowcloudai-ui'
import {useAiController, type AiFocus} from '../../../features/ai-chat/hooks/useAiController'
import {
    CONVERSATION_TEMPERATURE_MAX,
    normalizeConversationSettings,
    type AiToolAccessMode,
    type Conversation,
    type ConversationSettings,
} from '../../../features/ai-chat/model/AiControllerTypes'
import {
    ai_export_conversation,
    type ConversationExportFormat,
    formatApiError,
    setting_has_api_key,
    toApiError,
} from '../../../api'
import {logger} from '../../../shared/logger'
import {ActionMenu, RenameDialog} from '../../../shared/ui/overlay'
import {type MobileTab} from '../MobileNav'
import {
    MobileAnchoredMenu,
    MobileAnchoredActionMenu,
    type MobileAnchoredMenuItem,
    MobileTopActionPill,
    MobileTopIconButton,
} from '../components/MobileTopControls'
import MobileBottomSheet from '../components/MobileBottomSheet'
import './MobileAiChat.css'

interface Props {
    aiFocus: AiFocus
    navigateToTab: (tab: MobileTab) => void
    conversationDrawerOpen?: boolean
    onOpenConversationDrawer?: () => void
    onCloseConversationDrawer?: () => void
}

type ApiKeyAvailability = 'unknown' | 'checking' | 'configured' | 'missing' | 'error'
type AiConversationFilter = 'all' | 'default' | 'character' | 'report'
type AiConversationStatusFilter = 'active' | 'archived'

interface ConversationLongPressState {
    pointerId: number
    conversation: Conversation
    startX: number
    startY: number
    ready: boolean
    timerId: number | null
}

const CONVERSATION_LONG_PRESS_DELAY = 430
const CONVERSATION_LONG_PRESS_MOVE_TOLERANCE = 12

function formatConversationDate(timestamp: number): string {
    if (!timestamp) return '时间未知'
    return new Intl.DateTimeFormat('zh-CN', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
    }).format(new Date(timestamp))
}

function sortConversations(first: Conversation, second: Conversation): number {
    const pinnedDiff = Number(Boolean(second.pinnedAt)) - Number(Boolean(first.pinnedAt))
    if (pinnedDiff !== 0) return pinnedDiff
    if (first.pinnedAt && second.pinnedAt) return second.pinnedAt.localeCompare(first.pinnedAt)
    return (second.timestamp ?? 0) - (first.timestamp ?? 0)
}

const AI_TOOL_ACCESS_LABELS: Record<AiToolAccessMode, string> = {
    reader: '读者模式',
    assistant: '助手模式',
    writer: '作家模式',
}

const AI_TOOL_ACCESS_DETAILS: Record<AiToolAccessMode, string> = {
    reader: '只读取资料',
    assistant: '写入前确认',
    writer: '常规写入跳过确认',
}

const AI_TOOL_ACCESS_OPTIONS: AiToolAccessMode[] = ['reader', 'assistant', 'writer']

const AI_CONVERSATION_FILTER_OPTIONS: Array<{key: AiConversationFilter; label: string}> = [
    {key: 'all', label: '全部'},
    {key: 'default', label: '通用'},
    {key: 'character', label: '角色聊天'},
    {key: 'report', label: '矛盾检测'},
]

const AI_CONVERSATION_STATUS_OPTIONS: Array<{key: AiConversationStatusFilter; label: string}> = [
    {key: 'active', label: '当前'},
    {key: 'archived', label: '归档'},
]

function matchesConversationFilter(conversation: Conversation, filter: AiConversationFilter): boolean {
    if (filter === 'all') return true
    if (filter === 'default') return !conversation.mode || conversation.mode === 'default'
    if (filter === 'character') return conversation.mode === 'character'
    if (filter === 'report') return conversation.mode === 'report'
    return false
}

function buildConversationSearchText(conversation: Conversation): string {
    return [
        conversation.title,
        conversation.characterName,
        conversation.reportContext?.projectName,
        conversation.reportContext?.scopeSummary,
    ].filter(Boolean).join(' ').toLocaleLowerCase()
}

function buildConversationExportFileName(conversation: Conversation, format: ConversationExportFormat): string {
    const extension = format === 'json' ? 'json' : 'md'
    const safeTitle = conversation.title
        .split('')
        .map(char => (char.charCodeAt(0) < 32 || '<>:"/\\|?*'.includes(char) ? '_' : char))
        .join('')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 80)
    return `${safeTitle || 'AI会话'}.${extension}`
}

function MobileAiIcon({type}: {type: 'menu' | 'pin' | 'archive' | 'rename' | 'delete' | 'plugin' | 'image' | 'file' | 'web' | 'send' | 'stop' | 'camera' | 'thinking'}) {
    if (type === 'menu') {
        return (
            <svg className="mobile-ai-svg" viewBox="0 0 24 24" focusable="false">
                <path d="M5 7h14"/>
                <path d="M5 12h14"/>
                <path d="M5 17h14"/>
            </svg>
        )
    }
    if (type === 'pin') {
        return (
            <svg className="mobile-ai-svg" viewBox="0 0 24 24" focusable="false">
                <path d="M12 17v5"/>
                <path d="M8.5 10.8 6.2 13.1A1.7 1.7 0 0 0 7.4 16h9.2a1.7 1.7 0 0 0 1.2-2.9l-2.3-2.3V6.5l1.5-1.5H7l1.5 1.5Z"/>
            </svg>
        )
    }
    if (type === 'archive') {
        return (
            <svg className="mobile-ai-svg" viewBox="0 0 24 24" focusable="false">
                <path d="M5 7.5h14"/>
                <path d="M7 8.5v10h10v-10"/>
                <path d="M9.5 12h5"/>
                <path d="M6.5 4.5h11l1.5 3h-13Z"/>
            </svg>
        )
    }
    if (type === 'rename') {
        return (
            <svg className="mobile-ai-svg" viewBox="0 0 24 24" focusable="false">
                <path d="M4.5 16.5 15.8 5.2a2.1 2.1 0 0 1 3 3L7.5 19.5h-3Z"/>
                <path d="m14 7 3 3"/>
            </svg>
        )
    }
    if (type === 'delete') {
        return (
            <svg className="mobile-ai-svg" viewBox="0 0 24 24" focusable="false">
                <path d="M5.5 7h13"/>
                <path d="M9 7V5.5h6V7"/>
                <path d="M8 10v8"/>
                <path d="M12 10v8"/>
                <path d="M16 10v8"/>
                <path d="M7 7.5 8 20h8l1-12.5"/>
            </svg>
        )
    }
    if (type === 'plugin') {
        return (
            <svg className="mobile-ai-svg" viewBox="0 0 24 24" focusable="false">
                <path d="M8.5 4.5h7v5.5h4v6h-4v5.5h-7V16h-4v-6h4Z"/>
            </svg>
        )
    }
    if (type === 'camera') {
        return (
            <svg className="mobile-ai-svg" viewBox="0 0 24 24" focusable="false">
                <path d="M8.5 7 10 5h4l1.5 2H18a2 2 0 0 1 2 2v8.5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2Z"/>
                <circle cx="12" cy="13" r="3.2"/>
            </svg>
        )
    }
    if (type === 'image') {
        return (
            <svg className="mobile-ai-svg" viewBox="0 0 24 24" focusable="false">
                <rect x="4" y="5" width="16" height="14" rx="2.5"/>
                <path d="m7 16 3.5-3.5 2.5 2.5 2-2 3 3"/>
                <path d="M8.5 9.5h.1"/>
            </svg>
        )
    }
    if (type === 'file') {
        return (
            <svg className="mobile-ai-svg" viewBox="0 0 24 24" focusable="false">
                <path d="M7 4.5h7l4 4V19a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 6 19V6A1.5 1.5 0 0 1 7.5 4.5Z"/>
                <path d="M14 4.5V9h4"/>
                <path d="M8.5 13h7"/>
                <path d="M8.5 16h5"/>
            </svg>
        )
    }
    if (type === 'web') {
        return (
            <svg className="mobile-ai-svg" viewBox="0 0 24 24" focusable="false">
                <circle cx="12" cy="12" r="8.5"/>
                <path d="M4.5 12h17"/>
                <path d="M12 3.5c2.2 2.4 3.2 5.3 3.2 8.5s-1 6.1-3.2 8.5"/>
                <path d="M12 3.5C9.8 5.9 8.8 8.8 8.8 12s1 6.1 3.2 8.5"/>
            </svg>
        )
    }
    if (type === 'thinking') {
        return (
            <svg className="mobile-ai-svg" viewBox="0 0 24 24" focusable="false">
                <path d="M12 3.5 9 11h4l-1 9.5 4-11h-4Z"/>
            </svg>
        )
    }
    if (type === 'stop') {
        return (
            <svg className="mobile-ai-svg" viewBox="0 0 24 24" focusable="false">
                <rect x="8" y="8" width="8" height="8" rx="1.5"/>
            </svg>
        )
    }
    return (
        <svg className="mobile-ai-svg" viewBox="0 0 24 24" focusable="false">
            <path d="M12 20V4"/>
            <path d="M4.5 11.5L12 4l7.5 7.5"/>
        </svg>
    )
}

export default function MobileAiChat({
    aiFocus,
    navigateToTab,
    conversationDrawerOpen = false,
    onOpenConversationDrawer,
    onCloseConversationDrawer,
}: Props) {
    const {showAlert} = useAlert()
    const messagesEndRef = useRef<HTMLDivElement>(null)
    const pageRef = useRef<HTMLDivElement>(null)
    const topActionsRef = useRef<HTMLDivElement>(null)

    const controller = useAiController(aiFocus)
    const {
        conversations, activeConversationId, setActiveConversationId,
        messages, sendMessage, stopStreaming,
        inputValue, setInputValue, isStreaming, streamingBlocks,
        conversationRuntime, switchConversation, createNewConversation, deleteConversation,
        renameConversation, toggleConversationPinned, toggleConversationArchived,
        plugins, pluginsReady, selectedPlugin, selectedModel,
        webSearchEnabled, toggleWebSearch,
        toolAccessMode, writerModeAvailable, setToolAccessMode, sessionParams, setSessionParams,
        updateConversationSettings, switchActiveConversationModel, focusContext,
    } = controller

    const [apiKeyRefreshTick, setApiKeyRefreshTick] = useState(0)
    const [llmApiKeyAvailability, setLlmApiKeyAvailability] = useState<ApiKeyAvailability>('unknown')
    const [conversationSearch, setConversationSearch] = useState('')
    const [conversationStatusFilter, setConversationStatusFilter] = useState<AiConversationStatusFilter>('active')
    const [conversationFilter, setConversationFilter] = useState<AiConversationFilter>('all')
    const [drawerRoot, setDrawerRoot] = useState<HTMLElement | null>(null)
    const [topMenuOpen, setTopMenuOpen] = useState(false)
    const [modelMenuOpen, setModelMenuOpen] = useState(false)
    const [modelMenuMode, setModelMenuMode] = useState<'models' | 'plugins'>('models')
    const [morePanelOpen, setMorePanelOpen] = useState(false)
    const [renameTarget, setRenameTarget] = useState<Conversation | null>(null)
    const [conversationActionTarget, setConversationActionTarget] = useState<Conversation | null>(null)
    const [renaming, setRenaming] = useState(false)
    const conversationLongPressRef = useRef<ConversationLongPressState | null>(null)
    const suppressConversationClickRef = useRef(false)
    const modelMenuRef = useRef<HTMLButtonElement>(null)

    const activeConversation = useMemo(
        () => conversations.find(conversation => conversation.id === activeConversationId) ?? null,
        [activeConversationId, conversations],
    )
    const activeLlmPluginId = activeConversation?.pluginId || selectedPlugin
    const activeLlmPluginInfo = useMemo(
        () => plugins.find(plugin => plugin.id === activeLlmPluginId) ?? null,
        [activeLlmPluginId, plugins],
    )
    const activeLlmPluginName = activeLlmPluginInfo?.name || activeLlmPluginId || '当前 LLM 插件'
    const activeModelId = activeConversation?.model || selectedModel
    const activeModelInfo = activeLlmPluginInfo?.model_infos.find(modelInfo => modelInfo.id === activeModelId)
    const activeModelLabel = activeModelInfo?.name && activeModelInfo.name !== activeModelId
        ? activeModelInfo.name
        : activeModelId || '未选择模型'
    const activeModelOptions = useMemo(() => {
        if (!activeLlmPluginInfo) return []
        return activeLlmPluginInfo.models.map(modelId => {
            const modelInfo = activeLlmPluginInfo.model_infos.find(item => item.id === modelId)
            return {
                id: modelId,
                label: modelInfo?.name && modelInfo.name !== modelId ? modelInfo.name : modelId,
                description: modelInfo?.description || (modelInfo?.name && modelInfo.name !== modelId ? modelId : ''),
            }
        })
    }, [activeLlmPluginInfo])
    const toolModeOptions = useMemo(() => AI_TOOL_ACCESS_OPTIONS.map(mode => ({
        mode,
        label: AI_TOOL_ACCESS_LABELS[mode],
        description: AI_TOOL_ACCESS_DETAILS[mode],
        disabled: mode === 'writer' && !writerModeAvailable,
    })), [writerModeAvailable])
    const conversationSettings = useMemo(
        () => normalizeConversationSettings(activeConversation?.settings),
        [activeConversation?.settings],
    )
    const normalizedConversationSearch = conversationSearch.trim().toLocaleLowerCase()
    const visibleConversations = useMemo(() => {
        return [...conversations]
            .filter(conversation => {
                if (conversationStatusFilter === 'active' && conversation.archivedAt) return false
                if (conversationStatusFilter === 'archived' && !conversation.archivedAt) return false
                if (!matchesConversationFilter(conversation, conversationFilter)) return false
                if (!normalizedConversationSearch) return true
                return buildConversationSearchText(conversation).includes(normalizedConversationSearch)
            })
            .sort(sortConversations)
    }, [conversationFilter, conversations, conversationStatusFilter, normalizedConversationSearch])
    const hasConversationSearch = normalizedConversationSearch.length > 0
    const pluginsLoading = !pluginsReady
    const llmUnavailable = pluginsReady && plugins.length === 0
    const pluginSelectionIncomplete = pluginsReady && plugins.length > 0 && (!selectedPlugin || !selectedModel)
    const llmApiKeyChecking = pluginsReady
        && !llmUnavailable
        && Boolean(activeLlmPluginId)
        && llmApiKeyAvailability === 'checking'
    const llmApiKeyMissing = pluginsReady
        && !llmUnavailable
        && Boolean(activeLlmPluginId)
        && llmApiKeyAvailability === 'missing'
    const isArchivedConversation = Boolean(activeConversation?.archivedAt)
    const conversationCreationDisabled = pluginsLoading
        || llmUnavailable
        || pluginSelectionIncomplete
        || llmApiKeyChecking
        || llmApiKeyMissing
    const inputDisabled = !activeConversation
        || isArchivedConversation
        || pluginsLoading
        || llmUnavailable
        || pluginSelectionIncomplete
        || llmApiKeyChecking
        || llmApiKeyMissing
    const inputPlaceholder = !activeConversation
        ? '先新建一个对话'
        : isArchivedConversation
            ? '已归档对话不可继续发送'
            : pluginsLoading
                ? '正在加载 LLM 插件…'
                : llmUnavailable
                    ? '请先配置 LLM 插件'
                    : pluginSelectionIncomplete
                        ? '请选择插件和模型'
                        : llmApiKeyChecking
                            ? '正在检查 API Key…'
                            : llmApiKeyMissing
                                ? '请先配置 API Key'
                                : '发消息或按住说话'

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({behavior: 'smooth'})
    }, [messages, streamingBlocks])

    useEffect(() => {
        if (conversations.length > 0 && !activeConversationId) {
            setActiveConversationId(conversations[0].id)
        }
    }, [conversations, activeConversationId, setActiveConversationId])

    useEffect(() => {
        setDrawerRoot(document.getElementById('mobile-ai-conversation-drawer-root'))
    }, [conversationDrawerOpen])

    useEffect(() => {
        return () => {
            const conversationLongPress = conversationLongPressRef.current
            if (conversationLongPress?.timerId != null) {
                window.clearTimeout(conversationLongPress.timerId)
            }
        }
    }, [])

    useEffect(() => {
        if (!pluginsReady || llmUnavailable || !activeLlmPluginId) {
            setLlmApiKeyAvailability('unknown')
            return
        }

        let cancelled = false
        setLlmApiKeyAvailability('checking')

        setting_has_api_key(activeLlmPluginId)
            .then(hasApiKey => {
                if (cancelled) return
                setLlmApiKeyAvailability(hasApiKey ? 'configured' : 'missing')
            })
            .catch(error => {
                logger.error('[MobileAiChat] API Key 状态检查失败', error)
                if (!cancelled) setLlmApiKeyAvailability('error')
            })

        return () => {
            cancelled = true
        }
    }, [activeLlmPluginId, apiKeyRefreshTick, llmUnavailable, pluginsReady])

    useEffect(() => {
        const refreshApiKeyState = () => setApiKeyRefreshTick(tick => tick + 1)
        const handleApiKeyChanged = (event: Event) => {
            const detail = (event as CustomEvent<{ pluginId?: string, hasApiKey?: boolean }>).detail
            if (detail?.pluginId && detail.pluginId !== activeLlmPluginId) return
            if (typeof detail?.hasApiKey === 'boolean') {
                setLlmApiKeyAvailability(detail.hasApiKey ? 'configured' : 'missing')
                return
            }
            refreshApiKeyState()
        }

        window.addEventListener('fc:api-key-changed', handleApiKeyChanged as EventListener)
        window.addEventListener('fc:plugins-changed', refreshApiKeyState)
        return () => {
            window.removeEventListener('fc:api-key-changed', handleApiKeyChanged as EventListener)
            window.removeEventListener('fc:plugins-changed', refreshApiKeyState)
        }
    }, [activeLlmPluginId])

    const handleToolModeChange = useCallback(async (mode: AiToolAccessMode) => {
        if (mode === toolAccessMode) return
        await setToolAccessMode(mode)
    }, [setToolAccessMode, toolAccessMode])

    const openMorePanel = useCallback(() => {
        setMorePanelOpen(true)
    }, [])

    const closeMorePanel = useCallback(() => {
        setMorePanelOpen(false)
    }, [])

    const closeModelMenu = useCallback(() => {
        setModelMenuOpen(false)
        setModelMenuMode('models')
    }, [])

    const handleToggleModelMenu = useCallback(() => {
        setTopMenuOpen(false)
        setModelMenuOpen(open => !open)
        setModelMenuMode('models')
    }, [])

    const handleSelectModel = useCallback(async (modelId: string) => {
        if (!activeLlmPluginId) return
        closeModelMenu()
        await switchActiveConversationModel(activeLlmPluginId, modelId)
    }, [activeLlmPluginId, closeModelMenu, switchActiveConversationModel])

    const handleSelectPlugin = useCallback(async (pluginId: string) => {
        const plugin = plugins.find(item => item.id === pluginId)
        if (!plugin) return
        const nextModel = plugin.default_model && plugin.models.includes(plugin.default_model)
            ? plugin.default_model
            : (plugin.models[0] ?? '')
        if (!nextModel) {
            await showAlert(`插件「${plugin.name}」没有可用模型。`, 'warning', 'nonInvasive', 1800)
            return
        }
        closeModelMenu()
        await switchActiveConversationModel(plugin.id, nextModel)
    }, [closeModelMenu, plugins, showAlert, switchActiveConversationModel])

    const updateConversationSetting = useCallback(<K extends keyof ConversationSettings>(
        key: K,
        value: ConversationSettings[K],
    ) => {
        if (!activeConversation) return
        void updateConversationSettings(activeConversation.id, {[key]: value} as Partial<ConversationSettings>)
    }, [activeConversation, updateConversationSettings])

    const handleSend = useCallback(async () => {
        if (!inputValue.trim() || isStreaming) return
        if (!activeConversation) {
            await showAlert('请先新建对话。', 'warning', 'nonInvasive', 1800)
            return
        }
        if (isArchivedConversation) {
            await showAlert('已归档对话不可继续发送。', 'warning', 'nonInvasive', 1800)
            return
        }
        if (pluginsLoading) {
            await showAlert('AI 插件仍在加载，请稍后再发送。', 'warning', 'nonInvasive', 1800)
            return
        }
        if (llmUnavailable) {
            await showAlert('当前没有可用的 LLM 插件，请先在设置中配置。', 'warning', 'nonInvasive', 2200)
            return
        }
        if (pluginSelectionIncomplete) {
            await showAlert('请先选择 LLM 插件和模型。', 'warning', 'nonInvasive', 1800)
            return
        }
        if (llmApiKeyChecking) {
            await showAlert('正在检查 API Key，请稍后再发送。', 'warning', 'nonInvasive', 1800)
            return
        }
        if (llmApiKeyMissing) {
            await showAlert(`请先在设置中配置 ${activeLlmPluginName} 的 API Key。`, 'warning', 'nonInvasive', 2200)
            return
        }
        await sendMessage(inputValue)
    }, [
        activeConversation,
        activeLlmPluginName,
        inputValue,
        isArchivedConversation,
        isStreaming,
        llmApiKeyChecking,
        llmApiKeyMissing,
        llmUnavailable,
        pluginSelectionIncomplete,
        pluginsLoading,
        sendMessage,
        showAlert,
    ])

    const handleNewConv = useCallback(async () => {
        setConversationActionTarget(null)
        await createNewConversation()
        closeMorePanel()
        onCloseConversationDrawer?.()
    }, [closeMorePanel, createNewConversation, onCloseConversationDrawer])

    const handleSelectConv = useCallback(async (convId: string) => {
        setConversationActionTarget(null)
        await switchConversation(convId)
        onCloseConversationDrawer?.()
    }, [onCloseConversationDrawer, switchConversation])

    const clearConversationLongPress = useCallback(() => {
        const state = conversationLongPressRef.current
        if (state?.timerId != null) {
            window.clearTimeout(state.timerId)
        }
        conversationLongPressRef.current = null
    }, [])

    const handleConversationItemClick = useCallback((convId: string) => {
        if (suppressConversationClickRef.current) {
            suppressConversationClickRef.current = false
            return
        }
        void handleSelectConv(convId)
    }, [handleSelectConv])

    const handleConversationLongPressStart = useCallback((
        conversation: Conversation,
        event: ReactPointerEvent<HTMLButtonElement>,
    ) => {
        if (event.pointerType === 'mouse' && event.button !== 0) return
        clearConversationLongPress()

        const pointerId = event.pointerId
        const state: ConversationLongPressState = {
            pointerId,
            conversation,
            startX: event.clientX,
            startY: event.clientY,
            ready: false,
            timerId: null,
        }
        state.timerId = window.setTimeout(() => {
            const current = conversationLongPressRef.current
            if (!current || current.pointerId !== pointerId) return
            current.ready = true
            current.timerId = null
        }, CONVERSATION_LONG_PRESS_DELAY)
        conversationLongPressRef.current = state
        event.currentTarget.setPointerCapture?.(pointerId)
    }, [clearConversationLongPress])

    const handleConversationLongPressMove = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
        const state = conversationLongPressRef.current
        if (!state || state.pointerId !== event.pointerId) return
        const dx = Math.abs(event.clientX - state.startX)
        const dy = Math.abs(event.clientY - state.startY)
        if (dx > CONVERSATION_LONG_PRESS_MOVE_TOLERANCE || dy > CONVERSATION_LONG_PRESS_MOVE_TOLERANCE) {
            clearConversationLongPress()
        }
    }, [clearConversationLongPress])

    const handleConversationLongPressEnd = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
        const state = conversationLongPressRef.current
        if (!state || state.pointerId !== event.pointerId) return
        const shouldOpenMenu = state.ready
        clearConversationLongPress()
        if (!shouldOpenMenu) return
        event.preventDefault()
        event.stopPropagation()
        suppressConversationClickRef.current = true
        setConversationActionTarget(state.conversation)
    }, [clearConversationLongPress])

    const handleConversationContextMenu = useCallback((
        conversation: Conversation,
        event: ReactMouseEvent<HTMLButtonElement>,
    ) => {
        event.preventDefault()
        suppressConversationClickRef.current = true
        setConversationActionTarget(conversation)
    }, [])

    const handleDeleteConv = useCallback(async (convId: string, event?: ReactMouseEvent) => {
        event?.stopPropagation()
        const result = await showAlert('确定删除此对话？此操作不可撤销。', 'warning', 'confirm')
        if (result !== 'yes') return
        setTopMenuOpen(false)
        setConversationActionTarget(null)
        await deleteConversation(convId)
    }, [deleteConversation, showAlert])

    const handleRenameConfirm = useCallback(async (title: string) => {
        if (!renameTarget) return
        setRenaming(true)
        try {
            await renameConversation(renameTarget.id, title)
            setRenameTarget(null)
        } finally {
            setRenaming(false)
        }
    }, [renameConversation, renameTarget])

    const handleExportConversation = useCallback(async (
        conversation: Conversation,
        format: ConversationExportFormat,
    ) => {
        setConversationActionTarget(null)

        if (conversation.id.startsWith('conv_')) {
            await showAlert('这条会话尚未写入历史，发送消息后再导出。', 'warning', 'nonInvasive', 2200)
            return
        }

        const isJson = format === 'json'
        const selectedPath = await saveFileDialog({
            defaultPath: buildConversationExportFileName(conversation, format),
            filters: [{
                name: isJson ? 'JSON' : 'Markdown',
                extensions: [isJson ? 'json' : 'md'],
            }],
        })

        if (!selectedPath) return

        try {
            await ai_export_conversation(conversation.id, selectedPath, format)
            await showAlert(`会话已导出为 ${isJson ? 'JSON' : 'Markdown'}。`, 'success', 'nonInvasive', 1000)
        } catch (error) {
            await showAlert(`导出会话失败：${formatApiError(toApiError(error))}`, 'error', 'nonInvasive', 2600)
        }
    }, [showAlert])

    const handleUnavailableMobileAiTool = useCallback((label: string) => {
        void showAlert(`移动端暂未开放「${label}」入口。`, 'info', 'nonInvasive', 1800)
    }, [showAlert])

    const activeConversationMenuItems: MobileAnchoredMenuItem[] = activeConversation ? [
        {
            key: 'pin',
            label: activeConversation.pinnedAt ? '取消顶置' : '顶置对话',
            description: activeConversation.pinnedAt ? '恢复到普通排序' : '固定在对话列表顶部',
            icon: <MobileAiIcon type="pin"/>,
            onSelect: () => toggleConversationPinned(activeConversation.id),
        },
        {
            key: 'archive',
            label: activeConversation.archivedAt ? '取消归档' : '归档对话',
            description: activeConversation.archivedAt ? '恢复继续对话' : '收起但保留历史',
            icon: <MobileAiIcon type="archive"/>,
            onSelect: () => toggleConversationArchived(activeConversation.id),
        },
        {
            key: 'rename',
            label: '重命名',
            description: '修改当前会话名称',
            icon: <MobileAiIcon type="rename"/>,
            onSelect: () => setRenameTarget(activeConversation),
        },
        {
            key: 'export-markdown',
            label: '导出 Markdown',
            description: activeConversation.id.startsWith('conv_') ? '发送消息后可导出' : '保存为 .md 文件',
            icon: <MobileAiIcon type="file"/>,
            disabled: activeConversation.id.startsWith('conv_'),
            onSelect: () => void handleExportConversation(activeConversation, 'markdown'),
        },
        {
            key: 'export-json',
            label: '导出 JSON',
            description: activeConversation.id.startsWith('conv_') ? '发送消息后可导出' : '保存为 .json 文件',
            icon: <MobileAiIcon type="file"/>,
            disabled: activeConversation.id.startsWith('conv_'),
            onSelect: () => void handleExportConversation(activeConversation, 'json'),
        },
        {
            key: 'delete',
            label: '删除对话',
            description: '永久删除当前会话',
            icon: <MobileAiIcon type="delete"/>,
            danger: true,
            onSelect: () => void handleDeleteConv(activeConversation.id),
        },
    ] : []

    const conversationActionMenuItems = conversationActionTarget ? [
        {
            key: 'pin',
            label: conversationActionTarget.pinnedAt ? '取消顶置' : '顶置',
            onSelect: () => toggleConversationPinned(conversationActionTarget.id),
        },
        {
            key: 'archive',
            label: conversationActionTarget.archivedAt ? '取消归档' : '归档',
            onSelect: () => toggleConversationArchived(conversationActionTarget.id),
        },
        {
            key: 'rename',
            label: '重命名',
            onSelect: () => setRenameTarget(conversationActionTarget),
        },
        {
            key: 'export-markdown',
            label: '导出 Markdown',
            disabled: conversationActionTarget.id.startsWith('conv_'),
            onSelect: () => void handleExportConversation(conversationActionTarget, 'markdown'),
        },
        {
            key: 'export-json',
            label: '导出 JSON',
            disabled: conversationActionTarget.id.startsWith('conv_'),
            onSelect: () => void handleExportConversation(conversationActionTarget, 'json'),
        },
        {
            key: 'delete',
            label: '删除',
            danger: true,
            onSelect: () => void handleDeleteConv(conversationActionTarget.id),
        },
    ] : []

    const conversationControls = (
        <div className="mobile-ai-settings-card" aria-label="对话属性设置">
            <div className="mobile-ai-settings-card__title">
                <span>对话属性</span>
                {activeConversation?.archivedAt ? <small>已归档</small> : null}
            </div>
            <div className="mobile-ai-settings-grid">
                <label className="mobile-ai-setting-field">
                    <span>温度</span>
                    <input
                        type="number"
                        min={0}
                        max={CONVERSATION_TEMPERATURE_MAX}
                        step={0.1}
                        value={conversationSettings.temperature}
                        disabled={!activeConversation}
                        onChange={event => updateConversationSetting('temperature', Number(event.currentTarget.value))}
                    />
                </label>
                <label className="mobile-ai-setting-field">
                    <span>top_p</span>
                    <input
                        type="number"
                        min={0}
                        max={1}
                        step={0.05}
                        value={conversationSettings.topP}
                        disabled={!activeConversation}
                        onChange={event => updateConversationSetting('topP', Number(event.currentTarget.value))}
                    />
                </label>
            </div>
            <div className="mobile-ai-setting-penalty-grid">
                <div className="mobile-ai-setting-penalty-card">
                    <label className="mobile-ai-setting-toggle">
                        <span>
                            <strong>重复惩罚</strong>
                            <small>降低重复用词</small>
                        </span>
                        <input
                            type="checkbox"
                            checked={conversationSettings.frequencyPenaltyEnabled}
                            disabled={!activeConversation}
                            onChange={event => updateConversationSetting('frequencyPenaltyEnabled', event.currentTarget.checked)}
                        />
                    </label>
                    <label className="mobile-ai-setting-field">
                        <span>强度</span>
                        <input
                            type="number"
                            min={-2}
                            max={2}
                            step={0.1}
                            value={conversationSettings.frequencyPenalty}
                            disabled={!activeConversation || !conversationSettings.frequencyPenaltyEnabled}
                            onChange={event => updateConversationSetting('frequencyPenalty', Number(event.currentTarget.value))}
                        />
                    </label>
                </div>
                <div className="mobile-ai-setting-penalty-card">
                    <label className="mobile-ai-setting-toggle">
                        <span>
                            <strong>存在惩罚</strong>
                            <small>鼓励引入新内容</small>
                        </span>
                        <input
                            type="checkbox"
                            checked={conversationSettings.presencePenaltyEnabled}
                            disabled={!activeConversation}
                            onChange={event => updateConversationSetting('presencePenaltyEnabled', event.currentTarget.checked)}
                        />
                    </label>
                    <label className="mobile-ai-setting-field">
                        <span>强度</span>
                        <input
                            type="number"
                            min={-2}
                            max={2}
                            step={0.1}
                            value={conversationSettings.presencePenalty}
                            disabled={!activeConversation || !conversationSettings.presencePenaltyEnabled}
                            onChange={event => updateConversationSetting('presencePenalty', Number(event.currentTarget.value))}
                        />
                    </label>
                </div>
            </div>
            <label className="mobile-ai-setting-prompt">
                <span>当前对话独有提示词</span>
                <textarea
                    value={conversationSettings.systemPrompt}
                    disabled={!activeConversation}
                    onChange={event => updateConversationSetting('systemPrompt', event.currentTarget.value)}
                    placeholder="例如：保持回答简洁，优先延续当前世界观设定。"
                />
            </label>
        </div>
    )

    const conversationDrawer = (
        <aside className="mobile-ai-drawer" aria-label="对话列表">
            <div className="mobile-ai-drawer__header">
                <span>对话列表</span>
                <small>{visibleConversations.length}/{conversations.length} 个会话</small>
            </div>
            <label className="mobile-ai-drawer__search">
                <span aria-hidden="true">⌕</span>
                <input
                    value={conversationSearch}
                    onChange={event => setConversationSearch(event.currentTarget.value)}
                    placeholder="搜索对话..."
                />
            </label>
            <div className="mobile-ai-drawer__filter-groups">
                <div className="mobile-ai-drawer__filter-group">
                    <span>状态</span>
                    <div className="mobile-ai-drawer__segmented" role="group" aria-label="AI 对话状态">
                        {AI_CONVERSATION_STATUS_OPTIONS.map(option => (
                            <button
                                key={option.key}
                                type="button"
                                className={conversationStatusFilter === option.key ? 'active' : ''}
                                aria-pressed={conversationStatusFilter === option.key}
                                onClick={() => setConversationStatusFilter(option.key)}
                            >
                                {option.label}
                            </button>
                        ))}
                    </div>
                </div>
                <div className="mobile-ai-drawer__filter-group">
                    <span>类型</span>
                    <div className="mobile-ai-drawer__segmented" role="group" aria-label="AI 对话类型">
                        {AI_CONVERSATION_FILTER_OPTIONS.map(option => (
                            <button
                                key={option.key}
                                type="button"
                                className={conversationFilter === option.key ? 'active' : ''}
                                aria-pressed={conversationFilter === option.key}
                                onClick={() => setConversationFilter(option.key)}
                            >
                                {option.label}
                            </button>
                        ))}
                    </div>
                </div>
                <button
                    type="button"
                    className="mobile-ai-drawer__new"
                    disabled={conversationCreationDisabled}
                    onClick={() => void handleNewConv()}
                >
                    <span aria-hidden="true">+</span>
                    <span>新对话</span>
                </button>
            </div>
            <div className="mobile-ai-drawer__list">
                {visibleConversations.length === 0 ? (
                    <div className="mobile-ai-drawer__empty">
                        {conversations.length === 0
                            ? '暂无历史对话'
                            : hasConversationSearch
                                ? '没有匹配的对话'
                                : conversationStatusFilter === 'archived'
                                    ? '暂无归档对话'
                                    : '当前类型下没有对话'}
                    </div>
                ) : visibleConversations.map(conversation => {
                    const runtime = conversationRuntime[conversation.id]
                    const isConversationStreaming = Boolean(runtime?.isStreaming)
                    const hasUnreadReply = Boolean(runtime?.hasUnreadReply)
                    const tags = [
                        conversation.pinnedAt ? '已顶置' : null,
                        conversation.archivedAt ? '已归档' : null,
                        conversation.mode === 'character' ? '角色对话' : null,
                        conversation.mode === 'report' ? '矛盾检测' : null,
                    ].filter(Boolean).join(' · ')
                    return (
                        <div
                            key={conversation.id}
                            className={`mobile-ai-drawer__item${conversation.id === activeConversationId ? ' active' : ''}${conversation.mode === 'character' ? ' is-character' : ''}${conversation.mode === 'report' ? ' is-report' : ''}${conversation.pinnedAt ? ' is-pinned' : ''}${conversation.archivedAt ? ' is-archived' : ''}${isConversationStreaming ? ' is-streaming' : ''}${hasUnreadReply ? ' has-unread-reply' : ''}`}
                        >
                            <button
                                type="button"
                                className="mobile-ai-drawer__item-content"
                                onClick={() => handleConversationItemClick(conversation.id)}
                                onPointerDown={event => handleConversationLongPressStart(conversation, event)}
                                onPointerMove={handleConversationLongPressMove}
                                onPointerUp={handleConversationLongPressEnd}
                                onPointerCancel={clearConversationLongPress}
                                onContextMenu={event => handleConversationContextMenu(conversation, event)}
                            >
                                <span className="mobile-ai-drawer__item-main">
                                    <strong>{conversation.title}</strong>
                                    {tags ? <small>{tags}</small> : null}
                                </span>
                                <span className="mobile-ai-drawer__item-meta">
                                    {formatConversationDate(conversation.timestamp)}
                                </span>
                            </button>
                            <button
                                type="button"
                                className="mobile-ai-drawer__item-more"
                                aria-label={`打开「${conversation.title}」的操作菜单`}
                                aria-haspopup="menu"
                                aria-expanded={conversationActionTarget?.id === conversation.id}
                                onClick={() => setConversationActionTarget(conversation)}
                            >
                                <span aria-hidden="true">•••</span>
                            </button>
                        </div>
                    )
                })}
            </div>
        </aside>
    )

    return (
        <div ref={pageRef} className="mobile-ai-chat">
            {drawerRoot ? createPortal(conversationDrawer, drawerRoot) : null}
            <header className="mobile-ai-chat__topbar">
                <div className="mobile-ai-chat__left-actions">
                    <MobileTopIconButton
                        type="button"
                        icon={<MobileAiIcon type="menu"/>}
                        aria-label="打开对话列表"
                        aria-expanded={conversationDrawerOpen}
                        onClick={onOpenConversationDrawer}
                    />
                    <button
                        ref={modelMenuRef}
                        type="button"
                        className="mobile-ai-model-pill"
                        aria-haspopup="menu"
                        aria-expanded={modelMenuOpen}
                        disabled={pluginsLoading}
                        onClick={handleToggleModelMenu}
                    >
                        <span>{pluginsLoading ? '加载模型中' : activeModelLabel}</span>
                        <svg viewBox="0 0 12 12" aria-hidden="true" focusable="false">
                            <path d={modelMenuOpen ? 'M2.5 7.5 6 4l3.5 3.5' : 'M2.5 4.5 6 8l3.5-3.5'}/>
                        </svg>
                    </button>
                </div>
                <MobileTopActionPill
                    ref={topActionsRef}
                    actions={[
                        {
                            key: 'new',
                            label: '新建对话',
                            icon: '+',
                            kind: 'add',
                            disabled: conversationCreationDisabled,
                            onClick: () => void handleNewConv(),
                        },
                        {
                            key: 'menu',
                            label: '对话操作',
                            icon: '…',
                            kind: 'more',
                            ariaHasPopup: 'menu',
                            ariaExpanded: topMenuOpen,
                            disabled: !activeConversation,
                            onClick: () => {
                                closeModelMenu()
                                setTopMenuOpen(open => !open)
                            },
                        },
                    ]}
                />
            </header>

            <main className="mobile-ai-chat__messages">
                {messages.length === 0 && !isStreaming && (
                    <div className="mobile-ai-chat__empty">
                        <p>开始 AI 对话</p>
                        <span>{focusContext.entryId ? '围绕当前词条继续创作。' : '与 AI 讨论世界观设定、资料整理和后续创作。'}</span>
                        {!activeConversation && (
                            <Button type="button" onClick={() => void handleNewConv()} disabled={conversationCreationDisabled}>
                                开始新对话
                            </Button>
                        )}
                        {llmUnavailable || llmApiKeyMissing ? (
                            <Button type="button" variant="outline" onClick={() => navigateToTab('settings')}>
                                {llmApiKeyMissing ? '配置 API Key' : '去设置插件'}
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

            <footer className="mobile-ai-chat__composer">
                <div className="mobile-ai-composer-card">
                    <textarea
                        value={inputValue}
                        onChange={event => setInputValue(event.target.value)}
                        onKeyDown={event => {
                            if (event.key === 'Enter' && !event.shiftKey) {
                                event.preventDefault()
                                void handleSend()
                            }
                        }}
                        placeholder={inputPlaceholder}
                        rows={1}
                        disabled={inputDisabled && !isStreaming}
                    />
                    <div className="mobile-ai-composer-card__bar">
                        <div className="mobile-ai-composer-card__chips">
                            <button
                                type="button"
                                className={`mobile-ai-composer-card__chip${sessionParams.thinking ? ' active' : ''}`}
                                disabled={isStreaming}
                                onClick={() => setSessionParams(current => ({...current, thinking: !current.thinking}))}
                            >
                                <MobileAiIcon type="thinking"/>
                                <span>思考</span>
                            </button>
                            <button
                                type="button"
                                className={`mobile-ai-composer-card__chip${webSearchEnabled ? ' active' : ''}`}
                                disabled={isStreaming}
                                onClick={() => void toggleWebSearch()}
                            >
                                <MobileAiIcon type="web"/>
                                <span>搜索</span>
                            </button>
                        </div>
                        <div className="mobile-ai-composer-card__actions">
                            <button
                                type="button"
                                className="mobile-ai-composer-card__icon-btn"
                                aria-label="更多"
                                aria-expanded={morePanelOpen}
                                onClick={morePanelOpen ? closeMorePanel : openMorePanel}
                            >
                                +
                            </button>
                            <button
                                type="button"
                                className="mobile-ai-composer-card__icon-btn mobile-ai-composer-card__icon-btn--send"
                                aria-label={isStreaming ? '停止生成' : '发送'}
                                onClick={isStreaming ? stopStreaming : () => void handleSend()}
                                disabled={!isStreaming && (!inputValue.trim() || inputDisabled)}
                            >
                                <MobileAiIcon type={isStreaming ? 'stop' : 'send'}/>
                            </button>
                        </div>
                    </div>
                </div>
            </footer>

            <MobileAnchoredMenu
                open={modelMenuOpen}
                onClose={closeModelMenu}
                anchorRef={modelMenuRef}
                containerRef={pageRef}
                ariaLabel={modelMenuMode === 'plugins' ? '切换 AI 插件' : '切换 AI 模型'}
                className="mobile-ai-model-menu"
            >
                {modelMenuMode === 'models' ? (
                    <div className="mobile-anchored-menu__group">
                        <button
                            type="button"
                            role="menuitem"
                            className="mobile-anchored-menu__row mobile-ai-model-menu__row"
                            disabled={plugins.length === 0}
                            onClick={() => setModelMenuMode('plugins')}
                        >
                            <span className="mobile-anchored-menu__check" aria-hidden="true"/>
                            <span className="mobile-anchored-menu__icon" aria-hidden="true">
                                <MobileAiIcon type="plugin"/>
                            </span>
                            <span className="mobile-anchored-menu__text">
                                <span>切换插件</span>
                                <small>{activeLlmPluginName}</small>
                            </span>
                        </button>
                        <div className="mobile-ai-model-menu__divider" role="presentation"/>
                        {activeModelOptions.length === 0 ? (
                            <button
                                type="button"
                                role="menuitem"
                                className="mobile-anchored-menu__row mobile-ai-model-menu__row"
                                disabled
                            >
                                <span className="mobile-anchored-menu__check" aria-hidden="true"/>
                                <span className="mobile-anchored-menu__icon" aria-hidden="true"/>
                                <span className="mobile-anchored-menu__text">
                                    <span>没有可用模型</span>
                                    <small>请先在设置中配置插件</small>
                                </span>
                            </button>
                        ) : activeModelOptions.map(model => (
                            <button
                                key={model.id}
                                type="button"
                                role="menuitemradio"
                                aria-checked={model.id === activeModelId}
                                className={`mobile-anchored-menu__row mobile-ai-model-menu__row${model.id === activeModelId ? ' active' : ''}`}
                                disabled={isStreaming}
                                onClick={() => void handleSelectModel(model.id)}
                            >
                                <span className="mobile-anchored-menu__check" aria-hidden="true"/>
                                <span className="mobile-anchored-menu__icon" aria-hidden="true"/>
                                <span className="mobile-anchored-menu__text">
                                    <span>{model.label}</span>
                                    {model.description ? <small>{model.description}</small> : null}
                                </span>
                            </button>
                        ))}
                    </div>
                ) : (
                    <div className="mobile-anchored-menu__group">
                        {plugins.length === 0 ? (
                            <button
                                type="button"
                                role="menuitem"
                                className="mobile-anchored-menu__row mobile-ai-model-menu__row"
                                disabled
                            >
                                <span className="mobile-anchored-menu__check" aria-hidden="true"/>
                                <span className="mobile-anchored-menu__icon" aria-hidden="true"/>
                                <span className="mobile-anchored-menu__text">
                                    <span>没有可用插件</span>
                                    <small>请先在设置中安装 LLM 插件</small>
                                </span>
                            </button>
                        ) : plugins.map(plugin => {
                            const nextModel = plugin.default_model && plugin.models.includes(plugin.default_model)
                                ? plugin.default_model
                                : (plugin.models[0] ?? '')
                            return (
                                <button
                                    key={plugin.id}
                                    type="button"
                                    role="menuitemradio"
                                    aria-checked={plugin.id === activeLlmPluginId}
                                    className={`mobile-anchored-menu__row mobile-ai-model-menu__row${plugin.id === activeLlmPluginId ? ' active' : ''}`}
                                    disabled={isStreaming || !nextModel}
                                    onClick={() => void handleSelectPlugin(plugin.id)}
                                >
                                    <span className="mobile-anchored-menu__check" aria-hidden="true"/>
                                    <span className="mobile-anchored-menu__icon" aria-hidden="true">
                                        <MobileAiIcon type="plugin"/>
                                    </span>
                                    <span className="mobile-anchored-menu__text">
                                        <span>{plugin.name}</span>
                                        <small>{nextModel || '没有可用模型'}</small>
                                    </span>
                                </button>
                            )
                        })}
                    </div>
                )}
            </MobileAnchoredMenu>

            <MobileAnchoredActionMenu
                open={topMenuOpen}
                onClose={() => setTopMenuOpen(false)}
                anchorRef={topActionsRef}
                containerRef={pageRef}
                ariaLabel="对话操作"
                items={activeConversationMenuItems}
            />

            <MobileBottomSheet
                open={morePanelOpen}
                onClose={closeMorePanel}
                ariaLabel="更多对话设置"
                className="mobile-ai-more-sheet"
            >
                <div className="mobile-ai-more-sheet__quick" aria-label="添加内容">
                    <button type="button" onClick={() => handleUnavailableMobileAiTool('相机')}>
                        <MobileAiIcon type="camera"/>
                        <span>相机</span>
                    </button>
                    <button type="button" onClick={() => handleUnavailableMobileAiTool('图库')}>
                        <MobileAiIcon type="image"/>
                        <span>图库</span>
                    </button>
                    <button type="button" onClick={() => handleUnavailableMobileAiTool('文件')}>
                        <MobileAiIcon type="file"/>
                        <span>文件</span>
                    </button>
                </div>
                <button
                    type="button"
                    className={`mobile-ai-more-switch${webSearchEnabled ? ' active' : ''}`}
                    aria-pressed={webSearchEnabled}
                    onClick={() => void toggleWebSearch()}
                >
                    <span className="mobile-ai-more-switch__main">
                        <MobileAiIcon type="web"/>
                        <span>
                            <strong>联网搜索</strong>
                            <small>允许 AI 调用联网搜索工具</small>
                        </span>
                    </span>
                    <span className="mobile-ai-more-switch__toggle" aria-hidden="true"/>
                </button>
                <div className="mobile-ai-more-mode" aria-label="模式切换">
                    <div className="mobile-ai-tool-mode-options">
                        {toolModeOptions.map(option => (
                            <button
                                key={option.mode}
                                type="button"
                                className={`mobile-ai-tool-mode-option${toolAccessMode === option.mode ? ' active' : ''}`}
                                aria-pressed={toolAccessMode === option.mode}
                                disabled={option.disabled || isStreaming}
                                onClick={() => void handleToolModeChange(option.mode)}
                            >
                                <span>{option.label}</span>
                                <small>{option.description}</small>
                            </button>
                        ))}
                    </div>
                </div>
                {conversationControls}
            </MobileBottomSheet>

            <ActionMenu
                open={!!conversationActionTarget}
                onClose={() => setConversationActionTarget(null)}
                title={conversationActionTarget?.title}
                ariaLabel="对话操作菜单"
                items={conversationActionMenuItems}
            />

            <RenameDialog
                open={!!renameTarget}
                title="重命名对话"
                initialValue={renameTarget?.title ?? ''}
                placeholder="对话名称"
                busy={renaming}
                onClose={() => setRenameTarget(null)}
                onConfirm={(title) => void handleRenameConfirm(title)}
            />
        </div>
    )
}
