# 移动端 Markdown 光标偏移修复记录

## 背景

移动端词条正文编辑使用 `flowcloudai-ui` 封装的 `MarkdownEditor`，底层是 `@uiw/react-md-editor`。

`@uiw/react-md-editor` 的编辑层由两套元素叠在一起：

- `.w-md-editor-text-pre`：镜像层，负责显示文本和 Markdown 高亮。
- `.w-md-editor-text-input`：真实 `textarea`，负责输入、选区和原生光标。

真实 `textarea` 是绝对定位在 `.w-md-editor-text` 内部的。光标是否和可见文字对齐，依赖 `.w-md-editor-text`、`.w-md-editor-text-pre`、`.w-md-editor-text-input` 三者的字体、行高、padding、换行规则一致。

## 问题原因

移动端样式曾直接给 `.w-md-editor-text-pre` 和 `.w-md-editor-text-input` 设置 padding、字体、行高和换行规则。

这破坏了 `@uiw/react-md-editor` 的默认布局假设：

- `.w-md-editor-text` 父层已有 padding。
- `.w-md-editor-text-input` 绝对定位在父层左上角。
- `.w-md-editor-text-pre` 是普通文档流中的镜像层。

当 padding 落在子层时，可见文字和真实 `textarea` 的坐标基准不再完全一致，表现为移动端正文编辑光标相对实际文字位置向左、向上偏移。

能推翻这个判断的证据：运行时 computed style 显示父层和两个子层的 padding、字体、行高、换行规则完全一致，并且可见文字起点与 `textarea` 文本起点重合。

## 修复方案

把正文编辑区和沉浸编辑区的文字盒模型统一收回到 `.w-md-editor-text` 父层：

- padding、字体、字号、行高、换行规则设置在 `.w-md-editor-text`。
- `.w-md-editor-text-pre` 和 `.w-md-editor-text-input` 只继承父层的文字样式。
- 不再在 `pre/input` 子层重复设置 padding。

后续如果要调整移动端正文编辑的内边距，只改 `.w-md-editor-text`，不要改 `.w-md-editor-text-pre` 或 `.w-md-editor-text-input` 的 padding。

## 验证

- `npm run lint` 通过，仅保留既有 `MapShapeEditorWorkbench.tsx` hook 依赖 warning。
- `npm run build` 通过，仅保留既有 chunk 体积和 Vite 依赖导出 warning。
- 手动验证移动端正文编辑光标与文字位置对齐。
