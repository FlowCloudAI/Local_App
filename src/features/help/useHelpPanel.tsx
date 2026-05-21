import {type ReactNode, useEffect, useMemo, useState} from 'react'
import type {DockableSidePanelMode} from '../../shared/ui/layout/DockableSidePanel'
import {
    DockPanelIconButton,
    DockPanelMain,
    DockPanelSide,
    DockPanelTitle,
    DockPanelTopbar,
} from '../../shared/ui/layout/DockPanelScaffold'
import '../../shared/ui/layout/DockPanelScaffold.css'
import './components/HelpPanel.css'

type HelpTopicKey = 'getting-started' | 'workspace' | 'ai-guide' | 'plugins' | 'snapshots'

interface HelpTopic {
    key: HelpTopicKey
    label: string
    summary: string
    sections: Array<{
        title: string
        items: string[]
    }>
    tips: string[]
}

interface UseHelpPanelOptions {
    panelMode?: DockableSidePanelMode
    topicKey?: string | null
    topicSignal?: number
    onTogglePanelMode?: () => void
    onToggleCollapsed?: () => void
}

export interface HelpPanelSlots {
    side: ReactNode
    main: ReactNode
}

const HELP_TOPICS: HelpTopic[] = [
    {
        key: 'getting-started',
        label: '新手指南',
        summary: '从创建世界观到写下第一批词条，建立一个可持续扩展的创作起点。',
        sections: [
            {title: '第一步', items: ['在首页创建世界观，先写清项目名称和创作方向。', '进入项目后建立几个顶层分类，例如角色、地点、组织和事件。']},
            {title: '第二步', items: ['从最确定的设定开始写词条，不必一次补全所有字段。', '把临时想法先放进灵感便签，确认后再转成词条。']},
            {title: '第三步', items: ['用关系图检查词条之间的连接，再用时间线整理事件顺序。', '阶段性保存快照，方便回退到稳定版本。']},
        ],
        tips: ['先搭结构再追求细节。', '不要把草稿直接删掉，先归档或保存快照。'],
    },
    {
        key: 'workspace',
        label: '工作区结构',
        summary: '理解主工作区、右侧 Dock 工具和底部设置入口之间的关系。',
        sections: [
            {title: '主工作区', items: ['首页、项目编辑器、词条编辑器和项目工具都在主工作区打开。', '顶部标签会保留最近打开的项目、词条和工具。']},
            {title: '右侧 Dock', items: ['灵感便签、AI 对话、版本管理和帮助都在右侧 Dock 中切换。', '拖动 Dock 左侧手柄可以调整宽度，拖到边缘可折叠。']},
            {title: '全屏模式', items: ['需要专注处理右侧工具时，可点击顶栏的全屏按钮。', '再次点击同一按钮即可回到浮动模式。']},
        ],
        tips: ['Dock 工具适合放辅助流程，主工作区适合放核心编辑。', '切换 Dock 子页面不会关闭主工作区标签。'],
    },
    {
        key: 'ai-guide',
        label: 'AI 功能',
        summary: '使用对话、联网搜索、角色聊天和矛盾检测来辅助创作。',
        sections: [
            {title: '普通对话', items: ['先在设置中配置插件和模型，再打开 AI 对话。', '对话会结合当前项目或词条上下文，适合提纲、润色和设定追问。']},
            {title: '角色聊天', items: ['在词条编辑器中从角色词条启动角色对话。', '角色回复可以结合角色设定、语音和背景图进行沉浸式预览。']},
            {title: '矛盾检测', items: ['在项目工具中启动矛盾检测，生成报告后可继续和 AI 讨论。', '报告对大纲重写和长项目复核更有价值。']},
        ],
        tips: ['AI 输出应作为草案，关键设定仍需要人工确认。', '长对话建议定期归档，保留当前最重要的上下文。'],
    },
    {
        key: 'plugins',
        label: '插件与密钥',
        summary: '管理模型插件、API Key 和本地能力扩展。',
        sections: [
            {title: '插件来源', items: ['FlowCloudAI 使用 .fcplug 插件接入模型、图像生成和语音能力。', '插件包通常包含 manifest、wasm 模块和图标。']},
            {title: '密钥管理', items: ['API Key 应通过设置页写入系统密钥链。', '不要把真实密钥写进普通配置文件、模板或项目文档。']},
            {title: '排查顺序', items: ['先确认插件已安装，再确认模型列表和密钥状态。', '如果调用失败，优先检查插件日志、网络和模型名称。']},
        ],
        tips: ['同类插件建议只保留常用的一两个，减少模型选择成本。', '迁移机器时需要重新配置本机密钥。'],
    },
    {
        key: 'snapshots',
        label: '版本管理',
        summary: '用分支、快照、回退和恢复保护世界观数据。',
        sections: [
            {title: '手动保存', items: ['在版本管理中输入说明并保存一次快照。', '说明应写清这次改动的意图，例如“补完主角阵营设定”。']},
            {title: '分支', items: ['大改设定前先新建分支，保留主线稳定版本。', '不同分支适合尝试互斥剧情或重写方案。']},
            {title: '回退与恢复', items: ['回退会把当前数据恢复到选中的历史版本。', '恢复可从旧版本追加生成一个新版本，避免直接覆盖当前进展。']},
        ],
        tips: ['重要改动前先保存快照。', '分支名要表达用途，例如 feature/重写王都线。'],
    },
]

const HELP_TOPIC_KEYS = new Set(HELP_TOPICS.map(topic => topic.key))

function normalizeTopicKey(topicKey?: string | null): HelpTopicKey {
    return HELP_TOPIC_KEYS.has(topicKey as HelpTopicKey) ? (topicKey as HelpTopicKey) : 'getting-started'
}

export function useHelpPanel({
    panelMode,
    topicKey,
    topicSignal,
    onTogglePanelMode,
    onToggleCollapsed,
}: UseHelpPanelOptions = {}): HelpPanelSlots {
    const [activeTopicKey, setActiveTopicKey] = useState<HelpTopicKey>(() => normalizeTopicKey(topicKey))
    const [sidebarCollapsed, setSidebarCollapsed] = useState(true)

    useEffect(() => {
        if (!topicKey) return
        setActiveTopicKey(normalizeTopicKey(topicKey))
    }, [topicKey, topicSignal])

    useEffect(() => {
        if (panelMode === 'fullscreen') {
            setSidebarCollapsed(false)
            return
        }
        if (panelMode === 'floating') {
            setSidebarCollapsed(true)
        }
    }, [panelMode])

    const activeTopic = useMemo(
        () => HELP_TOPICS.find(topic => topic.key === activeTopicKey) ?? HELP_TOPICS[0],
        [activeTopicKey],
    )

    const sideContent = (
        <DockPanelSide className="help-side">
            <DockPanelTopbar className="help-side__topbar" variant="side">
                <DockPanelTitle>帮助目录</DockPanelTitle>
                {panelMode !== 'fullscreen' ? (
                    <DockPanelIconButton
                        type="button"
                        className="help-side__toggle"
                        onClick={() => setSidebarCollapsed(true)}
                        title="收起目录"
                    >
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                            <path d="M10 3 5 8l5 5"/>
                        </svg>
                    </DockPanelIconButton>
                ) : null}
            </DockPanelTopbar>
            <div className="help-side__list">
                {HELP_TOPICS.map(topic => (
                    <button
                        key={topic.key}
                        type="button"
                        className={`help-side__item${topic.key === activeTopicKey ? ' is-active' : ''}`}
                        onClick={() => {
                            setActiveTopicKey(topic.key)
                            if (panelMode !== 'fullscreen') {
                                setSidebarCollapsed(true)
                            }
                        }}
                    >
                        <span className="help-side__item-title">{topic.label}</span>
                        <span className="help-side__item-summary">{topic.summary}</span>
                    </button>
                ))}
            </div>
        </DockPanelSide>
    )

    const mainContent = (
        <DockPanelMain className="help-main">
            <DockPanelTopbar className="help-main__topbar">
                <div className="help-main__topbar-left">
                    {panelMode !== 'fullscreen' && sidebarCollapsed ? (
                        <DockPanelIconButton
                            type="button"
                            className="help-main__sidebar-toggle"
                            onClick={() => setSidebarCollapsed(false)}
                            title="展开目录"
                        >
                            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                                <path d="M6 3 11 8l-5 5"/>
                            </svg>
                        </DockPanelIconButton>
                    ) : null}
                    <DockPanelTitle>帮助中心</DockPanelTitle>
                </div>
                <div className="help-main__topbar-actions">
                    <DockPanelIconButton
                        type="button"
                        onClick={() => onTogglePanelMode?.()}
                        title={panelMode === 'fullscreen' ? '退出全屏' : '全屏模式'}
                    >
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                            {panelMode === 'fullscreen' ? (
                                <path d="M4 10v2h2M10 12h2v-2M12 4v2h-2M6 4H4v2"/>
                            ) : (
                                <path d="M2 6V2h4M14 6V2h-4M2 10v4h4M14 10v4h-4"/>
                            )}
                        </svg>
                    </DockPanelIconButton>
                    <DockPanelIconButton type="button" onClick={() => onToggleCollapsed?.()} title="最小化">
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                            <path d="M6 4l4 4-4 4"/>
                        </svg>
                    </DockPanelIconButton>
                </div>
            </DockPanelTopbar>
            <div className="help-main__body">
                <header className="help-main__header">
                    <span className="help-main__eyebrow">FlowCloudAI 使用指南</span>
                    <h2>{activeTopic.label}</h2>
                    <p>{activeTopic.summary}</p>
                </header>
                <div className="help-main__section-grid">
                    {activeTopic.sections.map(section => (
                        <section className="help-main__section" key={section.title}>
                            <h3>{section.title}</h3>
                            <ul>
                                {section.items.map(item => <li key={item}>{item}</li>)}
                            </ul>
                        </section>
                    ))}
                </div>
                <section className="help-main__tips">
                    <h3>注意事项</h3>
                    <ul>
                        {activeTopic.tips.map(tip => <li key={tip}>{tip}</li>)}
                    </ul>
                </section>
            </div>
        </DockPanelMain>
    )

    if (panelMode === 'fullscreen') {
        return {side: sideContent, main: mainContent}
    }

    return {
        side: null,
        main: (
            <div className={`help-panel${sidebarCollapsed ? ' sidebar-collapsed' : ''}`}>
                {!sidebarCollapsed ? (
                    <button
                        type="button"
                        className="help-panel__sidebar-backdrop"
                        aria-label="关闭帮助目录"
                        onClick={() => setSidebarCollapsed(true)}
                    />
                ) : null}
                {sideContent}
                {mainContent}
            </div>
        ),
    }
}
