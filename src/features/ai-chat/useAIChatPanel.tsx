import {type ReactNode, useState} from 'react'
import AIChatContent from './components/AIChatContent'
import type {DockableSidePanelMode} from '../../shared/ui/layout/DockableSidePanel'
import type {AiContextValue} from './model/AiControllerTypes'
import AiPluginMissingOverlay, {type AiMissingPluginKind} from '../../shared/ui/AiPluginMissingOverlay'

interface UseAIChatPanelOptions {
    controller: AiContextValue
    panelMode?: DockableSidePanelMode
    onTogglePanelMode?: () => void
    onToggleCollapsed?: () => void
    onOpenEntry?: (projectId: string, entry: { id: string; title: string }) => void
    onOpenPluginManagement?: (kind: AiMissingPluginKind) => void
    onOpenWriterModeSettings?: () => void
}

export interface AIChatPanelSlots {
    side: ReactNode
    main: ReactNode
}

/**
 * AIChat 双 slot 实现（Phase 3）。
 *
 * 由于 AIChatContent 内部状态/effect/hook 极多（1400+ 行、56 个 hook 调用），
 * 不把所有 state 搬到本 hook 内，而是采用 Portal 方案：
 *   - AIChatContent 仍作为整体单一组件渲染到 main slot，保留所有内部状态
 *   - fullscreen 模式下提供一个 portal target div 作为 side slot
 *   - AIChatContent 内部根据 portal target 是否存在，把 sidebar 部分
 *     createPortal 到 side slot，与 main 共享同一个组件实例的状态
 */
export function useAIChatPanel({
                                   controller,
                                   panelMode,
                                   ...rest
                               }: UseAIChatPanelOptions): AIChatPanelSlots {
    // 用 useState + ref callback 把 portal host 元素暴露给 AIChatContent；
    // el 挂载时触发 re-render，AIChatContent 拿到非空 target 后才能 portal
    const [sidePortalEl, setSidePortalEl] = useState<HTMLDivElement | null>(null)
    const missingLlmPlugin = controller.pluginsReady && controller.plugins.length === 0
    const renderMissingOverlay = () => missingLlmPlugin ? (
        <AiPluginMissingOverlay kind="llm" onOpenPluginManagement={rest.onOpenPluginManagement}/>
    ) : null

    if (panelMode === 'fullscreen') {
        return {
            side: (
                <div className="ai-side-portal-host" ref={setSidePortalEl}>
                    {renderMissingOverlay()}
                </div>
            ),
            main: (
                <div className="ai-chat-layout">
                    <AIChatContent
                        controller={controller}
                        panelMode={panelMode}
                        sidePortalTarget={sidePortalEl}
                        {...rest}
                    />
                    {renderMissingOverlay()}
                </div>
            ),
        }
    }

    return {
        side: null,
        main: (
            <div className={`ai-chat-layout ${controller.sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
                <AIChatContent
                    controller={controller}
                    panelMode={panelMode}
                    {...rest}
                />
                {renderMissingOverlay()}
            </div>
        ),
    }
}
