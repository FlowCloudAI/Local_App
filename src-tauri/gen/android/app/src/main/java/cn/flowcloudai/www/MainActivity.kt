package cn.flowcloudai.www

import android.os.Bundle
import android.webkit.WebView
import androidx.activity.OnBackPressedCallback
import androidx.activity.enableEdgeToEdge

class MainActivity : TauriActivity() {
  private var webView: WebView? = null

  companion object {
    init {
      System.loadLibrary("app_lib")
    }
  }

  private external fun initRustlsPlatformVerifier()

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    initRustlsPlatformVerifier()
    super.onCreate(savedInstanceState)
    onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
      override fun handleOnBackPressed() {
        // Android 系统返回键由前端页面栈统一处理，避免直接退出应用。
        webView?.evaluateJavascript(
          "window.dispatchEvent(new Event('flowcloudai:android-back')); true",
          null
        )
      }
    })
  }

  override fun onWebViewCreate(webView: WebView) {
    super.onWebViewCreate(webView)
    this.webView = webView
  }
}
