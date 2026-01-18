use std::collections::HashMap;
use uuid::Uuid;

use db::models::task::{Task, TaskStatus};
use db::models::task_dependency::TaskDependency;

use crate::models::TransitionValidation;

/// Validates a task status transition
pub fn validate_transition(
    task: &Task,
    new_status: &TaskStatus,
    all_tasks: &[Task],
    dependencies: &[TaskDependency],
) -> TransitionValidation {
    let current = &task.status;

    // Same status is always valid (no-op)
    if current == new_status {
        return TransitionValidation::Valid;
    }

    // Check if transition is allowed based on state machine rules
    if !is_valid_transition(current, new_status) {
        return TransitionValidation::Invalid {
            reason: format!(
                "Cannot transition from {} to {}",
                status_to_string(current),
                status_to_string(new_status)
            ),
        };
    }

    // Check dependency constraints for certain transitions
    match new_status {
        TaskStatus::InProgress => {
            // Can only start if all dependencies are done
            let blocking = get_blocking_tasks(task.id, all_tasks, dependencies);
            if !blocking.is_empty() {
                return TransitionValidation::RequiresConfirmation {
                    reason: format!(
                        "Task has {} incomplete dependencies. Starting this task may cause issues.",
                        blocking.len()
                    ),
                    blocking_tasks: blocking,
                };
            }
        }
        TaskStatus::Done => {
            // Completing a task is always allowed (but dependents should be notified)
        }
        _ => {}
    }

    TransitionValidation::Valid
}

/// Check if a status transition is allowed by the state machine
fn is_valid_transition(from: &TaskStatus, to: &TaskStatus) -> bool {
    use TaskStatus::*;

    matches!(
        (from, to),
        // From Todo
        (Todo, InProgress)
            | (Todo, Cancelled)
            // From InProgress
            | (InProgress, Todo)
            | (InProgress, InReview)
            | (InProgress, Done)
            | (InProgress, Cancelled)
            // From InReview
            | (InReview, InProgress)
            | (InReview, Done)
            | (InReview, Cancelled)
            // From Done (reopen)
            | (Done, Todo)
            | (Done, InProgress)
            // From Cancelled (reopen)
            | (Cancelled, Todo)
    )
}

/// Get task IDs that are blocking the given task (not yet completed dependencies)
fn get_blocking_tasks(
    task_id: Uuid,
    all_tasks: &[Task],
    dependencies: &[TaskDependency],
) -> Vec<Uuid> {
    let task_map: HashMap<Uuid, &Task> = all_tasks.iter().map(|t| (t.id, t)).collect();

    dependencies
        .iter()
        .filter(|dep| dep.task_id == task_id)
        .filter_map(|dep| {
            task_map.get(&dep.depends_on_task_id).and_then(|t| {
                if t.status != TaskStatus::Done {
                    Some(t.id)
                } else {
                    None
                }
            })
        })
        .collect()
}

/// Convert TaskStatus to a human-readable string
fn status_to_string(status: &TaskStatus) -> &'static str {
    match status {
        TaskStatus::Todo => "todo",
        TaskStatus::InProgress => "in_progress",
        TaskStatus::InReview => "in_review",
        TaskStatus::Done => "done",
        TaskStatus::Cancelled => "cancelled",
    }
}

/// Check if a task can be started (all dependencies satisfied)
pub fn can_start_task(
    task: &Task,
    all_tasks: &[Task],
    dependencies: &[TaskDependency],
) -> bool {
    if task.status != TaskStatus::Todo {
        return false;
    }

    let blocking = get_blocking_tasks(task.id, all_tasks, dependencies);
    blocking.is_empty()
}

/// Get all tasks that depend on the given task (direct dependents)
pub fn get_dependent_tasks(task_id: Uuid, dependencies: &[TaskDependency]) -> Vec<Uuid> {
    dependencies
        .iter()
        .filter(|dep| dep.depends_on_task_id == task_id)
        .map(|dep| dep.task_id)
        .collect()
}

/// Get all tasks that the given task depends on (direct dependencies)
pub fn get_dependency_tasks(task_id: Uuid, dependencies: &[TaskDependency]) -> Vec<Uuid> {
    dependencies
        .iter()
        .filter(|dep| dep.task_id == task_id)
        .map(|dep| dep.depends_on_task_id)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use db::models::task_dependency::DependencyCreator;

    fn create_test_task(id: Uuid, status: TaskStatus) -> Task {
        Task {
            id,
            project_id: Uuid::new_v4(),
            title: format!("Task {}", id),
            description: None,
            status,
            parent_workspace_id: None,
            shared_task_id: None,
            position: None,
            dag_position_x: None,
            dag_position_y: None,
            created_at: chrono::Utc::now(),
            updated_at: chrono::Utc::now(),
        }
    }

    fn create_test_dependency(task_id: Uuid, depends_on: Uuid) -> TaskDependency {
        TaskDependency {
            id: Uuid::new_v4(),
            task_id,
            depends_on_task_id: depends_on,
            genre_id: None,
            created_by: DependencyCreator::User,
            created_at: chrono::Utc::now(),
        }
    }

    #[test]
    fn test_valid_transitions() {
        assert!(is_valid_transition(&TaskStatus::Todo, &TaskStatus::InProgress));
        assert!(is_valid_transition(&TaskStatus::InProgress, &TaskStatus::Done));
        assert!(is_valid_transition(&TaskStatus::InProgress, &TaskStatus::InReview));
        assert!(is_valid_transition(&TaskStatus::InReview, &TaskStatus::Done));
        assert!(is_valid_transition(&TaskStatus::InReview, &TaskStatus::InProgress));
    }

    #[test]
    fn test_invalid_transitions() {
        // Can't skip from Todo directly to Done
        assert!(!is_valid_transition(&TaskStatus::Todo, &TaskStatus::Done));
        // Can't skip from Todo directly to InReview
        assert!(!is_valid_transition(&TaskStatus::Todo, &TaskStatus::InReview));
    }

    #[test]
    fn test_can_start_task_no_dependencies() {
        let task = create_test_task(Uuid::new_v4(), TaskStatus::Todo);
        assert!(can_start_task(&task, &[task.clone()], &[]));
    }

    #[test]
    fn test_can_start_task_with_incomplete_dependency() {
        let dep_task = create_test_task(Uuid::new_v4(), TaskStatus::Todo);
        let task = create_test_task(Uuid::new_v4(), TaskStatus::Todo);
        let deps = vec![create_test_dependency(task.id, dep_task.id)];

        assert!(!can_start_task(&task, &[task.clone(), dep_task.clone()], &deps));
    }

    #[test]
    fn test_can_start_task_with_completed_dependency() {
        let dep_task = create_test_task(Uuid::new_v4(), TaskStatus::Done);
        let task = create_test_task(Uuid::new_v4(), TaskStatus::Todo);
        let deps = vec![create_test_dependency(task.id, dep_task.id)];

        assert!(can_start_task(&task, &[task.clone(), dep_task.clone()], &deps));
    }

    #[test]
    fn test_validate_transition_with_blocking_dependency() {
        let dep_task = create_test_task(Uuid::new_v4(), TaskStatus::Todo);
        let task = create_test_task(Uuid::new_v4(), TaskStatus::Todo);
        let deps = vec![create_test_dependency(task.id, dep_task.id)];
        let all_tasks = vec![task.clone(), dep_task.clone()];

        let result = validate_transition(&task, &TaskStatus::InProgress, &all_tasks, &deps);

        assert!(matches!(result, TransitionValidation::RequiresConfirmation { .. }));
    }
}
