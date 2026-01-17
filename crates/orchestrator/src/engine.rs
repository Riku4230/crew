use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{broadcast, RwLock};
use uuid::Uuid;

use db::models::task::{Task, TaskStatus};
use db::models::task_dependency::TaskDependency;
use sqlx::SqlitePool;

use crate::models::{ExecutionPlan, OrchestratorEvent, OrchestratorState};
use crate::scheduler::{build_execution_plan, get_ready_tasks, get_tasks_unblocked_by_completion};
use crate::state_machine::validate_transition;

/// Error types for orchestrator operations
#[derive(Debug, thiserror::Error)]
pub enum OrchestratorError {
    #[error("Database error: {0}")]
    Database(#[from] sqlx::Error),

    #[error("Invalid state transition: {0}")]
    InvalidTransition(String),

    #[error("Task not found: {0}")]
    TaskNotFound(Uuid),

    #[error("Orchestrator is not running")]
    NotRunning,

    #[error("Orchestrator is already running")]
    AlreadyRunning,
}

/// Orchestrator state for a single project
pub struct ProjectOrchestrator {
    project_id: Uuid,
    state: RwLock<OrchestratorState>,
    event_sender: broadcast::Sender<OrchestratorEvent>,
    /// Maximum number of tasks that can run in parallel
    max_parallel_tasks: usize,
}

impl ProjectOrchestrator {
    pub fn new(project_id: Uuid, max_parallel_tasks: usize) -> Self {
        let (event_sender, _) = broadcast::channel(100);
        Self {
            project_id,
            state: RwLock::new(OrchestratorState::Idle),
            event_sender,
            max_parallel_tasks,
        }
    }

    /// Subscribe to orchestrator events
    pub fn subscribe(&self) -> broadcast::Receiver<OrchestratorEvent> {
        self.event_sender.subscribe()
    }

    /// Get current orchestrator state
    pub async fn get_state(&self) -> OrchestratorState {
        *self.state.read().await
    }

    /// Build execution plan for this project
    pub async fn build_plan(&self, pool: &SqlitePool) -> Result<ExecutionPlan, OrchestratorError> {
        let tasks = Task::find_by_project_id(pool, self.project_id).await?;
        let dependencies =
            TaskDependency::find_by_project_id(pool, self.project_id).await?;

        Ok(build_execution_plan(&tasks, &dependencies))
    }

    /// Start the orchestrator
    pub async fn start(&self, pool: &SqlitePool) -> Result<(), OrchestratorError> {
        let mut state = self.state.write().await;
        if *state == OrchestratorState::Running {
            return Err(OrchestratorError::AlreadyRunning);
        }

        *state = OrchestratorState::Running;
        self.emit_event(OrchestratorEvent::StateChanged {
            state: OrchestratorState::Running,
        });

        // Build and emit initial plan
        drop(state); // Release lock before async operation
        let plan = self.build_plan(pool).await?;
        self.emit_event(OrchestratorEvent::PlanUpdated { plan });

        Ok(())
    }

    /// Pause the orchestrator (in-progress tasks will complete, but no new tasks start)
    pub async fn pause(&self) -> Result<(), OrchestratorError> {
        let mut state = self.state.write().await;
        if *state != OrchestratorState::Running {
            return Err(OrchestratorError::NotRunning);
        }

        *state = OrchestratorState::Paused;
        self.emit_event(OrchestratorEvent::StateChanged {
            state: OrchestratorState::Paused,
        });

        Ok(())
    }

    /// Resume the orchestrator from paused state
    pub async fn resume(&self, pool: &SqlitePool) -> Result<(), OrchestratorError> {
        let mut state = self.state.write().await;
        if *state != OrchestratorState::Paused {
            return Err(OrchestratorError::NotRunning);
        }

        *state = OrchestratorState::Running;
        self.emit_event(OrchestratorEvent::StateChanged {
            state: OrchestratorState::Running,
        });

        // Rebuild and emit plan
        drop(state);
        let plan = self.build_plan(pool).await?;
        self.emit_event(OrchestratorEvent::PlanUpdated { plan });

        Ok(())
    }

    /// Stop the orchestrator
    pub async fn stop(&self) -> Result<(), OrchestratorError> {
        let mut state = self.state.write().await;
        if *state == OrchestratorState::Idle {
            return Ok(()); // Already stopped
        }

        *state = OrchestratorState::Stopping;
        self.emit_event(OrchestratorEvent::StateChanged {
            state: OrchestratorState::Stopping,
        });

        // After all in-progress tasks complete, transition to Idle
        // This would be handled by the task completion handler
        *state = OrchestratorState::Idle;
        self.emit_event(OrchestratorEvent::StateChanged {
            state: OrchestratorState::Idle,
        });

        Ok(())
    }

    /// Get tasks that are ready to execute
    pub async fn get_ready_to_execute(
        &self,
        pool: &SqlitePool,
    ) -> Result<Vec<Uuid>, OrchestratorError> {
        let state = self.state.read().await;
        if *state != OrchestratorState::Running {
            return Ok(vec![]);
        }
        drop(state);

        let plan = self.build_plan(pool).await?;
        let ready = get_ready_tasks(&plan);

        // Limit by max_parallel_tasks
        let in_progress_count = plan.in_progress_tasks;
        let available_slots = self.max_parallel_tasks.saturating_sub(in_progress_count);

        Ok(ready
            .into_iter()
            .take(available_slots)
            .map(|t| t.task_id)
            .collect())
    }

    /// Notify that a task has started
    pub async fn on_task_started(
        &self,
        task_id: Uuid,
        pool: &SqlitePool,
    ) -> Result<(), OrchestratorError> {
        self.emit_event(OrchestratorEvent::TaskStarted { task_id });

        // Rebuild plan
        let plan = self.build_plan(pool).await?;
        self.emit_event(OrchestratorEvent::PlanUpdated { plan });

        Ok(())
    }

    /// Notify that a task has completed
    pub async fn on_task_completed(
        &self,
        task_id: Uuid,
        pool: &SqlitePool,
    ) -> Result<Vec<Uuid>, OrchestratorError> {
        self.emit_event(OrchestratorEvent::TaskCompleted { task_id });

        // Rebuild plan and find newly ready tasks
        let plan = self.build_plan(pool).await?;
        let newly_ready = get_tasks_unblocked_by_completion(&plan, task_id);

        self.emit_event(OrchestratorEvent::PlanUpdated { plan });

        Ok(newly_ready)
    }

    /// Notify that a task has failed
    pub async fn on_task_failed(
        &self,
        task_id: Uuid,
        error: String,
        pool: &SqlitePool,
    ) -> Result<(), OrchestratorError> {
        self.emit_event(OrchestratorEvent::TaskFailed { task_id, error });

        // Rebuild plan
        let plan = self.build_plan(pool).await?;
        self.emit_event(OrchestratorEvent::PlanUpdated { plan });

        Ok(())
    }

    /// Notify that a task is awaiting review
    pub async fn on_task_review(
        &self,
        task_id: Uuid,
        pool: &SqlitePool,
    ) -> Result<(), OrchestratorError> {
        self.emit_event(OrchestratorEvent::TaskAwaitingReview { task_id });

        // Rebuild plan
        let plan = self.build_plan(pool).await?;
        self.emit_event(OrchestratorEvent::PlanUpdated { plan });

        Ok(())
    }

    /// Validate a task status transition
    pub async fn validate_task_transition(
        &self,
        task_id: Uuid,
        new_status: &TaskStatus,
        pool: &SqlitePool,
    ) -> Result<crate::models::TransitionValidation, OrchestratorError> {
        let tasks = Task::find_by_project_id(pool, self.project_id).await?;
        let task = tasks
            .iter()
            .find(|t| t.id == task_id)
            .ok_or(OrchestratorError::TaskNotFound(task_id))?;
        let dependencies =
            TaskDependency::find_by_project_id(pool, self.project_id).await?;

        Ok(validate_transition(task, new_status, &tasks, &dependencies))
    }

    fn emit_event(&self, event: OrchestratorEvent) {
        // Ignore send errors (no receivers)
        let _ = self.event_sender.send(event);
    }
}

/// Global orchestrator manager
pub struct OrchestratorManager {
    orchestrators: RwLock<HashMap<Uuid, Arc<ProjectOrchestrator>>>,
    default_max_parallel: usize,
}

impl OrchestratorManager {
    pub fn new(default_max_parallel: usize) -> Self {
        Self {
            orchestrators: RwLock::new(HashMap::new()),
            default_max_parallel,
        }
    }

    /// Get or create an orchestrator for a project
    pub async fn get_or_create(&self, project_id: Uuid) -> Arc<ProjectOrchestrator> {
        let orchestrators = self.orchestrators.read().await;
        if let Some(orch) = orchestrators.get(&project_id) {
            return Arc::clone(orch);
        }
        drop(orchestrators);

        let mut orchestrators = self.orchestrators.write().await;
        // Double-check after acquiring write lock
        if let Some(orch) = orchestrators.get(&project_id) {
            return Arc::clone(orch);
        }

        let orch = Arc::new(ProjectOrchestrator::new(
            project_id,
            self.default_max_parallel,
        ));
        orchestrators.insert(project_id, Arc::clone(&orch));
        orch
    }

    /// Remove an orchestrator for a project
    pub async fn remove(&self, project_id: Uuid) {
        let mut orchestrators = self.orchestrators.write().await;
        orchestrators.remove(&project_id);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_orchestrator_state_transitions() {
        let project_id = Uuid::new_v4();
        let orch = ProjectOrchestrator::new(project_id, 3);

        assert_eq!(orch.get_state().await, OrchestratorState::Idle);

        // Can't pause when idle
        assert!(orch.pause().await.is_err());

        // Can stop when idle (no-op)
        assert!(orch.stop().await.is_ok());
        assert_eq!(orch.get_state().await, OrchestratorState::Idle);
    }

    #[tokio::test]
    async fn test_orchestrator_manager() {
        let manager = OrchestratorManager::new(3);
        let project_id = Uuid::new_v4();

        let orch1 = manager.get_or_create(project_id).await;
        let orch2 = manager.get_or_create(project_id).await;

        // Should return same instance
        assert!(Arc::ptr_eq(&orch1, &orch2));
    }
}
