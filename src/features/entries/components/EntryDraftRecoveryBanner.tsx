/**
 * 正文恢复提示；当前版本自动恢复，旧版本草稿必须由用户明确选择。
 */
import {Button} from 'flowcloudai-ui'
import type {EntryDraftRecoveryRecord} from '../lib/entryDraftRecovery'

interface EntryDraftRecoveryBannerProps {
    record: EntryDraftRecoveryRecord
    mode: 'restored' | 'stale'
    onRestore: () => void
    onDiscard: () => void
    onDismiss: () => void
}

export default function EntryDraftRecoveryBanner({
    record,
    mode,
    onRestore,
    onDiscard,
    onDismiss,
}: EntryDraftRecoveryBannerProps) {
    const savedAt = new Date(record.savedAt).toLocaleString()

    return (
        <div
            className={`entry-editor-recovery-banner is-${mode}`}
            role={mode === 'stale' ? 'alert' : 'status'}
        >
            <div className="entry-editor-recovery-banner__copy">
                <strong>{mode === 'restored' ? '已恢复未保存的正文草稿' : '发现基于旧版本的正文草稿'}</strong>
                <span>
                    {mode === 'restored'
                        ? `恢复点：${savedAt}`
                        : `草稿保存于 ${savedAt}；正式词条此后已更新，不会自动覆盖。`}
                </span>
            </div>
            <div className="entry-editor-recovery-banner__actions">
                {mode === 'stale' && (
                    <>
                        <Button type="button" size="sm" onClick={onRestore}>恢复旧草稿</Button>
                        <Button type="button" variant="outline" size="sm" onClick={onDiscard}>放弃草稿</Button>
                    </>
                )}
                {mode === 'restored' && (
                    <Button type="button" variant="ghost" size="sm" onClick={onDismiss}>知道了</Button>
                )}
            </div>
        </div>
    )
}
