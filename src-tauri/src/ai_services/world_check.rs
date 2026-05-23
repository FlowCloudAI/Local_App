use crate::reports::world_check_report::WorldCheckKind;
use crate::senses::contradiction_sense::ContradictionSense;

#[derive(Debug, Clone)]
pub struct WorldCheckDefinition {
    pub kind: WorldCheckKind,
    pub task_type: &'static str,
    pub prompt_template: &'static str,
    pub system_template: &'static str,
    pub default_temperature: f64,
    pub tool_whitelist: Vec<String>,
}

pub fn world_check_definition(kind: WorldCheckKind) -> WorldCheckDefinition {
    match kind {
        WorldCheckKind::Contradiction => WorldCheckDefinition {
            kind,
            task_type: "world_check.contradiction",
            prompt_template: "contradiction/detection_prompt",
            system_template: "sense/contradiction_system",
            default_temperature: 0.1,
            tool_whitelist: ContradictionSense::tool_whitelist(),
        },
    }
}
