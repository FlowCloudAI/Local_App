# Windows 字体安装包体积对比

记录时间：2026-08-08

## 结果

| 构建 | Git 快照 | 安装包大小 | SHA-256 |
| --- | --- | ---: | --- |
| 加入字体前 | `df3e39a` | 11,203,688 字节（10.685 MiB） | `FDE1295D7F9C9C0A3C0A06DE07B0584E29DDDBCEE3113FD4740183D424C8009A` |
| 加入字体后 | `0338ab0` | 62,068,146 字节（59.193 MiB） | `20324D4E408188A31281703F1A25A72249EBA8DC6629677F9A328B522A383CF1` |

安装包增加 **50,864,458 字节（48.508 MiB，+454.00%）**，最终大小约为原来的 **5.54 倍**。

7 个 WOFF2 源文件合计 50,230,752 字节（47.904 MiB）；Vite 产物包含 7 个 WOFF2、0 个 TTF。安装包增量比 WOFF2 合计多 633,706 字节（0.604 MiB）。

## 测量口径

- Windows 目标：`x86_64-pc-windows-msvc`。
- 安装器：Tauri NSIS，文件名 `流云AI_0.1.4_x64-setup.exe`。
- 两次构建使用同一份 `Cargo.lock`，SHA-256 为 `E6199AFA35F5EFCCC06A1ED793A1DCF7F95BE1FA87D22FDCAA9D585CC801BB55`。
- 最终构建使用隔离工作树，排除了同时进行的移动端未提交改动。
- 校验通过：`npm run lint`；最终打包内置执行的 `npm run build`；7 个 WOFF2 字体签名、字形表和可变字重轴检查。

## 已知打包条件

项目配置了 updater 公钥，但当前环境没有 `TAURI_SIGNING_PRIVATE_KEY`。标准打包会先成功生成 NSIS 安装器，再在 updater 签名阶段返回错误。体积测量的最终重跑仅临时关闭 `bundle.createUpdaterArtifacts`，未改变 NSIS 安装器内容；正式发布仍应使用项目的签名构建流程和私钥。
