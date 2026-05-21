import type {HelpModuleKey, HelpTopicGroup, HelpTopicKey} from '../../../shared/help/helpCatalog'
import {DockPanelSearchInput} from '../../../shared/ui/layout/DockPanelSidebarControls'
import {
    DockPanelIconButton,
    DockPanelSide,
    DockPanelTitle,
    DockPanelTopbar,
} from '../../../shared/ui/layout/DockPanelScaffold'
import './HelpSidebar.css'

interface HelpSidebarProps {
    groups: HelpTopicGroup[]
    activeHome: boolean
    activeModuleKey: HelpModuleKey | null
    activeTopicKey: HelpTopicKey | null
    searchText: string
    showCollapseButton: boolean
    onSearchTextChange: (value: string) => void
    onSelectHome: () => void
    onSelectModule: (moduleKey: HelpModuleKey) => void
    onSelectTopic: (topicKey: HelpTopicKey) => void
    onCollapse: () => void
}

function HelpHomeIcon() {
    return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4 10.5 12 4l8 6.5V20H5.5a1.5 1.5 0 0 1-1.5-1.5v-8Z"/>
            <path d="M9 20v-6h6v6"/>
        </svg>
    )
}

function HelpModuleIcon({moduleKey}: { moduleKey: HelpModuleKey }) {
    switch (moduleKey) {
        case 'basics':
            return (
                <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M4 6.5 12 2l8 4.5v9L12 20l-8-4.5v-9Z"/>
                    <path d="M12 20v-9M4.5 7 12 11l7.5-4"/>
                </svg>
            )
        case 'knowledge':
            return (
                <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M5 6c0-2 14-2 14 0v12c0 2-14 2-14 0V6Z"/>
                    <path d="M5 6c0 2 14 2 14 0M5 12c0 2 14 2 14 0"/>
                    <path d="M16 15h4v4h-4z"/>
                </svg>
            )
        case 'ai':
            return (
                <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M8 12a4 4 0 1 1 8 0 4 4 0 0 1-8 0Z"/>
                    <path d="M4 12h4M16 12h4M12 4v4M12 16v4"/>
                    <path d="M6 6l2.5 2.5M17.5 15.5 20 18M18 6l-2.5 2.5M8.5 15.5 6 18"/>
                </svg>
            )
        case 'visualization':
            return (
                <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M4 6l5-2 6 3 5-2v13l-5 2-6-3-5 2V6Z"/>
                    <path d="M9 4v13M15 7v13"/>
                </svg>
            )
        case 'safety':
            return (
                <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M12 3 5 6v6c0 4.5 3 7.5 7 9 4-1.5 7-4.5 7-9V6l-7-3Z"/>
                    <path d="m9 12 2 2 4-5"/>
                </svg>
            )
    }
}

export default function HelpSidebar({
    groups,
    activeHome,
    activeModuleKey,
    activeTopicKey,
    searchText,
    showCollapseButton,
    onSearchTextChange,
    onSelectHome,
    onSelectModule,
    onSelectTopic,
    onCollapse,
}: HelpSidebarProps) {
    return (
        <DockPanelSide className="help-side">
            <DockPanelTopbar className="help-side__topbar" variant="side">
                <DockPanelTitle>帮助分类</DockPanelTitle>
                {showCollapseButton ? (
                    <DockPanelIconButton
                        type="button"
                        className="help-side__toggle"
                        onClick={onCollapse}
                        title="收起目录"
                        aria-label="收起帮助目录"
                    >
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                            <path d="M10 3 5 8l5 5"/>
                        </svg>
                    </DockPanelIconButton>
                ) : null}
            </DockPanelTopbar>
            <div className="help-side__controls">
                <DockPanelSearchInput
                    value={searchText}
                    onChange={onSearchTextChange}
                    placeholder="在目录中搜索"
                    ariaLabel="在目录中搜索"
                />
            </div>
            <div className="help-side__list" aria-label="帮助主题">
                <button
                    type="button"
                    className={`help-side__home-button${activeHome ? ' is-active' : ''}`}
                    aria-current={activeHome ? 'page' : undefined}
                    onClick={onSelectHome}
                >
                    <span className="help-side__module-icon">
                        <HelpHomeIcon/>
                    </span>
                    <span className="help-side__module-title">首页</span>
                </button>
                {groups.length > 0 ? groups.map(group => {
                    const activeInModule = group.module.key === activeModuleKey

                    return (
                        <section className={`help-side__module${activeInModule ? ' is-active' : ''}`} key={group.module.key}>
                            <button
                                type="button"
                                className="help-side__module-button"
                                onClick={() => onSelectModule(group.module.key)}
                            >
                                <span className="help-side__module-icon">
                                    <HelpModuleIcon moduleKey={group.module.key}/>
                                </span>
                                <span className="help-side__module-title">{group.module.label}</span>
                            </button>
                            {activeInModule ? (
                                <div className="help-side__topic-list" aria-label={`${group.module.label} 主题`}>
                                    {group.topics.map(topic => (
                                        <button
                                            key={topic.key}
                                            type="button"
                                            className={`help-side__topic-item${topic.key === activeTopicKey ? ' is-active' : ''}`}
                                            aria-current={topic.key === activeTopicKey ? 'page' : undefined}
                                            onClick={() => onSelectTopic(topic.key)}
                                        >
                                            {topic.label}
                                        </button>
                                    ))}
                                </div>
                            ) : null}
                        </section>
                    )
                }) : (
                    <div className="help-side__empty">
                        <strong>没有匹配内容</strong>
                        <span>换一个关键词试试。</span>
                    </div>
                )}
            </div>
        </DockPanelSide>
    )
}
