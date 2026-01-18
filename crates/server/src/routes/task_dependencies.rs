use axum::{
    Extension, Json, Router,
    extract::{
        Path, State,
        ws::{WebSocket, WebSocketUpgrade},
    },
    middleware::from_fn_with_state,
    response::{IntoResponse, Json as ResponseJson},
    routing::{get, put},
};
use futures_util::{SinkExt, StreamExt, TryStreamExt};
use db::models::{
    project::Project,
    task::Task,
    task_dependency::{CreateTaskDependency, TaskDependency, UpdateTaskDependency},
};
use deployment::Deployment;
use serde::Deserialize;
use ts_rs::TS;
use utils::response::ApiResponse;
use uuid::Uuid;

use crate::{DeploymentImpl, error::ApiError, middleware::load_project_middleware};

/// Request body for creating a dependency
#[derive(Debug, Deserialize, TS)]
pub struct CreateDependencyRequest {
    pub task_id: Uuid,
    pub depends_on_task_id: Uuid,
    pub created_by: Option<db::models::task_dependency::DependencyCreator>,
    pub genre_id: Option<Uuid>,
}

/// Request body for updating a dependency
#[derive(Debug, Deserialize, TS)]
pub struct UpdateDependencyRequest {
    pub genre_id: Option<Option<Uuid>>, // Option<Option<>> to allow unsetting: None = no change, Some(None) = clear, Some(Some(id)) = set
}

/// Request body for updating task position
#[derive(Debug, Deserialize, TS)]
pub struct UpdatePositionRequest {
    pub position: i32,
}

/// Get all dependencies for tasks in a project
pub async fn get_project_dependencies(
    Extension(project): Extension<Project>,
    State(deployment): State<DeploymentImpl>,
) -> Result<ResponseJson<ApiResponse<Vec<TaskDependency>>>, ApiError> {
    let dependencies =
        TaskDependency::find_by_project_id(&deployment.db().pool, project.id).await?;
    Ok(ResponseJson(ApiResponse::success(dependencies)))
}

/// WebSocket endpoint for streaming dependency updates
pub async fn stream_dependencies_ws(
    ws: WebSocketUpgrade,
    Extension(project): Extension<Project>,
    State(deployment): State<DeploymentImpl>,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| async move {
        if let Err(e) = handle_dependencies_ws(socket, deployment, project.id).await {
            tracing::warn!("dependencies WS closed: {}", e);
        }
    })
}

async fn handle_dependencies_ws(
    socket: WebSocket,
    deployment: DeploymentImpl,
    project_id: uuid::Uuid,
) -> anyhow::Result<()> {
    // Get the raw stream and convert LogMsg to WebSocket messages
    let mut stream = deployment
        .events()
        .stream_dependencies_raw(project_id)
        .await?
        .map_ok(|msg| msg.to_ws_message_unchecked());

    // Split socket into sender and receiver
    let (mut sender, mut receiver) = socket.split();

    // Drain (and ignore) any client->server messages so pings/pongs work
    tokio::spawn(async move { while let Some(Ok(_)) = receiver.next().await {} });

    // Forward server messages
    while let Some(item) = stream.next().await {
        match item {
            Ok(msg) => {
                if sender.send(msg).await.is_err() {
                    break; // client disconnected
                }
            }
            Err(e) => {
                tracing::error!("dependencies stream error: {}", e);
                break;
            }
        }
    }
    Ok(())
}

/// Create a new dependency between tasks
pub async fn create_dependency(
    Extension(project): Extension<Project>,
    State(deployment): State<DeploymentImpl>,
    Json(payload): Json<CreateDependencyRequest>,
) -> Result<ResponseJson<ApiResponse<TaskDependency>>, ApiError> {
    let pool = &deployment.db().pool;

    // 自己参照チェック
    if payload.task_id == payload.depends_on_task_id {
        return Err(ApiError::BadRequest(
            "タスクは自分自身に依存することはできません".to_string(),
        ));
    }

    // タスク存在チェック（task_id）
    let task = Task::find_by_id(pool, payload.task_id)
        .await?
        .ok_or_else(|| {
            ApiError::NotFound(format!(
                "タスクが見つかりません: {}",
                payload.task_id
            ))
        })?;

    // タスクがプロジェクトに属しているかチェック
    if task.project_id != project.id {
        return Err(ApiError::BadRequest(
            "タスクはこのプロジェクトに属していません".to_string(),
        ));
    }

    // タスク存在チェック（depends_on_task_id）
    let depends_on_task = Task::find_by_id(pool, payload.depends_on_task_id)
        .await?
        .ok_or_else(|| {
            ApiError::NotFound(format!(
                "依存先タスクが見つかりません: {}",
                payload.depends_on_task_id
            ))
        })?;

    // 依存先タスクもプロジェクトに属しているかチェック
    if depends_on_task.project_id != project.id {
        return Err(ApiError::BadRequest(
            "依存先タスクはこのプロジェクトに属していません".to_string(),
        ));
    }

    // 重複チェック
    if TaskDependency::exists(pool, payload.task_id, payload.depends_on_task_id).await? {
        return Err(ApiError::Conflict(
            "この依存関係は既に存在します".to_string(),
        ));
    }

    // 循環依存チェック
    if TaskDependency::would_create_cycle(pool, payload.task_id, payload.depends_on_task_id).await?
    {
        return Err(ApiError::Conflict(
            "この依存関係を追加すると循環依存が発生します".to_string(),
        ));
    }

    // 依存関係を作成
    let create_data = CreateTaskDependency {
        task_id: payload.task_id,
        depends_on_task_id: payload.depends_on_task_id,
        created_by: payload.created_by,
        genre_id: payload.genre_id,
    };

    let dependency = TaskDependency::create(pool, &create_data).await?;

    // 依存関係作成後、プロジェクト全体のDAGレイアウトを再計算
    recalculate_dag_layout(pool, project.id).await?;

    tracing::info!(
        "Created dependency: task {} depends on task {}",
        payload.task_id,
        payload.depends_on_task_id
    );

    Ok(ResponseJson(ApiResponse::success(dependency)))
}

/// Update a dependency (e.g., change its genre)
pub async fn update_dependency(
    State(deployment): State<DeploymentImpl>,
    Path(dependency_id): Path<Uuid>,
    Json(payload): Json<UpdateDependencyRequest>,
) -> Result<ResponseJson<ApiResponse<TaskDependency>>, ApiError> {
    let pool = &deployment.db().pool;

    // 依存関係が存在するかチェック
    TaskDependency::find_by_id(pool, dependency_id)
        .await?
        .ok_or_else(|| {
            ApiError::NotFound(format!(
                "依存関係が見つかりません: {}",
                dependency_id
            ))
        })?;

    // 更新実行
    let update_data = UpdateTaskDependency {
        genre_id: payload.genre_id,
    };

    let updated = TaskDependency::update(pool, dependency_id, &update_data).await?;

    tracing::info!(
        "Updated dependency {}: genre_id = {:?}",
        dependency_id,
        updated.genre_id
    );

    Ok(ResponseJson(ApiResponse::success(updated)))
}

/// Delete a dependency by ID
pub async fn delete_dependency(
    State(deployment): State<DeploymentImpl>,
    Path(dependency_id): Path<Uuid>,
) -> Result<ResponseJson<ApiResponse<()>>, ApiError> {
    let pool = &deployment.db().pool;

    // 依存関係が存在するかチェック
    let dependency = TaskDependency::find_by_id(pool, dependency_id)
        .await?
        .ok_or_else(|| {
            ApiError::NotFound(format!(
                "依存関係が見つかりません: {}",
                dependency_id
            ))
        })?;

    // 削除実行
    let rows_affected = TaskDependency::delete(pool, dependency_id).await?;

    if rows_affected == 0 {
        return Err(ApiError::NotFound(
            "依存関係の削除に失敗しました".to_string(),
        ));
    }

    tracing::info!(
        "Deleted dependency {}: task {} no longer depends on task {}",
        dependency_id,
        dependency.task_id,
        dependency.depends_on_task_id
    );

    Ok(ResponseJson(ApiResponse::success(())))
}

/// Update task position
pub async fn update_task_position(
    State(deployment): State<DeploymentImpl>,
    Path(task_id): Path<Uuid>,
    Json(payload): Json<UpdatePositionRequest>,
) -> Result<ResponseJson<ApiResponse<Task>>, ApiError> {
    let pool = &deployment.db().pool;

    // タスク存在チェック
    Task::find_by_id(pool, task_id)
        .await?
        .ok_or_else(|| {
            ApiError::NotFound(format!("タスクが見つかりません: {}", task_id))
        })?;

    // 位置を更新
    let updated_task = Task::update_position(pool, task_id, payload.position).await?;

    tracing::info!(
        "Updated task {} position to {}",
        task_id,
        payload.position
    );

    Ok(ResponseJson(ApiResponse::success(updated_task)))
}

/// Recalculate DAG layout for all tasks with dependencies in a project
/// Uses topological sort to arrange tasks in a clean hierarchical layout
async fn recalculate_dag_layout(
    pool: &sqlx::SqlitePool,
    project_id: Uuid,
) -> Result<(), sqlx::Error> {
    use std::collections::{HashMap, HashSet, VecDeque};

    // レイアウト定数
    const NODE_WIDTH: f64 = 220.0;
    const NODE_HEIGHT: f64 = 80.0;
    const HORIZONTAL_SPACING: f64 = 120.0;
    const VERTICAL_SPACING: f64 = 40.0;

    // プロジェクト内の全タスクと依存関係を取得
    let tasks = Task::find_by_project_id(pool, project_id).await?;
    let dependencies = TaskDependency::find_by_project_id(pool, project_id).await?;

    if dependencies.is_empty() {
        return Ok(());
    }

    // 依存関係に関わるタスクIDを収集
    let mut dag_task_ids: HashSet<Uuid> = HashSet::new();
    for dep in &dependencies {
        dag_task_ids.insert(dep.task_id);
        dag_task_ids.insert(dep.depends_on_task_id);
    }

    // タスクIDからタスクへのマップを作成
    let task_map: HashMap<Uuid, &Task> = tasks.iter().map(|t| (t.id, t)).collect();

    // 依存関係グラフを構築
    // in_degree: 各タスクへの入力エッジ数
    // dependencies_map: タスクIDから依存先タスクIDへのマップ
    // dependents_map: タスクIDからそのタスクに依存するタスクIDへのマップ
    let mut in_degree: HashMap<Uuid, usize> = HashMap::new();
    let mut dependents_map: HashMap<Uuid, Vec<Uuid>> = HashMap::new();

    for task_id in &dag_task_ids {
        in_degree.insert(*task_id, 0);
        dependents_map.insert(*task_id, Vec::new());
    }

    for dep in &dependencies {
        *in_degree.get_mut(&dep.task_id).unwrap() += 1;
        dependents_map
            .get_mut(&dep.depends_on_task_id)
            .unwrap()
            .push(dep.task_id);
    }

    // トポロジカルソート（Kahn's algorithm）でレベルを計算
    let mut queue: VecDeque<Uuid> = VecDeque::new();
    let mut levels: HashMap<Uuid, usize> = HashMap::new();

    // 入力エッジがないタスク（ルートノード）をキューに追加
    for (task_id, &degree) in &in_degree {
        if degree == 0 {
            queue.push_back(*task_id);
            levels.insert(*task_id, 0);
        }
    }

    // BFSでレベルを計算
    while let Some(task_id) = queue.pop_front() {
        let current_level = *levels.get(&task_id).unwrap();

        if let Some(dependents) = dependents_map.get(&task_id) {
            for &dependent_id in dependents {
                // 依存するタスクのレベルは、依存先の最大レベル + 1
                let new_level = current_level + 1;
                let existing_level = levels.entry(dependent_id).or_insert(0);
                if new_level > *existing_level {
                    *existing_level = new_level;
                }

                // 入力エッジを減らし、0になったらキューに追加
                let degree = in_degree.get_mut(&dependent_id).unwrap();
                *degree -= 1;
                if *degree == 0 {
                    queue.push_back(dependent_id);
                }
            }
        }
    }

    // レベルごとにタスクをグループ化
    let mut level_groups: HashMap<usize, Vec<Uuid>> = HashMap::new();
    for (task_id, level) in &levels {
        level_groups
            .entry(*level)
            .or_insert_with(Vec::new)
            .push(*task_id);
    }

    // 各タスクの位置を計算して更新
    for (level, task_ids) in &level_groups {
        let x = (*level as f64) * (NODE_WIDTH + HORIZONTAL_SPACING);

        for (index, task_id) in task_ids.iter().enumerate() {
            let y = (index as f64) * (NODE_HEIGHT + VERTICAL_SPACING);

            // 位置が変わった場合のみ更新
            if let Some(task) = task_map.get(task_id) {
                let needs_update = task.dag_position_x != Some(x) || task.dag_position_y != Some(y);
                if needs_update {
                    Task::update_dag_position(pool, *task_id, Some(x), Some(y)).await?;
                    tracing::debug!(
                        "Updated task {} position to ({}, {})",
                        task_id,
                        x,
                        y
                    );
                }
            }
        }
    }

    tracing::info!(
        "Recalculated DAG layout for project {}: {} tasks in {} levels",
        project_id,
        dag_task_ids.len(),
        level_groups.len()
    );

    Ok(())
}

pub fn router(deployment: &DeploymentImpl) -> Router<DeploymentImpl> {
    // プロジェクト内の依存関係操作（project_idが必要）
    let project_dependencies_router = Router::new()
        .route(
            "/dependencies",
            get(get_project_dependencies).post(create_dependency),
        )
        .route("/dependencies/stream/ws", get(stream_dependencies_ws))
        .layer(from_fn_with_state(
            deployment.clone(),
            load_project_middleware,
        ));

    // 依存関係の直接操作（dependency_idのみ）
    let dependencies_router = Router::new()
        .route("/{dependency_id}", put(update_dependency).delete(delete_dependency));

    // タスク位置の更新
    let task_position_router = Router::new().route("/{task_id}/position", put(update_task_position));

    Router::new()
        .nest("/projects/{id}", project_dependencies_router)
        .nest("/dependencies", dependencies_router)
        .nest("/tasks", task_position_router)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_create_dependency_request_deserialize() {
        let json = r#"{"task_id": "00000000-0000-0000-0000-000000000001", "depends_on_task_id": "00000000-0000-0000-0000-000000000002"}"#;
        let request: CreateDependencyRequest = serde_json::from_str(json).unwrap();
        assert_eq!(
            request.task_id,
            Uuid::parse_str("00000000-0000-0000-0000-000000000001").unwrap()
        );
        assert_eq!(
            request.depends_on_task_id,
            Uuid::parse_str("00000000-0000-0000-0000-000000000002").unwrap()
        );
        assert!(request.created_by.is_none());
    }

    #[test]
    fn test_update_position_request_deserialize() {
        let json = r#"{"position": 5}"#;
        let request: UpdatePositionRequest = serde_json::from_str(json).unwrap();
        assert_eq!(request.position, 5);
    }
}
