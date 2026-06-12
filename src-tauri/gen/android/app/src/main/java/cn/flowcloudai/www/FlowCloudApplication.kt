package cn.flowcloudai.www

import android.app.Application
import android.os.Build
import android.system.Os
import android.system.OsConstants
import android.util.Log

class FlowCloudApplication : Application() {
  private val shouldSkipWebViewTrimMemory: Boolean by lazy {
    val pageSize = runCatching { Os.sysconf(OsConstants._SC_PAGE_SIZE) }.getOrDefault(0)
    Build.SUPPORTED_ABIS.contains("x86_64") && pageSize >= 16 * 1024
  }

  override fun onTrimMemory(level: Int) {
    if (shouldSkipWebViewTrimMemory) {
      // Android 16KB x86_64 模拟器上的 WebView 148 会在内部 trim 回调里触发 SIGILL。
      // 不调用 super 可阻止 Application 分发给 WebView 注册的 ComponentCallbacks。
      Log.w("FlowCloudApplication", "skip onTrimMemory dispatch on x86_64 16KB WebView environment: level=$level")
      return
    }
    super.onTrimMemory(level)
  }
}
