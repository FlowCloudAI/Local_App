import {createPortal} from 'react-dom'
import type {FcworldProgressState} from '../hooks/useFcworldProgress'
import './FcworldProgressDialog.css'

interface FcworldProgressDialogProps {
    progress: FcworldProgressState | null
}

export default function FcworldProgressDialog({progress}: FcworldProgressDialogProps) {
    if (!progress) return null

    const countText = progress.total > 0 ? `${progress.current}/${progress.total}` : ''
    const percent = Math.max(0, Math.min(100, progress.percent))

    return createPortal(
        <div className="fcworld-progress-backdrop">
            <div className="fcworld-progress-dialog" role="dialog" aria-modal="true" aria-label={progress.title}>
                <div className="fcworld-progress-header">
                    <span className="fcworld-progress-title">{progress.title}</span>
                    <span className={`fcworld-progress-status is-${progress.status}`}>
                        {progress.status === 'error' ? '失败' : progress.status === 'done' ? '完成' : '进行中'}
                    </span>
                </div>
                <div className="fcworld-progress-body">
                    <div className="fcworld-progress-message">{progress.message}</div>
                    <div
                        className="fcworld-progress-track"
                        role="progressbar"
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={percent}
                    >
                        <div className="fcworld-progress-fill" style={{width: `${percent}%`}} />
                    </div>
                    <div className="fcworld-progress-meta">
                        <span>{percent}%</span>
                        {countText ? <span>{countText}</span> : <span>{progress.phase}</span>}
                    </div>
                </div>
            </div>
        </div>,
        document.body,
    )
}
