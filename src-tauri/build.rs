fn main() {
    // cargo test 生成的测试可执行文件默认不带 common-controls v6 清单，
    // 会把 comctl32 绑定到 System32 的 v5.82（缺少 TaskDialogIndirect 等 v6 导出），
    // 导致测试二进制在加载期即报 STATUS_ENTRYPOINT_NOT_FOUND，进不到任何测试代码。
    // 给所有可执行目标（含 cargo test 的 lib 单元测试二进制）补 common-controls v6
    // 清单依赖，修复测试二进制加载期的 STATUS_ENTRYPOINT_NOT_FOUND。
    // 用清单文件 + /MANIFESTINPUT，避免 /MANIFESTDEPENDENCY 内含空格被链接器拆成多个参数；
    // 该依赖会并入链接器生成的清单，与 tauri 为正式构建注入的同名依赖合并去重。
    // 仅用 -tests 变体，作用域限定为测试 / bench 目标，绝不碰正式 bin
    // （正式构建由 tauri 以资源形式嵌入清单，再叠加链接器清单会触发 CVT1100 资源重复）。
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows") {
        let manifest_dir = std::env::var("CARGO_MANIFEST_DIR").unwrap();
        println!("cargo:rustc-link-arg-tests=/MANIFEST:EMBED");
        println!(
            "cargo:rustc-link-arg-tests=/MANIFESTINPUT:{manifest_dir}/common-controls.manifest"
        );
        println!("cargo:rerun-if-changed=common-controls.manifest");
    }

    tauri_build::build()
}
