package cn.flowcloudai.www

import android.content.ContentResolver
import android.net.Uri
import android.os.Bundle
import android.provider.OpenableColumns
import android.util.Log
import android.view.View
import android.webkit.WebView
import android.webkit.MimeTypeMap
import androidx.activity.OnBackPressedCallback
import androidx.activity.enableEdgeToEdge
import java.io.File
import java.util.UUID

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
    if (AndroidRuntimeWorkarounds.isX86_64_16KbPageEnvironment) {
      // Android 16KB x86_64 模拟器上的 WebView/GPU 组合可能只渲染黑屏，改用软件层绘制。
      webView.setLayerType(View.LAYER_TYPE_SOFTWARE, null)
      Log.w("MainActivity", "use software layer for WebView on x86_64 16KB environment")
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
