/*
 * 展示应用内置字体的版权、使用范围与完整许可文本。
 * 许可内容直接读取随字体保存的 OFL.txt，避免界面摘要与分发文件失去同步。
 */

import {Button, RollingBox} from 'flowcloudai-ui'
import notoSansLicense from '../../assets/fonts/noto-sans-cjk/OFL.txt?raw'
import notoSerifLicense from '../../assets/fonts/noto-serif-cjk/OFL.txt?raw'
import lxgwWenKaiLicense from '../../assets/fonts/lxgw-wenkai/OFL.txt?raw'
import {FloatingPanel} from '../../shared/ui/overlay'
import './LicenseModal.css'

interface FontLicenseModalProps {
    open: boolean
    onClose: () => void
}

const FONT_LICENSES = [
    {
        name: 'Noto Sans CJK（SC / TC / JP）',
        files: 'NotoSansSC-VF.woff2、NotoSansTC-VF.woff2、NotoSansJP-VF.woff2',
        copyright: '© 2014–2021 Adobe。保留字体名称：Source；Source 是 Adobe 的商标。',
        source: 'https://github.com/notofonts/noto-cjk',
        license: notoSansLicense,
    },
    {
        name: 'Noto Serif CJK（SC / TC / JP）',
        files: 'NotoSerifSC-VF.woff2、NotoSerifTC-VF.woff2、NotoSerifJP-VF.woff2',
        copyright: '© 2017–2024 Adobe。Noto 是 Google Inc. 的商标。',
        source: 'https://github.com/notofonts/noto-cjk',
        license: notoSerifLicense,
    },
    {
        name: 'LXGW WenKai / 霞鹜文楷',
        files: 'LXGWWenKai-Regular.woff2',
        copyright: '© 2021–2026 LXGW；© 2020 The Klee Project Authors。',
        source: 'https://github.com/lxgw/LxgwWenKai',
        note: '本应用仅将转换后的 WOFF2 用于 WebView 内文字渲染，不将其作为可安装桌面字体提供。保留字体名称及格式转换遵循该字体 OFL.txt 中的附加许可。',
        license: lxgwWenKaiLicense,
    },
] as const

const TITLE = '字体版权与使用说明'

export default function FontLicenseModal({open, onClose}: FontLicenseModalProps) {
    return (
        <FloatingPanel
            open={open}
            onClose={onClose}
            title={TITLE}
            ariaLabel={TITLE}
            className="license-modal-dialog"
        >
            <RollingBox axis="y" className="license-modal-body" thumbSize="thin">
                <p className="license-modal-intro">
                    以下字体版权归各自权利人所有，均按 SIL Open Font License 1.1 授权，
                    不受流云AI自身 MIT License 覆盖。
                </p>

                <section className="license-modal-section">
                    <h3 className="license-modal-section-title">允许与限制</h3>
                    <ul className="font-license-modal-terms">
                        <li>允许个人或企业免费使用，包括商业使用、嵌入应用、随软件分发和修改。</li>
                        <li>不得单独出售字体文件；分发字体时必须保留版权声明和完整 OFL 1.1。</li>
                        <li>修改版本必须继续采用 OFL 1.1，并遵守相应的保留字体名称条款。</li>
                        <li>使用字体生成的文档、图片或其他作品不因此被要求采用 OFL。</li>
                    </ul>
                </section>

                {FONT_LICENSES.map(font => (
                    <section key={font.name} className="license-modal-section">
                        <h3 className="license-modal-section-title">{font.name}</h3>
                        <div className="font-license-modal-copy">
                            <p><strong>内置文件：</strong>{font.files}</p>
                            <p><strong>版权：</strong>{font.copyright}</p>
                            <p><strong>来源：</strong>{font.source}</p>
                            {'note' in font && <p><strong>格式转换说明：</strong>{font.note}</p>}
                        </div>
                        <details className="font-license-modal-details">
                            <summary>查看完整 SIL Open Font License 1.1</summary>
                            <pre className="font-license-modal-license-text">{font.license}</pre>
                        </details>
                    </section>
                ))}
            </RollingBox>

            <div className="license-modal-footer">
                <Button type="button" size="sm" radius="full" onClick={onClose}>已阅读</Button>
            </div>
        </FloatingPanel>
    )
}
