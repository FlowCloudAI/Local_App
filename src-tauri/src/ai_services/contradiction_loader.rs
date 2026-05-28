use crate::AppState;
use crate::ai_services::world_check::{
    WorldCheckCorpus, WorldCheckLoadRequest, load_world_check_corpus,
};

pub type ContradictionLoadRequest = WorldCheckLoadRequest;
pub type ContradictionCorpus = WorldCheckCorpus;

pub async fn load_contradiction_corpus(
    app_state: &AppState,
    request: &ContradictionLoadRequest,
) -> Result<ContradictionCorpus, String> {
    load_world_check_corpus(app_state, request).await
}
