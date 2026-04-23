import type {MapPreviewKeyLocationIcon} from 'flowcloudai-ui'
import {svgToDataUrl} from './utils'

/**
 * 托尔金风格地点图标——城/要塞用塔楼，普通地点用简化塔。
 */
export function buildTolkienLocationIcon(type: string, colorHex: string): MapPreviewKeyLocationIcon | null {
    const isMajor = /城|都|要塞|港/.test(type)

    if (isMajor) {
        return {
            url: svgToDataUrl(`
                <svg xmlns="http://www.w3.org/2000/svg" width="40" height="44" viewBox="0 0 40 44">
                    <path d="M10 40V18L7 15V12L20 6L33 12V15L30 18V40H10Z"
                          fill="#f7e7bc" stroke="${colorHex}" stroke-width="1.8" stroke-linejoin="round"/>
                    <path d="M7 40H33" stroke="${colorHex}" stroke-width="1.4"/>
                    <path d="M13 40V26H17V40M23 40V26H27V40" stroke="${colorHex}" stroke-width="1.2"/>
                    <circle cx="20" cy="14" r="2.2" fill="${colorHex}"/>
                    <path d="M14 18H26" stroke="${colorHex}" stroke-width="0.9" stroke-opacity="0.6"/>
                </svg>
            `),
            width: 40,
            height: 44,
            anchorX: 20,
            anchorY: 40,
        }
    }

    return {
        url: svgToDataUrl(`
            <svg xmlns="http://www.w3.org/2000/svg" width="32" height="36" viewBox="0 0 32 36">
                <path d="M7 32V16L5 13V11L16 5L27 11V13L25 16V32H7Z"
                      fill="#f7e7bc" stroke="${colorHex}" stroke-width="1.6" stroke-linejoin="round"/>
                <path d="M5 32H27" stroke="${colorHex}" stroke-width="1.2"/>
                <circle cx="16" cy="13" r="1.8" fill="${colorHex}"/>
            </svg>
        `),
        width: 32,
        height: 36,
        anchorX: 16,
        anchorY: 32,
    }
}
