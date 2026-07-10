# 文档引用卡片轨道设计核验

- 视觉真源：
  - `C:\Users\f1779\AppData\Local\Temp\codex-clipboard-50ce86eb-5cea-4477-a706-be608ef48846.png`
  - `C:\Users\f1779\AppData\Local\Temp\codex-clipboard-b5115d45-a914-44ad-8259-41bd4bca838a.png`
  - `C:\Users\f1779\AppData\Local\Temp\codex-clipboard-88e87ba7-9a2b-4eea-aefa-b141aa79888d.png`
  - `C:\Users\f1779\AppData\Local\Temp\codex-clipboard-1c7e603f-e2b1-43fc-9183-c6f3d2d94239.png`
- 目标视口：桌面端，参考图约 1353 × 676。
- 目标状态：单/多文档的输入区引用卡片、解析状态、移除与横向溢出导航。

## 比较证据

- 全局比较：受阻。当前可见的 `FlowCloudAI` 桌面实例停留在世界地图页；为避免打断用户正在使用的页面，未导航到 AI 聊天页。
- 局部比较：受阻。缺少同一视口、同一聊天状态的实现截图，不能以代码或构建结果代替视觉证据。

## 已完成的代码核验

- `tsc -b --pretty false` 通过。
- `vite build` 通过。
- `npm run lint` 通过，保留一条既有地图组件 warning。

## 待视觉核验项

1. 单张文档卡片的高度、文件名截断与移除按钮的悬停/键盘焦点状态。
2. 多张卡片溢出时左右导航的出现、滚动位置和可达性。
3. `pending`、`parsing`、`ready`、`failed` 四种状态在真实 Tauri 窗口中的对比度与布局。

final result: blocked
