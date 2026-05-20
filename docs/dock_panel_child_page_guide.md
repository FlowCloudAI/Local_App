# DockPanel 子页面开发规范

本文档记录后续新增 `DockableSidePanel` 子页面时应遵守的结构、样式和验证约定。目标是让右侧 Dock 面板里的不同工具切换时保持同一套工作区体验，同时允许业务内容保留必要差异。

## 适用范围

适用于挂载到 `DockableSidePanel` 的子页面，例如：

- 灵感便签
- AI 对话
- 快照 / 版本管理
- 后续新增的右侧工具页

不适用于主工作区页面、弹窗、设置页或独立全屏页面。

## 基本原则

1. 新子页面必须使用共享骨架组件，不要重新手写 side、main、topbar、图标按钮的基础布局。
2. 子页面可以有自己的业务内容样式，但不能复制共享骨架已负责的宽度、高度、背景、边框、圆角、顶栏高度和图标按钮基础样式。
3. `fullscreen` 模式优先使用 `DockableSidePanel` 的双 slot：`side` 放左侧区，`main` 放主工作区。
4. `floating` 模式可以按业务需要把 `side` 嵌入 `main` 内部，但必须保持顶栏、按钮、滚动区域和视觉层级一致。
5. `Snapshot` 的 floating 上下布局是已确认的业务例外：允许保持“顶部主栏 -> 中间控制区 -> 底部图谱区”的结构。

## 必用组件

从 `src/shared/ui/layout/DockPanelScaffold.tsx` 引入基础骨架：

```tsx
import {
    DockPanelIconButton,
    DockPanelMain,
    DockPanelSide,
    DockPanelTitle,
    DockPanelTopbar,
} from '../../shared/ui/layout/DockPanelScaffold'
```

按实际相对路径调整 import。

共享组件职责：

- `DockPanelSide`：左侧栏基础容器，负责固定宽度、背景、边框、全屏透明侧栏等骨架行为。
- `DockPanelMain`：主工作区基础容器，负责 flex 布局、背景、滚动裁剪、全屏圆角工作区。
- `DockPanelTopbar`：统一顶栏高度、间距、背景、底部分隔线。
- `DockPanelTopbar variant="side"`：侧栏顶栏，默认透明且无底部分隔线。
- `DockPanelTitle`：统一标题字号、字重和颜色。
- `DockPanelIconButton`：统一图标按钮尺寸、圆角、hover、disabled 状态。

侧栏筛选、搜索和分段控件优先使用：

```tsx
import {
    DockPanelSearchInput,
    DockPanelSegmentedControl,
} from '../../shared/ui/layout/DockPanelSidebarControls'
```

## 推荐文件形态

新增 Dock 子页面优先使用一个 hook 返回 slot：

```tsx
export interface XxxPanelSlots {
    side: ReactNode
    main: ReactNode
}

export function useXxxPanel(options: UseXxxPanelOptions): XxxPanelSlots {
    const sideContent = (
        <DockPanelSide className="xxx-side">
            <DockPanelTopbar className="xxx-side__topbar" variant="side">
                <DockPanelTitle className="xxx-side__title">侧栏标题</DockPanelTitle>
            </DockPanelTopbar>
            <div className="dock-panel-sidebar-controls">
                {/* 搜索、筛选、分段控件 */}
            </div>
            {/* 侧栏列表 */}
        </DockPanelSide>
    )

    const mainContent = (
        <DockPanelMain className="xxx-main">
            <DockPanelTopbar className="xxx-main__topbar">
                <DockPanelTitle className="xxx-main__title">主区标题</DockPanelTitle>
                <div className="xxx-main__topbar-actions">
                    <DockPanelIconButton title="全屏模式">
                        {/* 图标 */}
                    </DockPanelIconButton>
                </div>
            </DockPanelTopbar>
            {/* 主区内容 */}
        </DockPanelMain>
    )

    if (options.panelMode === 'fullscreen') {
        return {side: sideContent, main: mainContent}
    }

    return {
        side: null,
        main: (
            <div className="xxx-panel">
                {sideContent}
                {mainContent}
            </div>
        ),
    }
}
```

如果子页面没有侧栏，`side` 返回 `null`，`main` 仍使用 `DockPanelMain`。

## floating 与 fullscreen 约定

### fullscreen

`fullscreen` 模式应尽量直接返回 `{side, main}`：

- `side` 使用 `DockPanelSide`。
- `main` 使用 `DockPanelMain`。
- 不要在业务 CSS 中重复写主区全屏圆角边框，`DockPanelScaffold.css` 已统一处理。
- 不要在业务 CSS 中重复写侧栏全屏透明背景，`DockPanelScaffold.css` 已统一处理。

### floating

`floating` 模式通常有两种允许结构：

1. 左右布局：外层容器包住 `sideContent` 和 `mainContent`。
2. 上下布局：仅在业务需要时使用，例如 `Snapshot`，但顶栏和按钮仍必须来自共享骨架。

如果 floating 内需要响应窄宽度，可使用 container query，但只处理业务布局，不覆盖共享骨架基础样式。

## AIChat Portal 例外

如果子页面已有大量内部状态、effect 或上下文，拆出 `side` 会导致状态搬迁成本过高，可以参考 AI 对话的 portal 方案：

- `fullscreen` 下 `side` 返回一个 portal host。
- 主组件仍渲染在 `main` 中。
- 主组件内部将侧栏 `createPortal` 到 side host。

该方案只应作为复杂历史组件的兼容手段。新页面优先直接拆 `sideContent` / `mainContent`，不要默认使用 portal。

## CSS 规范

业务 CSS 只写业务差异：

- 可以写：列表项、图谱、编辑器、输入区、业务状态、响应式排列。
- 不要写：side 固定宽度、main flex 主结构、topbar 高度、基础背景、基础边框、全屏圆角主区、图标按钮基础尺寸。

推荐保留的业务 class：

```css
.xxx-panel {}
.xxx-side {}
.xxx-main {}
.xxx-main__topbar-actions {}
.xxx-list {}
.xxx-list-item {}
```

禁止为了覆盖共享样式使用 `!important`。如果共享骨架能力不足，应先扩展 `DockPanelScaffold.css` 或骨架组件，再让业务页使用。

颜色、间距、圆角必须使用 `--fc-*` 或 `--dock-panel-*` token，不新增硬编码主题值。

## 接入 DesktopApp

新增子页面通常需要在 `src/app/desktop/DesktopApp.tsx` 中完成以下接入：

1. 扩展 `SidePanelContentKey`。
2. 调用新 hook，拿到 `{side, main}`。
3. 在 `sidePanelSides` 和 `sidePanelMains` 中按 key 注册。
4. 在侧边栏菜单中增加入口。
5. 保证 `mountedSidePanelKeys` 能覆盖该 key。

不要直接绕过 `DockableSidePanel` 自己挂载右侧页面。

## 验证清单

新增或改动 Dock 子页面后至少检查：

- floating 模式下布局正确。
- fullscreen 模式下 side/main 分离正确。
- 顶栏高度和按钮位置与已有 Dock 子页面一致。
- `Snapshot` 类上下布局页面没有被强制改成左右布局。
- 面板折叠、全屏切换、切换到其他 Dock 子页面后状态没有明显丢失。
- `npm run lint` 通过。
- 涉及 TypeScript 或组件结构变更时运行 `npm run build`。

提交前检查：

```bash
git diff --check
npm run lint
npm run build
```

如果只是纯文档更新，可以用 `git diff --check` 作为最低检查。

## 常见错误

- 在业务 CSS 中复制 `.dock-panel-main` 或 `.dock-panel-side` 的基础声明。
- 新页面的全屏主区自己写一套圆角卡片，导致和其他 Dock 子页面不一致。
- floating 和 fullscreen 使用完全不同的按钮样式。
- 侧栏筛选不用 `DockPanelSidebarControls`，导致控件密度和 hover 状态不一致。
- 为了局部修正使用 `!important`。
- 新增页面只测试 floating，未测试 fullscreen。
