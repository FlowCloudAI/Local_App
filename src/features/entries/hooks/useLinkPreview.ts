import {useCallback, useEffect, useMemo, useRef, useState} from 'react'
import type {Entry, EntryBrief} from '../../../api'
import {normalizeEntryLookupTitle} from '../lib/entryCommon'

interface UseLinkPreviewOptions {
    currentProjectId?: string | null
    entryCache: Record<string, Entry>
    projectEntries: EntryBrief[]
    ensureProjectEntriesLoaded: () => Promise<void>
    onOpenEntry?: (projectId: string, entry: { id: string; title: string }) => void
    onMissingLink?: (message: string) => void
}

type EntryLinkTarget = {
    projectId?: string | null
    entryId?: string | null
    title: string
}

type LinkPreviewState = {
    title: string
    projectId: string | null
    entryId: string | null
    missingReason?: string
}

export default function useLinkPreview({
                                           currentProjectId,
                                           entryCache,
                                           projectEntries,
                                           ensureProjectEntriesLoaded,
                                           onOpenEntry,
                                           onMissingLink,
                                       }: UseLinkPreviewOptions) {
    const [linkPreview, setLinkPreview] = useState<LinkPreviewState | null>(null)
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
        if (linkPreview.missingReason) return null
        if (linkPreview.projectId && linkPreview.projectId !== currentProjectId) return null
        if (linkPreview.entryId) return entryCache[linkPreview.entryId] ?? null
        const normalizedLinkTitle = normalizeEntryLookupTitle(linkPreview.title)
        return Object.values(entryCache).find((item) => (
            normalizeEntryLookupTitle(item.title) === normalizedLinkTitle
        )) ?? null
    }, [currentProjectId, entryCache, linkPreview])

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

    function getOpenMissingReason(link: EntryLinkTarget): string | null {
        if (link.entryId && !link.projectId) return '旧版词条链接缺少项目 ID，无法定位词条。'
        return null
    }

    function getPreviewMissingReason(link: EntryLinkTarget): string | null {
        return getOpenMissingReason(link)
            ?? (link.projectId && link.projectId !== currentProjectId ? '词条链接指向其他项目，点击后打开。' : null)
    }

    function findProjectEntry(link: EntryLinkTarget): EntryBrief | undefined {
        if (link.entryId) {
            if (getPreviewMissingReason(link)) return undefined
            const targetById = projectEntries.find((item) => item.id === link.entryId)
            if (targetById) return targetById
        }
        const normalizedTitle = normalizeEntryLookupTitle(link.title)
        if (!normalizedTitle) return undefined
        return projectEntries.find((item) => (
            normalizeEntryLookupTitle(item.title) === normalizedTitle
        ))
    }

    function openLinkPreview(anchor: HTMLAnchorElement, link: EntryLinkTarget) {
        clearLinkPreviewCloseTimer()
        linkPreviewAnchorRef.current = anchor
        updateLinkPreviewPosition(anchor)
        const missingReason = getPreviewMissingReason(link)
        if (missingReason) {
            setLinkPreview({
                title: link.title,
                projectId: link.projectId ?? null,
                entryId: link.entryId ?? null,
                missingReason,
            })
            return
        }
        void ensureProjectEntriesLoaded().then(() => {
            if (linkPreviewAnchorRef.current !== anchor) return
            const target = findProjectEntry(link)
            setLinkPreview({
                title: target?.title ?? link.title,
                projectId: currentProjectId ?? null,
                entryId: target?.id ?? null,
            })
        })
    }

    function handleOpenLinkedEntry(link: EntryLinkTarget) {
        const missingReason = getOpenMissingReason(link)
        if (missingReason) {
            onMissingLink?.(missingReason)
            setLinkPreview({
                title: link.title,
                projectId: link.projectId ?? null,
                entryId: link.entryId ?? null,
                missingReason,
            })
            return
        }
        if (link.entryId && link.projectId && link.projectId !== currentProjectId) {
            onOpenEntry?.(link.projectId, {id: link.entryId, title: link.title || '词条'})
            return
        }
        const target = findProjectEntry(link)
        if (!target) {
            setLinkPreview({
                title: link.title,
                projectId: currentProjectId ?? null,
                entryId: null,
            })
            return
        }
        if (currentProjectId) onOpenEntry?.(currentProjectId, {id: target.id, title: target.title})
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
