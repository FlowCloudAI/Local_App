import {useCallback, useEffect, useMemo, useRef, useState} from 'react'
import type {Entry, EntryBrief} from '../../../api'
import {normalizeEntryLookupTitle} from '../lib/entryCommon'

interface UseLinkPreviewOptions {
    entryCache: Record<string, Entry>
    projectEntries: EntryBrief[]
    ensureProjectEntriesLoaded: () => Promise<void>
    onOpenEntry?: (entry: { id: string; title: string }) => void
}

export default function useLinkPreview({
                                           entryCache,
                                           projectEntries,
                                           ensureProjectEntriesLoaded,
                                           onOpenEntry,
                                       }: UseLinkPreviewOptions) {
    const [linkPreview, setLinkPreview] = useState<{ title: string; entryId: string | null } | null>(null)
    const [linkPreviewPosition, setLinkPreviewPosition] = useState<{ top: number; left: number }>({top: 16, left: 16})
    const linkPreviewCloseTimerRef = useRef<number | null>(null)
    const linkPreviewAnchorRef = useRef<HTMLAnchorElement | null>(null)

    const clearLinkPreviewCloseTimer = useCallback(() => {
        if (linkPreviewCloseTimerRef.current !== null) {
            window.clearTimeout(linkPreviewCloseTimerRef.current)
            linkPreviewCloseTimerRef.current = null
        }
    }, [])

    const closeLinkPreview = useCallback(() => {
        clearLinkPreviewCloseTimer()
        linkPreviewAnchorRef.current = null
        setLinkPreview(null)
    }, [clearLinkPreviewCloseTimer])

    const scheduleLinkPreviewClose = useCallback(() => {
        clearLinkPreviewCloseTimer()
        linkPreviewCloseTimerRef.current = window.setTimeout(() => {
            linkPreviewAnchorRef.current = null
            setLinkPreview(null)
            linkPreviewCloseTimerRef.current = null
        }, 90)
    }, [clearLinkPreviewCloseTimer])

    useEffect(() => {
        return () => {
            if (linkPreviewCloseTimerRef.current !== null) {
                window.clearTimeout(linkPreviewCloseTimerRef.current)
            }
        }
    }, [])

    useEffect(() => {
        if (!linkPreview) return
        const handleViewportChange = () => closeLinkPreview()
        window.addEventListener('resize', handleViewportChange)
        window.addEventListener('scroll', handleViewportChange, true)
        return () => {
            window.removeEventListener('resize', handleViewportChange)
            window.removeEventListener('scroll', handleViewportChange, true)
        }
    }, [closeLinkPreview, linkPreview])

    const linkPreviewEntry = useMemo(() => {
        if (!linkPreview) return null
        if (linkPreview.entryId) return entryCache[linkPreview.entryId] ?? null
        const normalizedLinkTitle = normalizeEntryLookupTitle(linkPreview.title)
        return Object.values(entryCache).find((item) => (
            normalizeEntryLookupTitle(item.title) === normalizedLinkTitle
        )) ?? null
    }, [entryCache, linkPreview])

    function updateLinkPreviewPosition(anchor: HTMLAnchorElement) {
        const gap = 12
        const viewportPadding = 12
        const anchorRect = anchor.getBoundingClientRect()
        const viewportWidth = window.innerWidth
        const viewportHeight = window.innerHeight
        const panelWidth = Math.min(320, Math.max(260, viewportWidth - viewportPadding * 2))
        const panelHeight = 260
        const preferRight = anchorRect.right + gap + panelWidth <= viewportWidth - viewportPadding
        const nextLeft = preferRight
            ? anchorRect.right + gap
            : Math.max(viewportPadding, anchorRect.left - panelWidth - gap)
        const preferBelow = anchorRect.bottom + gap + panelHeight <= viewportHeight - viewportPadding
        const centeredTop = anchorRect.top + anchorRect.height / 2 - panelHeight / 2
        const nextTop = preferBelow
            ? anchorRect.bottom + gap
            : Math.min(
                Math.max(viewportPadding, centeredTop),
                Math.max(viewportPadding, viewportHeight - panelHeight - viewportPadding),
            )

        setLinkPreviewPosition((current) => (
            current.left === nextLeft && current.top === nextTop
                ? current
                : {left: nextLeft, top: nextTop}
        ))
    }

    function findProjectEntry(link: { entryId?: string | null; title: string }): EntryBrief | undefined {
        if (link.entryId) {
            const targetById = projectEntries.find((item) => item.id === link.entryId)
            if (targetById) return targetById
        }
        const normalizedTitle = normalizeEntryLookupTitle(link.title)
        if (!normalizedTitle) return undefined
        return projectEntries.find((item) => (
            normalizeEntryLookupTitle(item.title) === normalizedTitle
        ))
    }

    function openLinkPreview(anchor: HTMLAnchorElement, link: { entryId?: string | null; title: string }) {
        clearLinkPreviewCloseTimer()
        linkPreviewAnchorRef.current = anchor
        updateLinkPreviewPosition(anchor)
        void ensureProjectEntriesLoaded().then(() => {
            if (linkPreviewAnchorRef.current !== anchor) return
            const target = findProjectEntry(link)
            setLinkPreview({title: target?.title ?? link.title, entryId: target?.id ?? null})
        })
    }

    function handleOpenLinkedEntry(link: { entryId?: string | null; title: string }) {
        const target = findProjectEntry(link)
        if (!target) {
            setLinkPreview({title: link.title, entryId: null})
            return
        }
        onOpenEntry?.({id: target.id, title: target.title})
    }

    return {
        linkPreview,
        linkPreviewPosition,
        linkPreviewEntry,
        linkPreviewAnchorRef,
        linkPreviewCloseTimerRef,
        clearLinkPreviewCloseTimer,
        closeLinkPreview,
        scheduleLinkPreviewClose,
        updateLinkPreviewPosition,
        openLinkPreview,
        handleOpenLinkedEntry,
        setLinkPreview,
    }
}
