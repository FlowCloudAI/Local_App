use std::{
    path::{Path, PathBuf},
    process::Stdio,
    time::Duration,
};

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use tauri::{AppHandle, Manager};
use tokio::{process::Command, time::timeout};
use uuid::Uuid;

use crate::{ApiError, apis::app_settings::default_data_root};

const DEFAULT_TIMEOUT_MS: u64 = 60_000;
const MAX_TIMEOUT_MS: u64 = 300_000;

#[cfg(target_os = "windows")]
const SIDECAR_EXE_NAME: &str = "flowcloudai-ocr-sidecar.exe";

#[cfg(not(target_os = "windows"))]
const SIDECAR_EXE_NAME: &str = "flowcloudai-ocr-sidecar";

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OcrRecognizeImageRequest {
    pub input_path: String,
    pub timeout_ms: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OcrModelInfo {
    pub name: String,
    pub dir: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OcrModels {
    pub det: OcrModelInfo,
    pub rec: OcrModelInfo,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OcrLine {
    pub index: usize,
    pub text: String,
    pub score: Option<f64>,
    #[serde(rename = "box")]
    pub text_box: Option<Vec<Vec<i32>>>,
    pub rect: Option<Vec<i32>>,
    pub det_box: Option<Vec<Vec<i32>>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OcrPage {
    pub input_path: String,
    pub page_index: Option<usize>,
    pub text: String,
    pub lines: Vec<OcrLine>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OcrRecognizeImageResult {
    pub ok: bool,
    pub engine: String,
    pub device: String,
    pub models: OcrModels,
    pub input_path: String,
    pub elapsed_ms: u64,
    pub pages: Vec<OcrPage>,
    pub text: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OcrSidecarErrorPayload {
    code: Option<String>,
    message: Option<String>,
    elapsed_ms: Option<u64>,
    traceback: Option<String>,
}

#[tauri::command]
pub async fn ocr_recognize_image(
    app: AppHandle,
    request: OcrRecognizeImageRequest,
) -> Result<OcrRecognizeImageResult, ApiError> {
    let input_path = PathBuf::from(&request.input_path);
    let input_path = input_path
        .canonicalize()
        .map_err(|err| ApiError::from(err).with_kv("path", request.input_path.clone()))?;
    if !input_path.is_file() {
        return Err(
            ApiError::internal("OCR 输入路径不是文件").with_kv("path", path_string(&input_path))
        );
    }

    let sidecar_exe = resolve_sidecar_exe(&app)?;
    let runtime_root = default_data_root(&app).join("ocr-sidecar");
    let output_dir = runtime_root.join("outputs");
    let cache_dir = runtime_root.join("cache");
    std::fs::create_dir_all(&output_dir)?;
    std::fs::create_dir_all(&cache_dir)?;

    let output_path = output_dir.join(format!("{}.json", Uuid::new_v4()));
    let timeout_ms = request
        .timeout_ms
        .unwrap_or(DEFAULT_TIMEOUT_MS)
        .clamp(1_000, MAX_TIMEOUT_MS);

    let mut command = Command::new(&sidecar_exe);
    command
        .arg("--input")
        .arg(&input_path)
        .arg("--output")
        .arg(&output_path)
        .arg("--cache-dir")
        .arg(&cache_dir)
        .arg("--device")
        .arg("cpu")
        .arg("--engine")
        .arg("paddle")
        .env("PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK", "True")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);

    let output = timeout(Duration::from_millis(timeout_ms), command.output())
        .await
        .map_err(|_| {
            ApiError::internal("OCR sidecar 执行超时")
                .with_kv("timeout_ms", timeout_ms)
                .with_kv("sidecar", path_string(&sidecar_exe))
                .with_kv("input", path_string(&input_path))
        })??;

    let result = read_sidecar_result(&output_path);
    if output.status.success() {
        let payload: OcrRecognizeImageResult = result?;
        let _ = std::fs::remove_file(&output_path);
        return Ok(payload);
    }

    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let error_payload = read_sidecar_error(&output_path).ok();
    let _ = std::fs::remove_file(&output_path);

    Err(sidecar_error(
        output.status.code(),
        error_payload,
        stderr,
        stdout,
        &sidecar_exe,
        &input_path,
    ))
}

fn read_sidecar_result(path: &Path) -> Result<OcrRecognizeImageResult, ApiError> {
    let text = std::fs::read_to_string(path).map_err(|err| {
        ApiError::from(err)
            .with_kv("path", path_string(path))
            .with_kv("reason", "OCR sidecar 未生成结果文件")
    })?;
    serde_json::from_str(&text).map_err(|err| {
        ApiError::from(err)
            .with_kv("path", path_string(path))
            .with_kv("reason", "OCR sidecar 结果 JSON 无法解析")
    })
}

fn read_sidecar_error(path: &Path) -> Result<OcrSidecarErrorPayload, ApiError> {
    let text = std::fs::read_to_string(path)?;
    serde_json::from_str(&text).map_err(ApiError::from)
}

fn sidecar_error(
    exit_code: Option<i32>,
    payload: Option<OcrSidecarErrorPayload>,
    stderr: String,
    stdout: String,
    sidecar_exe: &Path,
    input_path: &Path,
) -> ApiError {
    let code = payload
        .as_ref()
        .and_then(|item| item.code.clone())
        .unwrap_or_else(|| "OCR_SIDECAR_FAILED".to_string());
    let message = payload
        .as_ref()
        .and_then(|item| item.message.clone())
        .filter(|item| !item.trim().is_empty())
        .unwrap_or_else(|| {
            if stderr.is_empty() {
                "OCR sidecar 执行失败".to_string()
            } else {
                stderr.chars().take(800).collect()
            }
        });

    ApiError {
        code,
        message,
        detail: json!({
            "exitCode": exit_code,
            "elapsedMs": payload.as_ref().and_then(|item| item.elapsed_ms),
            "traceback": payload.as_ref().and_then(|item| item.traceback.clone()),
            "stderr": truncate(&stderr, 4000),
            "stdout": truncate(&stdout, 4000),
            "sidecar": path_string(sidecar_exe),
            "input": path_string(input_path),
        }),
    }
}

fn resolve_sidecar_exe(app: &AppHandle) -> Result<PathBuf, ApiError> {
    let mut candidates = Vec::new();

    if let Some(path) = std::env::var_os("FLOWCLOUDAI_OCR_SIDECAR_EXE") {
        candidates.push(PathBuf::from(path));
    }

    #[cfg(debug_assertions)]
    {
        candidates.push(
            PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("resources")
                .join("ocr-sidecar")
                .join("windows-x64")
                .join("flowcloudai-ocr-sidecar")
                .join(SIDECAR_EXE_NAME),
        );
    }

    if let Ok(resource_dir) = app.path().resource_dir() {
        candidates.push(
            resource_dir
                .join("ocr-sidecar")
                .join("windows-x64")
                .join("flowcloudai-ocr-sidecar")
                .join(SIDECAR_EXE_NAME),
        );
    }

    if let Some(path) = std::env::current_exe()
        .ok()
        .and_then(|path| path.parent().map(|parent| parent.to_path_buf()))
    {
        candidates.push(
            path.join("ocr-sidecar")
                .join("windows-x64")
                .join("flowcloudai-ocr-sidecar")
                .join(SIDECAR_EXE_NAME),
        );
    }

    for candidate in &candidates {
        if candidate.is_file() {
            return Ok(candidate.clone());
        }
    }

    Err(ApiError::internal("未找到 OCR sidecar 可执行文件").with_kv(
        "checked",
        Value::Array(
            candidates
                .iter()
                .map(|path| Value::String(path_string(path)))
                .collect(),
        ),
    ))
}

fn path_string(path: &Path) -> String {
    path.to_string_lossy().to_string()
}

fn truncate(value: &str, max_chars: usize) -> String {
    if value.chars().count() <= max_chars {
        return value.to_string();
    }
    let mut output: String = value.chars().take(max_chars).collect();
    output.push_str("...(truncated)");
    output
}
