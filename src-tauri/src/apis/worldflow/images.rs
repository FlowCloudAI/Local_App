use super::common::*;

fn build_entry_images_dir(paths: &PathsState, project_id: &Uuid) -> Result<PathBuf, String> {
    let db_dir = paths
        .db_path
        .parent()
        .ok_or_else(|| format!("无法解析数据库目录: {:?}", paths.db_path))?;
    Ok(db_dir.join("images").join(project_id.to_string()))
}

fn canonical_images_root(paths: &PathsState) -> Result<PathBuf, String> {
    let db_dir = paths
        .db_path
        .parent()
        .ok_or_else(|| format!("无法解析数据库目录: {:?}", paths.db_path))?;
    let images_root = db_dir.join("images");
    std::fs::canonicalize(&images_root)
        .map_err(|e| format!("无法解析图片根目录 {:?}: {}", images_root, e))
}

fn ensure_image_path_allowed(paths: &PathsState, path: &Path) -> Result<PathBuf, String> {
    let canonical_requested =
        std::fs::canonicalize(path).map_err(|e| format!("无法访问图片路径 {:?}: {}", path, e))?;
    let canonical_root = canonical_images_root(paths)?;

    if !canonical_requested.starts_with(&canonical_root) {
        return Err(format!("图片路径不在允许范围内: {:?}", canonical_requested));
    }

    Ok(canonical_requested)
}

fn should_keep_existing_image(path: &Path, target_dir: &Path) -> bool {
    path.starts_with(target_dir)
}

#[tauri::command]
pub fn open_entry_image_path(
    app: AppHandle,
    paths: State<'_, PathsState>,
    path: String,
) -> Result<(), String> {
    let allowed_path = ensure_image_path_allowed(paths.inner(), Path::new(&path))?;
    let folder_path = allowed_path
        .parent()
        .ok_or_else(|| format!("无法解析图片所在文件夹: {:?}", allowed_path))?;
    app.opener()
        .open_path(folder_path.to_string_lossy().into_owned(), None::<String>)
        .map_err(|e| format!("打开图片所在文件夹失败: {}", e))
}

pub(super) fn copy_entry_images(
    paths: &PathsState,
    project_id: &Uuid,
    images: Option<Vec<FCImage>>,
) -> Result<Option<Vec<FCImage>>, String> {
    let Some(images) = images else {
        return Ok(None);
    };

    let target_dir = build_entry_images_dir(paths, project_id)?;
    std::fs::create_dir_all(&target_dir)
        .map_err(|e| format!("创建图片目录失败 {:?}: {}", target_dir, e))?;

    let copied_images = images
        .into_iter()
        .map(|mut image| {
            if image.path.as_os_str().is_empty() {
                return Ok(image);
            }

            let source_path = image.path.clone();
            if should_keep_existing_image(&source_path, &target_dir) {
                return Ok(image);
            }
            if !source_path.exists() {
                return Err(format!("图片文件不存在: {:?}", source_path));
            }

            let extension = source_path
                .extension()
                .and_then(|ext| ext.to_str())
                .filter(|ext| !ext.is_empty());
            let file_name = match extension {
                Some(ext) => format!("{}.{}", Uuid::new_v4(), ext),
                None => Uuid::new_v4().to_string(),
            };
            let target_path = target_dir.join(file_name);

            std::fs::copy(&source_path, &target_path).map_err(|e| {
                format!(
                    "复制图片失败: {:?} -> {:?}, {}",
                    source_path, target_path, e
                )
            })?;

            image.path = target_path;
            Ok(image)
        })
        .collect::<Result<Vec<_>, String>>()?;

    Ok(Some(copied_images))
}

#[tauri::command]
pub fn import_entry_images(
    paths: State<'_, PathsState>,
    project_id: String,
    file_paths: Vec<String>,
) -> Result<Vec<FCImage>, String> {
    let project_id = Uuid::parse_str(&project_id).map_err(|e| e.to_string())?;
    let images = file_paths
        .into_iter()
        .map(|path| {
            let path_buf = PathBuf::from(&path);
            FCImage {
                path: path_buf,
                is_cover: false,
                caption: None,
            }
        })
        .collect::<Vec<_>>();

    Ok(copy_entry_images(paths.inner(), &project_id, Some(images))?.unwrap_or_default())
}

#[tauri::command]
pub async fn import_remote_images(
    paths: State<'_, PathsState>,
    network: State<'_, NetworkState>,
    project_id: String,
    urls: Vec<String>,
) -> Result<Vec<FCImage>, String> {
    let _project_id = Uuid::parse_str(&project_id).map_err(|e| e.to_string())?;

    let images_root = paths
        .db_path
        .parent()
        .ok_or_else(|| "invalid db path".to_string())?
        .join("images");
    std::fs::create_dir_all(&images_root).map_err(|e| e.to_string())?;

    let mut images = Vec::new();
    for (i, url) in urls.into_iter().enumerate() {
        // 清洗 URL：移除查询参数，提取纯净扩展名
        let clean_url = url.split('?').next().unwrap_or(&url);
        let ext = clean_url
            .split('.')
            .last()
            .unwrap_or("png");

        // 清洗文件名：移除 Windows 非法字符
        let timestamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0);
        let filename = format!("remote_{}_{}.{}",
                               timestamp,
                               i, ext);
        let local_path = images_root.join(&filename);

        let bytes = network
            .client
            .get(&url)
            .send()
            .await
            .map_err(|e| e.to_string())?
            .bytes()
            .await
            .map_err(|e| e.to_string())?;

        std::fs::write(&local_path, &bytes).map_err(|e| e.to_string())?;

        images.push(FCImage {
            path: local_path,
            is_cover: false,
            caption: None,
        });
    }
    Ok(images)
}
