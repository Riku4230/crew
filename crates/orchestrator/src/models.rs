use db::models::task::TaskStatus;
use serde::{Deserialize, Serialize};
use ts_rs::TS;
use uuid::Uuid;

/// Represents the readiness state of a task for execution
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum TaskReadiness {
    /// Task is ready to be executed (all dependencies satisfied)
    Ready,
    /// Task is blocked by one or more dependencies
    Blocked {
        blocking_task_ids: Vec<Uuid>,
    },
    /// Task is already in progress
    InProgress,
    /// Task is already completed
    Completed,
    /// Task is cancelled
    Cancelled,
}

/// A task with its execution metadata
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct ExecutableTask {
    pub task_id: Uuid,
    pub status: TaskStatus,
    pub readiness: TaskReadiness,
    /// Tasks that must complete before this task can start
    pub dependencies: Vec<Uuid>,
    /// Tasks that depend on this task
    pub dependents: Vec<Uuid>,
}

/// Execution plan containing tasks in topological order
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct ExecutionPlan {
    /// All tasks grouped by execution level (tasks in same level can run in parallel)
    pub levels: Vec<ExecutionLevel>,
    /// Total number of tasks in the plan
    pub total_tasks: usize,
    /// Number of tasks already completed
    pub completed_tasks: usize,
    /// Number of tasks currently in progress
    pub in_progress_tasks: usize,
    /// Number of tasks waiting for review
    pub in_review_tasks: usize,
    /// Number of tasks ready to execute
    pub ready_tasks: usize,
    /// Number of tasks blocked by dependencies
    pub blocked_tasks: usize,
}

/// A level in the execution plan (tasks at same depth can run in parallel)
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct ExecutionLevel {
    pub level: usize,
    pub tasks: Vec<ExecutableTask>,
}

/// Result of validating a status transition
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum TransitionValidation {
    /// Transition is valid
    Valid,
    /// Transition is invalid
    Invalid { reason: String },
    /// Transition requires confirmation (e.g., dependencies not met)
    RequiresConfirmation { reason: String, blocking_tasks: Vec<Uuid> },
}

/// Orchestration state for a project
#[derive(Debug, Clone, Copy, Serialize, Deserialize, TS, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum OrchestratorState {
    /// Orchestrator is idle, not running tasks
    #[default]
    Idle,
    /// Orchestrator is actively running tasks
    Running,
    /// Orchestrator is paused (tasks in progress will complete, but no new tasks start)
    Paused,
    /// Orchestrator is stopping (waiting for in-progress tasks to complete)
    Stopping,
}

/// Event emitted by the orchestrator
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(tag = "type", content = "data", rename_all = "snake_case")]
pub enum OrchestratorEvent {
    /// A task has started execution
    TaskStarted { task_id: Uuid },
    /// A task has completed successfully
    TaskCompleted { task_id: Uuid },
    /// A task has failed
    TaskFailed { task_id: Uuid, error: String },
    /// A task is waiting for review
    TaskAwaitingReview { task_id: Uuid },
    /// Orchestrator state changed
    StateChanged { state: OrchestratorState },
    /// Execution plan updated
    PlanUpdated { plan: ExecutionPlan },
}
