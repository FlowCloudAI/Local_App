import {createPortal} from 'react-dom'
import type {FcworldProgressState} from '../hooks/useFcworldProgress'
import './FcworldProgressDialog.css'

interface FcworldProgressDialogProps {
    progress: FcworldProgressState | null
}

export default function FcworldProgressDialog({progress}: FcworldProgressDialogProps) {
    if (!progress) return null

    const countText = progress.total > 0 ? `${progress.current}/${progress.total}` : ''

    return createPortal(
        <div className="fcworld-progress-layer" aria-live="polite">
            <div className="fcworld-progress-card" role="status" aria-label={progress.title}>
                <div className="fcworld-progress-header">
                    <span className="fcworld-progress-title">{progress.title}</span>
                    <span className={`fcworld-progress-status is-${progress.status}`}>
                        {progress.status === 'error' ? '失败' : progress.status === 'done' ? '完成' : '进行中'}
                    </span>
                </div>
                <div className="fcworld-progress-body">
                    <div className="fcworld-progress-message">{progress.message}</div>
                    {countText ? (
                        <div className="fcworld-progress-meta">
                            <span>{countText}</span>
                        </div>
                    ) : null}
                </div>
            </div>
        </div>,
        document.body,
    )
}
