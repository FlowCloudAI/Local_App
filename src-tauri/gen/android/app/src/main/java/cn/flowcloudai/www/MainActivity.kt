/*
 * Android 移动壳层入口：衔接系统返回、WindowInsets、系统字号与 WebView。
 * 页面结构仍由共享 React 实现；这里只桥接 Android 独有的系统环境信号。
 */
package cn.flowcloudai.www

import android.content.ContentResolver
import android.content.res.Configuration
import android.net.Uri
import android.os.Bundle
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.provider.OpenableColumns
import android.provider.Settings
import android.util.Log
import android.view.View
import android.view.ViewGroup
import android.webkit.JavascriptInterface
import android.webkit.WebView
import android.webkit.MimeTypeMap
import androidx.activity.BackEventCompat
import androidx.activity.OnBackPressedCallback
import androidx.activity.enableEdgeToEdge
import androidx.core.graphics.Insets
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsAnimationCompat
import androidx.core.view.WindowInsetsCompat
import java.io.File
import java.util.Locale
import java.util.UUID

class MainActivity : TauriActivity() {
  private var webView: WebView? = null
  private var mobileSafeInsets: Insets = Insets.NONE
  private var mobileImeInsets: Insets = Insets.NONE
  private var mobileImeVisible = false
  private var mobileImeAnimationDurationMs = 0L
  private var mobileWebViewExpandedHeightPx = 0

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
    configureMobileWindowInsets()
    onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
      override fun handleOnBackStarted(backEvent: BackEventCompat) {
        dispatchAndroidBackEvent("flowcloudai:android-back-start", backEvent.progress)
      }

      override fun handleOnBackProgressed(backEvent: BackEventCompat) {
        dispatchAndroidBackEvent("flowcloudai:android-back-progress", backEvent.progress)
      }

      override fun handleOnBackCancelled() {
        dispatchAndroidBackEvent("flowcloudai:android-back-cancel")
      }

      override fun handleOnBackPressed() {
        dispatchAndroidBackEvent("flowcloudai:android-back-invoked")
      }
    })
  }

  override fun onWebViewCreate(webView: WebView) {
    super.onWebViewCreate(webView)
    this.webView = webView
    webView.addOnLayoutChangeListener { view, _, _, _, _, _, _, _, _ ->
      if (!mobileImeVisible && view.height > 0) {
        mobileWebViewExpandedHeightPx = view.height
      }
    }
    webView.addJavascriptInterface(MobileUiJavascriptBridge(), "flowcloudaiMobileUi")
    pushMobileUiEnvironment()
    updateMobileWebViewKeyboardViewport()
    pushMobileKeyboardMetrics()
    ViewCompat.requestApplyInsets(window.decorView)
    if (AndroidRuntimeWorkarounds.isX86_64_16KbPageEnvironment) {
      // Android 16KB x86_64 模拟器上的 WebView/GPU 组合可能只渲染黑屏，改用软件层绘制。
      webView.setLayerType(View.LAYER_TYPE_SOFTWARE, null)
      Log.w("MainActivity", "use software layer for WebView on x86_64 16KB environment")
    }
  }

  override fun onResume() {
    super.onResume()
    pushMobileUiEnvironment()
    pushMobileKeyboardMetrics()
  }

  override fun onConfigurationChanged(newConfig: Configuration) {
    super.onConfigurationChanged(newConfig)
    pushMobileUiEnvironment()
    ViewCompat.requestApplyInsets(window.decorView)
  }

  private fun configureMobileWindowInsets() {
    ViewCompat.setOnApplyWindowInsetsListener(window.decorView) { _, windowInsets ->
      mobileSafeInsets = windowInsets.getInsets(
        WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout()
      )
      updateMobileImeInsets(windowInsets)
      updateMobileWebViewKeyboardViewport()
      pushMobileUiEnvironment()
      pushMobileKeyboardMetrics()
      windowInsets
    }
    ViewCompat.setWindowInsetsAnimationCallback(
      window.decorView,
      object : WindowInsetsAnimationCompat.Callback(DISPATCH_MODE_CONTINUE_ON_SUBTREE) {
        override fun onPrepare(animation: WindowInsetsAnimationCompat) {
          super.onPrepare(animation)
          if (animation.typeMask and WindowInsetsCompat.Type.ime() == 0) return
          mobileImeAnimationDurationMs = animation.durationMillis.coerceAtLeast(0L)
        }

        override fun onProgress(
          insets: WindowInsetsCompat,
          @Suppress("UNUSED_PARAMETER")
          runningAnimations: MutableList<WindowInsetsAnimationCompat>
        ): WindowInsetsCompat {
          /*
           * 系统负责 IME 的逐帧动画。这里若同步改 WebView 高度并执行 JavaScript，
           * 会把最终 WindowInsets 与动画中间帧交替写入页面，造成升降过程反复重排。
           */
          return insets
        }

        override fun onEnd(animation: WindowInsetsAnimationCompat) {
          super.onEnd(animation)
          if (animation.typeMask and WindowInsetsCompat.Type.ime() == 0) return
          mobileImeAnimationDurationMs = 0L
          ViewCompat.getRootWindowInsets(window.decorView)?.let(::updateMobileImeInsets)
          updateMobileWebViewKeyboardViewport()
          pushMobileKeyboardMetrics()
        }
      }
    )
    ViewCompat.requestApplyInsets(window.decorView)
  }

  private fun updateMobileImeInsets(windowInsets: WindowInsetsCompat) {
    mobileImeInsets = windowInsets.getInsets(WindowInsetsCompat.Type.ime())
    mobileImeVisible = windowInsets.isVisible(WindowInsetsCompat.Type.ime())
      && mobileImeInsets.bottom > 0
  }

  /**
   * edge-to-edge 厂商 WebView 可能把 adjustResize 退化成 visual viewport 平移。
   * 原生层直接约束 WebView 物理高度，确保页面坐标系保持贴顶且只缩短可用高度。
   */
  private fun updateMobileWebViewKeyboardViewport() {
    val target = webView ?: return
    val layoutParams = target.layoutParams ?: return

    if (!mobileImeVisible || mobileImeInsets.bottom <= 0) {
      if (layoutParams.height != ViewGroup.LayoutParams.MATCH_PARENT) {
        layoutParams.height = ViewGroup.LayoutParams.MATCH_PARENT
        target.layoutParams = layoutParams
      }
      return
    }

    if (mobileWebViewExpandedHeightPx <= 0 && target.height > 0) {
      mobileWebViewExpandedHeightPx = target.height
    }
    val expandedHeight = mobileWebViewExpandedHeightPx.takeIf { it > 0 }
      ?: target.rootView.height.takeIf { it > 0 }
      ?: return
    val parentHeight = (target.parent as? View)?.height?.takeIf { it > 0 } ?: expandedHeight
    val desiredHeight = (expandedHeight - mobileImeInsets.bottom)
      .coerceAtLeast(1)
      .coerceAtMost(parentHeight)
    if (layoutParams.height != desiredHeight) {
      layoutParams.height = desiredHeight
      target.layoutParams = layoutParams
    }
  }

  private fun pushMobileKeyboardMetrics() {
    val target = webView ?: return
    val density = resources.displayMetrics.density.coerceAtLeast(1f)
    val bottom = if (mobileImeVisible) mobileImeInsets.bottom / density else 0f
    val viewportWidth = target.width.coerceAtLeast(0) / density
    val viewportHeightPx = mobileWebViewExpandedHeightPx.takeIf { it > 0 }
      ?: (target.height + if (mobileImeVisible) mobileImeInsets.bottom else 0)
    val viewportHeight = viewportHeightPx.coerceAtLeast(0) / density
    val frameTop = (viewportHeight - bottom).coerceAtLeast(0f)
    val duration = mobileImeAnimationDurationMs.coerceAtLeast(0L)
    val visible = mobileImeVisible && bottom > 0f
    val script = """
      (() => {
        const metrics = {
          visible: $visible,
          docked: $visible,
          occludedBottom: ${String.format(Locale.US, "%.2f", bottom)},
          frame: ${if (visible) "{ x: 0, y: ${String.format(Locale.US, "%.2f", frameTop)}, width: ${String.format(Locale.US, "%.2f", viewportWidth)}, height: ${String.format(Locale.US, "%.2f", bottom)} }" else "null"},
          animationDurationMs: $duration,
          animationCurve: 'ease-in-out',
        };
        window.__flowcloudaiPendingMobileKeyboardMetrics = metrics;
        window.__flowcloudaiReceiveMobileKeyboardMetrics?.(metrics);
      })();
    """.trimIndent()

    target.post {
      target.evaluateJavascript(script, null)
    }
  }

  private fun dispatchAndroidBackEvent(name: String, progress: Float? = null) {
    val detail = progress?.coerceIn(0f, 1f)?.let {
      String.format(Locale.US, "{ progress: %.4f }", it)
    }
    val event = if (detail == null) {
      "new Event('$name')"
    } else {
      "new CustomEvent('$name', { detail: $detail })"
    }
    webView?.evaluateJavascript("window.dispatchEvent($event); true", null)
  }

  private fun pushMobileUiEnvironment() {
    val target = webView ?: return
    val density = resources.displayMetrics.density.coerceAtLeast(1f)
    val fontScale = resources.configuration.fontScale.coerceIn(1f, 2f)
    val highContrast = Settings.Secure.getInt(
      contentResolver,
      "high_text_contrast_enabled",
      0
    ) == 1

    fun cssPixels(value: Int): String =
      String.format(Locale.US, "%.2fpx", value / density)

    val script = """
      (() => {
        const root = document.documentElement;
        root.style.setProperty('--mobile-native-inset-top', '${cssPixels(mobileSafeInsets.top)}');
        root.style.setProperty('--mobile-native-inset-right', '${cssPixels(mobileSafeInsets.right)}');
        root.style.setProperty('--mobile-native-inset-bottom', '${cssPixels(mobileSafeInsets.bottom)}');
        root.style.setProperty('--mobile-native-inset-left', '${cssPixels(mobileSafeInsets.left)}');
        root.style.setProperty('--mobile-font-scale', '$fontScale');
        root.dataset.mobileHighContrast = '$highContrast';
        const syncNativeTheme = () => {
          const theme = root.dataset.theme === 'dark' ? 'dark' : 'light';
          window.flowcloudaiMobileUi?.setTheme(theme);
        };
        if (!window.__flowcloudaiMobileThemeObserver) {
          window.__flowcloudaiMobileThemeObserver = new MutationObserver(syncNativeTheme);
          window.__flowcloudaiMobileThemeObserver.observe(root, {
            attributes: true,
            attributeFilter: ['data-theme'],
          });
        }
        syncNativeTheme();
      })();
    """.trimIndent()

    target.post {
      target.evaluateJavascript(script, null)
    }
  }

  private inner class MobileUiJavascriptBridge {
    @JavascriptInterface
    fun getNavigationMode(): String {
      val resourceId = resources.getIdentifier(
        "config_navBarInteractionMode",
        "integer",
        "android"
      )
      if (resourceId == 0) return "unknown"

      return when (resources.getInteger(resourceId)) {
        0, 1 -> "buttons"
        2 -> "gesture"
        else -> "unknown"
      }
    }

    @JavascriptInterface
    fun setTheme(theme: String) {
      runOnUiThread {
        val light = theme != "dark"
        WindowCompat.getInsetsController(window, window.decorView).apply {
          isAppearanceLightStatusBars = light
          isAppearanceLightNavigationBars = light
        }
      }
    }

    @JavascriptInterface
    fun haptic(kind: String) {
      runOnUiThread {
        val vibrator = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
          getSystemService(VibratorManager::class.java)?.defaultVibrator
        } else {
          @Suppress("DEPRECATION")
          getSystemService(Vibrator::class.java)
        } ?: return@runOnUiThread

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
          val effect = when (kind) {
            "success" -> VibrationEffect.EFFECT_DOUBLE_CLICK
            "warning" -> VibrationEffect.EFFECT_HEAVY_CLICK
            else -> VibrationEffect.EFFECT_TICK
          }
          vibrator.vibrate(VibrationEffect.createPredefined(effect))
        } else {
          @Suppress("DEPRECATION")
          vibrator.vibrate(when (kind) {
            "warning" -> 35L
            "success" -> 24L
            else -> 12L
          })
        }
      }
    }
  }

  fun copyContentUriToDir(uriString: String, targetDirPath: String): String {
    val uri = Uri.parse(uriString)
    val targetDir = File(targetDirPath)
    targetDir.mkdirs()

    val extension = resolvePickedFileExtension(uri) ?: "bin"
    val target = File(targetDir, "${UUID.randomUUID()}.$extension")
    val input = contentResolver.openInputStream(uri)
      ?: throw IllegalArgumentException("无法打开已选择的图片")

    input.use { source ->
      target.outputStream().use { output ->
        source.copyTo(output)
      }
    }
    return target.absolutePath
  }

  fun copyFileToContentUri(sourcePath: String, uriString: String) {
    val uri = Uri.parse(uriString)
    val output = contentResolver.openOutputStream(uri, "w")
      ?: throw IllegalArgumentException("无法写入已选择的文件")

    File(sourcePath).inputStream().use { source ->
      output.use { target ->
        source.copyTo(target)
      }
    }
  }

  private fun resolvePickedFileExtension(uri: Uri): String? {
    val name = when (uri.scheme) {
      ContentResolver.SCHEME_FILE -> uri.path?.let { File(it).name }
      else -> resolveDisplayName(uri) ?: uri.lastPathSegment
    }
    val fromName = name
      ?.substringAfterLast('.', "")
      ?.lowercase()
      ?.takeIf { it.isNotBlank() && it.length <= 8 }
    return fromName ?: MimeTypeMap.getSingleton()
      .getExtensionFromMimeType(contentResolver.getType(uri))
      ?.lowercase()
  }

  private fun resolveDisplayName(uri: Uri): String? {
    if (uri.scheme != ContentResolver.SCHEME_CONTENT) return null
    return runCatching {
      contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)
        ?.use { cursor ->
          val index = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
          if (index >= 0 && cursor.moveToFirst()) cursor.getString(index) else null
        }
    }.getOrNull()
  }
}
