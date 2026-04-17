import {command} from './base'

export type IdeaNoteStatus = 'inbox' | 'processed' | 'archived'

export interface IdeaNote {
    id: string
    project_id?: string | null
    content: string
    title?: string | null
    status: IdeaNoteStatus
    pinned: boolean
    created_at: string
    updated_at: string
    last_reviewed_at?: string | null
    converted_entry_id?: string | null
}

export interface CreateIdeaNoteParams {
    projectId?: string | null
    content: string
    title?: string | null
    pinned?: boolean | null
}

export interface UpdateIdeaNoteParams {
    id: string
    title?: string | null | undefined
    content?: string | null
    status?: IdeaNoteStatus | null
    pinned?: boolean | null
    lastReviewedAt?: string | null | undefined
    convertedEntryId?: string | null | undefined
}

export interface ListIdeaNotesParams {
    projectId?: string | null
    onlyGlobal?: boolean
    status?: IdeaNoteStatus | null
    pinned?: boolean | null
    limit: number
    offset: number
}

export const db_create_idea_note = ({
                                        projectId,
                                        content,
                                        title,
                                        pinned,
                                    }: CreateIdeaNoteParams) =>
    command<IdeaNote>('db_create_idea_note', {
        projectId,
        content,
        title,
        pinned,
    })

export const db_get_idea_note = (id: string) =>
    command<IdeaNote>('db_get_idea_note', {id})

export const db_list_idea_notes = ({
                                       projectId,
                                       onlyGlobal,
                                       status,
                                       pinned,
                                       limit,
                                       offset,
                                   }: ListIdeaNotesParams) =>
    command<IdeaNote[]>('db_list_idea_notes', {
        projectId,
        onlyGlobal,
        status,
        pinned,
        limit,
        offset,
    })

export const db_update_idea_note = ({
                                        id,
                                        title,
                                        content,
                                        status,
                                        pinned,
                                        lastReviewedAt,
                                        convertedEntryId,
                                    }: UpdateIdeaNoteParams) =>
    command<IdeaNote>('db_update_idea_note', {
        id,
        title: title === undefined ? undefined : title,
        content: content ?? undefined,
        status: status ?? undefined,
        pinned: pinned ?? undefined,
        lastReviewedAt: lastReviewedAt === undefined ? undefined : lastReviewedAt,
        convertedEntryId: convertedEntryId === undefined ? undefined : convertedEntryId,
    })

export const db_delete_idea_note = (id: string) =>
    command<void>('db_delete_idea_note', {id})
