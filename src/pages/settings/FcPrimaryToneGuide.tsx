import type {CSSProperties} from 'react'
import {
    createFcSemanticTokenPreviews,
    type MaterialToneSwatch,
    type FcSemanticTokenPreview,
} from './materialThemePreview'
import './FcPrimaryToneGuide.css'

type ColorVariableStyle = CSSProperties & Record<string, string>

interface FcPrimaryToneGuideProps {
    tones: MaterialToneSwatch[]
}

export default function FcPrimaryToneGuide({tones}: FcPrimaryToneGuideProps) {
    const tokenPreviews = createFcSemanticTokenPreviews(tones)

    return (
        <div className="fc-primary-tone-guide">
            <div className="fc-primary-tone-guide__header">
                <strong>FC 主色建议映射</strong>
                <span>深浅主题共用同一 Primary 色阶，只取不同 Tone。</span>
            </div>
            <div className="fc-primary-tone-guide__token-list">
                {tokenPreviews.map((item) => (
                    <FcPrimaryToken key={item.token} item={item}/>
                ))}
            </div>
        </div>
    )
}

function FcPrimaryToken({item}: { item: FcSemanticTokenPreview }) {
    return (
        <div className="fc-primary-tone-guide__token">
            <div className="fc-primary-tone-guide__token-name">
                <strong>{item.label}</strong>
                <code>{item.token}</code>
            </div>
            <ColorValue label={item.light.label} value={item.light.value} swatch={item.light.swatch}/>
            <ColorValue label={item.dark.label} value={item.dark.value} swatch={item.dark.swatch}/>
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
