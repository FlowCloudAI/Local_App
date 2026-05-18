import {useEffect, useMemo, useState} from 'react'
import {createPortal} from 'react-dom'
import {Button} from 'flowcloudai-ui'
import type {FcworldImportPreview} from '../../../api'
import './ProjectImportConflictDialog.css'

interface ProjectImportConflictDialogProps {
    open: boolean
    preview: FcworldImportPreview | null
    existingNames?: string[]
    busy?: boolean
    onCancel: () => void
    onRename: (projectName: string) => void
    onOverwrite: () => void
}

export default function ProjectImportConflictDialog({
                                                        open,
                                                        preview,
                                                        existingNames = [],
                                                        busy = false,
                                                        onCancel,
                                                        onRename,
                                                        onOverwrite,
                                                    }: ProjectImportConflictDialogProps) {
    const [projectName, setProjectName] = useState('')

    useEffect(() => {
        if (open && preview) {
            setProjectName(preview.suggestedName)
        }
    }, [open, preview])

    useEffect(() => {
        if (!open) return
        const handler = (event: KeyboardEvent) => {
            if (event.key === 'Escape' && !busy) onCancel()
        }
        window.addEventListener('keydown', handler)
        return () => window.removeEventListener('keydown', handler)
    }, [busy, onCancel, open])

    const trimmedName = projectName.trim()
    const isDuplicate = useMemo(() => {
        if (!trimmedName) return false
        const normalized = trimmedName.toLowerCase()
        return existingNames.some(name => name.trim().toLowerCase() === normalized)
    }, [existingNames, trimmedName])
    const canRename = trimmedName.length > 0 && !isDuplicate && !busy

    if (!open || !preview || !preview.duplicateProject) return null

    return createPortal(
        <div
            className="project-import-conflict-backdrop"
            onClick={event => {
                if (event.target === event.currentTarget && !busy) onCancel()
            }}
        >
            <div className="project-import-conflict-dialog" role="dialog" aria-modal="true" aria-label="导入世界观重名处理">
                <div className="project-import-conflict-header">
                    <span className="project-import-conflict-title">发现同名世界观</span>
                </div>
                <div className="project-import-conflict-body">
                    <p className="project-import-conflict-message">
                        当前已有“{preview.duplicateProject.projectName}”，请选择如何处理导入包中的“{preview.projectName}”。
                    </p>
                    <label className="project-import-conflict-field">
                        <span>重命名为</span>
                        <input
                            className="project-import-conflict-input"
                            value={projectName}
                            onChange={event => setProjectName(event.target.value)}
                            disabled={busy}
                            maxLength={120}
                            autoFocus
                        />
                    </label>
                    {isDuplicate && (
                        <p className="project-import-conflict-error">已有同名世界观，请换一个名称或选择覆盖</p>
                    )}
                </div>
                <div className="project-import-conflict-footer">
                    <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={busy}>
                        取消
                    </Button>
                    <Button
                        type="button"
                        size="sm"
                        disabled={!canRename}
                        onClick={() => onRename(trimmedName)}
                    >
                        重命名导入
                    </Button>
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => onOverwrite()}
                        disabled={busy}
                    >
                        覆盖
                    </Button>
                </div>
            </div>
        </div>,
        document.body,
    )
}
