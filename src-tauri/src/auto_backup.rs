use crate::{AppState, PathsState, SettingsState};
use anyhow::{Context, Result};
use base64::Engine;
use futures::TryStreamExt;
use sqlx::{Row, TypeInfo, ValueRef};
use std::collections::{BTreeMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager};
use tokio::io::AsyncWriteExt;

const BACKUP_POLL_INTERVAL: Duration = Duration::from_secs(5);
const TIMESTAMP_LEN: usize = 19;

pub fn start_auto_backup_worker(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let mut last_attempt = Instant::now();

        loop {
            tokio::time::sleep(BACKUP_POLL_INTERVAL).await;

            let Some(settings_state) = app.try_state::<SettingsState>() else {
                continue;
            };
            let settings = settings_state.settings.lock().await.clone();
            if settings.auto_backup_secs == 0 {
                last_attempt = Instant::now();
                continue;
            }

            let interval = Duration::from_secs(settings.auto_backup_secs as u64);
            if last_attempt.elapsed() < interval {
                continue;
            }
            last_attempt = Instant::now();

            if let Err(error) = run_csv_backup(&app).await {
                log::warn!("自动备份失败: {}", error);
            }
        }
    });
}

async fn run_csv_backup(app: &AppHandle) -> Result<()> {
    let settings_state = app
        .try_state::<SettingsState>()
        .context("设置状态尚未初始化")?;
    let paths = app
        .try_state::<PathsState>()
        .context("路径状态尚未初始化")?;
    let app_state = app
        .try_state::<Arc<AppState>>()
        .context("数据库状态尚未初始化")?;

    let settings = settings_state.settings.lock().await.clone();
    if settings.auto_backup_secs == 0 {
        return Ok(());
    }

    let backup_dir = resolve_backup_dir(settings.backup_dir.as_deref(), &paths)?;
    tokio::fs::create_dir_all(&backup_dir).await?;

    let timestamp = chrono::Local::now().format("%Y%m%d_%H%M%S_%3f").to_string();
    let max_backup_count = settings.max_backup_count.max(1) as usize;

    let pool = {
        let db = app_state.inner().sqlite_db.lock().await;
        db.pool.clone()
    };

    let table_names = sqlx::query_scalar::<_, String>(
        "SELECT name FROM sqlite_master \
         WHERE type = 'table' \
         AND name NOT LIKE 'sqlite_%' \
         AND name NOT LIKE '_sqlx_%' \
         ORDER BY name",
    )
    .fetch_all(&pool)
    .await?;

    for table_name in table_names {
        export_table_csv(&pool, &backup_dir, &timestamp, &table_name).await?;
    }

    prune_backup_sets(&backup_dir, max_backup_count).await?;
    Ok(())
}

fn resolve_backup_dir(configured: Option<&str>, paths: &PathsState) -> Result<PathBuf> {
    if let Some(dir) = configured.map(str::trim).filter(|dir| !dir.is_empty()) {
        return Ok(PathBuf::from(dir));
    }

    let db_dir = paths
        .db_path
        .parent()
        .with_context(|| format!("无法解析数据库目录: {:?}", paths.db_path))?;
    Ok(db_dir.join("backup"))
}

async fn export_table_csv(
    pool: &sqlx::SqlitePool,
    backup_dir: &Path,
    timestamp: &str,
    table_name: &str,
) -> Result<()> {
    let headers = load_table_columns(pool, table_name).await?;
    let query = format!("SELECT * FROM {}", quote_sqlite_identifier(table_name));
    let file_name = format!("{}_{}.csv", timestamp, sanitize_file_segment(table_name));
    let path = backup_dir.join(file_name);
    let mut file = tokio::fs::File::create(&path).await?;
    write_csv_record(&mut file, &headers).await?;

    let mut rows = sqlx::query(&query).fetch(pool);
    while let Some(row) = rows.try_next().await? {
        let mut record = Vec::with_capacity(headers.len());
        for index in 0..headers.len() {
            record.push(sqlite_cell_to_string(&row, index)?);
        }
        write_csv_record(&mut file, &record).await?;
    }
    file.flush().await?;
    Ok(())
}

async fn load_table_columns(pool: &sqlx::SqlitePool, table_name: &str) -> Result<Vec<String>> {
    let query = format!("PRAGMA table_info({})", quote_sqlite_identifier(table_name));
    let rows = sqlx::query(&query).fetch_all(pool).await?;
    rows.into_iter()
        .map(|row| row.try_get::<String, _>("name").map_err(Into::into))
        .collect()
}

fn sqlite_cell_to_string(row: &sqlx::sqlite::SqliteRow, index: usize) -> Result<String> {
    let raw = row.try_get_raw(index)?;
    if raw.is_null() {
        return Ok(String::new());
    }

    let type_name = raw.type_info().name().to_ascii_uppercase();
    if type_name.contains("INT") {
        return row
            .try_get::<i64, _>(index)
            .map(|value| value.to_string())
            .map_err(Into::into);
    }
    if type_name.contains("REAL") || type_name.contains("FLOA") || type_name.contains("DOUB") {
        return row
            .try_get::<f64, _>(index)
            .map(|value| value.to_string())
            .map_err(Into::into);
    }
    if type_name.contains("BLOB") {
        let bytes = row.try_get::<Vec<u8>, _>(index)?;
        return Ok(base64::engine::general_purpose::STANDARD.encode(bytes));
    }

    row.try_get::<String, _>(index)
        .or_else(|_| row.try_get::<i64, _>(index).map(|value| value.to_string()))
        .or_else(|_| row.try_get::<f64, _>(index).map(|value| value.to_string()))
        .or_else(|_| {
            row.try_get::<Vec<u8>, _>(index)
                .map(|bytes| base64::engine::general_purpose::STANDARD.encode(bytes))
        })
        .map_err(Into::into)
}

fn quote_sqlite_identifier(value: &str) -> String {
    format!("\"{}\"", value.replace('"', "\"\""))
}

fn sanitize_file_segment(value: &str) -> String {
    value
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '_' || ch == '-' {
                ch
            } else {
                '_'
            }
        })
        .collect()
}

async fn write_csv_record(file: &mut tokio::fs::File, fields: &[String]) -> Result<()> {
    let mut line = String::new();
    for (index, field) in fields.iter().enumerate() {
        if index > 0 {
            line.push(',');
        }
        push_csv_field(&mut line, field);
    }
    line.push('\n');
    file.write_all(line.as_bytes()).await?;
    Ok(())
}

fn push_csv_field(output: &mut String, value: &str) {
    let needs_quotes =
        value.contains(',') || value.contains('"') || value.contains('\n') || value.contains('\r');
    if !needs_quotes {
        output.push_str(value);
        return;
    }

    output.push('"');
    for ch in value.chars() {
        if ch == '"' {
            output.push('"');
        }
        output.push(ch);
    }
    output.push('"');
}

async fn prune_backup_sets(backup_dir: &Path, max_backup_count: usize) -> Result<()> {
    let mut dir = tokio::fs::read_dir(backup_dir).await?;
    let mut groups = BTreeMap::<String, Vec<PathBuf>>::new();

    while let Some(entry) = dir.next_entry().await? {
        let path = entry.path();
        if path.extension().and_then(|ext| ext.to_str()) != Some("csv") {
            continue;
        }
        let Some(file_name) = path.file_name().and_then(|name| name.to_str()) else {
            continue;
        };
        if let Some(prefix) = backup_prefix(file_name) {
            groups.entry(prefix).or_default().push(path);
        }
    }

    if groups.len() <= max_backup_count {
        return Ok(());
    }

    let keep = groups
        .keys()
        .rev()
        .take(max_backup_count)
        .cloned()
        .collect::<HashSet<_>>();

    for (prefix, files) in groups {
        if keep.contains(&prefix) {
            continue;
        }
        for file in files {
            if let Err(error) = tokio::fs::remove_file(&file).await {
                log::warn!("清理旧备份文件失败: {:?}, {}", file, error);
            }
        }
    }

    Ok(())
}

fn backup_prefix(file_name: &str) -> Option<String> {
    if file_name.len() <= TIMESTAMP_LEN || file_name.as_bytes().get(TIMESTAMP_LEN) != Some(&b'_') {
        return None;
    }

    let prefix = &file_name[..TIMESTAMP_LEN];
    let valid = prefix.chars().enumerate().all(|(index, ch)| match index {
        8 | 15 => ch == '_',
        _ => ch.is_ascii_digit(),
    });
    valid.then(|| prefix.to_string())
}
