import {useCallback, useMemo, useState} from 'react'
import type {EntryRelation} from '../../../api'
import type {EntryRelationDraft} from '../../project-editor/components/EntryRelationCreator'
import {areRelationDraftsEqual, buildRelationDraft, hasInvalidRelationDraft} from '../lib/entryRelation'

export default function useEntryRelationState(entryId: string) {
    const [entryRelations, setEntryRelations] = useState<EntryRelation[]>([])
    const [relationDrafts, setRelationDrafts] = useState<EntryRelationDraft[]>([])

    const initialRelationDrafts = useMemo(
        () => entryRelations.map((relation) => buildRelationDraft(entryId, relation)),
        [entryId, entryRelations],
    )
    const hasRelationChanges = useMemo(
        () => !areRelationDraftsEqual(relationDrafts, initialRelationDrafts),
        [initialRelationDrafts, relationDrafts],
    )
    const hasInvalidRelationDrafts = useMemo(
        () => relationDrafts.some((item) => hasInvalidRelationDraft(item, entryId)),
        [entryId, relationDrafts],
    )

    const clearRelations = useCallback(() => {
        setEntryRelations([])
        setRelationDrafts([])
    }, [])

    const applySavedRelations = useCallback((relations: EntryRelation[], draftEntryId = entryId) => {
        setEntryRelations(relations)
        setRelationDrafts(relations.map((relation) => buildRelationDraft(draftEntryId, relation)))
    }, [entryId])

    return {
        entryRelations,
        setEntryRelations,
        relationDrafts,
        setRelationDrafts,
        initialRelationDrafts,
        hasRelationChanges,
        hasInvalidRelationDrafts,
        clearRelations,
        applySavedRelations,
    }
}
