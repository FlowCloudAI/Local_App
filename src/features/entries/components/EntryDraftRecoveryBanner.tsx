/**
 * 词条草稿恢复提示；集中列出可恢复字段，由用户一次性选择。
 */
import {Button} from 'flowcloudai-ui'
import {useEffect, useState} from 'react'
import type {
    EntryDraftRecoveryField,
    EntryDraftRecoveryKind,
    EntryDraftRecoveryRecord,
} from '../lib/entryDraftRecovery'

interface EntryDraftRecoveryBannerProps {
    record: EntryDraftRecoveryRecord
    kind: EntryDraftRecoveryKind
    fields: EntryDraftRecoveryField[]
    onRestore: (fields: EntryDraftRecoveryField[]) => void
    onDiscard: () => void
}

const FIELD_LABELS: Record<EntryDraftRecoveryField, string> = {
    title: '标题',
    summary: '摘要',
    content: '正文',
    type: '词条类型',
    categoryId: '所属分类',
    tags: '标签',
    images: '图片',
    relationDrafts: '词条关系',
}

export default function EntryDraftRecoveryBanner({
    record,
    kind,
    fields,
    onRestore,
    onDiscard,
}: EntryDraftRecoveryBannerProps) {
    const savedAt = new Date(record.savedAt).toLocaleString()
    const [selectedFields, setSelectedFields] = useState<EntryDraftRecoveryField[]>(fields)

    useEffect(() => {
        setSelectedFields(fields)
    }, [fields])

    return (
        <div
            className={`entry-editor-recovery-banner is-${kind}`}
            role={kind === 'stale' ? 'alert' : 'status'}
        >
            <div className="entry-editor-recovery-banner__copy">
                <strong>{kind === 'current' ? '发现未保存的词条草稿' : '发现基于旧版本的词条草稿'}</strong>
                <span>
                    {kind === 'current'
                        ? `恢复点：${savedAt}`
                        : `草稿保存于 ${savedAt}；正式词条此后已更新，不会自动覆盖。`}
                </span>
                <fieldset className="entry-editor-recovery-banner__fields">
                    <legend>选择要恢复的内容</legend>
                    {fields.map((field) => (
                        <label key={field}>
                            <input
                                type="checkbox"
                                checked={selectedFields.includes(field)}
                                onChange={(event) => {
                                    setSelectedFields((current) => (
                                        event.target.checked
                                            ? [...current, field]
                                            : current.filter((item) => item !== field)
                                    ))
                                }}
                            />
                            <span>{FIELD_LABELS[field]}</span>
                        </label>
                    ))}
                </fieldset>
            </div>
            <div className="entry-editor-recovery-banner__actions">
                <Button
                    type="button"
                    size="sm"
                    disabled={selectedFields.length === 0}
                    onClick={() => onRestore(selectedFields)}
                >
                    恢复所选
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={onDiscard}>放弃草稿</Button>
            </div>
        </div>
    )
}
