import {command} from './base'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface Project {
    id: string
    name: string
    description?: string | null
    cover_path?: string | null
    created_at?: string | null
    updated_at?: string | null

    [key: string]: unknown
}

export interface Category {
    id: string
    project_id: string
    parent_id?: string | null
    name: string
    sort_order: number
    created_at: string
    updated_at: string

    [key: string]: unknown
}

export interface EntryTag {
    schema_id?: string
    name?: string
    value: string | number | boolean | null

    [key: string]: unknown
}

export interface FCImage {
    path?: string | null
    url?: string | null
    alt?: string | null
    caption?: string | null
    is_cover?: boolean

    [key: string]: unknown
}

export interface Entry {
    id: string
    project_id: string
    category_id?: string | null
    title: string
    summary?: string | null
    content?: string | null
    type?: string | null
    tags?: EntryTag[] | null
    images?: FCImage[] | null

    [key: string]: unknown
}

export interface EntryBrief {
    id: string
    project_id: string
    category_id?: string | null
    title: string
    summary?: string | null
    type?: string | null
    cover?: string | null
    updated_at: string

    [key: string]: unknown
}

export interface TagSchema {
    id: string
    project_id: string
    name: string
    description?: string | null
    type: string
    target: string[]
    default_val?: string | null
    range_min?: number | null
    range_max?: number | null
    sort_order?: number | null

    [key: string]: unknown
}

export type RelationDirection = 'one_way' | 'two_way'

export interface EntryRelation {
    id: string
    project_id: string
    a_id: string
    b_id: string
    relation: RelationDirection
    content: string
    created_at: string
    updated_at: string

    [key: string]: unknown
}

export interface CreateProjectInput {
    name: string
    description?: string | null
}

export interface UpdateProjectInput {
    id: string
    name?: string | null
    description?: string | null
}

export interface CreateCategoryInput {
    projectId: string
    parentId?: string | null
    name: string
    sortOrder?: number | null
}

export interface UpdateCategoryInput {
    id: string
    parentId?: string | null
    name?: string | null
    sortOrder?: number | null
}

export interface ListEntriesParams {
    projectId: string
    categoryId?: string | null
    entryType?: string | null
    limit: number
    offset: number
}

export interface SearchEntriesParams {
    projectId: string
    query: string
    categoryId?: string | null
    entryType?: string | null
    limit: number
}

export interface CountEntriesParams {
    projectId: string
    categoryId?: string | null
    entryType?: string | null
}

export interface CreateEntryInput {
    projectId: string
    categoryId?: string | null
    title: string
    summary?: string | null
    content?: string | null
    type?: string | null
    tags?: EntryTag[] | null
    images?: FCImage[] | null
}

export interface UpdateEntryInput {
    id: string
    categoryId?: string | null
    title?: string | null
    summary?: string | null
    content?: string | null
    type?: string | null
    tags?: EntryTag[] | null
    images?: FCImage[] | null
}

export interface CreateTagSchemaInput {
    projectId: string
    name: string
    description?: string | null
    type: string
    target: string[]
    defaultVal?: string | null
    rangeMin?: number | null
    rangeMax?: number | null
    sortOrder?: number | null
}

export interface UpdateTagSchemaInput extends CreateTagSchemaInput {
    id: string
}

export interface CreateRelationInput {
    projectId: string
    aId: string
    bId: string
    relation: RelationDirection
    content: string
}

export interface UpdateRelationInput {
    id: string
    relation?: RelationDirection | null
    content?: string | null
}

export const log_message = (level: LogLevel, message: string) =>
    command<void>('log_message', {level, message})

export const show_main_window = () => command<string>('show_main_window')

export const showWindow = () => show_main_window().then(() => undefined)

export const db_create_project = ({name, description}: CreateProjectInput) =>
    command<Project>('db_create_project', {name, description})

export const db_get_project = (id: string) => command<Project>('db_get_project', {id})

export const db_list_projects = () => command<Project[]>('db_list_projects')

export const db_update_project = ({id, name, description}: UpdateProjectInput) =>
    command<Project>('db_update_project', {id, name, description})

export const db_delete_project = (id: string) =>
    command<void>('db_delete_project', {id})

export const db_create_category = ({
                                       projectId,
                                       parentId,
                                       name,
                                       sortOrder,
                                   }: CreateCategoryInput) =>
    command<Category>('db_create_category', {projectId, parentId, name, sortOrder})

export const db_get_category = (id: string) => command<Category>('db_get_category', {id})

export const db_list_categories = (projectId: string) =>
    command<Category[]>('db_list_categories', {projectId})

export const db_update_category = ({id, parentId, name, sortOrder}: UpdateCategoryInput) =>
    command<Category>('db_update_category', {
        id,
        parentId,
        name,
        sortOrder,
    })

export const db_delete_category = (id: string) =>
    command<void>('db_delete_category', {id})

export const db_create_entry = ({
                                    projectId,
                                    categoryId,
                                    title,
                                    summary,
                                    content,
                                    type,
                                    tags,
                                    images,
                                }: CreateEntryInput) =>
    command<Entry>('db_create_entry', {
        projectId,
        categoryId,
        title,
        summary,
        content,
        type,
        tags,
        images,
    })

export const db_get_entry = (id: string) => command<Entry>('db_get_entry', {id})

export const db_list_entries = ({
                                    projectId,
                                    categoryId,
                                    entryType,
                                    limit,
                                    offset,
                                }: ListEntriesParams) =>
    command<EntryBrief[]>('db_list_entries', {
        projectId,
        categoryId,
        entryType,
        limit,
        offset,
    })

export const db_search_entries = ({
                                      projectId,
                                      query,
                                      categoryId,
                                      entryType,
                                      limit,
                                  }: SearchEntriesParams) =>
    command<EntryBrief[]>('db_search_entries', {
        projectId,
        query,
        categoryId,
        entryType,
        limit,
    })

export const db_count_entries = ({projectId, categoryId, entryType}: CountEntriesParams) =>
    command<number>('db_count_entries', {projectId, categoryId, entryType})

export const db_update_entry = ({
                                    id,
                                    categoryId,
                                    title,
                                    summary,
                                    content,
                                    type,
                                    tags,
                                    images,
                                }: UpdateEntryInput) =>
    command<Entry>('db_update_entry', {
        id,
        categoryId,
        title,
        summary,
        content,
        type,
        tags,
        images,
    })

export const db_delete_entry = (id: string) => command<void>('db_delete_entry', {id})

export const db_create_entries_bulk = (entries: CreateEntryInput[]) =>
    command<number>('db_create_entries_bulk', {entries})

export const db_optimize_fts = () => command<void>('db_optimize_fts')

export const db_create_tag_schema = ({
                                         projectId,
                                         name,
                                         description,
                                         type,
                                         target,
                                         defaultVal,
                                         rangeMin,
                                         rangeMax,
                                         sortOrder,
                                     }: CreateTagSchemaInput) =>
    command<TagSchema>('db_create_tag_schema', {
        projectId,
        name,
        description,
        type,
        target,
        defaultVal,
        rangeMin,
        rangeMax,
        sortOrder,
    })

export const db_get_tag_schema = (id: string) =>
    command<TagSchema>('db_get_tag_schema', {id})

export const db_list_tag_schemas = (projectId: string) =>
    command<TagSchema[]>('db_list_tag_schemas', {projectId})

export const db_update_tag_schema = ({
                                         id,
                                         projectId,
                                         name,
                                         description,
                                         type,
                                         target,
                                         defaultVal,
                                         rangeMin,
                                         rangeMax,
                                         sortOrder,
                                     }: UpdateTagSchemaInput) =>
    command<TagSchema>('db_update_tag_schema', {
        id,
        projectId,
        name,
        description,
        type,
        target,
        defaultVal,
        rangeMin,
        rangeMax,
        sortOrder,
    })

export const db_delete_tag_schema = (id: string) =>
    command<void>('db_delete_tag_schema', {id})

export const db_create_relation = ({
                                       projectId,
                                       aId,
                                       bId,
                                       relation,
                                       content,
                                   }: CreateRelationInput) =>
    command<EntryRelation>('db_create_relation', {projectId, aId, bId, relation, content})

export const db_get_relation = (id: string) =>
    command<EntryRelation>('db_get_relation', {id})

export const db_list_relations_for_entry = (entryId: string) =>
    command<EntryRelation[]>('db_list_relations_for_entry', {entryId})

export const db_list_relations_for_project = (projectId: string) =>
    command<EntryRelation[]>('db_list_relations_for_project', {projectId})

export const db_update_relation = ({id, relation, content}: UpdateRelationInput) =>
    command<EntryRelation>('db_update_relation', {id, relation, content})

export const db_delete_relation = (id: string) =>
    command<void>('db_delete_relation', {id})

export const db_delete_relations_between = (entryAId: string, entryBId: string) =>
    command<number>('db_delete_relations_between', {entryAId, entryBId})

// ── Entry Types ────────────────────────────────────────────────────────────────

export interface CustomEntryType {
    id: string
    project_id: string
    name: string
    description?: string | null
    icon?: string | null
    color?: string | null
    created_at: string
    updated_at: string
}

/** Discriminated union returned by list_all_entry_types */
export type EntryTypeView =
    | { kind: 'builtin'; key: string; name: string; description: string; icon: string; color: string }
    | { kind: 'custom' } & CustomEntryType

/** Returns the stable identifier used as Entry.type value */
export function entryTypeKey(et: EntryTypeView): string {
    return et.kind === 'builtin' ? et.key : et.id
}

export interface CreateEntryTypeInput {
    projectId: string
    name: string
    description?: string | null
    icon?: string | null
    color?: string | null
}

export interface UpdateEntryTypeInput {
    id: string
    name?: string | null
    description?: string | null | undefined
    icon?: string | null | undefined
    color?: string | null | undefined
}

export const db_list_all_entry_types = (projectId: string) =>
    command<EntryTypeView[]>('db_list_all_entry_types', {projectId})

export const db_list_custom_entry_types = (projectId: string) =>
    command<CustomEntryType[]>('db_list_custom_entry_types', {projectId})

export const db_create_entry_type = ({projectId, name, description, icon, color}: CreateEntryTypeInput) =>
    command<CustomEntryType>('db_create_entry_type', {projectId, name, description, icon, color})

export const db_get_entry_type = (id: string) =>
    command<CustomEntryType>('db_get_entry_type', {id})

export const db_update_entry_type = ({id, name, description, icon, color}: UpdateEntryTypeInput) =>
    command<CustomEntryType>('db_update_entry_type', {id, name, description, icon, color})

export const db_delete_entry_type = (id: string) =>
    command<void>('db_delete_entry_type', {id})
