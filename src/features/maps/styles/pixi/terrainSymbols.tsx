/* eslint-disable react-refresh/only-export-components */
import '@pixi/react'
import {extend} from '@pixi/react'
import {Sprite, Texture} from 'pixi.js'
import {useEffect, useMemo, useState} from 'react'
import {
    MAP_TERRAIN_KINDS,
    type MapPreviewShape,
} from '../../components/MapShapeEditor'
import type {MapStyleParameterRecord, TerrainFieldData} from '../common'
import {
    buildPixiTerrainSymbolAsset,
    type PixiTerrainSymbolAsset,
    type PixiTerrainSymbolAssetId,
} from './assets'
import type {PixiMapStyle} from './types'

extend({Sprite})

const TERRAIN_SYMBOL_ASSETS = new Set<PixiTerrainSymbolAssetId>([
    'flat-mountain',
    'tolkien-mountain',
    'tolkien-hill',
    'tolkien-tree',
    'ink-mountain',
])

interface TerrainSymbolPlacement {
    key: string
    assetKey: string
    asset: PixiTerrainSymbolAsset
    x: number
    y: number
    width: number
    height: number
    rotation: number
    opacity: number
}

function asRecord(value: unknown): MapStyleParameterRecord | null {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value as MapStyleParameterRecord
        : null
}

function getNumber(value: unknown, fallback: number): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function getString(value: unknown, fallback: string): string {
    return typeof value === 'string' && value.trim() ? value : fallback
}

function hashUnit(x: number, y: number, salt: number): number {
    let value = Math.imul(Math.round(x) ^ salt, 0x45d9f3b)
    value = Math.imul(value ^ Math.round(y), 0x45d9f3b)
    value ^= value >>> 16
    return (value >>> 0) / 0xffffffff
}

function pointInPolygon(x: number, y: number, polygon: [number, number][]): boolean {
    let inside = false
    for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
        const [x1, y1] = polygon[index]
        const [x2, y2] = polygon[previous]
        if ((y1 > y) !== (y2 > y) && x < (x2 - x1) * (y - y1) / (y2 - y1) + x1) {
            inside = !inside
        }
    }
    return inside
}

function isOnLand(x: number, y: number, shapes: MapPreviewShape[]): boolean {
    return shapes.some(shape => shape.polygon.length >= 3 && pointInPolygon(x, y, shape.polygon))
}

function sampleTerrain(field: TerrainFieldData, x: number, y: number, typeIndex: number): boolean {
    const px = Math.max(0, Math.min(field.width - 1, Math.round(x)))
    const py = Math.max(0, Math.min(field.height - 1, Math.round(y)))
    const offset = (py * field.width + px) * 4
    return field.data[offset] === typeIndex && field.data[offset + 1] >= 210
}

function isSymbolAsset(value: string): value is PixiTerrainSymbolAssetId {
    return TERRAIN_SYMBOL_ASSETS.has(value as PixiTerrainSymbolAssetId)
}

export function buildTerrainSymbolPlacements(
    field: TerrainFieldData | null,
    shapes: MapPreviewShape[],
    style: PixiMapStyle,
): TerrainSymbolPlacement[] {
    if (!field) return []
    const terrainParams = style.decorations?.find(item => item.id === 'terrain')?.params
    const symbols = asRecord(terrainParams?.symbols)
    if (!symbols) return []

    const placements: TerrainSymbolPlacement[] = []
    for (const definition of MAP_TERRAIN_KINDS) {
        const config = asRecord(symbols[definition.id])
        if (!config) continue
        const assetId = getString(config.asset, '')
        if (!isSymbolAsset(assetId)) continue

        const color = getString(config.color, '#4d4338')
        const spacing = Math.max(18, getNumber(config.spacing, 48))
        const targetSize = Math.max(16, getNumber(config.size, spacing))
        const opacity = Math.max(0, Math.min(1, getNumber(config.opacity, 1)))
        const jitter = Math.max(0, Math.min(0.8, getNumber(config.jitter, 0.42)))
        const variants = Math.max(1, Math.min(3, Math.round(getNumber(config.variants, 3))))
        const margin = Math.max(5, targetSize * 0.38)
        const salt = definition.order * 7919 + assetId.length * 104729
        const variantAssets = Array.from({length: variants}, (_, variant) => (
            buildPixiTerrainSymbolAsset(assetId, color, variant)
        ))

        for (let gridY = spacing * 0.5; gridY < field.height; gridY += spacing) {
            for (let gridX = spacing * 0.5; gridX < field.width; gridX += spacing) {
                const x = gridX + (hashUnit(gridX, gridY, salt) - 0.5) * spacing * jitter
                const y = gridY + (hashUnit(gridX, gridY, salt + 17) - 0.5) * spacing * jitter
                if (!sampleTerrain(field, x, y, definition.order) || !isOnLand(x, y, shapes)) continue
                if (!sampleTerrain(field, x - margin, y, definition.order)
                    || !sampleTerrain(field, x + margin, y, definition.order)
                    || !sampleTerrain(field, x, y - margin * 0.85, definition.order)
                    || !sampleTerrain(field, x, y + margin * 0.25, definition.order)) continue

                const densityRadius = spacing * 0.58
                const interiorSamples = [
                    sampleTerrain(field, x - densityRadius, y, definition.order),
                    sampleTerrain(field, x + densityRadius, y, definition.order),
                    sampleTerrain(field, x, y - densityRadius, definition.order),
                    sampleTerrain(field, x, y + densityRadius, definition.order),
                ].filter(Boolean).length
                const density = 0.30 + interiorSamples / 4 * 0.70
                if (hashUnit(gridX, gridY, salt + 23) > density) continue

                const variant = Math.min(variants - 1, Math.floor(hashUnit(gridX, gridY, salt + 31) * variants))
                const asset = variantAssets[variant]
                const width = targetSize * (0.70 + hashUnit(gridX, gridY, salt + 47) * 0.60)
                const height = width * asset.height / asset.width
                const assetKey = `${assetId}:${color}:${variant}`
                placements.push({
                    key: `${definition.id}:${Math.round(gridX)}:${Math.round(gridY)}`,
                    assetKey,
                    asset,
                    x,
                    y,
                    width,
                    height,
                    rotation: (hashUnit(gridX, gridY, salt + 61) - 0.5) * 0.09,
                    opacity,
                })
            }
        }
    }

    return placements.sort((left, right) => left.y - right.y || left.x - right.x)
}

function useTerrainSymbolTextures(placements: TerrainSymbolPlacement[]): Map<string, Texture> {
    const assets = useMemo(() => {
        const unique = new Map<string, PixiTerrainSymbolAsset>()
        for (const placement of placements) unique.set(placement.assetKey, placement.asset)
        return unique
    }, [placements])
    const [textures, setTextures] = useState<Map<string, Texture>>(new Map())

    useEffect(() => {
        let cancelled = false
        if (assets.size === 0) {
            setTextures(new Map())
            return () => {
                cancelled = true
            }
        }

        const loaded = new Map<string, Texture>()
        let pending = assets.size
        const finish = () => {
            pending--
            if (pending === 0 && !cancelled) setTextures(loaded)
            if (pending === 0 && cancelled) loaded.forEach(texture => texture.destroy(true))
        }

        for (const [key, asset] of assets) {
            const image = new Image()
            image.onload = () => {
                if (!cancelled) loaded.set(key, Texture.from({resource: image}, true))
                finish()
            }
            image.onerror = finish
            image.src = asset.url
        }

        return () => {
            cancelled = true
        }
    }, [assets])

    useEffect(() => () => {
        textures.forEach(texture => {
            if (!texture.destroyed) texture.destroy(true)
        })
    }, [textures])

    return textures
}

export function PixiTerrainSymbolLayer({
    field,
    shapes,
    style,
}: {
    field: TerrainFieldData | null
    shapes: MapPreviewShape[]
    style: PixiMapStyle
}) {
    const placements = useMemo(
        () => buildTerrainSymbolPlacements(field, shapes, style),
        [field, shapes, style],
    )
    const textures = useTerrainSymbolTextures(placements)

    return (
        <>
            {placements.map(placement => {
                const texture = textures.get(placement.assetKey)
                if (!texture) return null
                return (
                    <pixiSprite
                        key={placement.key}
                        texture={texture}
                        x={placement.x}
                        y={placement.y}
                        width={placement.width}
                        height={placement.height}
                        anchor={{
                            x: placement.asset.anchorX / placement.asset.width,
                            y: placement.asset.anchorY / placement.asset.height,
                        }}
                        rotation={placement.rotation}
                        alpha={placement.opacity}
                    />
                )
            })}
        </>
    )
}
