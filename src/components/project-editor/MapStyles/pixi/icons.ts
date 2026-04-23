import type {MapPreviewKeyLocationIcon} from 'flowcloudai-ui'
import {buildPixiLocationIconAsset} from './assets'

/**
 * 兼容旧调用点的托尔金图标入口；新代码应优先通过 Pixi assets atlas 解析。
 */
export function buildTolkienPixiLocationIcon(type: string, colorHex: string): MapPreviewKeyLocationIcon {
    return buildPixiLocationIconAsset({
        iconSet: 'tolkien',
        type,
        color: colorHex,
    })!
}
