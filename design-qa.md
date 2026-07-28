# 帮助中心布局设计 QA

- source visual truth path: `C:\Users\f1779\.codex\visualizations\2026\07\28\019fa66f-afac-7121-a30b-8dfd8925044f\help-audit\help-layout-prototype.html`
- implementation screenshot path: unavailable
- viewport: 未捕获
- source pixels / implementation pixels / CSS size / density: 未捕获，无法归一化
- state: 窄栏首页、窄栏文章、全屏首页、全屏文章

**Findings**

- [P1] 缺少实现截图，无法完成视觉对比
  Location: 帮助中心四个目标状态。
  Evidence: 设计基线已由用户在单 HTML 中审计通过，但当前环境没有可调用的应用内浏览器工具，Chrome 也不可用，因此没有同视口实现截图。
  Impact: 无法核验实际运行时的宽度、折行、滚动和目录固定效果。
  Fix: 提供上述四个状态的同尺寸截图，再进行并排比较。

**Open Questions**

- 无。实现范围已经由通过审计的单 HTML 确定。

**Implementation Checklist**

- 已统一窄栏与全屏的信息架构。
- 已把搜索提升到帮助首页首屏。
- 已移除窄栏目录遮罩层。
- 已压缩文章头部，并区分窄栏折叠目录与全屏固定目录。
- 待补四个运行状态截图并完成视觉对比。

**Follow-up Polish**

- 视觉对比完成前不判断 P3 细节。

## Comparison History

- 尚未开始：缺少浏览器渲染的实现截图。

## Full-view Comparison Evidence

- blocked：没有实现截图。

## Focused Region Comparison Evidence

- blocked：没有实现截图，无法检查标题区、目录区和正文首屏。

final result: blocked

---

## 历史 QA：文档引用卡片轨道

- 视觉真源：
  - `C:\Users\f1779\AppData\Local\Temp\codex-clipboard-50ce86eb-5cea-4477-a706-be608ef48846.png`
  - `C:\Users\f1779\AppData\Local\Temp\codex-clipboard-b5115d45-a914-44ad-8259-41bd4bca838a.png`
  - `C:\Users\f1779\AppData\Local\Temp\codex-clipboard-88e87ba7-9a2b-4eea-aefa-b141aa79888d.png`
  - `C:\Users\f1779\AppData\Local\Temp\codex-clipboard-1c7e603f-e2b1-43fc-9183-c6f3d2d94239.png`
- 目标视口：桌面端，参考图约 1353 × 676。
- 目标状态：单/多文档的输入区引用卡片、解析状态、移除与横向溢出导航。

### 比较证据

- 全局比较：受阻。当前可见的 `FlowCloudAI` 桌面实例停留在世界地图页；为避免打断用户正在使用的页面，未导航到 AI 聊天页。
- 局部比较：受阻。缺少同一视口、同一聊天状态的实现截图，不能以代码或构建结果代替视觉证据。

### 已完成的代码核验

- `tsc -b --pretty false` 通过。
- `vite build` 通过。
- `npm run lint` 通过，保留一条既有地图组件 warning。

### 待视觉核验项

1. 单张文档卡片的高度、文件名截断与移除按钮的悬停/键盘焦点状态。
2. 多张卡片溢出时左右导航的出现、滚动位置和可达性。
3. `pending`、`parsing`、`ready`、`failed` 四种状态在真实 Tauri 窗口中的对比度与布局。

final result: blocked
