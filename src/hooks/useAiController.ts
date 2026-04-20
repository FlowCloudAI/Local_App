import {useCallback, useEffect, useMemo, useRef, useState} from 'react'
import {listen} from '@tauri-apps/api/event'
import {
    ai_close_session,
    ai_delete_conversation,
    ai_disable_tool,
    ai_enable_tool,
    ai_get_conversation,
    ai_list_conversations,
    ai_list_plugins,
    ai_list_tools,
    ai_rename_conversation,
    ai_set_task_context,
    ai_update_session,
    type Category,
    type CharacterChatCategorySnapshot,
    type CharacterChatEntrySnapshot,
    type CharacterChatProjectSnapshot,
    type CharacterChatRelationSnapshot,
    type CharacterChatTagSchemaSnapshot,
    db_get_entry,
    db_get_project,
    db_list_categories,
    db_list_entries,
    db_list_relations_for_project,
    db_list_tag_schemas,
    type Entry,
    ENTRY_UPDATED,
    type EntryRelation,
    type EntryTag,
    type EntryUpdatedEvent,
    type PluginInfo,
    type StoredMessage,
    type TagSchema,
    type TaskContextPayload,
    type ToolStatus,
} from '../api'
import {type SessionMessage, useAiSession} from './useAiSession'
import type {AiContextValue, Conversation, Message, SessionParams} from '../contexts/AiControllerTypes'
import {getCoverImage, normalizeEntryImages, toEntryImageSrc} from '../components/utils/entryImage'
import {normalizeComparableType, normalizeEntryContent} from '../components/utils/entryCommon'
import {readCharacterVoiceConfigFromTags} from '../components/utils/characterVoice'

const generateTitleFromMessage = (content: string): string => {
    const cleaned = content.trim().replace(/\s+/g, ' ')
    if (cleaned.length <= 20) return cleaned
    return `${cleaned.slice(0, 20)}...`
}

const runtimeConversationKey = (sessionId: string, runId: string) => `${sessionId}::${runId}`
const PROJECT_SCAN_LIMIT = 1000
const CHARACTER_CONTENT_LIMIT = 8000
const ENTRY_CONTENT_LIMIT = 2400
const ENTRY_SUMMARY_LIMIT = 600
const RELATION_CONTENT_LIMIT = 400
const TAG_VALUE_LIMIT = 160

function truncateText(value: string | null | undefined, limit: number): string {
    if (typeof value !== 'string') return ''
    const normalized = value.trim()
    if (!normalized) return ''
    return normalized.length > limit ? `${normalized.slice(0, limit)}…` : normalized
}

function buildCategoryPathMap(categories: Category[]): Map<string, string[]> {
    const categoryMap = new Map(categories.map((category) => [category.id, category]))
    const pathMap = new Map<string, string[]>()

    const resolvePath = (categoryId: string | null | undefined): string[] => {
        if (!categoryId) return []
        const cached = pathMap.get(categoryId)
        if (cached) return cached

        const path: string[] = []
        const visited = new Set<string>()
        let currentId: string | null = categoryId
        while (currentId) {
            if (visited.has(currentId)) break
            visited.add(currentId)
            const current = categoryMap.get(currentId)
            if (!current) break
            path.unshift(current.name)
            currentId = current.parent_id ?? null
        }
        pathMap.set(categoryId, path)
        return path
    }

    categories.forEach((category) => resolvePath(category.id))
    return pathMap
}

function stringifyTagValue(value: EntryTag['value']): string {
    if (value == null) return ''
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        return truncateText(String(value), TAG_VALUE_LIMIT)
    }
    return ''
}

function mapTagSchemas(schemas: TagSchema[]): CharacterChatTagSchemaSnapshot[] {
    return schemas.map((schema) => ({
        id: schema.id,
        name: schema.name,
        description: schema.description ?? null,
        type: schema.type,
        target: schema.target,
    }))
}

function mapRelations(relations: EntryRelation[]): CharacterChatRelationSnapshot[] {
    return relations.map((relation) => ({
        id: relation.id,
        fromEntryId: relation.a_id,
        toEntryId: relation.b_id,
        relation: relation.relation,
        content: truncateText(relation.content, RELATION_CONTENT_LIMIT),
    }))
}

function mapEntrySnapshot(entry: Entry, categoryPathMap: Map<string, string[]>, contentLimit: number): CharacterChatEntrySnapshot {
    return {
        id: entry.id,
        title: entry.title,
        summary: truncateText(entry.summary ?? '', ENTRY_SUMMARY_LIMIT) || null,
        content: truncateText(normalizeEntryContent(entry), contentLimit) || null,
        entryType: normalizeComparableType(entry.type),
        categoryId: entry.category_id ?? null,
        categoryPath: categoryPathMap.get(entry.category_id ?? '') ?? [],
        tags: (entry.tags ?? [])
            .map((tag) => {
                const value = stringifyTagValue(tag.value)
                return {
                    schemaId: tag.schema_id ?? null,
                    name: tag.name ?? tag.schema_id ?? '未命名标签',
                    value,
                }
            })
            .filter((tag) => tag.value),
    }
}

async function buildCharacterProjectSnapshot(projectId: string, entryId: string): Promise<{
    snapshot: CharacterChatProjectSnapshot
    characterEntry: Entry
    backgroundImageUrl: string | null
    characterVoiceId: string | null
    characterAutoPlay: boolean | null
}> {
    const [project, categories, tagSchemas, entryBriefs, relations, characterEntry] = await Promise.all([
        db_get_project(projectId),
        db_list_categories(projectId),
        db_list_tag_schemas(projectId),
        db_list_entries({projectId, limit: PROJECT_SCAN_LIMIT, offset: 0}),
        db_list_relations_for_project(projectId),
        db_get_entry(entryId),
    ])

    const detailResults = await Promise.all(
        entryBriefs.map(async (brief) => {
            try {
                return await db_get_entry(brief.id)
            } catch {
                return null
            }
        }),
    )
    const allEntries = detailResults.filter((item): item is Entry => Boolean(item))
    const categoryPathMap = buildCategoryPathMap(categories)
    const targetSnapshot = mapEntrySnapshot(characterEntry, categoryPathMap, CHARACTER_CONTENT_LIMIT)
    const entrySnapshots = allEntries.map((entry) => (
        entry.id === characterEntry.id
            ? targetSnapshot
            : mapEntrySnapshot(entry, categoryPathMap, ENTRY_CONTENT_LIMIT)
    ))
    const backgroundImageUrl = toEntryImageSrc(getCoverImage(normalizeEntryImages(characterEntry.images))) ?? null
    const characterVoiceConfig = readCharacterVoiceConfigFromTags(characterEntry.tags)

    return {
        snapshot: {
            project: {
                id: project.id,
                name: project.name,
                description: truncateText(project.description ?? '', ENTRY_SUMMARY_LIMIT) || null,
            },
            targetCharacter: targetSnapshot,
            categories: categories.map((category): CharacterChatCategorySnapshot => ({
                id: category.id,
                name: category.name,
                parentId: category.parent_id ?? null,
                path: categoryPathMap.get(category.id) ?? [category.name],
            })),
            tagSchemas: mapTagSchemas(tagSchemas),
            entries: entrySnapshots,
            relations: mapRelations(relations),
        },
        characterEntry,
        backgroundImageUrl,
        characterVoiceId: characterVoiceConfig.voiceId,
        characterAutoPlay: characterVoiceConfig.autoPlay,
    }
}

const storedToMessages = (messages: StoredMessage[]): Message[] => {
    const result: Message[] = []
    let pendingAssistant: Message | null = null

    const flushPendingAssistant = () => {
        if (!pendingAssistant) return
        if (pendingAssistant.blocks && pendingAssistant.blocks.length > 0) {
            result.push(pendingAssistant)
        }
        pendingAssistant = null
    }

    const ensureAssistant = (message: StoredMessage, index: number) => {
        if (!pendingAssistant) {
            pendingAssistant = {
                id: message.message_id ?? `loaded_assistant_${index}_${Date.now()}`,
                role: 'assistant',
                content: '',
                timestamp: new Date(message.timestamp).getTime(),
                nodeId: message.node_id ?? undefined,
                blocks: [],
            }
        }
        return pendingAssistant
    }

    messages.forEach((message, index) => {
        if (message.role === 'user') {
            flushPendingAssistant()
        }

        if (message.role === 'tool') {
            const assistant = pendingAssistant
            if (!assistant?.blocks) return
            const toolBlockIndex = assistant.blocks.findIndex((block) => {
                if (block.type !== 'tool') return false
                return block.tool.result == null
            })
            if (toolBlockIndex === -1) return

            const nextBlocks = [...assistant.blocks]
            const block = nextBlocks[toolBlockIndex]
            if (block.type === 'tool') {
                nextBlocks[toolBlockIndex] = {
                    ...block,
                    tool: {
                        ...block.tool,
                        result: message.content ?? '',
                        isError: false,
                    },
                }
                pendingAssistant = {...assistant, blocks: nextBlocks}
            }
            return
        }

        if (message.role === 'assistant') {
            const assistant = ensureAssistant(message, index)
            const nextBlocks = [...(assistant.blocks ?? [])]

            if (message.reasoning) {
                nextBlocks.push({type: 'reasoning', content: message.reasoning})
            }
            if (message.tool_calls && message.tool_calls.length > 0) {
                message.tool_calls.forEach((toolCall) => {
                    nextBlocks.push({
                        type: 'tool',
                        tool: {
                            index: toolCall.index,
                            name: toolCall.function?.name ?? toolCall.name ?? '',
                            args: toolCall.function?.arguments ?? toolCall.arguments ?? '',
                        },
                        detail: 'verbose',
                    })
                })
            }
            if (message.content) {
                nextBlocks.push({type: 'content', content: message.content, markdown: true})
            }

            pendingAssistant = {
                ...assistant,
                content: assistant.content + (message.content ?? ''),
                reasoning: assistant.reasoning
                    ? `${assistant.reasoning}${message.reasoning ?? ''}`
                    : (message.reasoning || undefined),
                timestamp: new Date(message.timestamp).getTime(),
                nodeId: message.node_id ?? assistant.nodeId,
                blocks: nextBlocks,
            }
            return
        }

        const base: Message = {
            id: message.message_id ?? `loaded_${index}_${Date.now()}`,
            role: message.role as 'user' | 'assistant',
            content: message.content ?? '',
            reasoning: message.reasoning || undefined,
            timestamp: new Date(message.timestamp).getTime(),
            nodeId: message.node_id ?? undefined,
        }

        if (message.content) {
            base.blocks = [{type: 'content', content: message.content}]
        }

        result.push(base)
    })

    flushPendingAssistant()
    return result
}

export interface AiFocus {
    projectId: string | null
    entryId: string | null
}

export function useAiController(focus: AiFocus): AiContextValue {
    const [plugins, setPlugins] = useState<PluginInfo[]>([])
    const [selectedPlugin, setSelectedPlugin] = useState('')
    const [selectedModel, setSelectedModel] = useState('')

    const [conversations, setConversations] = useState<Conversation[]>([])
    const [activeConversationId, setActiveConversationId] = useState<string | null>(null)
    const [sidebarCollapsed, setSidebarCollapsed] = useState(true)
    const [autoScroll, setAutoScroll] = useState(true)

    const [inputValue, setInputValue] = useState('')
    const [editingMessageId, setEditingMessageId] = useState<string | null>(null)
    const [sessionParams, setSessionParams] = useState<SessionParams>({thinking: true})
    const [tools, setTools] = useState<ToolStatus[]>([])
    const [webSearchEnabled, setWebSearchEnabled] = useState(true)
    const [editModeEnabled, setEditModeEnabled] = useState(true)

    const focusRef = useRef(focus)
    useEffect(() => {
        focusRef.current = focus
    }, [focus])

    const projectNameCacheRef = useRef<Map<string, string>>(new Map())
    // Map value: snippet string（含空字符串），undefined 表示未缓存
    const entrySnippetCacheRef = useRef<Map<string, string>>(new Map())

    const activeConversation = useMemo(
        () => conversations.find((conversation) => conversation.id === activeConversationId),
        [conversations, activeConversationId],
    )

    const messages = useMemo(() => activeConversation?.messages ?? [], [activeConversation])

    const activeConversationRef = useRef(activeConversation)
    useEffect(() => {
        activeConversationRef.current = activeConversation
    }, [activeConversation])

    const activeConversationIdRef = useRef(activeConversationId)
    useEffect(() => {
        activeConversationIdRef.current = activeConversationId
    }, [activeConversationId])

    const runtimeConversationRef = useRef<Record<string, string>>({})
    const abortControllerRef = useRef<AbortController | null>(null)

    const onMessage = useCallback((message: SessionMessage) => {
        const targetConversationId =
            runtimeConversationRef.current[runtimeConversationKey(message.sessionId, message.runId)]

        setConversations((prev) => prev.map((conversation) => {
            const matchedByRuntime =
                conversation.sessionId === message.sessionId && conversation.runId === message.runId
            const matchedByMap = targetConversationId != null && conversation.id === targetConversationId
            if (!matchedByRuntime && !matchedByMap) return conversation
            return {
                ...conversation,
                messages: [...conversation.messages, {
                    id: message.id,
                    role: message.role,
                    content: message.content,
                    timestamp: message.timestamp,
                    reasoning: message.reasoning,
                    blocks: message.blocks,
                    nodeId: message.nodeId,
                }],
            }
        }))
    }, [])

    const onError = useCallback((message: string) => {
        console.error('[useAiController]', message)
    }, [])

    const session = useAiSession({onMessage, onError})

    // 词条内容更新时清除对应缓存，避免下次推送旧摘要
    useEffect(() => {
        const unlisten = listen<EntryUpdatedEvent>(ENTRY_UPDATED, (e) => {
            entrySnippetCacheRef.current.delete(e.payload.entry_id)
        })
        return () => {
            unlisten.then(fn => fn())
        }
    }, [])

    const resolveContextPayload = useCallback(async (
        projectId: string | null,
        entryId: string | null,
    ): Promise<TaskContextPayload> => {
        const attributes: Record<string, string> = {}
        const [projResult, entryResult] = await Promise.allSettled([
            projectId ? (async () => {
                const cached = projectNameCacheRef.current.get(projectId)
                if (cached !== undefined) return cached
                const proj = await db_get_project(projectId)
                projectNameCacheRef.current.set(projectId, proj.name)
                return proj.name
            })() : Promise.resolve(null),
            entryId ? (async () => {
                if (entrySnippetCacheRef.current.has(entryId)) {
                    return entrySnippetCacheRef.current.get(entryId)!
                }
                const entry = await db_get_entry(entryId)
                const snippet = entry.content?.slice(0, 500) ?? ''
                entrySnippetCacheRef.current.set(entryId, snippet)
                return snippet
            })() : Promise.resolve(null),
        ])

        if (projectId) {
            attributes.project_id = projectId
            if (projResult.status === 'fulfilled' && projResult.value) {
                attributes.project_name = projResult.value
            }
        }
        if (entryId) {
            attributes.entry_id = entryId
            if (entryResult.status === 'fulfilled' && entryResult.value) {
                attributes.entry_snippet = entryResult.value
            }
        }

        const hints: string[] = []
        if (!webSearchEnabled) {
            hints.push(
                '用户已禁用 "web_search" 和 "open_url" 工具。' +
                '若问题涉及联网获取信息，请勿主观臆断，而是告知用户开启"联网搜索"功能后再试。'
            )
        }
        if (!editModeEnabled) {
            hints.push(
                '用户当前处于阅读模式，所有词条编辑工具已被禁用。' +
                '若用户要求修改内容，请告知其切换到"编辑模式"后再操作。'
            )
        }
        if (hints.length > 0) {
            attributes.ai_instructions = hints.join('\n')
        }

        return {
            attributes,
            flags: {read_only: !editModeEnabled},
        }
    }, [editModeEnabled, webSearchEnabled])

    // tab 切换或 session 建立时推送最新焦点上下文
    useEffect(() => {
        const sid = session.sessionId
        if (!sid) return
        let cancelled = false
        resolveContextPayload(focus.projectId, focus.entryId).then((ctx) => {
            if (cancelled) return
            ai_set_task_context(sid, ctx).catch(() => {
            })
        }).catch(() => {
        })
        return () => {
            cancelled = true
        }
    }, [focus.projectId, focus.entryId, session.sessionId, resolveContextPayload])

    useEffect(() => {
        ai_list_plugins('llm').then(setPlugins).catch(console.error)
        ai_list_tools().then((fetched) => {
            const enableOps = fetched.map((tool) => ai_enable_tool(tool.name))
            void Promise.all(enableOps)
            setTools(fetched.map((tool) => ({...tool, enabled: true})))
            setWebSearchEnabled(true)
            setEditModeEnabled(true)
        }).catch(console.error)
    }, [])

    useEffect(() => {
        if (selectedPlugin || plugins.length === 0) return
        setSelectedPlugin(plugins[0].id)
    }, [plugins, selectedPlugin])

    useEffect(() => {
        let mounted = true
        const init = async () => {
            const metas = await ai_list_conversations().catch(
                () => [] as Awaited<ReturnType<typeof ai_list_conversations>>,
            )
            if (!mounted) return

            if (metas.length > 0) {
                const convs: Conversation[] = metas.map((meta) => ({
                    id: meta.id,
                    title: meta.title,
                    messages: [],
                    pluginId: meta.plugin_id,
                    model: meta.model,
                    sessionId: null,
                    runId: null,
                    timestamp: new Date(meta.updated_at).getTime(),
                    mode: 'default',
                    characterEntryId: null,
                    characterName: null,
                    backgroundImageUrl: null,
                    characterVoiceId: null,
                    characterAutoPlay: null,
                }))

                setConversations(convs)
                setActiveConversationId(null)
            } else {
                setConversations([])
                setActiveConversationId(null)
            }
        }

        void init()
        return () => {
            mounted = false
        }
    }, [])

    useEffect(() => {
        if (selectedPlugin && plugins.length > 0 && !selectedModel) {
            const plugin = plugins.find((item) => item.id === selectedPlugin)
            if (plugin) {
                const defaultModel = plugin.default_model ?? plugin.models[0] ?? ''
                if (defaultModel) {
                    const timer = setTimeout(() => setSelectedModel(defaultModel), 0)
                    return () => clearTimeout(timer)
                }
            }
        }
    }, [selectedPlugin, plugins, selectedModel])

    useEffect(() => {
        if (!session.sessionId) return
        void ai_update_session(session.sessionId, {thinking: sessionParams.thinking}).catch(console.error)
    }, [sessionParams, session.sessionId])

    const createNewConversation = useCallback(async () => {
        if (session.isStreaming) {
            abortControllerRef.current?.abort()
        }
        await session.closeSession()
        setActiveConversationId(null)
        setInputValue('')
        setEditingMessageId(null)
        setAutoScroll(true)
    }, [session])

    const startCharacterConversation = useCallback(async ({projectId, entryId}: {
        projectId: string
        entryId: string
    }) => {
        if (!selectedPlugin || !selectedModel) {
            throw new Error('当前 AI 插件或模型尚未准备好，请稍后重试。')
        }
        if (session.isStreaming) {
            abortControllerRef.current?.abort()
            await session.cancelSession()
        }

        const currentConv = activeConversationRef.current
        if (currentConv?.sessionId) {
            await session.closeSession(currentConv.sessionId)
        } else {
            await session.closeSession()
        }

        const built = await buildCharacterProjectSnapshot(projectId, entryId)
        const characterType = normalizeComparableType(built.characterEntry.type)
        if (characterType !== 'character') {
            throw new Error('当前词条不是角色类型，无法开启角色对话。')
        }

        const created = await session.createCharacterSession(selectedPlugin, selectedModel, {
            characterName: built.characterEntry.title,
            projectSnapshot: built.snapshot,
        })
        if (!created) return

        const conversation: Conversation = {
            id: created.conversationId,
            title: `和「${built.characterEntry.title}」聊天`,
            messages: [],
            pluginId: selectedPlugin,
            model: selectedModel,
            sessionId: created.sessionId,
            runId: created.runId,
            timestamp: Date.now(),
            mode: 'character',
            characterEntryId: entryId,
            characterName: built.characterEntry.title,
            backgroundImageUrl: built.backgroundImageUrl,
            characterVoiceId: built.characterVoiceId,
            characterAutoPlay: built.characterAutoPlay,
        }
        runtimeConversationRef.current[
            runtimeConversationKey(created.sessionId, created.runId)
            ] = created.conversationId
        setConversations((prev) => [conversation, ...prev.filter((item) => item.id !== conversation.id)])
        setActiveConversationId(conversation.id)
        setInputValue('')
        setEditingMessageId(null)
        setAutoScroll(true)
    }, [selectedModel, selectedPlugin, session])

    const switchConversation = useCallback(async (convId: string) => {
        if (convId === activeConversationIdRef.current) return
        setActiveConversationId(convId)
        setInputValue('')
        setEditingMessageId(null)
        setAutoScroll(true)

        const targetConv = conversations.find((conversation) => conversation.id === convId)
        if (targetConv) {
            setSelectedPlugin(targetConv.pluginId)
            setSelectedModel(targetConv.model)

            if (targetConv.messages.length === 0 && !targetConv.id.startsWith('conv_')) {
                const stored = await ai_get_conversation(targetConv.id).catch(() => null)
                if (stored) {
                    setConversations((prev) => prev.map((conversation) =>
                        conversation.id === convId
                            ? {...conversation, messages: storedToMessages(stored.messages)}
                            : conversation,
                    ))
                }
            }
        }
    }, [conversations])

    const deleteConversation = useCallback(async (convId: string, event?: React.MouseEvent) => {
        event?.stopPropagation()
        const conv = conversations.find((conversation) => conversation.id === convId)

        if (activeConversationIdRef.current === convId && session.isStreaming) {
            await session.cancelSession(conv?.sessionId)
        }

        if (conv?.sessionId) {
            await ai_close_session(conv.sessionId).catch(console.error)
        }
        if (conv && !conv.id.startsWith('conv_')) {
            await ai_delete_conversation(conv.id).catch(console.error)
        }

        setConversations((prev) => prev.filter((conversation) => conversation.id !== convId))

        if (activeConversationIdRef.current === convId) {
            await session.closeSession()
            setActiveConversationId(null)
            setInputValue('')
            setEditingMessageId(null)
            setAutoScroll(true)
        }
    }, [conversations, session])

    const renameConversation = useCallback(async (convId: string, title: string) => {
        const trimmed = title.trim()
        if (!trimmed) return
        setConversations((prev) => prev.map((conversation) =>
            conversation.id === convId ? {...conversation, title: trimmed} : conversation,
        ))
        await ai_rename_conversation(convId, trimmed).catch(console.error)
    }, [])

    const sendMessage = useCallback(async (content: string) => {
        const trimmed = content.trim()
        if (!trimmed || session.isStreaming) return

        let currentConvId = activeConversationRef.current?.id ?? null
        let effectiveConvId = currentConvId

        if (!currentConvId) {
            const draftConversationId = `conv_${Date.now()}`
            const draftConversation: Conversation = {
                id: draftConversationId,
                title: '新对话',
                messages: [],
                pluginId: selectedPlugin,
                model: selectedModel,
                sessionId: null,
                runId: null,
                timestamp: Date.now(),
                mode: 'default',
                characterEntryId: null,
                characterName: null,
                backgroundImageUrl: null,
                characterVoiceId: null,
                characterAutoPlay: null,
            }
            currentConvId = draftConversationId
            effectiveConvId = draftConversationId
            setConversations((prev) => [draftConversation, ...prev])
            setActiveConversationId(draftConversationId)
            setAutoScroll(true)
        }

        abortControllerRef.current = new AbortController()

        let sessionForcedClosed = false

        if (editingMessageId) {
            const conv = activeConversationRef.current
            if (conv) {
                const editIdx = conv.messages.findIndex((message) => message.id === editingMessageId)
                if (editIdx !== -1) {
                    setConversations((prev) => prev.map((conversation) =>
                        conversation.id === currentConvId
                            ? {...conversation, messages: conversation.messages.slice(0, editIdx)}
                            : conversation,
                    ))
                    const precedingMsg = editIdx > 0 ? conv.messages[editIdx - 1] : null
                    if (precedingMsg?.nodeId && conv.sessionId === session.sessionId) {
                        await session.checkoutForEdit(precedingMsg.nodeId)
                    } else if (session.sessionId) {
                        await session.closeSession()
                        sessionForcedClosed = true
                    }
                }
            }
            setEditingMessageId(null)
        }

        const sessionBelongsHere = !sessionForcedClosed && session.sessionId != null
            && session.sessionId === activeConversationRef.current?.sessionId
            && session.runId != null
            && session.runId === activeConversationRef.current?.runId

        if (session.sessionId && !sessionBelongsHere) {
            await session.closeSession()
        }

        let currentSid = sessionBelongsHere ? session.sessionId : null

        if (!currentSid) {
            await new Promise<void>((resolve) => {
                setTools((latest) => {
                    Promise.all(
                        latest.map((tool) => tool.enabled ? ai_enable_tool(tool.name) : ai_disable_tool(tool.name)),
                    ).catch(console.error).finally(resolve)
                    return latest
                })
            })

            const isPending = currentConvId.startsWith('conv_')
            const desiredSessionId = isPending ? undefined : currentConvId
            const created = await session.createSession(selectedPlugin, selectedModel, desiredSessionId)
            if (!created) return

            currentSid = created.sessionId

            // 兜底推送：session 刚建立时 effect 可能尚未触发，确保首轮 assemble 有上下文
            resolveContextPayload(focusRef.current.projectId, focusRef.current.entryId)
                .then((ctx) => ai_set_task_context(currentSid!, ctx).catch(() => {
                }))
                .catch(() => {
                })

            if (isPending) {
                effectiveConvId = created.conversationId
                runtimeConversationRef.current[
                    runtimeConversationKey(created.sessionId, created.runId)
                    ] = created.conversationId
                setConversations((prev) => prev.map((conversation) =>
                    conversation.id === currentConvId
                        ? {...conversation, id: created.conversationId, sessionId: currentSid!, runId: created.runId}
                        : conversation,
                ))
                setActiveConversationId(created.conversationId)
            } else {
                runtimeConversationRef.current[
                    runtimeConversationKey(created.sessionId, created.runId)
                    ] = currentConvId
                setConversations((prev) => prev.map((conversation) =>
                    conversation.id === currentConvId
                        ? {...conversation, sessionId: currentSid!, runId: created.runId}
                        : conversation,
                ))
            }
        }

        const userMessage: Message = {
            id: `u_${Date.now()}`,
            role: 'user',
            content: trimmed,
            timestamp: Date.now(),
        }

        setConversations((prev) => prev.map((conversation) => {
            if (conversation.id !== effectiveConvId) return conversation
            const isFirstMessage = conversation.messages.length === 0
            return {
                ...conversation,
                title: isFirstMessage && conversation.mode !== 'character'
                    ? generateTitleFromMessage(trimmed)
                    : conversation.title,
                messages: [...conversation.messages, userMessage],
            }
        }))

        setInputValue('')
        await session.sendMessage(trimmed, currentSid!)
    }, [editingMessageId, selectedModel, selectedPlugin, session, resolveContextPayload])

    const stopStreaming = useCallback(() => {
        abortControllerRef.current?.abort()
        void session.cancelSession()
    }, [session])

    const regenerateMessage = useCallback(async (messageId: string) => {
        if (session.isStreaming) return
        const conv = conversations.find((conversation) => conversation.id === activeConversationIdRef.current)
        if (!conv || conv.sessionId !== session.sessionId) return

        const messageIndex = conv.messages.findIndex((message) => message.id === messageId)
        if (messageIndex === -1) return

        const precedingUserMsg = conv.messages
            .slice(0, messageIndex)
            .reverse()
            .find((message) => message.role === 'user')
        if (!precedingUserMsg?.nodeId) return

        setConversations((prev) => prev.map((conversation) =>
            conversation.id === activeConversationIdRef.current
                ? {...conversation, messages: conversation.messages.slice(0, messageIndex)}
                : conversation,
        ))
        setAutoScroll(true)
        await session.checkout(precedingUserMsg.nodeId)
    }, [conversations, session])

    const editMessage = useCallback((messageId: string) => {
        const conv = conversations.find((conversation) => conversation.id === activeConversationIdRef.current)
        const message = conv?.messages.find((item) => item.id === messageId)
        if (!message || message.role !== 'user') return
        setInputValue(message.content)
        setEditingMessageId(messageId)
    }, [conversations])

    const toggleWebSearch = useCallback(async () => {
        const next = !webSearchEnabled
        const webNames = ['web_search', 'open_url']
        setTools((prev) => prev.map((tool) => webNames.includes(tool.name) ? {...tool, enabled: next} : tool))
        setWebSearchEnabled(next)
        if (!session.sessionId) {
            const ops = tools
                .filter((tool) => webNames.includes(tool.name))
                .map((tool) => next ? ai_enable_tool(tool.name) : ai_disable_tool(tool.name))
            await Promise.all(ops).catch(console.error)
        }
    }, [session.sessionId, tools, webSearchEnabled])

    const toggleEditMode = useCallback(async () => {
        const next = !editModeEnabled
        const webNames = ['web_search', 'open_url']
        setTools((prev) => prev.map((tool) => (!webNames.includes(tool.name)) ? {...tool, enabled: next} : tool))
        setEditModeEnabled(next)
        // registry 侧同步由 sendMessage 的工具初始化流程负责；
        // read_only flag 通过 resolveContextPayload → ai_set_task_context 在下一轮 assemble 生效
    }, [editModeEnabled])

    return useMemo(() => ({
        plugins,
        selectedPlugin,
        selectedModel,
        setSelectedPlugin,
        setSelectedModel,
        conversations,
        activeConversationId,
        setActiveConversationId,
        messages,
        sendMessage,
        stopStreaming,
        regenerateMessage,
        editMessage,
        inputValue,
        setInputValue,
        editingMessageId,
        setEditingMessageId,
        tools,
        webSearchEnabled,
        editModeEnabled,
        toggleWebSearch,
        toggleEditMode,
        sessionParams,
        setSessionParams,
        isStreaming: session.isStreaming,
        streamingBlocks: session.blocks,
        sidebarCollapsed,
        setSidebarCollapsed,
        autoScroll,
        setAutoScroll,
        createNewConversation,
        startCharacterConversation,
        switchConversation,
        deleteConversation,
        renameConversation,
        activeConversation,
    }), [
        plugins, selectedPlugin, selectedModel, conversations, activeConversationId,
        messages, inputValue, editingMessageId, tools, webSearchEnabled, editModeEnabled,
        sessionParams, session.isStreaming, session.blocks, sidebarCollapsed, autoScroll,
        activeConversation, sendMessage, stopStreaming, regenerateMessage, editMessage,
        toggleWebSearch, toggleEditMode, createNewConversation, switchConversation, deleteConversation,
        renameConversation, startCharacterConversation,
    ])
}
