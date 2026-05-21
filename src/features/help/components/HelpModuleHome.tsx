import type {RefObject} from 'react'
import type {HelpFigure, HelpModule, HelpTopic, HelpTopicKey} from '../../../shared/help/helpCatalog'
import './HelpModuleHome.css'

interface HelpModuleHomeProps {
    module: HelpModule
    topics: HelpTopic[]
    bodyRef: RefObject<HTMLDivElement | null>
    onSelectHome: () => void
    onSelectTopic: (topicKey: HelpTopicKey, sectionId?: string) => void
}

function findLeadFigure(topics: HelpTopic[]): HelpFigure | null {
    for (const topic of topics) {
        const section = topic.sections.find(item => item.figure)
        if (section?.figure) return section.figure
    }
    return null
}

export default function HelpModuleHome({
    module,
    topics,
    bodyRef,
    onSelectHome,
    onSelectTopic,
}: HelpModuleHomeProps) {
    const leadFigure = findLeadFigure(topics)
    const sectionCount = topics.reduce((total, topic) => total + topic.sections.length, 0)

    return (
        <div className="help-main__body" ref={bodyRef}>
            <article className="help-home">
                <button type="button" className="help-content-home-button" onClick={onSelectHome}>
                    <svg viewBox="0 0 16 16" aria-hidden="true">
                        <path d="M9.5 3.5 5 8l4.5 4.5"/>
                    </svg>
                    返回首页
                </button>
                <header className={`help-home__header${leadFigure ? ' has-figure' : ''}`}>
                    <div className="help-home__intro">
                        <div className="help-home__crumb">帮助中心 / {module.label}</div>
                        <h2>{module.label}</h2>
                        <p>{module.description}</p>
                        <div className="help-home__meta" aria-label="模块信息">
                            <span>{topics.length} 篇文档</span>
                            <span>{sectionCount} 个小节</span>
                        </div>
                    </div>
                    {leadFigure ? (
                        <figure className="help-home__figure">
                            <img src={leadFigure.src} alt={leadFigure.alt} loading="lazy"/>
                            <figcaption>{leadFigure.caption}</figcaption>
                        </figure>
                    ) : null}
                </header>

                <section className="help-home__section" aria-labelledby="help-home-recommended">
                    <h3 id="help-home-recommended">推荐阅读</h3>
                    <div className="help-home__featured-list">
                        {topics.map(topic => (
                            <button
                                key={topic.key}
                                type="button"
                                className="help-home__featured-item"
                                onClick={() => onSelectTopic(topic.key)}
                            >
                                <span>{topic.category} / {topic.readingTime}</span>
                                <strong>{topic.label}</strong>
                                <em>{topic.summary}</em>
                            </button>
                        ))}
                    </div>
                </section>

                <section className="help-home__section" aria-labelledby="help-home-topics">
                    <h3 id="help-home-topics">本模块内容</h3>
                    <div className="help-home__topic-list">
                        {topics.map(topic => (
                            <section className="help-home__topic-row" key={topic.key}>
                                <div className="help-home__topic-summary">
                                    <button
                                        type="button"
                                        className="help-home__topic-title"
                                        onClick={() => onSelectTopic(topic.key)}
                                    >
                                        {topic.label}
                                    </button>
                                    <p>{topic.summary}</p>
                                </div>
                                <div className="help-home__section-links" aria-label={`${topic.label} 小节`}>
                                    {topic.sections.map(section => (
                                        <button
                                            key={section.id}
                                            type="button"
                                            onClick={() => onSelectTopic(topic.key, section.id)}
                                        >
                                            {section.title}
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
