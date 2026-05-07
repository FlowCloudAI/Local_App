use crate::apis::ai_client::{spawn_session_event_loop, CreateLlmSessionResult};
use crate::senses::character_sense::{CharacterProjectSnapshot, CharacterSense};
use crate::{AiSessionKind, AiState, ApiKeyStore, AppState};
use flowcloudai_client::llm::config::SessionConfig;
use flowcloudai_client::{sense::Sense, DefaultOrchestrator};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tauri::{AppHandle, State};
use tokio::sync::{mpsc, Mutex};
use uuid::Uuid;
use worldflow_core::{
    models::{Category, Entry, EntryBrief, EntryFilter, EntryTag, FCImage, TagSchema}, CategoryOps, EntryOps, EntryRelationOps, ProjectOps,
    TagSchemaOps,
};

const CHARACTER_SNAPSHOT_SCAN_LIMIT: usize = 1000;
const CHARACTER_CONTENT_LIMIT: usize = 8000;
const ENTRY_CONTENT_LIMIT: usize = 2400;
const ENTRY_SUMMARY_LIMIT: usize = 600;
const RELATION_CONTENT_LIMIT: usize = 400;
const TAG_VALUE_LIMIT: usize = 160;
const CHARACTER_VOICE_ID_TAG: &str = "fc_role_voice_id";
const CHARACTER_VOICE_AUTO_PLAY_TAG: &str = "fc_role_voice_auto_play";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CharacterSessionInput {
    pub session_id: String,
    pub plugin_id: String,
    pub character_name: String,
    pub project_snapshot: CharacterProjectSnapshot,
    pub model: Option<String>,
    pub temperature: Option<f64>,
    pub max_tokens: Option<i64>,
    pub max_tool_rounds: Option<i32>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CharacterProjectSnapshotBundle {
    pub snapshot: CharacterProjectSnapshot,
    pub character_entry: Entry,
    pub background_image: Option<FCImage>,
    pub character_voice_id: Option<String>,
    pub character_auto_play: Option<bool>,
}

fn truncate_text(value: impl AsRef<str>, limit: usize) -> String {
    let normalized = value.as_ref().trim();
    if normalized.is_empty() {
        return String::new();
    }
    if normalized.chars().count() <= limit {
        return normalized.to_string();
    }
    let mut result = normalized.chars().take(limit).collect::<String>();
    result.push('…');
    result
}

fn build_category_path_map(categories: &[Category]) -> HashMap<Uuid, Vec<String>> {
    let category_map = categories
        .iter()
        .map(|category| (category.id, category))
        .collect::<HashMap<_, _>>();
    let mut path_map = HashMap::<Uuid, Vec<String>>::new();

    fn resolve_path(
        category_id: Uuid,
        category_map: &HashMap<Uuid, &Category>,
        path_map: &mut HashMap<Uuid, Vec<String>>,
    ) -> Vec<String> {
        if let Some(cached) = path_map.get(&category_id) {
            return cached.clone();
        }

        let mut path = Vec::new();
        let mut visited = Vec::<Uuid>::new();
        let mut current_id = Some(category_id);
        while let Some(id) = current_id {
            if visited.contains(&id) {
                break;
            }
            visited.push(id);
            let Some(category) = category_map.get(&id) else {
                break;
            };
            path.insert(0, category.name.clone());
            current_id = category.parent_id;
        }

        path_map.insert(category_id, path.clone());
        path
    }

    for category in categories {
        resolve_path(category.id, &category_map, &mut path_map);
    }

    path_map
}

fn stringify_tag_value(value: &serde_json::Value) -> String {
    match value {
        serde_json::Value::String(text) => truncate_text(text, TAG_VALUE_LIMIT),
        serde_json::Value::Number(number) => truncate_text(number.to_string(), TAG_VALUE_LIMIT),
        serde_json::Value::Bool(flag) => truncate_text(flag.to_string(), TAG_VALUE_LIMIT),
        _ => String::new(),
    }
}

fn schema_target_list(schema: &TagSchema) -> Vec<String> {
    serde_json::from_str::<Vec<String>>(&schema.target).unwrap_or_default()
}

fn map_tag_schemas(
    schemas: &[TagSchema],
) -> Vec<crate::senses::character_sense::CharacterTagSchemaSnapshot> {
    schemas
        .iter()
        .map(|schema| crate::senses::character_sense::CharacterTagSchemaSnapshot {
            id: schema.id.to_string(),
            name: schema.name.clone(),
            description: schema.description.clone(),
            r#type: schema.r#type.clone(),
            target: schema_target_list(schema),
        })
        .collect()
}

fn map_entry_snapshot(
    entry: &Entry,
    category_path_map: &HashMap<Uuid, Vec<String>>,
    tag_schema_names: &HashMap<Uuid, String>,
    content_limit: usize,
) -> crate::senses::character_sense::CharacterEntrySnapshot {
    crate::senses::character_sense::CharacterEntrySnapshot {
        id: entry.id.to_string(),
        title: entry.title.clone(),
        summary: {
            let summary = truncate_text(entry.summary.as_deref().unwrap_or_default(), ENTRY_SUMMARY_LIMIT);
            (!summary.is_empty()).then_some(summary)
        },
        content: {
            let content = truncate_text(&entry.content, content_limit);
            (!content.is_empty()).then_some(content)
        },
        entry_type: entry.r#type.clone().and_then(|value| {
            let trimmed = value.trim().to_string();
            (!trimmed.is_empty()).then_some(trimmed)
        }),
        category_id: entry.category_id.map(|id| id.to_string()),
        category_path: entry
            .category_id
            .and_then(|id| category_path_map.get(&id).cloned())
            .unwrap_or_default(),
        tags: entry
            .tags
            .0
            .iter()
            .filter_map(|tag| {
                let value = stringify_tag_value(&tag.value);
                if value.is_empty() {
                    return None;
                }
                Some(crate::senses::character_sense::CharacterTagSnapshot {
                    schema_id: Some(tag.schema_id.to_string()),
                    name: tag_schema_names
                        .get(&tag.schema_id)
                        .cloned()
                        .unwrap_or_else(|| tag.schema_id.to_string()),
                    value,
                })
            })
            .collect(),
    }
}

fn map_character_relations(
    relations: &[worldflow_core::models::EntryRelation],
) -> Vec<crate::senses::character_sense::CharacterRelationSnapshot> {
    relations
        .iter()
        .map(|relation| crate::senses::character_sense::CharacterRelationSnapshot {
            id: relation.id.to_string(),
            from_entry_id: relation.a_id.to_string(),
            to_entry_id: relation.b_id.to_string(),
            relation: relation.relation.as_str().to_string(),
            content: truncate_text(&relation.content, RELATION_CONTENT_LIMIT),
        })
        .collect()
}

fn find_cover_image(entry: &Entry) -> Option<FCImage> {
    entry
        .images
        .0
        .iter()
        .find(|image| image.is_cover)
        .cloned()
        .or_else(|| entry.images.0.first().cloned())
}

fn read_character_voice_config(
    tags: &[EntryTag],
    tag_schema_names: &HashMap<Uuid, String>,
) -> (Option<String>, Option<bool>) {
    let mut voice_id = None;
    let mut auto_play = None;

    for tag in tags {
        let Some(name) = tag_schema_names.get(&tag.schema_id) else {
            continue;
        };
        if name == CHARACTER_VOICE_ID_TAG {
            if let Some(value) = tag.value.as_str().map(str::trim).filter(|value| !value.is_empty()) {
                voice_id = Some(value.to_string());
            }
        }
        if name == CHARACTER_VOICE_AUTO_PLAY_TAG {
            if let Some(value) = tag.value.as_bool() {
                auto_play = Some(value);
            }
        }
    }

    (voice_id, auto_play)
}

#[tauri::command]
pub async fn ai_build_character_project_snapshot(
    state: State<'_, Arc<Mutex<AppState>>>,
    project_id: String,
    entry_id: String,
) -> Result<CharacterProjectSnapshotBundle, String> {
    let project_id = Uuid::parse_str(&project_id).map_err(|e| e.to_string())?;
    let entry_id = Uuid::parse_str(&entry_id).map_err(|e| e.to_string())?;
    let state = state.inner().lock().await;
    let db = state.sqlite_db.lock().await;

    let project = db.get_project(&project_id).await.map_err(|e| e.to_string())?;
    let categories = db
        .list_categories(&project_id)
        .await
        .map_err(|e| e.to_string())?;
    let tag_schemas = db
        .list_tag_schemas(&project_id)
        .await
        .map_err(|e| e.to_string())?;
    let entry_briefs: Vec<EntryBrief> = db
        .list_entries(
            &project_id,
            EntryFilter::default(),
            CHARACTER_SNAPSHOT_SCAN_LIMIT,
            0,
        )
        .await
        .map_err(|e| e.to_string())?;
    let relations = db
        .list_relations_for_project(&project_id)
        .await
        .map_err(|e| e.to_string())?;
    let character_entry = db.get_entry(&entry_id).await.map_err(|e| e.to_string())?;

    let mut all_entries = Vec::with_capacity(entry_briefs.len());
    for brief in entry_briefs {
        if let Ok(entry) = db.get_entry(&brief.id).await {
            all_entries.push(entry);
        }
    }
    if !all_entries.iter().any(|entry| entry.id == character_entry.id) {
        all_entries.push(character_entry.clone());
    }

    let category_path_map = build_category_path_map(&categories);
    let tag_schema_names = tag_schemas
        .iter()
        .map(|schema| (schema.id, schema.name.clone()))
        .collect::<HashMap<_, _>>();
    let target_snapshot = map_entry_snapshot(
        &character_entry,
        &category_path_map,
        &tag_schema_names,
        CHARACTER_CONTENT_LIMIT,
    );
    let entries = all_entries
        .iter()
        .map(|entry| {
            if entry.id == character_entry.id {
                target_snapshot.clone()
            } else {
                map_entry_snapshot(entry, &category_path_map, &tag_schema_names, ENTRY_CONTENT_LIMIT)
            }
        })
        .collect::<Vec<_>>();
    let background_image = find_cover_image(&character_entry);
    let (character_voice_id, character_auto_play) =
        read_character_voice_config(&character_entry.tags.0, &tag_schema_names);

    Ok(CharacterProjectSnapshotBundle {
        snapshot: CharacterProjectSnapshot {
            project: crate::senses::character_sense::CharacterProjectMeta {
                id: project.id.to_string(),
                name: project.name,
                description: {
                    let description =
                        truncate_text(project.description.as_deref().unwrap_or_default(), ENTRY_SUMMARY_LIMIT);
                    (!description.is_empty()).then_some(description)
                },
            },
            target_character: target_snapshot,
            categories: categories
                .iter()
                .map(|category| crate::senses::character_sense::CharacterCategorySnapshot {
                    id: category.id.to_string(),
                    name: category.name.clone(),
                    parent_id: category.parent_id.map(|id| id.to_string()),
                    path: category_path_map
                        .get(&category.id)
                        .cloned()
                        .unwrap_or_else(|| vec![category.name.clone()]),
                })
                .collect(),
            tag_schemas: map_tag_schemas(&tag_schemas),
            entries,
            relations: map_character_relations(&relations),
        },
        character_entry,
        background_image,
        character_voice_id,
        character_auto_play,
    })
}

#[tauri::command]
pub async fn ai_create_character_session(
    app: AppHandle,
    ai_state: State<'_, AiState>,
    input: CharacterSessionInput,
) -> Result<CreateLlmSessionResult, String> {
    let api_key = ApiKeyStore::get(&input.plugin_id)
        .ok_or_else(|| format!("插件 '{}' 未配置 API Key，请在设置中配置", input.plugin_id))?;

    let client = ai_state.client.lock().await;
    let registry = client.tool_registry().clone();
    let sense = CharacterSense::new(input.character_name.clone(), input.project_snapshot.clone());
    let whitelist = sense.tool_whitelist();
    let config = input.max_tool_rounds.map(|rounds| SessionConfig {
        max_tool_rounds: rounds as usize,
        ..Default::default()
    });
    let mut session = client
        .create_llm_session(&input.plugin_id, &api_key, config)
        .map_err(|e| e.to_string())?;
    drop(client);

    session.load_sense(sense).await.map_err(|e| e.to_string())?;
    session.set_orchestrator(Box::new(
        DefaultOrchestrator::new(registry).with_whitelist(whitelist),
    ));

    if let Some(model) = &input.model {
        session.set_model(model).await;
    }
    if let Some(temperature) = input.temperature {
        session.set_temperature(temperature).await;
    }
    if let Some(max_tokens) = input.max_tokens {
        session.set_max_tokens(max_tokens).await;
    }
    session.set_stream(true).await;

    let conversation_id = session
        .conversation_id()
        .map(str::to_string)
        .unwrap_or_else(|| input.session_id.clone());

    let (input_tx, input_rx) = mpsc::channel::<String>(32);
    let (event_stream, handle) = session.run(input_rx);
    let run_id = Uuid::new_v4().to_string();

    spawn_session_event_loop(app, input.session_id.clone(), run_id.clone(), event_stream);

    let resolved_model = input.model.clone().unwrap_or_else(|| "default".to_string());
    ai_state.sessions.lock().await.insert(
        input.session_id.clone(),
        crate::SessionEntry {
            run_id: run_id.clone(),
            input_tx,
            handle,
            kind: AiSessionKind::Character,
            model: resolved_model,
            plugin_id: input.plugin_id.clone(),
        },
    );

    Ok(CreateLlmSessionResult {
        session_id: input.session_id,
        conversation_id,
        run_id,
    })
}
