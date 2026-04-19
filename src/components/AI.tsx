import type {AiContextValue} from '../contexts/AiControllerTypes'
import AIChatContent from './AIChatContent'
import './AI.css'

interface AIChatProps {
    controller: AiContextValue
}

export default function AIChat({controller}: AIChatProps) {
    return (
        <div className={`ai-chat-layout ${controller.sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
            <AIChatContent controller={controller}/>
        </div>
    )
}
