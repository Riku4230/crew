//! Task Orchestrator Engine
//!
//! This crate provides dependency-aware task orchestration for the vibe-kanban-neo project.
//! It handles:
//! - Topological sorting of tasks based on dependencies
//! - Parallel execution planning
//! - Task state machine validation
//! - Real-time execution plan updates

pub mod engine;
pub mod models;
pub mod scheduler;
pub mod state_machine;

pub use engine::{OrchestratorError, OrchestratorManager, ProjectOrchestrator};
pub use models::{
    ExecutableTask, ExecutionLevel, ExecutionPlan, OrchestratorEvent, OrchestratorState,
    TaskReadiness, TransitionValidation,
};
pub use scheduler::{
    build_execution_plan, get_in_progress_tasks, get_ready_tasks, get_tasks_blocked_by,
    get_tasks_unblocked_by_completion,
};
pub use state_machine::{
    can_start_task, get_dependency_tasks, get_dependent_tasks, validate_transition,
};
