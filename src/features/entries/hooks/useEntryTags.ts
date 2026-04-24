import {useEffect, useMemo, useRef, useState} from 'react'
import type {TagSchema} from '../../../api'
import {buildAutoVisibleTagSchemaIds, getComparableTagValue, mergeUniqueStringValues,} from '../lib/entryTag'
import {ensureTypeTargetTagValues, getSchemaDefaultValue, isSchemaImplantedForType} from '../components/entryTagUtils'

interface UseEntryTagsOptions {
    tagSchemas: TagSchema[]
    draftTags: Record<string, string | number | boolean | null>
    draftType: string | null
    entryId: string
    onTagsChange: (nextTags: Record<string, string | number | boolean | null>) => void
}

export default function useEntryTags({
                                         tagSchemas,
                                         draftTags,
                                         draftType,
                                         entryId,
                                         onTagsChange,
                                     }: UseEntryTagsOptions) {
    const [localTagSchemas, setLocalTagSchemas] = useState<TagSchema[]>(tagSchemas)
    const [pinnedTagSchemaIds, setPinnedTagSchemaIds] = useState<string[]>([])
    const [tagSchemaPickerValue, setTagSchemaPickerValue] = useState<string | undefined>(undefined)
    const prevTypeRef = useRef<string | null>(null)
    const autoAddedTagSchemaIdsRef = useRef<Set<string>>(new Set())
    const onTagsChangeRef = useRef(onTagsChange)
    useEffect(() => {
        onTagsChangeRef.current = onTagsChange
    }, [onTagsChange])

    useEffect(() => {
        setLocalTagSchemas(tagSchemas)
    }, [tagSchemas])

    useEffect(() => {
        setPinnedTagSchemaIds([])
        setTagSchemaPickerValue(undefined)
        prevTypeRef.current = null
        autoAddedTagSchemaIdsRef.current = new Set()
    }, [entryId])

    const autoVisibleTagSchemaIds = useMemo(
        () => buildAutoVisibleTagSchemaIds(localTagSchemas, draftTags, draftType),
        [draftTags, draftType, localTagSchemas],
    )
    const visibleTagSchemaIds = useMemo(
        () => mergeUniqueStringValues([...pinnedTagSchemaIds, ...autoVisibleTagSchemaIds]),
        [autoVisibleTagSchemaIds, pinnedTagSchemaIds],
    )
    const visibleTagSchemaIdSet = useMemo(
        () => new Set(visibleTagSchemaIds),
        [visibleTagSchemaIds],
    )
    const visibleTagSchemas = useMemo(
        () => localTagSchemas.filter((schema) => visibleTagSchemaIdSet.has(schema.id)),
        [localTagSchemas, visibleTagSchemaIdSet],
    )
    const implantedTagSchemaIdSet = useMemo(
        () => new Set(
            visibleTagSchemas
                .filter((schema) => isSchemaImplantedForType(schema, draftType))
                .map((schema) => schema.id),
        ),
        [draftType, visibleTagSchemas],
    )
    const availableTagSchemaOptions = useMemo(
        () => localTagSchemas
            .filter((schema) => !visibleTagSchemaIdSet.has(schema.id))
            .map((schema) => ({value: schema.id, label: schema.name})),
        [localTagSchemas, visibleTagSchemaIdSet],
    )
    const browseVisibleTagSchemas = useMemo(
        () => visibleTagSchemas.filter((schema) => (
            implantedTagSchemaIdSet.has(schema.id) || draftTags[schema.id] !== null || draftTags[schema.name] !== null
        )),
        [draftTags, implantedTagSchemaIdSet, visibleTagSchemas],
    )

    useEffect(() => {
        if (!autoVisibleTagSchemaIds.length) return
        setPinnedTagSchemaIds((current) => {
            const next = mergeUniqueStringValues([...current, ...autoVisibleTagSchemaIds])
            return next.length === current.length && next.every((item, index) => item === current[index]) ? current : next
        })
    }, [autoVisibleTagSchemaIds])

    useEffect(() => {
        const prevType = prevTypeRef.current
        const nextType = draftType
        let workingTags = draftTags
        const removedSchemaIds: string[] = []

        if (prevType !== null && prevType !== nextType && autoAddedTagSchemaIdsRef.current.size > 0) {
            const schemasToCheck = localTagSchemas.filter((schema) => autoAddedTagSchemaIdsRef.current.has(schema.id))
            let tagsModified = false
            const nextTags = {...workingTags}

            for (const schema of schemasToCheck) {
                if (!isSchemaImplantedForType(schema, nextType)) {
                    const currentValue = getComparableTagValue(workingTags, schema)
                    const defaultValue = getSchemaDefaultValue(schema)

                    if (currentValue === defaultValue || (currentValue === null && defaultValue === null)) {
                        delete nextTags[schema.id]
                        delete nextTags[schema.name]
                        autoAddedTagSchemaIdsRef.current.delete(schema.id)
                        removedSchemaIds.push(schema.id)
                        tagsModified = true
                    }
                }
            }

            if (tagsModified) {
                workingTags = nextTags
            }
        }

        const {tags: ensuredTags, addedSchemaIds} = ensureTypeTargetTagValues(workingTags, localTagSchemas, nextType)

        addedSchemaIds.forEach((id) => autoAddedTagSchemaIdsRef.current.add(id))
        prevTypeRef.current = nextType

        if (ensuredTags !== workingTags || workingTags !== draftTags) {
            onTagsChangeRef.current(ensuredTags)
        }

        if (removedSchemaIds.length > 0) {
            setPinnedTagSchemaIds((current) => current.filter((id) => !removedSchemaIds.includes(id)))
        }
    }, [entryId, localTagSchemas, draftType, draftTags])

    function handleAddVisibleTagSchema(schemaId: string) {
        if (!schemaId) return
        setPinnedTagSchemaIds((current) => (current.includes(schemaId) ? current : [...current, schemaId]))
        setTagSchemaPickerValue(undefined)
    }

    function handleTagSchemaSaved(schema: TagSchema) {
        const nextSchemas = [...localTagSchemas, schema]
        setLocalTagSchemas(nextSchemas)
        setPinnedTagSchemaIds((current) => (current.includes(schema.id) ? current : [...current, schema.id]))
        setTagSchemaPickerValue(undefined)
        onTagsChangeRef.current({
            ...draftTags,
            [schema.id]: draftTags[schema.id] ?? draftTags[schema.name] ?? null,
        })
        return nextSchemas
    }

    return {
        localTagSchemas,
        pinnedTagSchemaIds,
        tagSchemaPickerValue,
        autoVisibleTagSchemaIds,
        visibleTagSchemaIds,
        visibleTagSchemaIdSet,
        visibleTagSchemas,
        implantedTagSchemaIdSet,
        availableTagSchemaOptions,
        browseVisibleTagSchemas,
        setLocalTagSchemas,
        setPinnedTagSchemaIds,
        setTagSchemaPickerValue,
        handleAddVisibleTagSchema,
        handleTagSchemaSaved,
    }
}
