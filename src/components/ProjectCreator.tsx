import {useEffect, useState} from 'react'
import {createPortal} from 'react-dom'
import {Button, useAlert} from 'flowcloudai-ui'
import {db_create_project, type Project} from '../api'
import './ProjectCreator.css'

interface ProjectCreatorProps {
    open: boolean
    onClose: () => void
    onCreated?: (project: Project) => void
    existingNames?: string[]
}

export default function ProjectCreator({open, onClose, onCreated, existingNames = []}: ProjectCreatorProps) {
    const [name, setName] = useState('')
    const [description, setDescription] = useState('')
    const [submitting, setSubmitting] = useState(false)
    const [apiError, setApiError] = useState<string | null>(null)
    const {showAlert} = useAlert()

    useEffect(() => {
        if (open) {
            queueMicrotask(() => {
                setName('')
                setDescription('')
                setApiError(null)
                setSubmitting(false)
            })
        }
    }, [open])

    useEffect(() => {
        if (!open) return
        const handler = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && !submitting) onClose()
        }
        window.addEventListener('keydown', handler)
        return () => window.removeEventListener('keydown', handler)
    }, [open, submitting, onClose])

    const trimmedName = name.trim()
    const isDuplicate = trimmedName.length > 0 &&
        existingNames.some(n => n.trim().toLowerCase() === trimmedName.toLowerCase())
    const canSubmit = trimmedName.length > 0 && !isDuplicate && !submitting

    async function handleSubmit() {
        if (!canSubmit) return
        setSubmitting(true)
        setApiError(null)
        try {
            const project = await db_create_project({
                name: trimmedName,
                description: description.trim() || null,
            })
            void showAlert('世界观已创建', 'success', 'toast', 1000)
            onCreated?.(project)
            onClose()
        } catch (e) {
            setApiError(String(e))
            setSubmitting(false)
        }
    }

    if (!open) return null

    return createPortal(
        <div
            className="project-creator-backdrop"
            onClick={e => {
                if (e.target === e.currentTarget && !submitting) onClose()
            }}
        >
            <div className="project-creator-dialog" role="dialog" aria-modal="true" aria-label="新建世界观">
                <div className="project-creator-header">
                    <span className="project-creator-title">新建世界观</span>
                    <button
                        className="project-creator-close"
                        onClick={onClose}
                        disabled={submitting}
                        aria-label="关闭"
                    >
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                            <path d="M1 1l10 10M11 1L1 11" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"/>
                        </svg>
                    </button>
                </div>

                <div className="project-creator-body">
                    <div className="project-creator-field">
                        <label className="project-creator-label">
                            世界观名称
                            <span className="project-creator-required" aria-hidden="true"> *</span>
                        </label>
                        <input
                            className="project-creator-input"
                            value={name}
                            onChange={e => setName(e.target.value)}
                            onKeyDown={e => {
                                if (e.key === 'Enter') void handleSubmit()
                            }}
                            placeholder="给你的世界取个名字…"
                            disabled={submitting}
                            autoFocus
                            maxLength={120}
                        />
                        {isDuplicate && (
                            <p className="project-creator-field-hint error">已有同名世界观，请换一个名字</p>
                        )}
                    </div>

                    <div className="project-creator-field">
                        <label className="project-creator-label">简介</label>
                        <textarea
                            className="project-creator-textarea"
                            value={description}
                            onChange={e => setDescription(e.target.value)}
                            placeholder="用一两句话描述这个世界…（可选）"
                            rows={3}
                            disabled={submitting}
                            maxLength={500}
                        />
                    </div>

                    {apiError && (
                        <p className="project-creator-api-error">创建失败：{apiError}</p>
                    )}
                </div>

                <div className="project-creator-footer">
                    <Button variant="ghost" size="sm" onClick={onClose} disabled={submitting}>
                        取消
                    </Button>
                    <Button size="sm" disabled={!canSubmit} onClick={() => void handleSubmit()}>
                        {submitting ? '创建中…' : '创建'}
                    </Button>
                </div>
            </div>
        </div>,
        document.body
    )
}
