//! Android `content://` 文件读写的 JNI 桥接。
//!
//! Android 文件选择器返回的 URI 不一定对应应用可直接读取的路径；本模块在 Java 层复制内容到
//! 应用管理的目录，或把应用生成的文件写回目标 URI，并缓存 Activity/JavaVM 以支持异步线程调用。

use std::path::{Path, PathBuf};

struct AndroidFileImportRuntime {
    java_vm: jni::JavaVM,
    activity: jni::objects::Global<jni::objects::JObject<'static>>,
}

static ANDROID_FILE_IMPORT_RUNTIME: std::sync::OnceLock<AndroidFileImportRuntime> =
    std::sync::OnceLock::new();

/// 在 Activity 创建时初始化运行时引用；后续导入必须在此成功后进行。
pub(crate) fn init_android_file_import(
    env: &mut jni::Env,
    activity: &jni::objects::JObject<'_>,
) -> jni::errors::Result<()> {
    if ANDROID_FILE_IMPORT_RUNTIME.get().is_none() {
        let runtime = AndroidFileImportRuntime {
            java_vm: env.get_java_vm()?,
            activity: env.new_global_ref(activity)?,
        };
        let _ = ANDROID_FILE_IMPORT_RUNTIME.set(runtime);
    }
    Ok(())
}

pub(crate) fn is_android_file_uri(path: &str) -> bool {
    path.starts_with("content://") || path.starts_with("file://")
}

pub(crate) fn is_android_content_uri(path: &str) -> bool {
    path.starts_with("content://")
}

/// 通过 Android ContentResolver 复制 URI 指向的文件，并返回应用可访问的本地路径。
pub(crate) fn copy_android_file_uri_to_dir(
    uri: &str,
    target_dir: &Path,
) -> Result<PathBuf, String> {
    let runtime = ANDROID_FILE_IMPORT_RUNTIME
        .get()
        .ok_or_else(|| "Android 文件导入运行时未初始化".to_string())?;
    let uri = uri.to_string();
    let target_dir = target_dir.to_string_lossy().to_string();

    runtime
        .java_vm
        .attach_current_thread(|env| -> jni::errors::Result<PathBuf> {
            let uri_arg = env.new_string(&uri)?;
            let target_dir_arg = env.new_string(&target_dir)?;
            let copied_path = env
                .call_method(
                    &runtime.activity,
                    jni::jni_str!("copyContentUriToDir"),
                    jni::jni_sig!("(Ljava/lang/String;Ljava/lang/String;)Ljava/lang/String;"),
                    &[(&uri_arg).into(), (&target_dir_arg).into()],
                )?
                .l()?;
            let copied_path = env.cast_local::<jni::objects::JString>(copied_path)?;
            Ok(PathBuf::from(copied_path.try_to_string(env)?))
        })
        .map_err(|e| format!("导入 Android 选择文件失败: {}", e))
}

/// 把应用私有目录中的文件写入 Android 文件选择器返回的目标 URI。
pub(crate) fn copy_local_file_to_android_uri(source_path: &Path, uri: &str) -> Result<(), String> {
    let runtime = ANDROID_FILE_IMPORT_RUNTIME
        .get()
        .ok_or_else(|| "Android 文件运行时未初始化".to_string())?;
    let source_path = source_path.to_string_lossy().to_string();
    let uri = uri.to_string();

    runtime
        .java_vm
        .attach_current_thread(|env| -> jni::errors::Result<()> {
            let source_path_arg = env.new_string(&source_path)?;
            let uri_arg = env.new_string(&uri)?;
            env.call_method(
                &runtime.activity,
                jni::jni_str!("copyFileToContentUri"),
                jni::jni_sig!("(Ljava/lang/String;Ljava/lang/String;)V"),
                &[(&source_path_arg).into(), (&uri_arg).into()],
            )?;
            Ok(())
        })
        .map_err(|e| format!("写入 Android 选择文件失败: {}", e))
}
