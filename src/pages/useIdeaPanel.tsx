import {type ReactNode} from 'react'
import Idea from './Idea'

interface UseIdeaPanelOptions {
    contextProjectId?: string | null
    onOpenEntry?: (projectId: string, entry: { id: string; title: string }) => void
    panelMode?: 'floating' | 'fullscreen'
    onTogglePanelMode?: () => void
    onToggleCollapsed?: () => void
}

export interface IdeaPanelSlots {
    side: ReactNode
    main: ReactNode
}

/**
 * Phase 1: wrapper-only — 内部仍是 Idea 单体组件。
 * Phase 2 拆分 IdeaSide / IdeaMain 时仅改这个 hook 内部。
 */
export function useIdeaPanel(options: UseIdeaPanelOptions = {}): IdeaPanelSlots {
    return {
        side: null,
        main: <Idea {...options} />,
    }
}
