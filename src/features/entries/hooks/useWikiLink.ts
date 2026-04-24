import type {KeyboardEvent as ReactKeyboardEvent, RefObject} from 'react'
import {useCallback, useEffect, useMemo, useRef, useState} from 'react'
import type {EntryBrief} from '../../../api'
import {
    getTextareaCaretOffset,
    normalizeEntryLookupTitle,
    replaceRange,
    resolveActiveWikiDraft,
} from '../lib/entryCommon'
import {buildInternalEntryMarkdown} from '../lib/entryMarkdown'

type WikiDraft = {
    start: number
    end: number
    query: string
}

type WikiLinkOption =
    | { kind: 'entry'; id: string; title: string; categoryId: string | null }
    | { kind: 'create'; title: string }

interface UseWikiLinkOptions {
    entryId: string
    entryCategoryId: string | null | undefined
    projectEntries: EntryBrief[]
    content: string
    containerRef: RefObject<HTMLDivElement | null>
    popoverRef: RefObject<HTMLDivElement | null>
    onContentChange: (nextContent: string) => void
    onCreateEntry: (title: string) => Promise<{ id: string; title: string } | null>
    onShowAlert: (message: string, type: 'success' | 'warning' | 'error') => void
}

export default function useWikiLink({
                                        entryId,
                                        entryCategoryId,
                                        projectEntries,
                                        content,
                                        containerRef,
                                        popoverRef,
                                        onContentChange,
                                        onCreateEntry,
                                        onShowAlert,
                                    }: UseWikiLinkOptions) {
    const [wikiDraft, setWikiDraft] = useState<WikiDraft | null>(null)
    const [wikiPopoverPosition, setWikiPopoverPosition] = useState<{ top: number; left: number }>({top: 16, left: 16})
    const [activeWikiOptionIndex, setActiveWikiOptionIndex] = useState(0)
    const [creatingLinkedEntry, setCreatingLinkedEntry] = useState(false)
    const wikiDraftRetainTimerRef = useRef<number | null>(null)
    const cursorSyncRafRef = useRef<number | null>(null)
    const pendingCursorSyncRef = useRef<{ value: string; selectionStart: number | null } | null>(null)
    const prevWikiDraftRef = useRef<WikiDraft | null>(null)
    const wikiOptionRefs = useRef<Record<number, HTMLButtonElement | null>>({})

    const updateWikiPopoverPosition = useCallback((textarea?: HTMLTextAreaElement | null, activeDraft?: WikiDraft | null) => {
        const container = containerRef.current
        const draftToUse = activeDraft ?? prevWikiDraftRef.current
        const input = textarea ?? container?.querySelector('textarea') ?? null
        const popover = popoverRef.current
        if (!container || !input || !draftToUse || !popover) return

        const containerRect = container.getBoundingClientRect()
        const inputRect = input.getBoundingClientRect()
        const {left, top, lineHeight} = getTextareaCaretOffset(input, draftToUse.end)
        const gap = 10
        const baseLeft = inputRect.left - containerRect.left + left
        const baseTop = inputRect.top - containerRect.top + top
        const maxLeft = Math.max(12, container.clientWidth - popover.offsetWidth - 12)
        const maxTop = Math.max(12, container.clientHeight - popover.offsetHeight - 12)
        const preferBelow = baseTop + lineHeight + gap + popover.offsetHeight <= container.clientHeight - 12
        const nextLeft = Math.min(Math.max(12, baseLeft), maxLeft)
        const nextTop = preferBelow
            ? Math.min(baseTop + lineHeight + gap, maxTop)
            : Math.max(12, baseTop - popover.offsetHeight - gap)

        setWikiPopoverPosition((current) => (
            current.left === nextLeft && current.top === nextTop
                ? current
                : {left: nextLeft, top: nextTop}
        ))
    }, [containerRef, popoverRef])

    const filteredLinkSuggestions = useMemo(() => {
        if (!wikiDraft) return []
        const query = normalizeEntryLookupTitle(wikiDraft.query)
        return projectEntries
            .filter((item) => item.id !== entryId)
            .filter((item) => !query || normalizeEntryLookupTitle(item.title).includes(query))
            .slice(0, 8)
    }, [wikiDraft, projectEntries, entryId])

    const hasExactCategorySuggestion = useMemo(() => {
        const query = normalizeEntryLookupTitle(wikiDraft?.query)
        if (!query) return false
        return projectEntries.some((item) => (
            item.id !== entryId
            && (item.category_id ?? null) === (entryCategoryId ?? null)
            && normalizeEntryLookupTitle(item.title) === query
        ))
    }, [wikiDraft, projectEntries, entryId, entryCategoryId])

    const wikiLinkOptions = useMemo<WikiLinkOption[]>(() => {
        const options: WikiLinkOption[] = filteredLinkSuggestions.map((item) => ({
            kind: 'entry',
            id: item.id,
            title: item.title,
            categoryId: item.category_id ?? null,
        }))
        if (!hasExactCategorySuggestion && wikiDraft?.query.trim()) {
            options.push({
                kind: 'create',
                title: wikiDraft.query.trim(),
            })
        }
        return options
    }, [filteredLinkSuggestions, hasExactCategorySuggestion, wikiDraft])

    useEffect(() => {
        if (!wikiDraft) return
        const rafId = requestAnimationFrame(() => updateWikiPopoverPosition())
        return () => cancelAnimationFrame(rafId)
    }, [filteredLinkSuggestions.length, hasExactCategorySuggestion, updateWikiPopoverPosition, wikiDraft])

    useEffect(() => {
        if (!wikiDraft) return
        const handleResize = () => updateWikiPopoverPosition()
        window.addEventListener('resize', handleResize)
        return () => window.removeEventListener('resize', handleResize)
    }, [updateWikiPopoverPosition, wikiDraft])

    useEffect(() => {
        if (!wikiDraft) {
            setActiveWikiOptionIndex(0)
            wikiOptionRefs.current = {}
            return
        }
        setActiveWikiOptionIndex((current) => {
            if (wikiLinkOptions.length <= 0) return 0
            return Math.min(current, wikiLinkOptions.length - 1)
        })
    }, [wikiDraft, wikiLinkOptions.length])

    useEffect(() => {
        if (!wikiDraft) return
        if (wikiLinkOptions.length <= 0) return
        const activeElement = wikiOptionRefs.current[activeWikiOptionIndex]
        if (!activeElement) return
        activeElement.scrollIntoView({block: 'nearest'})
    }, [activeWikiOptionIndex, wikiDraft, wikiLinkOptions.length])

    useEffect(() => {
        return () => {
            if (wikiDraftRetainTimerRef.current) {
                window.clearTimeout(wikiDraftRetainTimerRef.current)
            }
            if (cursorSyncRafRef.current !== null) {
                cancelAnimationFrame(cursorSyncRafRef.current)
            }
            pendingCursorSyncRef.current = null
        }
    }, [])

    function applyWikiLink(linkedEntry: { title: string; id: string }) {
        if (!wikiDraft) return
        const inserted = buildInternalEntryMarkdown(linkedEntry.title, linkedEntry.id)
        onContentChange(replaceRange(content, wikiDraft.start, wikiDraft.end, inserted))
        setWikiDraft(null)
        prevWikiDraftRef.current = null
    }

    async function handleCreateLinkedEntry() {
        const title = wikiDraft?.query.trim()
        if (!title || hasExactCategorySuggestion) return
        setCreatingLinkedEntry(true)
        try {
            const created = await onCreateEntry(title)
            if (!created) {
                setActiveWikiOptionIndex(0)
                return
            }
            applyWikiLink(created)
            onShowAlert('已创建并插入双链', 'success')
        } catch {
            onShowAlert('创建词条失败', 'error')
        } finally {
            setCreatingLinkedEntry(false)
        }
    }

    function handleWikiOptionCommit(option: WikiLinkOption | undefined) {
        if (!option) return
        if (option.kind === 'entry') {
            applyWikiLink({title: option.title, id: option.id})
            return
        }
        if (creatingLinkedEntry) return
        void handleCreateLinkedEntry()
    }

    function handleWikiKeyDown(event: ReactKeyboardEvent<HTMLTextAreaElement>) {
        if (!wikiDraft || !wikiLinkOptions.length) return
        if (event.nativeEvent.isComposing) return

        if (event.key === 'ArrowDown') {
            event.preventDefault()
            setActiveWikiOptionIndex((current) => (current + 1) % wikiLinkOptions.length)
            return
        }

        if (event.key === 'ArrowUp') {
            event.preventDefault()
            setActiveWikiOptionIndex((current) => (current - 1 + wikiLinkOptions.length) % wikiLinkOptions.length)
            return
        }

        if (event.key === 'Enter') {
            event.preventDefault()
            handleWikiOptionCommit(wikiLinkOptions[activeWikiOptionIndex])
            return
        }

        if (event.key === 'Escape') {
            event.preventDefault()
            setWikiDraft(null)
            prevWikiDraftRef.current = null
        }
    }

    function handleMarkdownCursorSync(textarea: HTMLTextAreaElement) {
        if (!textarea.value.includes('[[')) {
            pendingCursorSyncRef.current = null
            if (prevWikiDraftRef.current !== null) {
                prevWikiDraftRef.current = null
                setWikiDraft(null)
            }
            return
        }
        pendingCursorSyncRef.current = {
            value: textarea.value,
            selectionStart: textarea.selectionStart,
        }
        if (cursorSyncRafRef.current !== null) return
        cursorSyncRafRef.current = requestAnimationFrame(() => {
            cursorSyncRafRef.current = null
            const pending = pendingCursorSyncRef.current
            pendingCursorSyncRef.current = null
            if (!pending) return
            const next = resolveActiveWikiDraft(pending.value, pending.selectionStart)
            const prev = prevWikiDraftRef.current
            const changed = next?.query !== prev?.query || next?.start !== prev?.start || next?.end !== prev?.end
            if (changed) {
                prevWikiDraftRef.current = next
                setWikiDraft(next)
                if (next) {
                    updateWikiPopoverPosition(textarea, next)
                }
            }
        })
    }

    function handleTextareaBlur() {
        if (wikiDraftRetainTimerRef.current) {
            window.clearTimeout(wikiDraftRetainTimerRef.current)
        }
        wikiDraftRetainTimerRef.current = window.setTimeout(() => {
            setWikiDraft(null)
            prevWikiDraftRef.current = null
        }, 120)
    }

    return {
        wikiDraft,
        setWikiDraft,
        wikiPopoverPosition,
        wikiLinkOptions,
        activeWikiOptionIndex,
        creatingLinkedEntry,
        hasExactCategorySuggestion,
        wikiOptionRefs,
        setActiveWikiOptionIndex,
        handleWikiKeyDown,
        handleMarkdownCursorSync,
        handleTextareaBlur,
        handleWikiOptionCommit,
        updateWikiPopoverPosition,
    }
}
