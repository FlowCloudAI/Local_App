import {type ReactNode} from 'react'
import AIChatContent from './components/AIChatContent'
import type {DockableSidePanelMode} from '../../shared/ui/layout/DockableSidePanel'
import type {AiContextValue} from './model/AiControllerTypes'

interface UseAIChatPanelOptions {
    controller: AiContextValue
    panelMode?: DockableSidePanelMode
    onTogglePanelMode?: () => void
    onToggleCollapsed?: () => void
    onOpenEntry?: (projectId: string, entry: { id: string; title: string }) => void
}

export interface AIChatPanelSlots {
    side: ReactNode
    main: ReactNode
}

/**
 * Phase 1: wrapper-only — 内部仍是 AIChatContent 单体组件。
 * Phase 3 拆分 AIChatSide / AIChatMain 时仅改这个 hook 内部。
 */
export function useAIChatPanel({
                                   controller,
                                   ...rest
                               }: UseAIChatPanelOptions): AIChatPanelSlots {
    return {
        side: null,
        main: (
            <div className={`ai-chat-layout ${controller.sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
                <AIChatContent controller={controller} {...rest} />
            </div>
        ),
    }
}
