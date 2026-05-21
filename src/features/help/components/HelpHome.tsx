import type {RefObject} from 'react'
import {
    HELP_HOME_LINKS,
    type HelpModuleKey,
    type HelpTopicGroup,
    type HelpTopicKey,
} from '../../../shared/help/helpCatalog'
import './HelpHome.css'

interface HelpHomeProps {
    groups: HelpTopicGroup[]
    bodyRef: RefObject<HTMLDivElement | null>
    onSelectModule: (moduleKey: HelpModuleKey) => void
    onSelectTopic: (topicKey: HelpTopicKey, sectionId?: string) => void
}

export default function HelpHome({
    groups,
    bodyRef,
    onSelectModule,
    onSelectTopic,
}: HelpHomeProps) {
    const topicCount = groups.reduce((total, group) => total + group.topics.length, 0)

    return (
        <div className="help-main__body" ref={bodyRef}>
            <article className="help-index">
                <header className="help-index__header">
                    <div className="help-index__crumb">帮助中心</div>
                    <h2>帮助首页</h2>
                    <p>按模块查找 FlowCloudAI 的核心操作说明，或从常用入口快速进入具体文档。</p>
                    <div className="help-index__meta" aria-label="帮助首页信息">
                        <span>{groups.length} 个分类</span>
                        <span>{topicCount} 篇文档</span>
                    </div>
                </header>

                <section className="help-index__section" aria-labelledby="help-index-quick">
                    <h3 id="help-index-quick">常用入口</h3>
                    <div className="help-index__quick-list">
                        {HELP_HOME_LINKS.map(link => (
                            <button
                                key={link.key}
                                type="button"
                                className="help-index__quick-item"
                                onClick={() => onSelectTopic(link.topicKey, link.sectionId)}
                            >
                                <strong>{link.title}</strong>
                                <span>{link.description}</span>
                            </button>
                        ))}
                    </div>
                </section>

                <section className="help-index__section" aria-labelledby="help-index-modules">
                    <h3 id="help-index-modules">文档分类</h3>
                    <div className="help-index__module-list">
                        {groups.map(group => (
                            <section className="help-index__module" key={group.module.key}>
                                <button
                                    type="button"
                                    className="help-index__module-title"
                                    onClick={() => onSelectModule(group.module.key)}
                                >
                                    <span>{group.module.label}</span>
                                    <em>{group.topics.length} 篇</em>
                                </button>
                                <p>{group.module.description}</p>
                                <div className="help-index__topic-links" aria-label={`${group.module.label} 文档`}>
                                    {group.topics.map(topic => (
                                        <button
                                            key={topic.key}
                                            type="button"
                                            onClick={() => onSelectTopic(topic.key)}
                                        >
                                            {topic.label}
                                        </button>
                                    ))}
                                </div>
                            </section>
                        ))}
                    </div>
                </section>
            </article>
        </div>
    )
}
