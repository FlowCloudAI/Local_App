pub(super) use crate::{AppState, NetworkState, PathsState};
pub(super) use git2::{BranchType, Oid, Repository, Sort};
pub(super) use serde::Serialize;
pub(super) use serde_json::Value;
pub(super) use std::collections::BTreeSet;
pub(super) use std::env;
pub(super) use std::path::{Path, PathBuf};
pub(super) use std::sync::Arc;
pub(super) use tauri::{AppHandle, State, Window};
pub(super) use tauri_plugin_opener::OpenerExt;
pub(super) use tokio::sync::Mutex;
pub(super) use uuid::Uuid;
pub(super) use worldflow_core::{models::*, AppendResult, CategoryOps, EntryLinkOps, EntryOps, EntryRelationOps, EntryTypeOps, IdeaNoteOps, ProjectOps, SnapshotBranchInfo, SnapshotInfo, SqliteDb, TagSchemaOps, WorldflowError};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum TimelineTagRole {
    Start,
    End,
    Parent,
    Show,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectTimelineEvent {
    pub id: String,
    pub title: String,
    pub start_time: i32,
    pub end_time: Option<i32>,
    pub description: Option<String>,
    pub parent_id: Option<String>,
    pub entry_type: Option<String>,
    pub category_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectTimelineData {
    pub events: Vec<ProjectTimelineEvent>,
    pub year_start: Option<i32>,
    pub year_end: Option<i32>,
    pub scanned_entry_count: usize,
    pub matched_entry_count: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectStats {
    pub image_count: usize,
    pub word_count: usize,
}

struct DefaultTimelineTagDefinition {
    name: &'static str,
    description: &'static str,
    value_type: &'static str,
    default_value: Option<&'static str>,
    range_min: Option<f64>,
    range_max: Option<f64>,
    sort_order: i64,
}

const DEFAULT_TIMELINE_TAG_TARGETS: &[&str] = &["event"];

const DEFAULT_TIMELINE_TAG_DEFINITIONS: &[DefaultTimelineTagDefinition] = &[
    DefaultTimelineTagDefinition {
        name: "开始年份",
        description: "事件在时间线上的起始年份。公元前年份请填写负数，例如 -221。",
        value_type: "number",
        default_value: None,
        range_min: None,
        range_max: None,
        sort_order: 0,
    },
    DefaultTimelineTagDefinition {
        name: "结束年份",
        description: "事件结束年份；若留空则视为单点事件。",
        value_type: "number",
        default_value: None,
        range_min: None,
        range_max: None,
        sort_order: 1,
    },
    DefaultTimelineTagDefinition {
        name: "父事件ID",
        description: "用于把事件挂到上层事件下，可填写父事件词条 ID 或标题。",
        value_type: "string",
        default_value: None,
        range_min: None,
        range_max: None,
        sort_order: 2,
    },
    DefaultTimelineTagDefinition {
        name: "时间线",
        description: "是否在项目时间线中显示该事件。",
        value_type: "boolean",
        default_value: Some("true"),
        range_min: None,
        range_max: None,
        sort_order: 3,
    },
];

pub(super) fn normalize_timeline_tag_name(name: &str) -> String {
    name.trim()
        .chars()
        .filter(|ch| !matches!(ch, ' ' | '\t' | '\r' | '\n' | '_' | '-'))
        .flat_map(|ch| ch.to_lowercase())
        .collect()
}

pub(super) fn timeline_tag_role_from_name(name: &str) -> Option<TimelineTagRole> {
    match normalize_timeline_tag_name(name).as_str() {
        "start" | "startyear" | "starttime" | "year" | "年份" | "开始" | "开始年"
        | "开始年份" | "开始时间" | "起始" | "起始年" | "起始年份" | "起始时间" => {
            Some(TimelineTagRole::Start)
        }
        "end" | "endyear" | "endtime" | "结束" | "结束年" | "结束年份" | "结束时间"
        | "终止" | "终止年" | "终止年份" | "终止时间" => Some(TimelineTagRole::End),
        "parent" | "parentid" | "父事件" | "父级事件" | "父事件id" | "父级事件id"
        | "上级事件" | "上级事件id" => Some(TimelineTagRole::Parent),
        "timeline" | "ontimeline" | "showtimeline" | "时间线" | "纳入时间线"
        | "显示在时间线" | "显示时间线" => Some(TimelineTagRole::Show),
        _ => None,
    }
}

pub(super) fn parse_timeline_year_from_str(raw: &str) -> Option<i32> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }

    if let Ok(value) = trimmed.parse::<i32>() {
        return Some(value);
    }

    let normalized = trimmed.replace(' ', "").to_lowercase();
    let negative = normalized.contains("公元前")
        || normalized.contains("前")
        || normalized.contains("bc")
        || normalized.contains("bce");

    let digits = normalized
        .chars()
        .filter(|ch| ch.is_ascii_digit() || *ch == '-')
        .collect::<String>();

    if digits.is_empty() {
        return None;
    }

    let parsed = digits.parse::<i32>().ok()?;
    if negative && parsed > 0 {
        Some(-parsed)
    } else {
        Some(parsed)
    }
}

pub(super) fn parse_timeline_year(value: &Value) -> Option<i32> {
    match value {
        Value::Number(number) => number.as_i64().and_then(|value| i32::try_from(value).ok()),
        Value::String(text) => parse_timeline_year_from_str(text),
        _ => None,
    }
}

pub(super) fn parse_timeline_bool(value: &Value) -> Option<bool> {
    match value {
        Value::Bool(flag) => Some(*flag),
        Value::Number(number) => number.as_i64().map(|value| value != 0),
        Value::String(text) => match text.trim().to_lowercase().as_str() {
            "true" | "1" | "yes" | "y" | "on" | "是" | "显示" | "加入" => Some(true),
            "false" | "0" | "no" | "n" | "off" | "否" | "隐藏" | "移除" => Some(false),
            _ => None,
        },
        _ => None,
    }
}

pub(super) fn parse_timeline_parent(value: &Value) -> Option<String> {
    match value {
        Value::String(text) => {
            let trimmed = text.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed.to_string())
            }
        }
        Value::Number(number) => Some(number.to_string()),
        _ => None,
    }
}

pub(super) async fn initialize_default_timeline_tags(db: &SqliteDb, project_id: &Uuid) -> Result<(), String> {
    let targets = DEFAULT_TIMELINE_TAG_TARGETS
        .iter()
        .map(|target| (*target).to_string())
        .collect::<Vec<_>>();

    for definition in DEFAULT_TIMELINE_TAG_DEFINITIONS {
        db.create_tag_schema(CreateTagSchema {
            project_id: *project_id,
            name: definition.name.to_string(),
            description: Some(definition.description.to_string()),
            r#type: definition.value_type.to_string(),
            target: targets.clone(),
            default_val: definition.default_value.map(|value| value.to_string()),
            range_min: definition.range_min,
            range_max: definition.range_max,
            sort_order: Some(definition.sort_order),
        })
            .await
            .map_err(|error| format!("初始化默认时间线标签“{}”失败: {}", definition.name, error))?;
    }

    Ok(())
}

// ============ Logging & Window ============

/// 前端日志桥接，将日志写入后端日志系统

pub(super) async fn touch_project_updated_at(db: &SqliteDb, project_id: &Uuid) -> Result<(), String> {
    db.update_project(
        project_id,
        UpdateProject {
            name: None,
            description: None,
            cover_image: None,
        },
    )
        .await
        .map(|_| ())
        .map_err(|e| e.to_string())
}
