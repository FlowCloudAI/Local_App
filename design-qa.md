# 默认封面实现视觉 QA

- source visual truth path: `E:\Projects\FlowCloudAI\app_main\designs\default-covers.html`
- source reference image: `C:\Users\f1779\AppData\Local\Temp\codex-clipboard-8597dd75-a5de-4fb1-867d-df4aadca94bb.png`
- implementation screenshot path: unavailable
- viewport: unavailable
- source pixel dimensions: unavailable for the final revised HTML state
- implementation pixel dimensions: unavailable
- CSS size / density normalization: not performed
- state: light and dark project cards, project Hero, desktop and mobile entry-card fallbacks

## Full-view comparison evidence

未执行。项目卡片与词条卡片依赖 Tauri 本地数据；项目规范禁止把浏览器空壳或 mock 当作原生真实状态证据。本次未取得桌面原生应用与 Android 真机的实现截图。

## Focused region comparison evidence

未执行。缺少与最终设计稿同状态、同尺寸的原生实现截图，无法对字体回退、线条裁切、卡片媒体区比例及浅色主题对比度做像素级判断。

## Findings

- [P2] 原生视觉一致性尚未取证
  - Location: 项目卡片、项目 Hero、桌面与移动端词条卡片默认封面。
  - Evidence: 设计源文件可用，但没有原生实现截图可与之并排比较。
  - Impact: 编译与样式结构正确不等于目标设备上的字体和裁切一定一致。
  - Fix: 分别在桌面原生应用与 Android 真机打开含无封面项目/词条的真实数据页面，按同一主题和内容截图后比较。

## Required fidelity surfaces

- Fonts and typography: 代码使用行楷字体栈并回退到 `--fc-font-family`；目标设备字体回退效果待截图确认。
- Spacing and layout rhythm: 复用现有 `Card` 媒体槽和页面尺寸；实际裁切与卡片比例待截图确认。
- Colors and visual tokens: 所有生产颜色、间距与阴影继续使用 `--fc-*` 令牌；浅色线条透明度为 0.28，深色为 0.14。
- Image quality and asset fidelity: 连续线稿来自设计稿中的同一组路径，并以单个共享 SVG 遮罩复用；目标 WebView 的遮罩渲染待截图确认。
- Copy and content: 项目 Hero 保留“世界观项目”与项目名；词条字印会跳过书名号和标点。

## Comparison history

尚无有效视觉比较轮次；没有把浏览器 mock 计为原生实现证据。

## Implementation checklist

1. 桌面原生项目列表与词条网格各截取浅色、深色状态。
2. Android 真机项目列表、项目 Hero 与词条列表各截取浅色、深色状态。
3. 与最终 HTML 设计稿在相同内容和近似媒体槽尺寸下并排比较，修复任何 P0/P1/P2 差异。

final result: blocked
