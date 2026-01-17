use axum::{
    Extension, Json, Router,
    extract::{
        Path, State,
        ws::{Message, WebSocket, WebSocketUpgrade},
    },
    middleware::from_fn_with_state,
    response::{IntoResponse, Json as ResponseJson},
    routing::{get, post},
};
use db::models::project::Project;
use deployment::Deployment;
use futures_util::{SinkExt, StreamExt};
use orchestrator::{
    ExecutionPlan, OrchestratorManager, OrchestratorState,
    TransitionValidation,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::OnceCell;
use ts_rs::TS;
use utils::response::ApiResponse;
use uuid::Uuid;

use crate::{DeploymentImpl, error::ApiError, middleware::load_project_middleware};

/// Global orchestrator manager instance
static ORCHESTRATOR_MANAGER: OnceCell<Arc<OrchestratorManager>> = OnceCell::const_new();

/// Get or initialize the global orchestrator manager
async fn get_orchestrator_manager() -> &'static Arc<OrchestratorManager> {
    ORCHESTRATOR_MANAGER
        .get_or_init(|| async { Arc::new(OrchestratorManager::new(3)) })
        .await
}

/// Response containing orchestrator state
#[derive(Serialize, Deserialize, TS)]
pub struct OrchestratorStateResponse {
    pub state: OrchestratorState,
    pub plan: ExecutionPlan,
}

/// Request to validate a task transition
#[derive(Deserialize, TS)]
pub struct ValidateTransitionRequest {
    pub task_id: Uuid,
    pub new_status: String,
}

/// Get orchestrator state and execution plan for a project
pub async fn get_orchestrator_state(
    Extension(project): Extension<Project>,
    State(deployment): State<DeploymentImpl>,
) -> Result<ResponseJson<ApiResponse<OrchestratorStateResponse>>, ApiError> {
    let manager = get_orchestrator_manager().await;
    let orchestrator = manager.get_or_create(project.id).await;

    let state = orchestrator.get_state().await;
    let plan = orchestrator
        .build_plan(&deployment.db().pool)
        .await
        .map_err(|e| ApiError::InternalServer(e.to_string()))?;

    Ok(ResponseJson(ApiResponse::success(OrchestratorStateResponse {
        state,
        plan,
    })))
}

/// Start the orchestrator for a project
pub async fn start_orchestrator(
    Extension(project): Extension<Project>,
    State(deployment): State<DeploymentImpl>,
) -> Result<ResponseJson<ApiResponse<OrchestratorStateResponse>>, ApiError> {
    let manager = get_orchestrator_manager().await;
    let orchestrator = manager.get_or_create(project.id).await;

    orchestrator
        .start(&deployment.db().pool)
        .await
        .map_err(|e| ApiError::BadRequest(e.to_string()))?;

    let state = orchestrator.get_state().await;
    let plan = orchestrator
        .build_plan(&deployment.db().pool)
        .await
        .map_err(|e| ApiError::InternalServer(e.to_string()))?;

    tracing::info!("Orchestrator started for project {}", project.id);

    Ok(ResponseJson(ApiResponse::success(OrchestratorStateResponse {
        state,
        plan,
    })))
}

/// Pause the orchestrator for a project
pub async fn pause_orchestrator(
    Extension(project): Extension<Project>,
    State(deployment): State<DeploymentImpl>,
) -> Result<ResponseJson<ApiResponse<OrchestratorStateResponse>>, ApiError> {
    let manager = get_orchestrator_manager().await;
    let orchestrator = manager.get_or_create(project.id).await;

    orchestrator
        .pause()
        .await
        .map_err(|e| ApiError::BadRequest(e.to_string()))?;

    let state = orchestrator.get_state().await;
    let plan = orchestrator
        .build_plan(&deployment.db().pool)
        .await
        .map_err(|e| ApiError::InternalServer(e.to_string()))?;

    tracing::info!("Orchestrator paused for project {}", project.id);

    Ok(ResponseJson(ApiResponse::success(OrchestratorStateResponse {
        state,
        plan,
    })))
}

/// Resume the orchestrator for a project
pub async fn resume_orchestrator(
    Extension(project): Extension<Project>,
    State(deployment): State<DeploymentImpl>,
) -> Result<ResponseJson<ApiResponse<OrchestratorStateResponse>>, ApiError> {
    let manager = get_orchestrator_manager().await;
    let orchestrator = manager.get_or_create(project.id).await;

    orchestrator
        .resume(&deployment.db().pool)
        .await
        .map_err(|e| ApiError::BadRequest(e.to_string()))?;

    let state = orchestrator.get_state().await;
    let plan = orchestrator
        .build_plan(&deployment.db().pool)
        .await
        .map_err(|e| ApiError::InternalServer(e.to_string()))?;

    tracing::info!("Orchestrator resumed for project {}", project.id);

    Ok(ResponseJson(ApiResponse::success(OrchestratorStateResponse {
        state,
        plan,
    })))
}

/// Stop the orchestrator for a project
pub async fn stop_orchestrator(
    Extension(project): Extension<Project>,
    State(deployment): State<DeploymentImpl>,
) -> Result<ResponseJson<ApiResponse<OrchestratorStateResponse>>, ApiError> {
    let manager = get_orchestrator_manager().await;
    let orchestrator = manager.get_or_create(project.id).await;

    orchestrator
        .stop()
        .await
        .map_err(|e| ApiError::BadRequest(e.to_string()))?;

    let state = orchestrator.get_state().await;
    let plan = orchestrator
        .build_plan(&deployment.db().pool)
        .await
        .map_err(|e| ApiError::InternalServer(e.to_string()))?;

    tracing::info!("Orchestrator stopped for project {}", project.id);

    Ok(ResponseJson(ApiResponse::success(OrchestratorStateResponse {
        state,
        plan,
    })))
}

/// Get ready-to-execute tasks for a project
pub async fn get_ready_tasks(
    Extension(project): Extension<Project>,
    State(deployment): State<DeploymentImpl>,
) -> Result<ResponseJson<ApiResponse<Vec<Uuid>>>, ApiError> {
    let manager = get_orchestrator_manager().await;
    let orchestrator = manager.get_or_create(project.id).await;

    let ready = orchestrator
        .get_ready_to_execute(&deployment.db().pool)
        .await
        .map_err(|e| ApiError::InternalServer(e.to_string()))?;

    Ok(ResponseJson(ApiResponse::success(ready)))
}

/// Validate a task status transition
pub async fn validate_transition(
    Extension(project): Extension<Project>,
    State(deployment): State<DeploymentImpl>,
    Json(payload): Json<ValidateTransitionRequest>,
) -> Result<ResponseJson<ApiResponse<TransitionValidation>>, ApiError> {
    let manager = get_orchestrator_manager().await;
    let orchestrator = manager.get_or_create(project.id).await;

    let new_status: db::models::task::TaskStatus = payload
        .new_status
        .parse()
        .map_err(|_| ApiError::BadRequest(format!("Invalid status: {}", payload.new_status)))?;

    let validation = orchestrator
        .validate_task_transition(payload.task_id, &new_status, &deployment.db().pool)
        .await
        .map_err(|e| ApiError::InternalServer(e.to_string()))?;

    Ok(ResponseJson(ApiResponse::success(validation)))
}

/// WebSocket endpoint for orchestrator events
pub async fn stream_orchestrator_events(
    ws: WebSocketUpgrade,
    Extension(project): Extension<Project>,
    State(_deployment): State<DeploymentImpl>,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| async move {
        if let Err(e) = handle_orchestrator_ws(socket, project.id).await {
            tracing::warn!("orchestrator WS closed: {}", e);
        }
    })
}

async fn handle_orchestrator_ws(socket: WebSocket, project_id: Uuid) -> anyhow::Result<()> {
    let manager = get_orchestrator_manager().await;
    let orchestrator = manager.get_or_create(project_id).await;
    let mut receiver = orchestrator.subscribe();

    let (mut sender, mut ws_receiver) = socket.split();

    // Drain (and ignore) any client->server messages so pings/pongs work
    tokio::spawn(async move {
        while let Some(Ok(_)) = ws_receiver.next().await {}
    });

    // Forward orchestrator events
    while let Ok(event) = receiver.recv().await {
        let json = serde_json::to_string(&event)?;
        if sender.send(Message::Text(json.into())).await.is_err() {
            break; // client disconnected
        }
    }

    Ok(())
}

/// Notify orchestrator that a task has started
pub async fn notify_task_started(
    Extension(project): Extension<Project>,
    State(deployment): State<DeploymentImpl>,
    Path(task_id): Path<Uuid>,
) -> Result<ResponseJson<ApiResponse<()>>, ApiError> {
    let manager = get_orchestrator_manager().await;
    let orchestrator = manager.get_or_create(project.id).await;

    orchestrator
        .on_task_started(task_id, &deployment.db().pool)
        .await
        .map_err(|e| ApiError::InternalServer(e.to_string()))?;

    Ok(ResponseJson(ApiResponse::success(())))
}

/// Notify orchestrator that a task has completed
pub async fn notify_task_completed(
    Extension(project): Extension<Project>,
    State(deployment): State<DeploymentImpl>,
    Path(task_id): Path<Uuid>,
) -> Result<ResponseJson<ApiResponse<Vec<Uuid>>>, ApiError> {
    let manager = get_orchestrator_manager().await;
    let orchestrator = manager.get_or_create(project.id).await;

    let newly_ready = orchestrator
        .on_task_completed(task_id, &deployment.db().pool)
        .await
        .map_err(|e| ApiError::InternalServer(e.to_string()))?;

    Ok(ResponseJson(ApiResponse::success(newly_ready)))
}

/// Notify orchestrator that a task has failed
#[derive(Deserialize, TS)]
pub struct TaskFailedRequest {
    pub error: String,
}

pub async fn notify_task_failed(
    Extension(project): Extension<Project>,
    State(deployment): State<DeploymentImpl>,
    Path(task_id): Path<Uuid>,
    Json(payload): Json<TaskFailedRequest>,
) -> Result<ResponseJson<ApiResponse<()>>, ApiError> {
    let manager = get_orchestrator_manager().await;
    let orchestrator = manager.get_or_create(project.id).await;

    orchestrator
        .on_task_failed(task_id, payload.error, &deployment.db().pool)
        .await
        .map_err(|e| ApiError::InternalServer(e.to_string()))?;

    Ok(ResponseJson(ApiResponse::success(())))
}

/// Notify orchestrator that a task is awaiting review
pub async fn notify_task_review(
    Extension(project): Extension<Project>,
    State(deployment): State<DeploymentImpl>,
    Path(task_id): Path<Uuid>,
) -> Result<ResponseJson<ApiResponse<()>>, ApiError> {
    let manager = get_orchestrator_manager().await;
    let orchestrator = manager.get_or_create(project.id).await;

    orchestrator
        .on_task_review(task_id, &deployment.db().pool)
        .await
        .map_err(|e| ApiError::InternalServer(e.to_string()))?;

    Ok(ResponseJson(ApiResponse::success(())))
}

pub fn router(deployment: &DeploymentImpl) -> Router<DeploymentImpl> {
    let orchestrator_router = Router::new()
        .route("/orchestrator", get(get_orchestrator_state))
        .route("/orchestrator/start", post(start_orchestrator))
        .route("/orchestrator/pause", post(pause_orchestrator))
        .route("/orchestrator/resume", post(resume_orchestrator))
        .route("/orchestrator/stop", post(stop_orchestrator))
        .route("/orchestrator/ready-tasks", get(get_ready_tasks))
        .route("/orchestrator/validate-transition", post(validate_transition))
        .route("/orchestrator/stream/ws", get(stream_orchestrator_events))
        .route(
            "/orchestrator/tasks/{task_id}/started",
            post(notify_task_started),
        )
        .route(
            "/orchestrator/tasks/{task_id}/completed",
            post(notify_task_completed),
        )
        .route(
            "/orchestrator/tasks/{task_id}/failed",
            post(notify_task_failed),
        )
        .route(
            "/orchestrator/tasks/{task_id}/review",
            post(notify_task_review),
        )
        .layer(from_fn_with_state(
            deployment.clone(),
            load_project_middleware,
        ));

    Router::new().nest("/projects/{id}", orchestrator_router)
}
