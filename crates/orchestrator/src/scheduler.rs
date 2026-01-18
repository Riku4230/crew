use std::collections::{HashMap, VecDeque};
use uuid::Uuid;

use db::models::task::{Task, TaskStatus};
use db::models::task_dependency::TaskDependency;

use crate::models::{ExecutableTask, ExecutionLevel, ExecutionPlan, TaskReadiness};

/// Builds an execution plan from tasks and their dependencies using topological sort
pub fn build_execution_plan(
    tasks: &[Task],
    dependencies: &[TaskDependency],
) -> ExecutionPlan {
    // Build lookup maps
    let task_map: HashMap<Uuid, &Task> = tasks.iter().map(|t| (t.id, t)).collect();

    // Build adjacency lists
    let mut deps_for_task: HashMap<Uuid, Vec<Uuid>> = HashMap::new();
    let mut dependents_of_task: HashMap<Uuid, Vec<Uuid>> = HashMap::new();

    for dep in dependencies {
        deps_for_task
            .entry(dep.task_id)
            .or_default()
            .push(dep.depends_on_task_id);
        dependents_of_task
            .entry(dep.depends_on_task_id)
            .or_default()
            .push(dep.task_id);
    }

    // Perform topological sort using Kahn's algorithm to assign levels
    let levels = topological_sort_levels(&task_map, &deps_for_task);

    // Build executable tasks with readiness info
    let mut all_executable_tasks: Vec<ExecutableTask> = Vec::new();

    for task in tasks {
        let task_deps = deps_for_task.get(&task.id).cloned().unwrap_or_default();
        let task_dependents = dependents_of_task.get(&task.id).cloned().unwrap_or_default();

        let readiness = calculate_readiness(task, &task_deps, &task_map);

        all_executable_tasks.push(ExecutableTask {
            task_id: task.id,
            status: task.status.clone(),
            readiness,
            dependencies: task_deps,
            dependents: task_dependents,
        });
    }

    // Group tasks by level
    let executable_map: HashMap<Uuid, ExecutableTask> = all_executable_tasks
        .into_iter()
        .map(|t| (t.task_id, t))
        .collect();

    let execution_levels: Vec<ExecutionLevel> = levels
        .into_iter()
        .enumerate()
        .map(|(level, task_ids)| {
            let tasks: Vec<ExecutableTask> = task_ids
                .into_iter()
                .filter_map(|id| executable_map.get(&id).cloned())
                .collect();
            ExecutionLevel { level, tasks }
        })
        .filter(|l| !l.tasks.is_empty())
        .collect();

    // Calculate statistics
    let mut completed = 0;
    let mut in_progress = 0;
    let mut in_review = 0;
    let mut ready = 0;
    let mut blocked = 0;

    for level in &execution_levels {
        for task in &level.tasks {
            match &task.readiness {
                TaskReadiness::Completed => completed += 1,
                TaskReadiness::InProgress => in_progress += 1,
                TaskReadiness::Ready => ready += 1,
                TaskReadiness::Blocked { .. } => blocked += 1,
                TaskReadiness::Cancelled => {}
            }
            // Check for in_review status specifically
            if task.status == TaskStatus::InReview {
                in_review += 1;
            }
        }
    }

    ExecutionPlan {
        levels: execution_levels,
        total_tasks: tasks.len(),
        completed_tasks: completed,
        in_progress_tasks: in_progress,
        in_review_tasks: in_review,
        ready_tasks: ready,
        blocked_tasks: blocked,
    }
}

/// Perform topological sort and return tasks grouped by level
/// Level 0 = tasks with no dependencies, Level 1 = tasks depending only on level 0, etc.
fn topological_sort_levels(
    task_map: &HashMap<Uuid, &Task>,
    deps_for_task: &HashMap<Uuid, Vec<Uuid>>,
) -> Vec<Vec<Uuid>> {
    let mut in_degree: HashMap<Uuid, usize> = HashMap::new();
    let mut levels: Vec<Vec<Uuid>> = Vec::new();

    // Initialize in-degrees
    for &task_id in task_map.keys() {
        let deps = deps_for_task.get(&task_id).map(|d| d.len()).unwrap_or(0);
        in_degree.insert(task_id, deps);
    }

    // Build reverse adjacency (dependents for each task)
    let mut dependents: HashMap<Uuid, Vec<Uuid>> = HashMap::new();
    for (task_id, deps) in deps_for_task {
        for dep_id in deps {
            dependents.entry(*dep_id).or_default().push(*task_id);
        }
    }

    // Kahn's algorithm with level tracking
    let mut current_level: VecDeque<Uuid> = in_degree
        .iter()
        .filter(|(_, &deg)| deg == 0)
        .map(|(&id, _)| id)
        .collect();

    while !current_level.is_empty() {
        let level_tasks: Vec<Uuid> = current_level.drain(..).collect();
        let mut next_level = VecDeque::new();

        for task_id in &level_tasks {
            if let Some(deps) = dependents.get(task_id) {
                for &dependent_id in deps {
                    if let Some(deg) = in_degree.get_mut(&dependent_id) {
                        *deg = deg.saturating_sub(1);
                        if *deg == 0 {
                            next_level.push_back(dependent_id);
                        }
                    }
                }
            }
        }

        levels.push(level_tasks);
        current_level = next_level;
    }

    levels
}

/// Calculate the readiness state of a task based on its dependencies
fn calculate_readiness(
    task: &Task,
    dependencies: &[Uuid],
    task_map: &HashMap<Uuid, &Task>,
) -> TaskReadiness {
    // Check task's own status first
    match task.status {
        TaskStatus::Done => return TaskReadiness::Completed,
        TaskStatus::Cancelled => return TaskReadiness::Cancelled,
        TaskStatus::InProgress | TaskStatus::InReview => return TaskReadiness::InProgress,
        TaskStatus::Todo => {}
    }

    // Check if all dependencies are completed
    let mut blocking_tasks = Vec::new();

    for &dep_id in dependencies {
        if let Some(dep_task) = task_map.get(&dep_id) {
            if dep_task.status != TaskStatus::Done {
                blocking_tasks.push(dep_id);
            }
        }
    }

    if blocking_tasks.is_empty() {
        TaskReadiness::Ready
    } else {
        TaskReadiness::Blocked {
            blocking_task_ids: blocking_tasks,
        }
    }
}

/// Get all tasks that are ready to execute
pub fn get_ready_tasks(plan: &ExecutionPlan) -> Vec<&ExecutableTask> {
    plan.levels
        .iter()
        .flat_map(|level| level.tasks.iter())
        .filter(|task| matches!(task.readiness, TaskReadiness::Ready))
        .collect()
}

/// Get all tasks that are currently in progress
pub fn get_in_progress_tasks(plan: &ExecutionPlan) -> Vec<&ExecutableTask> {
    plan.levels
        .iter()
        .flat_map(|level| level.tasks.iter())
        .filter(|task| matches!(task.readiness, TaskReadiness::InProgress))
        .collect()
}

/// Get tasks blocked by a specific task
pub fn get_tasks_blocked_by(plan: &ExecutionPlan, task_id: Uuid) -> Vec<&ExecutableTask> {
    plan.levels
        .iter()
        .flat_map(|level| level.tasks.iter())
        .filter(|task| {
            if let TaskReadiness::Blocked { blocking_task_ids } = &task.readiness {
                blocking_task_ids.contains(&task_id)
            } else {
                false
            }
        })
        .collect()
}

/// Find tasks that would become ready if the given task completes
pub fn get_tasks_unblocked_by_completion(plan: &ExecutionPlan, completed_task_id: Uuid) -> Vec<Uuid> {
    let mut newly_ready = Vec::new();

    for level in &plan.levels {
        for task in &level.tasks {
            if let TaskReadiness::Blocked { blocking_task_ids } = &task.readiness {
                // If this task is only blocked by the completing task, it will become ready
                if blocking_task_ids.len() == 1 && blocking_task_ids[0] == completed_task_id {
                    newly_ready.push(task.task_id);
                }
            }
        }
    }

    newly_ready
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
    fn test_no_dependencies() {
        let task1 = create_test_task(Uuid::new_v4(), TaskStatus::Todo);
        let task2 = create_test_task(Uuid::new_v4(), TaskStatus::Todo);

        let plan = build_execution_plan(&[task1.clone(), task2.clone()], &[]);

        assert_eq!(plan.levels.len(), 1);
        assert_eq!(plan.levels[0].tasks.len(), 2);
        assert_eq!(plan.ready_tasks, 2);
        assert_eq!(plan.blocked_tasks, 0);
    }

    #[test]
    fn test_linear_dependencies() {
        let task1 = create_test_task(Uuid::new_v4(), TaskStatus::Todo);
        let task2 = create_test_task(Uuid::new_v4(), TaskStatus::Todo);
        let task3 = create_test_task(Uuid::new_v4(), TaskStatus::Todo);

        // task3 -> task2 -> task1 (task1 must complete first)
        let deps = vec![
            create_test_dependency(task2.id, task1.id),
            create_test_dependency(task3.id, task2.id),
        ];

        let plan = build_execution_plan(&[task1.clone(), task2.clone(), task3.clone()], &deps);

        assert_eq!(plan.levels.len(), 3);
        assert_eq!(plan.ready_tasks, 1); // Only task1 is ready
        assert_eq!(plan.blocked_tasks, 2);
    }

    #[test]
    fn test_completed_dependency_unblocks() {
        let task1 = create_test_task(Uuid::new_v4(), TaskStatus::Done);
        let task2 = create_test_task(Uuid::new_v4(), TaskStatus::Todo);

        let deps = vec![create_test_dependency(task2.id, task1.id)];

        let plan = build_execution_plan(&[task1.clone(), task2.clone()], &deps);

        assert_eq!(plan.ready_tasks, 1); // task2 is ready because task1 is done
        assert_eq!(plan.completed_tasks, 1);
    }

    #[test]
    fn test_parallel_tasks_same_level() {
        let task1 = create_test_task(Uuid::new_v4(), TaskStatus::Done);
        let task2 = create_test_task(Uuid::new_v4(), TaskStatus::Todo);
        let task3 = create_test_task(Uuid::new_v4(), TaskStatus::Todo);

        // Both task2 and task3 depend only on task1
        let deps = vec![
            create_test_dependency(task2.id, task1.id),
            create_test_dependency(task3.id, task1.id),
        ];

        let plan = build_execution_plan(&[task1.clone(), task2.clone(), task3.clone()], &deps);

        // task2 and task3 should be in the same level (level 1) and both ready
        assert_eq!(plan.ready_tasks, 2);
    }
}
