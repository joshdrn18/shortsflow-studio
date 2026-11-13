from pathlib import Path
import sqlite3

ROOT = Path(__file__).resolve().parents[1]
MIGRATIONS = sorted((ROOT / "migrations").glob("*.sql"))

expected = ["0001_initial.sql", "0002_auth.sql", "0003_workspace_settings.sql", "0004_processing_jobs.sql", "0005_source_transcripts.sql", "0006_ai_usage_budget.sql", "0007_clip_discovery_idempotency.sql", "0008_clip_editing.sql", "0009_subtitle_settings.sql", "0010_render_assets.sql", "0011_review_asset_binding.sql", "0012_youtube_publisher.sql", "0013_watermark_positions.sql", "0014_ai_usage_reservation_ledger.sql", "0015_workspace_brand_kits.sql", "0016_workspace_brand_profiles.sql", "0017_brand_profile_metadata.sql", "0018_youtube_metric_snapshots.sql", "0019_youtube_retention_metrics.sql", "0020_background_render_jobs.sql", "0021_clip_score_breakdown.sql", "0022_autopilot.sql"]
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
    "ai_usage_reservations",
    "youtube_connections",
    "youtube_oauth_states",
    "workspace_brand_kits",
    "workspace_brand_profiles",
    "youtube_video_metric_snapshots",
    "youtube_video_analytics_snapshots",
    "clip_render_jobs",
    "autopilot_settings",
    "autopilot_jobs",
    "autopilot_daily_reports",
}
missing = required - tables
if missing:
    raise SystemExit(f"Missing tables after migrations: {sorted(missing)}")

render_job_columns = {row[1] for row in connection.execute("PRAGMA table_info(clip_render_jobs)")}
for required_column in ("workspace_id", "clip_id", "metadata_version", "status", "runner_id", "locked_until", "asset_id"):
    if required_column not in render_job_columns:
        raise SystemExit(f"clip_render_jobs.{required_column} is missing")

clip_columns = {row[1] for row in connection.execute("PRAGMA table_info(clips)")}
if "discovery_job_id" not in clip_columns:
    raise SystemExit("clips.discovery_job_id is missing")

if "score_breakdown_json" not in clip_columns:
    raise SystemExit("clips.score_breakdown_json is missing")

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

review_columns = {row[1] for row in connection.execute("PRAGMA table_info(clip_reviews)")}
if "render_asset_id" not in review_columns:
    raise SystemExit("clip_reviews.render_asset_id is missing")


autopilot_settings_columns = {row[1] for row in connection.execute("PRAGMA table_info(autopilot_settings)")}
for required_column in ("workspace_id", "enabled", "daily_target", "privacy_status", "watermark_text", "timezone"):
    if required_column not in autopilot_settings_columns:
        raise SystemExit(f"autopilot_settings.{required_column} is missing")

autopilot_job_columns = {row[1] for row in connection.execute("PRAGMA table_info(autopilot_jobs)")}
for required_column in ("workspace_id", "day_key", "status", "script_json", "scenes_json", "audio_key", "output_key", "publishing_job_id", "platform_url"):
    if required_column not in autopilot_job_columns:
        raise SystemExit(f"autopilot_jobs.{required_column} is missing")

autopilot_indexes = {row[1] for row in connection.execute("PRAGMA index_list(autopilot_jobs)")}
if "idx_autopilot_queue" not in autopilot_indexes or "idx_autopilot_workspace_day" not in autopilot_indexes:
    raise SystemExit("Autopilot queue indexes are missing")

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

publish_columns = {row[1] for row in connection.execute("PRAGMA table_info(publishing_jobs)")}
for required_column in ("render_asset_id", "metadata_version", "title", "description", "privacy_status", "tags_json"):
    if required_column not in publish_columns:
        raise SystemExit(f"publishing_jobs.{required_column} is missing")


for position in ("top-left", "top-center", "top-right", "center", "bottom-left", "bottom-center", "bottom-right"):
    connection.execute(
        "INSERT INTO workspace_settings (workspace_id, watermark_position) VALUES (?, ?) "
        "ON CONFLICT(workspace_id) DO UPDATE SET watermark_position=excluded.watermark_position",
        ("workspace-test", position),
    )

# Workspace Brand Kits persist reusable subtitle and watermark configuration.
connection.execute(
    "INSERT INTO workspace_brand_kits (workspace_id, kit_name, subtitle_config_json, watermark_config_json) VALUES (?, ?, ?, ?)",
    ("workspace-test", "Creator Brand", '{"fontSize":30,"animation":"pop"}', '{"watermarkText":"CREATOR"}'),
)
brand_kit = connection.execute(
    "SELECT kit_name, subtitle_config_json, watermark_config_json FROM workspace_brand_kits WHERE workspace_id=?",
    ("workspace-test",),
).fetchone()
if brand_kit != ("Creator Brand", '{"fontSize":30,"animation":"pop"}', '{"watermarkText":"CREATOR"}'):
    raise SystemExit("Workspace Brand Kit persistence check failed")

# AI reservations must be idempotent and the daily cap must be enforced atomically.
connection.execute(
    "INSERT INTO ai_usage_reservations (reservation_key, usage_date, neurons, audio_seconds, created_at) VALUES (?, ?, ?, ?, ?)",
    ("audio:job-a:0:0", "2026-11-08", 100.0, 60, "2026-11-08T00:00:00Z"),
)
connection.execute(
    "INSERT OR IGNORE INTO ai_usage_reservations (reservation_key, usage_date, neurons, audio_seconds, created_at) VALUES (?, ?, ?, ?, ?)",
    ("audio:job-a:0:0", "2026-11-08", 250.0, 60, "2026-11-08T00:00:01Z"),
)
usage = connection.execute(
    "SELECT neurons_reserved, audio_seconds_reserved FROM ai_usage_daily WHERE usage_date=?",
    ("2026-11-08",),
).fetchone()
if usage != (100.0, 60):
    raise SystemExit(f"AI reservation was not idempotent: {usage}")
connection.execute(
    "INSERT OR IGNORE INTO ai_usage_reservations (reservation_key, usage_date, neurons, audio_seconds, created_at) VALUES (?, ?, ?, ?, ?)",
    ("audio:job-b:0:0", "2026-11-08", 8000.0, 60, "2026-11-08T00:00:02Z"),
)
usage = connection.execute(
    "SELECT neurons_reserved, audio_seconds_reserved FROM ai_usage_daily WHERE usage_date=?",
    ("2026-11-08",),
).fetchone()
reservation = connection.execute(
    "SELECT reservation_key FROM ai_usage_reservations WHERE reservation_key=?",
    ("audio:job-b:0:0",),
).fetchone()
if usage != (100.0, 60) or reservation is not None:
    raise SystemExit(f"AI daily budget guard failed: usage={usage}, reservation={reservation}")

brand_profile_columns = {row[1] for row in connection.execute("PRAGMA table_info(workspace_brand_profiles)")}
if "metadata_config_json" not in brand_profile_columns:
    raise SystemExit("workspace_brand_profiles.metadata_config_json is missing")

# Multiple Brand Profiles persist separately and can be activated.
connection.execute(
    "INSERT INTO workspace_brand_profiles (id, workspace_id, profile_name, subtitle_config_json, watermark_config_json) VALUES (?, ?, ?, ?, ?)",
    ("brand-profile-a", "workspace-test", "Gaming", '{"fontSize":32}', '{"watermarkText":"GAMING"}'),
)
connection.execute(
    "INSERT INTO workspace_brand_profiles (id, workspace_id, profile_name) VALUES (?, ?, ?)",
    ("brand-profile-b", "workspace-test", "Podcast"),
)
profiles = connection.execute(
    "SELECT profile_name FROM workspace_brand_profiles WHERE workspace_id=? ORDER BY profile_name",
    ("workspace-test",),
).fetchall()
if profiles != [("Gaming",), ("Podcast",)]:
    raise SystemExit(f"Brand Profile persistence failed: {profiles}")

# Publisher metadata templates persist independently for each Brand Profile.
metadata_config = {
    "titleTemplate": "{clip_title} #Shorts",
    "descriptionTemplate": "{clip_title}\\n\\n{hashtags}",
    "hashtags": "#shorts #gaming",
    "tags": "shorts, gaming",
}
connection.execute(
    "UPDATE workspace_brand_profiles SET metadata_config_json=? WHERE id=? AND workspace_id=?",
    (
        __import__("json").dumps(metadata_config, separators=(",", ":")),
        "brand-profile-a",
        "workspace-test",
    ),
)
saved_metadata = connection.execute(
    "SELECT metadata_config_json FROM workspace_brand_profiles WHERE id=? AND workspace_id=?",
    ("brand-profile-a", "workspace-test"),
).fetchone()
if saved_metadata is None or __import__("json").loads(saved_metadata[0]) != metadata_config:
    raise SystemExit("Brand Profile metadata template persistence failed")

connection.execute(
    "UPDATE workspace_brand_kits SET active_profile_id=? WHERE workspace_id=?",
    ("brand-profile-a", "workspace-test"),
)
active = connection.execute(
    "SELECT active_profile_id FROM workspace_brand_kits WHERE workspace_id=?",
    ("workspace-test",),
).fetchone()
if active != ("brand-profile-a",):
    raise SystemExit("Brand Profile activation persistence failed")

connection.commit()
connection.close()
print(f"OK: {len(MIGRATIONS)} migrations applied; required tables and constraints verified.")
