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
    dependency_genre::{CreateDependencyGenre, DependencyGenre, UpdateDependencyGenre},
    project::Project,
};
use deployment::Deployment;
use serde::Deserialize;
use ts_rs::TS;
use utils::response::ApiResponse;
use uuid::Uuid;

use crate::{DeploymentImpl, error::ApiError, middleware::load_project_middleware};

/// Request body for creating a genre
#[derive(Debug, Deserialize, TS)]
pub struct CreateGenreRequest {
    pub name: String,
    pub color: Option<String>,
    pub position: Option<i32>,
}

/// Request body for updating a genre
#[derive(Debug, Deserialize, TS)]
pub struct UpdateGenreRequest {
    pub name: Option<String>,
    pub color: Option<String>,
    pub position: Option<i32>,
}

/// Request body for reordering genres
#[derive(Debug, Deserialize, TS)]
pub struct ReorderGenresApiRequest {
    pub genre_ids: Vec<Uuid>,
}

/// Get all genres for a project
pub async fn get_project_genres(
    Extension(project): Extension<Project>,
    State(deployment): State<DeploymentImpl>,
) -> Result<ResponseJson<ApiResponse<Vec<DependencyGenre>>>, ApiError> {
    let genres = DependencyGenre::find_by_project_id(&deployment.db().pool, project.id).await?;
    Ok(ResponseJson(ApiResponse::success(genres)))
}

/// WebSocket endpoint for streaming genre updates
pub async fn stream_genres_ws(
    ws: WebSocketUpgrade,
    Extension(project): Extension<Project>,
    State(deployment): State<DeploymentImpl>,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| async move {
        if let Err(e) = handle_genres_ws(socket, deployment, project.id).await {
            tracing::warn!("genres WS closed: {}", e);
        }
    })
}

async fn handle_genres_ws(
    socket: WebSocket,
    deployment: DeploymentImpl,
    project_id: uuid::Uuid,
) -> anyhow::Result<()> {
    // Get the raw stream and convert LogMsg to WebSocket messages
    let mut stream = deployment
        .events()
        .stream_dependency_genres_raw(project_id)
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
                tracing::error!("genres stream error: {}", e);
                break;
            }
        }
    }
    Ok(())
}

/// Create a new genre in a project
pub async fn create_genre(
    Extension(project): Extension<Project>,
    State(deployment): State<DeploymentImpl>,
    Json(payload): Json<CreateGenreRequest>,
) -> Result<ResponseJson<ApiResponse<DependencyGenre>>, ApiError> {
    let pool = &deployment.db().pool;

    // Check if a genre with this name already exists in the project
    if let Some(_existing) = DependencyGenre::find_by_name(pool, project.id, &payload.name).await? {
        return Err(ApiError::Conflict(format!(
            "ジャンル「{}」は既に存在します",
            payload.name
        )));
    }

    let create_data = CreateDependencyGenre {
        project_id: project.id,
        name: payload.name.clone(),
        color: payload.color,
        position: payload.position,
    };

    let genre = DependencyGenre::create(pool, &create_data).await?;

    tracing::info!(
        "Created dependency genre: {} in project {}",
        genre.name,
        project.id
    );

    Ok(ResponseJson(ApiResponse::success(genre)))
}

/// Update a genre
pub async fn update_genre(
    State(deployment): State<DeploymentImpl>,
    Path(genre_id): Path<Uuid>,
    Json(payload): Json<UpdateGenreRequest>,
) -> Result<ResponseJson<ApiResponse<DependencyGenre>>, ApiError> {
    let pool = &deployment.db().pool;

    // Check if genre exists
    let existing = DependencyGenre::find_by_id(pool, genre_id)
        .await?
        .ok_or_else(|| ApiError::NotFound(format!("ジャンルが見つかりません: {}", genre_id)))?;

    // If name is being changed, check for duplicates
    if let Some(ref new_name) = payload.name {
        if new_name != &existing.name {
            if let Some(_dup) = DependencyGenre::find_by_name(pool, existing.project_id, new_name).await? {
                return Err(ApiError::Conflict(format!(
                    "ジャンル「{}」は既に存在します",
                    new_name
                )));
            }
        }
    }

    let update_data = UpdateDependencyGenre {
        name: payload.name,
        color: payload.color,
        position: payload.position,
    };

    let genre = DependencyGenre::update(pool, genre_id, &update_data).await?;

    tracing::info!("Updated dependency genre: {}", genre_id);

    Ok(ResponseJson(ApiResponse::success(genre)))
}

/// Delete a genre
pub async fn delete_genre(
    State(deployment): State<DeploymentImpl>,
    Path(genre_id): Path<Uuid>,
) -> Result<ResponseJson<ApiResponse<()>>, ApiError> {
    let pool = &deployment.db().pool;

    // Check if genre exists
    DependencyGenre::find_by_id(pool, genre_id)
        .await?
        .ok_or_else(|| ApiError::NotFound(format!("ジャンルが見つかりません: {}", genre_id)))?;

    let rows_affected = DependencyGenre::delete(pool, genre_id).await?;

    if rows_affected == 0 {
        return Err(ApiError::NotFound(
            "ジャンルの削除に失敗しました".to_string(),
        ));
    }

    tracing::info!("Deleted dependency genre: {}", genre_id);

    Ok(ResponseJson(ApiResponse::success(())))
}

/// Reorder genres
pub async fn reorder_genres(
    Extension(project): Extension<Project>,
    State(deployment): State<DeploymentImpl>,
    Json(payload): Json<ReorderGenresApiRequest>,
) -> Result<ResponseJson<ApiResponse<Vec<DependencyGenre>>>, ApiError> {
    let pool = &deployment.db().pool;

    // Validate that all genre IDs belong to the project
    for genre_id in &payload.genre_ids {
        let genre = DependencyGenre::find_by_id(pool, *genre_id)
            .await?
            .ok_or_else(|| ApiError::NotFound(format!("ジャンルが見つかりません: {}", genre_id)))?;

        if genre.project_id != project.id {
            return Err(ApiError::BadRequest(
                "ジャンルはこのプロジェクトに属していません".to_string(),
            ));
        }
    }

    let genres = DependencyGenre::reorder(pool, &payload.genre_ids).await?;

    tracing::info!(
        "Reordered {} genres in project {}",
        payload.genre_ids.len(),
        project.id
    );

    Ok(ResponseJson(ApiResponse::success(genres)))
}

pub fn router(deployment: &DeploymentImpl) -> Router<DeploymentImpl> {
    // Project-scoped genre operations (project_id required)
    let project_genres_router = Router::new()
        .route(
            "/dependency-genres",
            get(get_project_genres).post(create_genre),
        )
        .route("/dependency-genres/reorder", put(reorder_genres))
        .route("/dependency-genres/stream/ws", get(stream_genres_ws))
        .layer(from_fn_with_state(
            deployment.clone(),
            load_project_middleware,
        ));

    // Direct genre operations (genre_id only)
    let genres_router = Router::new()
        .route("/{genre_id}", put(update_genre).delete(delete_genre));

    Router::new()
        .nest("/projects/{id}", project_genres_router)
        .nest("/dependency-genres", genres_router)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_create_genre_request_deserialize() {
        let json = r##"{"name": "技術的依存", "color": "#FF0000"}"##;
        let request: CreateGenreRequest = serde_json::from_str(json).unwrap();
        assert_eq!(request.name, "技術的依存");
        assert_eq!(request.color, Some("#FF0000".to_string()));
        assert!(request.position.is_none());
    }

    #[test]
    fn test_update_genre_request_deserialize() {
        let json = r##"{"color": "#00FF00"}"##;
        let request: UpdateGenreRequest = serde_json::from_str(json).unwrap();
        assert!(request.name.is_none());
        assert_eq!(request.color, Some("#00FF00".to_string()));
        assert!(request.position.is_none());
    }

    #[test]
    fn test_reorder_genres_request_deserialize() {
        let json = r#"{"genre_ids": ["00000000-0000-0000-0000-000000000001", "00000000-0000-0000-0000-000000000002"]}"#;
        let request: ReorderGenresApiRequest = serde_json::from_str(json).unwrap();
        assert_eq!(request.genre_ids.len(), 2);
    }
}
