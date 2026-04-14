import type {EntryRelation, RelationDirection} from '../../api'
import type {EntryRelationDraft} from '../project-editor/EntryRelationCreator'

export function buildRelationDraft(entryId: string, relation: EntryRelation): EntryRelationDraft {
    if (relation.relation === 'two_way') {
        return {
            id: relation.id,
            otherEntryId: relation.a_id === entryId ? relation.b_id : relation.a_id,
            direction: 'two_way',
            content: relation.content ?? '',
        }
    }

    return {
        id: relation.id,
        otherEntryId: relation.a_id === entryId ? relation.b_id : relation.a_id,
        direction: relation.a_id === entryId ? 'outgoing' : 'incoming',
        content: relation.content ?? '',
    }
}

export function buildComparableRelationDrafts(drafts: EntryRelationDraft[]): string[] {
    return drafts
        .map((draft) => [
            draft.id ?? '',
            draft.otherEntryId ?? '',
            draft.direction,
            (draft.content ?? '').replace(/\r\n?/g, '\n').trim(),
        ].join('|'))
        .sort()
}

export function areRelationDraftsEqual(left: EntryRelationDraft[], right: EntryRelationDraft[]): boolean {
    if (left.length !== right.length) return false
    const leftComparable = buildComparableRelationDrafts(left)
    const rightComparable = buildComparableRelationDrafts(right)
    return leftComparable.every((item, index) => item === rightComparable[index])
}

export function hasInvalidRelationDraft(draft: EntryRelationDraft, entryId: string): boolean {
    return !draft.otherEntryId || draft.otherEntryId === entryId
}

export function resolveRelationPayload(
    entryId: string,
    draft: EntryRelationDraft,
): { aId: string; bId: string; relation: RelationDirection; content: string } {
    const otherEntryId = draft.otherEntryId ?? ''
    if (draft.direction === 'incoming') {
        return {
            aId: otherEntryId,
            bId: entryId,
            relation: 'one_way',
            content: (draft.content ?? '').replace(/\r\n?/g, '\n').trim(),
        }
    }

    if (draft.direction === 'two_way') {
        return {
            aId: entryId,
            bId: otherEntryId,
            relation: 'two_way',
            content: (draft.content ?? '').replace(/\r\n?/g, '\n').trim(),
        }
    }

    return {
        aId: entryId,
        bId: otherEntryId,
        relation: 'one_way',
        content: (draft.content ?? '').replace(/\r\n?/g, '\n').trim(),
    }
}
