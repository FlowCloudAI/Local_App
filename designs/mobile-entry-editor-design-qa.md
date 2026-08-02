# 移动端词条编辑设计 QA

- source visual truth path: `C:\Users\f1779\.codex\visualizations\2026\08\02\019fc218-fd10-7570-9a67-09d52a01fdea\entry-editor-comparison\21-design-entry-editor-main.png`、`22-design-entry-editor-extras.png`
- implementation screenshot path: `C:\Users\f1779\.codex\visualizations\2026\08\02\019fc218-fd10-7570-9a67-09d52a01fdea\entry-editor-comparison\24-design-editor-summary.png`、`25-design-editor-media.png`、`26-design-editor-relations.png`
- comparison evidence: `C:\Users\f1779\.codex\visualizations\2026\08\02\019fc218-fd10-7570-9a67-09d52a01fdea\entry-editor-comparison\27-design-qa-comparison.png`
- viewport: 1440 × 1000；手机画布 390 × 844 CSS px
- pixels and density: 原稿与实现截图均为 1440 × 1000 px，deviceScaleFactor 1，无密度换算
- state: 主编辑摘要、图片展开、词条关系展开

## Findings

- 无 P0/P1/P2 问题。
- 信息架构：摘要已回到标题后的核心编辑区；图片、属性与标签、词条关系为三个平级且命名明确的折叠板块，不再经过“附加内容”总入口。
- 字体与排版：沿用原稿的系统字体、字号层级和行高，新增摘要与折叠标题没有产生截断或异常换行。
- 间距与布局：沿用 390 × 844 画布、16px 表单边距与 64px 折叠标题高度；展开内容不遮挡固定底栏。
- 颜色与 token：继续使用原稿的 `--fc-*` 语义变量，交互蓝色、边框与背景层级一致。
- 图片质量：缩略图沿用原稿的抽象预览，本轮没有新增或替换素材；真实图片裁切留到生产实现联调。
- 文案与内容：删除“附加内容”，各板块名称、计数和操作文案与其业务含义一致。

## Focused region comparison

主编辑、图片展开和关系展开已分别以原始尺寸检查，字段文字、计数、展开状态和固定底栏均清晰；无需额外裁切局部图。

## Comparison history

1. 原稿问题：摘要、图片、标签和关系被统一降级为“附加内容”。
2. 修订：摘要移入核心表单；其余三类数据拆成平级原生折叠板块；增加独立定位状态。
3. 首轮渲染问题：查询参数触发平滑滚动，截图时尚未定位到展开板块。
4. 修复：定位改为即时滚动；复测图片与关系展开状态均正确显示。

## Implementation Checklist

- [x] 删除“附加内容”总入口和独立页面。
- [x] 摘要紧邻标题并始终可编辑。
- [x] 图片、属性与标签、词条关系各自独立折叠。
- [x] 验证摘要、图片、关系和沉浸正文入口不互相覆盖。

final result: passed
