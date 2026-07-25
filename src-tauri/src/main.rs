//! 桌面应用二进制入口，仅将控制权交给库层启动流程。

// 防止在 Windows 发布版中显示额外控制台窗口，请勿删除！！
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
fn main() {
    app_lib::run();
}
