use std::path::{Path, PathBuf};

struct AndroidFileImportRuntime {
    java_vm: jni::JavaVM,
    activity: jni::objects::Global<jni::objects::JObject<'static>>,
}

static ANDROID_FILE_IMPORT_RUNTIME: std::sync::OnceLock<AndroidFileImportRuntime> =
    std::sync::OnceLock::new();

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
