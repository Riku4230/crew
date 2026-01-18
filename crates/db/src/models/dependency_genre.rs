use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{Executor, FromRow, Sqlite, SqlitePool};
use ts_rs::TS;
use uuid::Uuid;

/// Represents a genre/category for task dependencies
/// Genres are project-specific and can be created dynamically
#[derive(Debug, Clone, FromRow, Serialize, Deserialize, TS)]
pub struct DependencyGenre {
    pub id: Uuid,
    pub project_id: Uuid,
    pub name: String,
    pub color: String,
    pub position: i32,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct CreateDependencyGenre {
    pub project_id: Uuid,
    pub name: String,
    pub color: Option<String>,
    pub position: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct UpdateDependencyGenre {
    pub name: Option<String>,
    pub color: Option<String>,
    pub position: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct ReorderGenresRequest {
    pub genre_ids: Vec<Uuid>,
}

impl DependencyGenre {
    /// Find a genre by its ID
    pub async fn find_by_id(pool: &SqlitePool, id: Uuid) -> Result<Option<Self>, sqlx::Error> {
        sqlx::query_as!(
            DependencyGenre,
            r#"SELECT
                id as "id!: Uuid",
                project_id as "project_id!: Uuid",
                name,
                color,
                position as "position!: i32",
                created_at as "created_at!: DateTime<Utc>",
                updated_at as "updated_at!: DateTime<Utc>"
            FROM dependency_genres
            WHERE id = $1"#,
            id
        )
        .fetch_optional(pool)
        .await
    }

    /// Find a genre by its rowid (used for SQLite update hooks)
    pub async fn find_by_rowid(pool: &SqlitePool, rowid: i64) -> Result<Option<Self>, sqlx::Error> {
        sqlx::query_as!(
            DependencyGenre,
            r#"SELECT
                id as "id!: Uuid",
                project_id as "project_id!: Uuid",
                name,
                color,
                position as "position!: i32",
                created_at as "created_at!: DateTime<Utc>",
                updated_at as "updated_at!: DateTime<Utc>"
            FROM dependency_genres
            WHERE rowid = $1"#,
            rowid
        )
        .fetch_optional(pool)
        .await
    }

    /// Find all genres for a project, ordered by position
    pub async fn find_by_project_id(
        pool: &SqlitePool,
        project_id: Uuid,
    ) -> Result<Vec<Self>, sqlx::Error> {
        sqlx::query_as!(
            DependencyGenre,
            r#"SELECT
                id as "id!: Uuid",
                project_id as "project_id!: Uuid",
                name,
                color,
                position as "position!: i32",
                created_at as "created_at!: DateTime<Utc>",
                updated_at as "updated_at!: DateTime<Utc>"
            FROM dependency_genres
            WHERE project_id = $1
            ORDER BY position ASC, created_at ASC"#,
            project_id
        )
        .fetch_all(pool)
        .await
    }

    /// Find a genre by name within a project
    pub async fn find_by_name(
        pool: &SqlitePool,
        project_id: Uuid,
        name: &str,
    ) -> Result<Option<Self>, sqlx::Error> {
        sqlx::query_as!(
            DependencyGenre,
            r#"SELECT
                id as "id!: Uuid",
                project_id as "project_id!: Uuid",
                name,
                color,
                position as "position!: i32",
                created_at as "created_at!: DateTime<Utc>",
                updated_at as "updated_at!: DateTime<Utc>"
            FROM dependency_genres
            WHERE project_id = $1 AND name = $2"#,
            project_id,
            name
        )
        .fetch_optional(pool)
        .await
    }

    /// Get the next position for a new genre in a project
    async fn get_next_position(pool: &SqlitePool, project_id: Uuid) -> Result<i32, sqlx::Error> {
        let result = sqlx::query_scalar!(
            r#"SELECT COALESCE(MAX(position), -1) + 1 as "next_position!: i32"
            FROM dependency_genres
            WHERE project_id = $1"#,
            project_id
        )
        .fetch_one(pool)
        .await?;
        Ok(result)
    }

    /// Create a new genre
    pub async fn create(pool: &SqlitePool, data: &CreateDependencyGenre) -> Result<Self, sqlx::Error> {
        let id = Uuid::new_v4();
        let color = data.color.clone().unwrap_or_else(|| "#808080".to_string());
        let position = match data.position {
            Some(p) => p,
            None => Self::get_next_position(pool, data.project_id).await?,
        };

        sqlx::query_as!(
            DependencyGenre,
            r#"INSERT INTO dependency_genres (id, project_id, name, color, position)
               VALUES ($1, $2, $3, $4, $5)
               RETURNING
                   id as "id!: Uuid",
                   project_id as "project_id!: Uuid",
                   name,
                   color,
                   position as "position!: i32",
                   created_at as "created_at!: DateTime<Utc>",
                   updated_at as "updated_at!: DateTime<Utc>""#,
            id,
            data.project_id,
            data.name,
            color,
            position
        )
        .fetch_one(pool)
        .await
    }

    /// Update a genre
    pub async fn update(
        pool: &SqlitePool,
        id: Uuid,
        data: &UpdateDependencyGenre,
    ) -> Result<Self, sqlx::Error> {
        let existing = Self::find_by_id(pool, id)
            .await?
            .ok_or(sqlx::Error::RowNotFound)?;

        let name = data.name.as_ref().unwrap_or(&existing.name);
        let color = data.color.as_ref().unwrap_or(&existing.color);
        let position = data.position.unwrap_or(existing.position);

        sqlx::query_as!(
            DependencyGenre,
            r#"UPDATE dependency_genres
               SET name = $2, color = $3, position = $4, updated_at = datetime('now', 'subsec')
               WHERE id = $1
               RETURNING
                   id as "id!: Uuid",
                   project_id as "project_id!: Uuid",
                   name,
                   color,
                   position as "position!: i32",
                   created_at as "created_at!: DateTime<Utc>",
                   updated_at as "updated_at!: DateTime<Utc>""#,
            id,
            name,
            color,
            position
        )
        .fetch_one(pool)
        .await
    }

    /// Delete a genre by its ID
    pub async fn delete<'e, E>(executor: E, id: Uuid) -> Result<u64, sqlx::Error>
    where
        E: Executor<'e, Database = Sqlite>,
    {
        let result = sqlx::query!("DELETE FROM dependency_genres WHERE id = $1", id)
            .execute(executor)
            .await?;
        Ok(result.rows_affected())
    }

    /// Reorder genres by updating their positions based on the provided order
    pub async fn reorder(pool: &SqlitePool, genre_ids: &[Uuid]) -> Result<Vec<Self>, sqlx::Error> {
        // Update positions for each genre based on its index in the array
        for (index, genre_id) in genre_ids.iter().enumerate() {
            let position = index as i32;
            sqlx::query!(
                r#"UPDATE dependency_genres
                   SET position = $2, updated_at = datetime('now', 'subsec')
                   WHERE id = $1"#,
                genre_id,
                position
            )
            .execute(pool)
            .await?;
        }

        // Get the project_id from the first genre to return updated list
        if let Some(first_id) = genre_ids.first() {
            if let Some(first_genre) = Self::find_by_id(pool, *first_id).await? {
                return Self::find_by_project_id(pool, first_genre.project_id).await;
            }
        }

        Ok(vec![])
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_create_dependency_genre_defaults() {
        let data = CreateDependencyGenre {
            project_id: Uuid::new_v4(),
            name: "Test Genre".to_string(),
            color: None,
            position: None,
        };
        assert!(data.color.is_none());
        assert!(data.position.is_none());
    }
}
