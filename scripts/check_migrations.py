from pathlib import Path
import sqlite3

ROOT = Path(__file__).resolve().parents[1]
MIGRATIONS = sorted((ROOT / "migrations").glob("*.sql"))

expected = ["0001_initial.sql", "0002_auth.sql"]
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
}
missing = required - tables
if missing:
    raise SystemExit(f"Missing tables after migrations: {sorted(missing)}")

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