# FlowCloudAI 文件类型图标

## 文件清单

```
exports/
├── fcplug.svg         主源文件 · .fcplug 蓝色 (#1D72F3)
├── fcworld.svg        主源文件 · .fcworld 紫色 (#7C35ED)
├── preview.html       本地预览页（双击打开看效果）
└── png/
    ├── fcplug-{16,32,64,128,256,512,1024}.png
    └── fcworld-{16,32,64,128,256,512,1024}.png
```

## 设计参数

- viewBox: `128 × 128`（矢量可无损缩放）
- 纸张比例: `88 × 112` ≈ 0.79（接近 US Letter）
- glyph: 拼图块（.fcplug）/ 分段球体（.fcworld）
- 配色: 方案 A · 蓝 `#1D72F3` × 紫 `#7C35ED`

## 小尺寸 PNG 提示

`16px` 和 `32px` 的 PNG 由矢量直接栅格化，建议在生产环境用专门工具（如 Inkscape / rsvg-convert）针对小尺寸单独调优，或使用 SVG 让浏览器/系统按需渲染。

## 接入 Tauri

共享的扩展名与打开方式在 `src-tauri/tauri.conf.json` 中配置：

```json
{
  "bundle": {
    "fileAssociations": [
      {
        "ext": ["fcplug"],
        "contentTypes": ["cn.flowcloudai.fcplug"],
        "name": "FlowCloudAI 插件包",
        "description": "FlowCloudAI plugin package",
        "role": "Editor"
      },
      {
        "ext": ["fcworld"],
        "contentTypes": ["cn.flowcloudai.fcworld"],
        "name": "FlowCloudAI 世界观包",
        "description": "FlowCloudAI world export",
        "role": "Editor"
      }
    ]
  }
}
```

当前 Tauri 2 的 `fileAssociations` 不支持 `icon` 字段。Windows 文件图标继续由
`src-tauri/nsis/installer-hooks.nsh` 写入注册表；macOS 文件图标由
`src-tauri/Info.macos.plist` 的 `UTTypeIconFile` 声明，并通过
`src-tauri/tauri.macos.conf.json` 把 `fcplug.icns`、`fcworld.icns` 放入应用资源目录。

`.icns` 由本地 Tauri CLI 从本目录的 SVG 主源生成；不要直接修改生成文件后遗漏 SVG 主源。
