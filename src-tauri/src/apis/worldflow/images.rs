use super::common::*;
use image::{GenericImageView, codecs::jpeg::JpegEncoder, imageops::FilterType};
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::io::BufWriter;

const COVER_THUMB_MAX_EDGE: u32 = 640;
const COVER_THUMB_JPEG_QUALITY: u8 = 82;

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

fn build_entry_thumbnails_dir(paths: &PathsState, project_id: &Uuid) -> Result<PathBuf, String> {
    Ok(build_entry_images_dir(paths, project_id)?.join("thumbs"))
}

fn cover_thumbnail_hash(source_path: &Path) -> u64 {
    let mut hasher = DefaultHasher::new();
    source_path.to_string_lossy().hash(&mut hasher);
    if let Ok(metadata) = std::fs::metadata(source_path) {
        metadata.len().hash(&mut hasher);
        if let Ok(modified) = metadata.modified() {
            if let Ok(duration) = modified.duration_since(std::time::UNIX_EPOCH) {
                duration.as_secs().hash(&mut hasher);
                duration.subsec_nanos().hash(&mut hasher);
            }
        }
    }
    hasher.finish()
}

fn is_valid_cover_thumbnail(path: &Path) -> bool {
    let is_jpeg = path
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| matches!(ext.to_ascii_lowercase().as_str(), "jpg" | "jpeg"))
        .unwrap_or(false);
    let in_thumbs_dir = path
        .components()
        .any(|component| component.as_os_str().to_string_lossy() == "thumbs");
    is_jpeg && in_thumbs_dir && path.exists()
}

pub(super) fn create_entry_cover_thumbnail(
    paths: &PathsState,
    project_id: &Uuid,
    source_path: &Path,
) -> Result<PathBuf, String> {
    if source_path.as_os_str().is_empty() {
        return Err("主图路径为空，无法生成缩略图".to_string());
    }
    if !source_path.exists() {
        return Err(format!("主图文件不存在: {:?}", source_path));
    }

    let thumbs_dir = build_entry_thumbnails_dir(paths, project_id)?;
    std::fs::create_dir_all(&thumbs_dir)
        .map_err(|e| format!("创建缩略图目录失败 {:?}: {}", thumbs_dir, e))?;

    let thumb_path = thumbs_dir.join(format!(
        "cover_{:016x}.jpg",
        cover_thumbnail_hash(source_path)
    ));
    if thumb_path.exists() {
        return Ok(thumb_path);
    }

    let image =
        image::open(source_path).map_err(|e| format!("读取主图失败 {:?}: {}", source_path, e))?;
    let (width, height) = image.dimensions();
    if width == 0 || height == 0 {
        return Err(format!("主图尺寸无效: {:?}", source_path));
    }

    let scale = (COVER_THUMB_MAX_EDGE as f64 / width.max(height) as f64).min(1.0);
    let target_width = ((width as f64 * scale).round() as u32).max(1);
    let target_height = ((height as f64 * scale).round() as u32).max(1);
    let resized = if target_width == width && target_height == height {
        image
    } else {
        image.resize(target_width, target_height, FilterType::Lanczos3)
    };

    let file = std::fs::File::create(&thumb_path)
        .map_err(|e| format!("创建缩略图失败 {:?}: {}", thumb_path, e))?;
    let mut writer = BufWriter::new(file);
    let mut encoder = JpegEncoder::new_with_quality(&mut writer, COVER_THUMB_JPEG_QUALITY);
    encoder
        .encode_image(&resized.to_rgb8())
        .map_err(|e| format!("写入缩略图失败 {:?}: {}", thumb_path, e))?;

    Ok(thumb_path)
}

pub(super) fn prepare_entry_cover_path(
    paths: &PathsState,
    project_id: &Uuid,
    images: Option<&[FCImage]>,
) -> Option<Option<String>> {
    let images = images?;
    let Some(cover_image) = images.iter().find(|image| image.is_cover) else {
        return Some(None);
    };
    let original_path = cover_image.path.to_string_lossy().to_string();
    match create_entry_cover_thumbnail(paths, project_id, &cover_image.path) {
        Ok(path) => Some(Some(path.to_string_lossy().to_string())),
        Err(error) => {
            log::warn!(
                "[cover_thumbnail] 生成词条主图缩略图失败，将回退到原图: path={:?} error={}",
                cover_image.path,
                error
            );
            Some(Some(original_path))
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CoverThumbnailMigrationSummary {
    pub scanned: usize,
    pub generated: usize,
    pub skipped: usize,
    pub failed: usize,
}

pub(super) async fn ensure_project_cover_thumbnails_with_progress<F>(
    db: &SqliteDb,
    paths: &PathsState,
    project_id: &Uuid,
    mut progress: F,
) -> Result<CoverThumbnailMigrationSummary, String>
where
    F: FnMut(usize, usize),
{
    let mut entries = Vec::new();
    let mut offset = 0usize;
    const PAGE_SIZE: usize = 200;

    loop {
        let batch = db
            .list_entries(project_id, EntryFilter::default(), PAGE_SIZE, offset)
            .await
            .map_err(|e| e.to_string())?;
        if batch.is_empty() {
            break;
        }
        let batch_len = batch.len();
        for brief in batch {
            entries.push(db.get_entry(&brief.id).await.map_err(|e| e.to_string())?);
        }
        offset += batch_len;
        if batch_len < PAGE_SIZE {
            break;
        }
    }

    let total = entries.len();
    let mut summary = CoverThumbnailMigrationSummary {
        scanned: 0,
        generated: 0,
        skipped: 0,
        failed: 0,
    };

    for entry in entries {
        summary.scanned += 1;
        let cover_image = entry.images.0.iter().find(|image| image.is_cover);
        let Some(cover_image) = cover_image else {
            if entry.cover_path.is_some() {
                db.update_entry(
                    &entry.id,
                    UpdateEntry {
                        category_id: None,
                        title: None,
                        summary: None,
                        content: None,
                        r#type: None,
                        tags: None,
                        images: None,
                        cover_path: Some(None),
                    },
                )
                .await
                .map_err(|e| e.to_string())?;
                summary.generated += 1;
            } else {
                summary.skipped += 1;
            }
            progress(summary.scanned, total);
            continue;
        };

        if entry
            .cover_path
            .as_deref()
            .map(Path::new)
            .map(is_valid_cover_thumbnail)
            .unwrap_or(false)
        {
            summary.skipped += 1;
            progress(summary.scanned, total);
            continue;
        }

        let thumb_path = match create_entry_cover_thumbnail(paths, project_id, &cover_image.path) {
            Ok(path) => path,
            Err(error) => {
                summary.failed += 1;
                log::warn!(
                    "[cover_thumbnail] 迁移词条主图缩略图失败: entry_id={} path={:?} error={}",
                    entry.id,
                    cover_image.path,
                    error
                );
                progress(summary.scanned, total);
                continue;
            }
        };
        let next_cover_path = thumb_path.to_string_lossy().to_string();
        if entry.cover_path.as_deref() == Some(next_cover_path.as_str()) {
            summary.skipped += 1;
            progress(summary.scanned, total);
            continue;
        }

        db.update_entry(
            &entry.id,
            UpdateEntry {
                category_id: None,
                title: None,
                summary: None,
                content: None,
                r#type: None,
                tags: None,
                images: None,
                cover_path: Some(Some(next_cover_path)),
            },
        )
        .await
        .map_err(|e| e.to_string())?;
        summary.generated += 1;
        progress(summary.scanned, total);
    }

    Ok(summary)
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
        log::info!("[copy_entry_images] images=None, 跳过复制");
        return Ok(None);
    };

    log::info!(
        "[copy_entry_images] 开始复制 {} 张图片, project_id={}",
        images.len(),
        project_id
    );

    let target_dir = build_entry_images_dir(paths, project_id)?;
    std::fs::create_dir_all(&target_dir)
        .map_err(|e| format!("创建图片目录失败 {:?}: {}", target_dir, e))?;

    let total = images.len();
    let copied_images = images
        .into_iter()
        .enumerate()
        .map(|(i, mut image)| {
            log::info!(
                "[copy_entry_images] 图片 [{}/{}] path={:?} is_cover={}",
                i + 1,
                total,
                image.path,
                image.is_cover
            );
            if image.path.as_os_str().is_empty() {
                log::info!("[copy_entry_images] 图片 [{}] path为空，跳过", i);
                return Ok(image);
            }

            let source_path = image.path.clone();
            if should_keep_existing_image(&source_path, &target_dir) {
                log::info!("[copy_entry_images] 图片 [{}] 已在目标目录，跳过复制", i);
                return Ok(image);
            }
            if !source_path.exists() {
                log::error!(
                    "[copy_entry_images] 图片 [{}] 文件不存在: {:?}",
                    i,
                    source_path
                );
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
            let target_path = target_dir.join(&file_name);

            log::info!(
                "[copy_entry_images] 复制 {:?} -> {:?}",
                source_path,
                target_path
            );
            std::fs::copy(&source_path, &target_path).map_err(|e| {
                log::error!(
                    "[copy_entry_images] 复制失败: {:?} -> {:?}, {}",
                    source_path,
                    target_path,
                    e
                );
                format!(
                    "复制图片失败: {:?} -> {:?}, {}",
                    source_path, target_path, e
                )
            })?;

            image.path = target_path;
            log::info!(
                "[copy_entry_images] 图片 [{}] 复制完成, 新path={:?}",
                i,
                image.path
            );
            Ok(image)
        })
        .collect::<Result<Vec<_>, String>>()?;

    log::info!(
        "[copy_entry_images] 全部复制完成, 共 {} 张",
        copied_images.len()
    );
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
    let project_id = Uuid::parse_str(&project_id).map_err(|e| e.to_string())?;
    let target_dir = build_entry_images_dir(paths.inner(), &project_id)?;
    std::fs::create_dir_all(&target_dir).map_err(|e| e.to_string())?;

    let mut images = Vec::new();
    for url in urls {
        // 清洗 URL：移除查询参数，提取纯净扩展名
        let clean_url = url.split('?').next().unwrap_or(&url);
        let ext = clean_url
            .split('.')
            .last()
            .filter(|value| !value.is_empty() && value.len() <= 8)
            .unwrap_or("png");
        let filename = format!("{}.{}", Uuid::new_v4(), ext);
        let local_path = target_dir.join(&filename);

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

#[tauri::command]
pub async fn db_ensure_project_cover_thumbnails(
    state: State<'_, Arc<AppState>>,
    paths: State<'_, PathsState>,
    project_id: String,
) -> Result<CoverThumbnailMigrationSummary, String> {
    let project_id = Uuid::parse_str(&project_id).map_err(|e| e.to_string())?;
    let db = state.inner().sqlite_db.lock().await;
    ensure_project_cover_thumbnails_with_progress(&db, paths.inner(), &project_id, |_, _| {}).await
}
