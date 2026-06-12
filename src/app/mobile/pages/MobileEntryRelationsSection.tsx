import {type Category, type EntryBrief} from '../../../api'
import EntryRelationCreator, {type EntryRelationDraft} from '../../../features/project-editor/components/EntryRelationCreator'

interface MobileEntryRelationsSectionProps {
    relationDrafts: EntryRelationDraft[]
    entries: EntryBrief[]
    categories: Category[]
    currentEntryId: string
    disabled: boolean
    onChange: (drafts: EntryRelationDraft[]) => void
    onOpenEntry: (entry: { id: string; title: string }) => void
}

export function MobileEntryRelationsSection({
    relationDrafts,
    entries,
    categories,
    currentEntryId,
    disabled,
    onChange,
    onOpenEntry,
}: MobileEntryRelationsSectionProps) {
    return (
        <section className="mobile-entry-detail__relations mobile-entry-detail__form-section">
            <div className="mobile-entry-detail__relations-header">
                <div className="mobile-entry-detail__relations-label">关系</div>
            </div>
            <EntryRelationCreator
                drafts={relationDrafts}
                entries={entries}
                categories={categories}
                currentEntryId={currentEntryId}
                disabled={disabled}
                onChange={onChange}
                onOpenEntry={onOpenEntry}
            />
        </section>
    )
}
