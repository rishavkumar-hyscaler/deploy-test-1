use axum::{
    extract::{Path, State},
    http::StatusCode,
    routing::{get, put},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use sqlx::{migrate::MigrateDatabase, postgres::PgPoolOptions, PgPool, Postgres};
use std::env;

type ApiError = (StatusCode, Json<serde_json::Value>);
type ApiResult<T> = Result<T, ApiError>;

#[derive(Serialize, sqlx::FromRow)]
struct Task {
    id: i32,
    title: String,
    completed: bool,
}

#[derive(Deserialize)]
struct TaskInput {
    title: String,
    #[serde(default)]
    completed: bool,
}

fn error(status: StatusCode, message: &str) -> ApiError {
    (status, Json(serde_json::json!({"error": message})))
}
fn database_error(err: sqlx::Error) -> ApiError {
    tracing::error!(%err, "Database request failed");
    error(StatusCode::INTERNAL_SERVER_ERROR, "Database request failed")
}
fn validate(input: &TaskInput) -> ApiResult<String> {
    let title = input.title.trim();
    if title.is_empty() || title.chars().count() > 200 {
        return Err(error(
            StatusCode::BAD_REQUEST,
            "Title must contain 1–200 characters",
        ));
    }
    Ok(title.to_owned())
}
async fn health(State(pool): State<PgPool>) -> ApiResult<Json<serde_json::Value>> {
    sqlx::query("SELECT 1")
        .execute(&pool)
        .await
        .map_err(|_| error(StatusCode::SERVICE_UNAVAILABLE, "Database unavailable"))?;
    Ok(Json(serde_json::json!({"status": "ok"})))
}
async fn list(State(pool): State<PgPool>) -> ApiResult<Json<Vec<Task>>> {
    Ok(Json(
        sqlx::query_as("SELECT id, title, completed FROM tasks ORDER BY id DESC")
            .fetch_all(&pool)
            .await
            .map_err(database_error)?,
    ))
}
async fn create(
    State(pool): State<PgPool>,
    Json(input): Json<TaskInput>,
) -> ApiResult<(StatusCode, Json<Task>)> {
    let title = validate(&input)?;
    let task = sqlx::query_as(
        "INSERT INTO tasks (title, completed) VALUES ($1, $2) RETURNING id, title, completed",
    )
    .bind(title)
    .bind(input.completed)
    .fetch_one(&pool)
    .await
    .map_err(database_error)?;
    Ok((StatusCode::CREATED, Json(task)))
}
async fn update(
    State(pool): State<PgPool>,
    Path(id): Path<i32>,
    Json(input): Json<TaskInput>,
) -> ApiResult<Json<Task>> {
    let title = validate(&input)?;
    let task = sqlx::query_as(
        "UPDATE tasks SET title = $1, completed = $2 WHERE id = $3 RETURNING id, title, completed",
    )
    .bind(title)
    .bind(input.completed)
    .bind(id)
    .fetch_optional(&pool)
    .await
    .map_err(database_error)?;
    task.map(Json)
        .ok_or_else(|| error(StatusCode::NOT_FOUND, "Task not found"))
}
async fn delete(State(pool): State<PgPool>, Path(id): Path<i32>) -> ApiResult<StatusCode> {
    let result = sqlx::query("DELETE FROM tasks WHERE id = $1")
        .bind(id)
        .execute(&pool)
        .await
        .map_err(database_error)?;
    if result.rows_affected() == 0 {
        return Err(error(StatusCode::NOT_FOUND, "Task not found"));
    }
    Ok(StatusCode::NO_CONTENT)
}
#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Load local configuration before accessing environment variables.
    // A missing file is fine when configuration is supplied by the environment.
    if let Err(err) = dotenvy::from_path(".env") {
        if !matches!(&err, dotenvy::Error::Io(io) if io.kind() == std::io::ErrorKind::NotFound) {
            return Err("Could not load .env; check its syntax and permissions".into());
        }
    }
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()),
        )
        .init();
    let database_url =
        env::var("DATABASE_URL").map_err(|_| "DATABASE_URL is missing; set it in backend/.env")?;
    let pool_options = PgPoolOptions::new().max_connections(5);
    let pool = match pool_options.clone().connect(&database_url).await {
        Ok(pool) => pool,
        Err(sqlx::Error::Database(err)) if err.code().as_deref() == Some("3D000") => {
            tracing::info!("Configured database is missing; creating it");
            if let Err(err) = Postgres::create_database(&database_url).await {
                // Another app instance may have created it concurrently.
                if !matches!(&err, sqlx::Error::Database(db) if db.code().as_deref() == Some("42P04"))
                {
                    tracing::error!("Could not create database; the PostgreSQL user needs CREATEDB permission and access to the postgres maintenance database");
                    return Err(err.into());
                }
            }
            pool_options.connect(&database_url).await?
        }
        Err(err) => return Err(err.into()),
    };
    sqlx::migrate!().run(&pool).await?;
    let app = Router::new()
        .route("/api/health", get(health))
        .route("/api/tasks", get(list).post(create))
        .route("/api/tasks/{id}", put(update).delete(delete))
        .with_state(pool);
    let listener = tokio::net::TcpListener::bind("0.0.0.0:8080").await?;
    tracing::info!("API listening on port 8080");
    axum::serve(listener, app)
        .with_graceful_shutdown(async {
            let _ = tokio::signal::ctrl_c().await;
        })
        .await?;
    Ok(())
}
