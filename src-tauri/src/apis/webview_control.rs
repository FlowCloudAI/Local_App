use tauri::Manager;

#[cfg(windows)]
use {
    std::sync::mpsc,
    webview2_com::Microsoft::Web::WebView2::Win32::{
        ICoreWebView2, ICoreWebView2_3,
    },
    webview2_com::TrySuspendCompletedHandler,
    windows::core::Interface,
};

/// 尝试挂起 WebView2，释放其内存占用。
/// 建议在窗口最小化或切换到后台时调用。
#[tauri::command]
pub async fn suspend_webview(app: tauri::AppHandle) -> Result<bool, String> {
    #[cfg(not(windows))]
    {
        let _ = app;
        return Err("WebView2 挂起仅在 Windows 平台可用".to_string());
    }

    #[cfg(windows)]
    {
        let window = app
            .get_webview_window("main")
            .ok_or("主窗口不存在")?;
        let (tx, rx) = mpsc::channel::<Result<bool, String>>();

        window
            .with_webview(move |webview| {
                let tx_err = tx.clone();

                let handler = TrySuspendCompletedHandler::create(Box::new(
                    move |error_result: ::windows::core::Result<()>, is_suspended: bool| {
                        let result = match error_result {
                            Ok(()) => Ok(is_suspended),
                            Err(e) => Err(format!("挂起失败: {}", e)),
                        };
                        let _ = tx.send(result);
                        Ok(())
                    },
                ));

                let result = (|| -> Result<(), String> {
                    let controller = webview.controller();
                    let core: ICoreWebView2 =
                        unsafe { controller.CoreWebView2() }.map_err(|e: ::windows::core::Error| e.to_string())?;
                    let core3: ICoreWebView2_3 =
                        core.cast().map_err(|e: ::windows::core::Error| e.to_string())?;
                    unsafe { core3.TrySuspend(&handler) }.map_err(|e: ::windows::core::Error| e.to_string())?;
                    Ok(())
                })();

                if let Err(e) = result {
                    let _ = tx_err.send(Err(e));
                }
            })
            .map_err(|e| e.to_string())?;

        rx.recv().map_err(|e| e.to_string())?
    }
}

/// 恢复已挂起的 WebView2。
#[tauri::command]
pub async fn resume_webview(app: tauri::AppHandle) -> Result<(), String> {
    #[cfg(not(windows))]
    {
        let _ = app;
        return Err("WebView2 恢复仅在 Windows 平台可用".to_string());
    }

    #[cfg(windows)]
    {
        let window = app
            .get_webview_window("main")
            .ok_or("主窗口不存在")?;
        let (tx, rx) = mpsc::channel::<Result<(), String>>();

        window
            .with_webview(move |webview| {
                let result = (|| -> Result<(), String> {
                    let controller = webview.controller();
                    let core: ICoreWebView2 =
                        unsafe { controller.CoreWebView2() }.map_err(|e: ::windows::core::Error| e.to_string())?;
                    let core3: ICoreWebView2_3 =
                        core.cast().map_err(|e: ::windows::core::Error| e.to_string())?;
                    unsafe { core3.Resume() }.map_err(|e: ::windows::core::Error| e.to_string())?;
                    Ok(())
                })();
                let _ = tx.send(result);
            })
            .map_err(|e| e.to_string())?;

        rx.recv().map_err(|e| e.to_string())?
    }
}
