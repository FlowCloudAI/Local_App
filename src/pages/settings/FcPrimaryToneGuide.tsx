import type {CSSProperties} from 'react'
import type {MaterialToneSwatch} from './materialThemePreview'
import './FcPrimaryToneGuide.css'

type ColorVariableStyle = CSSProperties & Record<string, string>

interface FcPrimaryTokenSuggestion {
    token: string
    label: string
    lightTone: number
    darkTone: number
    darkAlpha?: number
}

const FC_PRIMARY_TOKEN_SUGGESTIONS: FcPrimaryTokenSuggestion[] = [
    {token: '--fc-color-primary', label: '主色', lightTone: 50, darkTone: 70},
    {token: '--fc-color-primary-hover', label: '悬停', lightTone: 40, darkTone: 80},
    {token: '--fc-color-primary-active', label: '按下', lightTone: 30, darkTone: 90},
    {token: '--fc-color-primary-subtle', label: '弱背景', lightTone: 95, darkTone: 70, darkAlpha: 12},
    {token: '--fc-color-border-focus', label: '焦点边框', lightTone: 50, darkTone: 60},
    {token: '--fc-color-text-link', label: '链接', lightTone: 40, darkTone: 70},
    {token: '--fc-color-text-link-hover', label: '链接悬停', lightTone: 30, darkTone: 80},
]

interface FcPrimaryToneGuideProps {
    tones: MaterialToneSwatch[]
}

export default function FcPrimaryToneGuide({tones}: FcPrimaryToneGuideProps) {
    return (
        <div className="fc-primary-tone-guide">
            <div className="fc-primary-tone-guide__header">
                <strong>FC 主色建议映射</strong>
                <span>深浅主题共用同一 Primary 色阶，只取不同 Tone。</span>
            </div>
            <div className="fc-primary-tone-guide__token-list">
                {FC_PRIMARY_TOKEN_SUGGESTIONS.map((item) => (
                    <FcPrimaryToken key={item.token} item={item} tones={tones}/>
                ))}
            </div>
        </div>
    )
}

function FcPrimaryToken({
    item,
    tones,
}: {
    item: FcPrimaryTokenSuggestion
    tones: MaterialToneSwatch[]
}) {
    const lightHex = getToneHex(tones, item.lightTone)
    const darkHex = getToneHex(tones, item.darkTone)
    const darkValue = item.darkAlpha ? `${darkHex} / ${item.darkAlpha}%` : darkHex
    const darkSwatch = item.darkAlpha
        ? `color-mix(in srgb, ${darkHex} ${item.darkAlpha}%, transparent)`
        : darkHex

    return (
        <div className="fc-primary-tone-guide__token">
            <div className="fc-primary-tone-guide__token-name">
                <strong>{item.label}</strong>
                <code>{item.token}</code>
            </div>
            <ColorValue label={`Light T${item.lightTone}`} value={lightHex} swatch={lightHex}/>
            <ColorValue label={`Dark T${item.darkTone}`} value={darkValue} swatch={darkSwatch}/>
        </div>
    )
}

function ColorValue({label, value, swatch}: { label: string; value: string; swatch: string }) {
    return (
        <div className="fc-primary-tone-guide__value">
            <span className="fc-primary-tone-guide__swatch" style={colorStyle(swatch)} aria-hidden="true"/>
            <span>{label}</span>
            <code>{value}</code>
        </div>
    )
}

function colorStyle(color: string): ColorVariableStyle {
    return {'--fc-primary-tone-guide-swatch': color}
}

function getToneHex(tones: MaterialToneSwatch[], tone: number): string {
    return tones.find((item) => item.tone === tone)?.hex ?? '#000000'
}
