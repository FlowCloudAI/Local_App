import type {RefObject} from 'react'
import {
    getHelpModule,
    getHelpSectionDomId,
    type HelpTopic,
} from '../../../shared/help/helpCatalog'
import './HelpArticle.css'

interface HelpArticleProps {
    topic: HelpTopic
    activeSectionId: string | null
    bodyRef: RefObject<HTMLDivElement | null>
    onSelectSection: (sectionId: string) => void
}

export default function HelpArticle({
    topic,
    activeSectionId,
    bodyRef,
    onSelectSection,
}: HelpArticleProps) {
    const module = getHelpModule(topic.moduleKey)

    return (
        <div className="help-main__body" ref={bodyRef}>
            <article className="help-doc">
                <header className="help-doc__header">
                    <div className="help-doc__crumb">帮助中心 / {module.label} / {topic.category}</div>
                    <h2>{topic.label}</h2>
                    <p>{topic.summary}</p>
                    <div className="help-doc__meta" aria-label="文档信息">
                        <span>{topic.readingTime}</span>
                        <span>{topic.sections.length} 个小节</span>
                    </div>
                </header>

                <nav className="help-doc__toc" aria-label="本篇目录">
                    <div className="help-doc__toc-title">本篇目录</div>
                    <div className="help-doc__toc-list">
                        {topic.sections.map((section, index) => (
                            <button
                                key={section.id}
                                type="button"
                                className={`help-doc__toc-item${section.id === activeSectionId ? ' is-active' : ''}`}
                                onClick={() => onSelectSection(section.id)}
                            >
                                <span>{String(index + 1).padStart(2, '0')}</span>
                                {section.title}
                            </button>
                        ))}
                    </div>
                </nav>

                <div className="help-doc__sections">
                    {topic.sections.map((section, index) => (
                        <section
                            className={`help-doc__section${section.id === activeSectionId ? ' is-highlighted' : ''}`}
                            id={getHelpSectionDomId(topic.key, section.id)}
                            key={section.id}
                        >
                            <div className="help-doc__section-number">{String(index + 1).padStart(2, '0')}</div>
                            <div className="help-doc__section-content">
                                <h3>{section.title}</h3>
                                <p>{section.lead}</p>
                                {section.figure ? (
                                    <figure className="help-doc__figure">
                                        <img src={section.figure.src} alt={section.figure.alt} loading="lazy"/>
                                        <figcaption>{section.figure.caption}</figcaption>
                                    </figure>
                                ) : null}
                                <ul className="help-doc__step-list">
                                    {section.items.map(item => <li key={item}>{item}</li>)}
                                </ul>
                            </div>
                        </section>
                    ))}
                </div>

                <aside className="help-doc__tips" aria-label="注意事项">
                    <h3>注意事项</h3>
                    <ul>
                        {topic.tips.map(tip => <li key={tip}>{tip}</li>)}
                    </ul>
                </aside>
            </article>
        </div>
    )
}
