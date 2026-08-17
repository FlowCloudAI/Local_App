import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import test from 'node:test'
import {URL} from 'node:url'

const typographyCss = readFileSync(new URL('./mobileTypography.css', import.meta.url), 'utf8')
const mobileAppSource = readFileSync(new URL('./MobileApp.tsx', import.meta.url), 'utf8')
const formFactorSource = readFileSync(new URL('../../shared/formFactor.ts', import.meta.url), 'utf8')
const mobileNavCss = readFileSync(new URL('./MobileNav.css', import.meta.url), 'utf8')
const mobileSettingsCss = readFileSync(new URL('./pages/MobileSettings.css', import.meta.url), 'utf8')

const touchScopeMatch = typographyCss.match(/:root\[data-fc-density="touch"]\s*\{([\s\S]*?)\}/)

test('移动字号只覆盖 touch density，并由 MobileApp 单独加载', () => {
    assert.ok(touchScopeMatch, '缺少 touch density 根级作用域')
    assert.match(mobileAppSource, /import '\.\/mobileTypography\.css'/)
    assert.doesNotMatch(typographyCss, /(?:^|\})\s*:root\s*\{/)
})

test('iOS 与 Android 共用 touch density，桌面构建保持 comfortable', () => {
    assert.match(formFactorSource, /buildPlatform === 'android' \|\| buildPlatform === 'ios'/)
    assert.match(formFactorSource, /resolveFormFactor\(platformInfo\) === 'mobile' \? 'touch' : 'comfortable'/)
})

test('移动语义字号覆盖完整且不低于 12px', () => {
    const declarations = touchScopeMatch?.[1] ?? ''
    const expected = {
        '2xs': '0.75rem',
        xs: '0.8125rem',
        caption: '0.8125rem',
        sm: '0.9375rem',
        control: '1.0625rem',
        reading: '1.0625rem',
        md: '1.0625rem',
        body: '1.0625rem',
        lg: '1.25rem',
        'title-sm': '1.375rem',
        xl: '1.5rem',
    }

    for (const [name, value] of Object.entries(expected)) {
        assert.match(declarations, new RegExp(`--fc-font-size-${name}:\\s*${value.replace('.', '\\.')}\\s*;`))
    }
})

test('移动端不再绕过 token 使用低于标尺的硬编码字号', () => {
    assert.doesNotMatch(mobileNavCss, /font-size:\s*0\.68rem/)
    assert.doesNotMatch(mobileSettingsCss, /font-size:\s*11px/)
    assert.match(mobileNavCss, /\.mobile-nav__label[\s\S]*font-size:\s*var\(--fc-font-size-xs\)/)
})
