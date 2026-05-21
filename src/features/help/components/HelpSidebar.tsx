import type {HelpTopicGroup, HelpTopicKey} from '../../../shared/help/helpCatalog'
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
    activeTopicKey: HelpTopicKey
    activeSectionId: string | null
    searchText: string
    showCollapseButton: boolean
    onSearchTextChange: (value: string) => void
    onSelectTopic: (topicKey: HelpTopicKey) => void
    onSelectSection: (sectionId: string) => void
    onCollapse: () => void
}

export default function HelpSidebar({
    groups,
    activeTopicKey,
    activeSectionId,
    searchText,
    showCollapseButton,
    onSearchTextChange,
    onSelectTopic,
    onSelectSection,
    onCollapse,
}: HelpSidebarProps) {
    return (
        <DockPanelSide className="help-side">
            <DockPanelTopbar className="help-side__topbar" variant="side">
                <DockPanelTitle>帮助目录</DockPanelTitle>
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
                    placeholder="搜索帮助内容"
                    ariaLabel="搜索帮助内容"
                />
            </div>
            <div className="help-side__list" aria-label="帮助主题">
                {groups.length > 0 ? groups.map(group => (
                    <section className="help-side__module" key={group.module.key}>
                        <div className="help-side__module-header">
                            <span className="help-side__module-title">{group.module.label}</span>
                            <span className="help-side__module-count">{group.topics.length}</span>
                        </div>
                        <div className="help-side__module-desc">{group.module.description}</div>
                        <div className="help-side__module-list">
                            {group.topics.map(topic => (
                                <div className="help-side__topic" key={topic.key}>
                                    <button
                                        type="button"
                                        className={`help-side__item${topic.key === activeTopicKey ? ' is-active' : ''}`}
                                        aria-current={topic.key === activeTopicKey ? 'page' : undefined}
                                        onClick={() => onSelectTopic(topic.key)}
                                    >
                                        <span className="help-side__item-meta">{topic.category}</span>
                                        <span className="help-side__item-title">{topic.label}</span>
                                        <span className="help-side__item-summary">{topic.summary}</span>
                                    </button>
                                    {topic.key === activeTopicKey ? (
                                        <div className="help-side__section-list" aria-label={`${topic.label} 小节`}>
                                            {topic.sections.map(section => (
                                                <button
                                                    key={section.id}
                                                    type="button"
                                                    className={`help-side__section-item${section.id === activeSectionId ? ' is-active' : ''}`}
                                                    onClick={() => onSelectSection(section.id)}
                                                >
                                                    {section.title}
                                                </button>
                                            ))}
                                        </div>
                                    ) : null}
                                </div>
                            ))}
                        </div>
                    </section>
                )) : (
                    <div className="help-side__empty">
                        <strong>没有匹配内容</strong>
                        <span>换一个关键词试试。</span>
                    </div>
                )}
            </div>
        </DockPanelSide>
    )
}
