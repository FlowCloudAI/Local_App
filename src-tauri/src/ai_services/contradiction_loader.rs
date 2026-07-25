use crate::AppState;
use crate::ai_services::world_check::{
    WorldCheckCorpus, WorldCheckLoadRequest, load_world_check_corpus,
};

/// 保留旧矛盾检测 API 的请求类型，实际语料规则与通用世界观检测完全一致。
pub type ContradictionLoadRequest = WorldCheckLoadRequest;
/// 保留旧矛盾检测 API 的语料类型，避免两套限额规则逐渐分叉。
pub type ContradictionCorpus = WorldCheckCorpus;

/// 委托通用加载器，保证旧入口也遵守目标词条优先和字符预算限制。
pub async fn load_contradiction_corpus(
    app_state: &AppState,
    request: &ContradictionLoadRequest,
) -> Result<ContradictionCorpus, String> {
    load_world_check_corpus(app_state, request).await
}
