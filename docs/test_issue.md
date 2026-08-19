# app_main 测试加载期崩溃排查纪要（STATUS_ENTRYPOINT_NOT_FOUND）

> 范围：`app_main`（Tauri 桌面端）Windows 下 `cargo test`。
> 排查日期：2026-06-02。
> 环境：Rust 1.95.0 / LLVM 22 / `x86_64-pc-windows-msvc`，VS2026 工具集 14.50.35717，Windows 11 build 26200。
> 性质：测试**二进制加载期**失败的根因定位 + 已落地方案 + 遗留事项；含 `dumpbin` 证据，便于复核。

---

## 0. 现象

- 在 `app_main/src-tauri` 跑任意测试，测试可执行文件一运行就报 `STATUS_ENTRYPOINT_NOT_FOUND`（NTSTATUS `0xC0000139`）。
- 失败发生在**进入测试代码之前**：用 `app_lib-<hash>.exe --list`（只枚举用例、不执行任何测试逻辑）复现 —— 零输出、退出码 127。说明是 Windows 加载器解析导入表阶段就死了，与具体哪个测试、与 `web_tools.rs` 等业务代码**无关**。
- **关键对照**：真实 app（`cargo run` / `tauri dev` / `FlowCloudAI.exe`）**完全正常**，只有测试二进制崩。

---

## 1. 根因：缺少 common-controls v6 应用程序清单

测试二进制经 `tao`/`wry`/`tauri-plugin-dialog` 按**名字**静态导入了 `comctl32.dll` 的 v6 专有导出：

```
comctl32.dll
    TaskDialogIndirect      ← v6 专有
    SetWindowSubclass
    DefSubclassProc
    RemoveWindowSubclass
```

`TaskDialogIndirect` 只存在于 **comctl32 v6**（WinSxS 并列程序集）。加载器只有在 exe 的**应用程序清单**声明了对 `Microsoft.Windows.Common-Controls 6.0.0.0` 的依赖时，才会把 `comctl32.dll` 绑定到 v6；否则回退到 `C:\Windows\System32\comctl32.dll` —— 那是 **v5.82** 老桩，**不导出** `TaskDialogIndirect`，于是入口点解析失败。

差异就在清单：

| 二进制 | 内含 common-controls 清单 | comctl32 绑定到 | TaskDialogIndirect | 结果 |
|---|---|---|---|---|
| `FlowCloudAI.exe`（主程序） | 是（`tauri-build` 以**资源**嵌入） | WinSxS **v6** | 有 | ✅ 正常 |
| `app_lib-<hash>.exe`（测试） | 否 | System32 **v5.82** | 无 | ❌ 入口点缺失 |

主程序由 `src/main.rs` 经 `tauri-build`（`build.rs` 的 `tauri_build::build()`）构建，会把含 common-controls v6 / DPI 等的清单以资源形式（`target/debug/build/FlowCloudAI-*/out/resource.lib`）嵌入；而 `cargo test` 把 lib 的 rlib + libtest 单独链成一个控制台 exe，**不走**这条清单嵌入路径，于是“裸奔”。

### 1.1 被排除的常见误判

- **不是** VC++ Redistributable 太旧：System32 `VCRUNTIME140.dll` = 14.50.35719（比构建工具集 14.50.35717 还新），导出齐全。
- **不是** UCRT / 系统 DLL 问题：`ucrtbase.dll`、`bcryptprimitives.dll` = 10.0.26100.8328，`ProcessPrng` 等导出正常。
- **不是** 环境/构建产物脏：`cargo clean` 无效（干净重编出的测试 exe 一样没清单）。判别口诀——**真实 app 正常、只有测试崩 → 看清单，不要折腾系统 DLL。**

---

## 2. 关键限制：为何不能简单地“给测试加清单”

cargo 的链接参数作用域与 Tauri 的清单嵌入方式叠加，形成一个死结：

| 手段 | 覆盖 lib 单元测试 | 影响正式 bin | 结论 |
|---|---|---|---|
| `cargo:rustc-link-arg-tests` | ❌（只覆盖 `tests/` 集成测试） | 否 | 无集成测试目标时还报 “does not have a test target” |
| `cargo:rustc-link-arg`（通用） | ✅ | **是** | bin 与 tauri 资源清单叠加 → `CVT1100 资源重复` / `LNK1123`，**破坏 app 构建** |

即：**cargo 没有“仅 lib 单元测试”的链接参数作用域**，而 Tauri 把清单作为资源嵌入 bin，导致正式 bin 无法再吃链接器清单。结论是 **app_main 的 lib 单元测试无法在不破坏 app 的前提下经 build.rs 拿到清单**。

> 另：`/MANIFESTDEPENDENCY` 内含空格，经 `cargo → rustc → link.exe` 传递时会被拆成多个参数（`LNK1181: 无法打开输入文件 "name='...'"`）；改用**清单文件 + `/MANIFESTINPUT`**（路径无空格）规避。

---

## 3. 已落地方案（2026-06-02）：web_tools 测试改为集成测试

思路：集成测试（`tests/*.rs`）可由 `rustc-link-arg-tests` 安全注入清单且不碰正式 bin，故把会牵入 Tauri 依赖的测试放到 `tests/` 下。

涉及文件：

| 文件 | 改动 |
|---|---|
| `app_main/src-tauri/build.rs` | windows 目标下注入 `cargo:rustc-link-arg-tests=/MANIFEST:EMBED` 与 `=/MANIFESTINPUT:{CARGO_MANIFEST_DIR}/common-controls.manifest` |
| `app_main/src-tauri/common-controls.manifest` | 新增，仅声明 common-controls v6 依赖 |
| `app_main/src-tauri/src/lib.rs` | `#[doc(hidden)] pub use crate::tools::web_tools::__test_api as test_api;`（窄桥接，不公开整个 `tools` 树） |
| `app_main/src-tauri/src/tools/web_tools.rs` | 被测私有项改 `pub`（`SearchIntent`/`SearchResult`/`MediaWikiSource` 及相关字段、`SearchIntent::parse`、9 个 `*_SOURCES` 常量、`search_mediawiki_source`、`search_moegirl_opensearch_inner`）；删除 `#[cfg(test)] mod tests`；新增 `#[doc(hidden)] pub mod __test_api` 经 `pub use super::{...}` 再导出 |
| `app_main/src-tauri/tests/web_tools.rs` | 新增，3 个测试迁移至此 |
| `app_main/src-tauri/Cargo.toml` | `[dev-dependencies]` 增加 `tokio`（rt-multi-thread）、`reqwest`（json）——集成测试 crate 内需自行构建 HTTP 客户端与运行时 |

`build.rs` 关键片段：

```rust
fn main() {
    // 给测试 / bench 目标补 common-controls v6 清单，修复测试二进制加载期
    // STATUS_ENTRYPOINT_NOT_FOUND。仅 -tests 作用域，绝不碰正式 bin
    //（正式构建由 tauri 以资源形式嵌入清单，再叠加链接器清单会触发 CVT1100）。
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows") {
        let manifest_dir = std::env::var("CARGO_MANIFEST_DIR").unwrap();
        println!("cargo:rustc-link-arg-tests=/MANIFEST:EMBED");
        println!("cargo:rustc-link-arg-tests=/MANIFESTINPUT:{manifest_dir}/common-controls.manifest");
        println!("cargo:rerun-if-changed=common-controls.manifest");
    }
    tauri_build::build()
}
```

### 3.1 验证

```text
running 3 tests
test mediawiki_search_smoke ... ignored
test moegirl_opensearch_smoke ... ignored
test parses_supported_search_intents ... ok
test result: ok. 1 passed; 0 failed; 2 ignored
```

- `cargo test --test web_tools` —— 集成测试二进制正常加载，纯逻辑测试通过，两个联网冒烟保持 `#[ignore]`。
- `cargo build --bin FlowCloudAI` —— app 仍正常构建，未受影响。

### 3.2 运行方式

```bash
cd app_main/src-tauri
cargo test --test web_tools                 # 跑迁移后的测试
cargo test --test web_tools -- --ignored    # 手动跑两个联网冒烟（需公网）
```

---

## 4. 遗留与后续

- **本次只解决了 web_tools 这 3 个测试。** 其余约 59 个 lib 单元测试分散在 17 个文件，仍共用同一个 `app_lib` 测试二进制；`cargo test --lib` 与裸 `cargo test` 依旧加载即崩。
- **约定**：今后凡是会牵入 Tauri 依赖的测试，一律按 `tests/web_tools.rs` 范式写成**集成测试**；纯逻辑若可剥离，更推荐下沉到无 Tauri 依赖的 crate。
- **可选的整体方案**：若要一次性救活现有那批单元测试，可改用“环境变量门控的通用 `cargo:rustc-link-arg` + `cargo test --lib`”——门控关时正式构建不受影响，门控开且仅 `--lib`（不连带构建 bin）时给单测二进制注入清单。代价是工作流偏 hacky，未采用。

---

## 5. 定位手法备忘

- 工具：`dumpbin /dependents | /imports | /exports`（VS2026 工具集在 `D:\VS2026\VC\Tools\MSVC\14.50.35717\bin\Hostx64\x64`）。git-bash 调用要 `MSYS_NO_PATHCONV=1`，否则 `/dependents` 这类参数会被当成路径。
- 复现并确认是加载期失败：`app_lib-<hash>.exe --list`（零输出 + 退出 127）。
- 看 exe 是否带清单：`grep -a "Microsoft.Windows.Common-Controls" <exe>`（主程序命中、测试 exe 不命中即印证本问题）。
- 查 System32 comctl32 版本与导出：`(Get-Item C:\Windows\System32\comctl32.dll).VersionInfo`、`dumpbin /exports C:\Windows\System32\comctl32.dll`（确认无 `TaskDialogIndirect`）。
