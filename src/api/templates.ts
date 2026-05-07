import {command} from './base'

export interface TemplateParamMeta {
    name: string
    description: string
}

export interface TemplateMeta {
    id: string
    group: string
    title: string
    relative_path: string
    purpose: string
    appear_in: string
    params: TemplateParamMeta[]
}

export interface TemplateDocument {
    meta: TemplateMeta
    content: string
    is_override: boolean
}

export interface TemplateValidationError {
    message: string
    line?: number | null
    column?: number | null
    raw_message: string
}

export type TemplateSaveResult =
    | {
    status: 'success'
    document: TemplateDocument
}
    | {
    status: 'validation_error'
    error: TemplateValidationError
}
    | {
    status: 'runtime_error'
    message: string
}

export const template_list = () =>
    command<TemplateMeta[]>('template_list')

export const template_get = (id: string) =>
    command<TemplateDocument>('template_get', {id})

export const template_get_default = (id: string) =>
    command<string>('template_get_default', {id})

export const template_get_local_root_dir = () =>
    command<string>('template_get_local_root_dir')

export const template_get_effective_path = (id: string) =>
    command<string>('template_get_effective_path', {id})

export const template_save = (id: string, content: string) =>
    command<TemplateSaveResult>('template_save', {id, content})
