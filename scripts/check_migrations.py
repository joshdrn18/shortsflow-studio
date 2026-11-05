from pathlib import Path
import sqlite3

ROOT = Path(__file__).resolve().parents[1]
MIGRATIONS = sorted((ROOT / "migrations").glob("*.sql"))

expected = ["0001_initial.sql", "0002_auth.sql", "0003_workspace_settings.sql", "0004_processing_jobs.sql", "0005_source_transcripts.sql", "0006_ai_usage_budget.sql", "0007_clip_discovery_idempotency.sql", "0008_clip_editing.sql", "0009_subtitle_settings.sql", "0010_render_assets.sql"]
actual = [path.name for path in MIGRATIONS]
if actual != expected:
    raise SystemExit(f"Unexpected migration sequence: {actual}")

connection = sqlite3.connect(":memory:")
connection.execute("PRAGMA foreign_keys = ON")

for migration in MIGRATIONS:
    connection.executescript(migration.read_text(encoding="utf-8"))

tables = {
    row[0]
    for row in connection.execute(
        "SELECT name FROM sqlite_master WHERE type = 'table'"
    )
}
required = {
    "workspaces",
    "source_videos",
    "clips",
    "clip_assets",
    "clip_metadata",
    "clip_reviews",
    "publishing_jobs",
    "activity_logs",
    "users",
    "workspace_members",
    "user_sessions",
    "auth_login_attempts",
    "workspace_settings",
    "processing_jobs",
    "source_transcripts",
    "ai_usage_daily",
}
missing = required - tables
if missing:
    raise SystemExit(f"Missing tables after migrations: {sorted(missing)}")

clip_columns = {row[1] for row in connection.execute("PRAGMA table_info(clips)")}
if "discovery_job_id" not in clip_columns:
    raise SystemExit("clips.discovery_job_id is missing")

clip_indexes = {
    row[1] for row in connection.execute("PRAGMA index_list(clips)")
}
if "idx_clips_discovery_job_time" not in clip_indexes:
    raise SystemExit("Clip discovery idempotency index is missing")

metadata_indexes = {row[1] for row in connection.execute("PRAGMA index_list(clip_metadata)")}
if "idx_clip_metadata_latest" not in metadata_indexes:
    raise SystemExit("Latest clip metadata index is missing")

metadata_columns = {row[1] for row in connection.execute("PRAGMA table_info(clip_metadata)")}
if "subtitle_config_json" not in metadata_columns:
    raise SystemExit("clip_metadata.subtitle_config_json is missing")

asset_columns = {row[1] for row in connection.execute("PRAGMA table_info(clip_assets)")}
if "metadata_version" not in asset_columns:
    raise SystemExit("clip_assets.metadata_version is missing")

connection.execute(
    "INSERT INTO users (id, email, display_name, password_hash) VALUES (?, ?, ?, ?)",
    ("user-test", "creator@example.com", "Creator", "test-hash"),
)
connection.execute(
    "INSERT INTO workspaces (id, name) VALUES (?, ?)",
    ("workspace-test", "Creator workspace"),
)
connection.execute(
    "INSERT INTO workspace_members (id, workspace_id, user_id, role) VALUES (?, ?, ?, ?)",
    ("membership-test", "workspace-test", "user-test", "owner"),
)

try:
    connection.execute(
        "INSERT INTO users (id, email, display_name, password_hash) VALUES (?, ?, ?, ?)",
        ("user-duplicate", "CREATOR@example.com", "Duplicate", "test-hash"),
    )
except sqlite3.IntegrityError:
    pass
else:
    raise SystemExit("Email uniqueness check failed")

connection.commit()
connection.close()
print(f"OK: {len(MIGRATIONS)} migrations applied; required tables and constraints verified.")