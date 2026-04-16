CREATE TABLE IF NOT EXISTS stem_jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    version_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    track_public_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    error_message TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (version_id) REFERENCES track_versions(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_stem_jobs_version_id ON stem_jobs(version_id);
CREATE INDEX IF NOT EXISTS idx_stem_jobs_user_id ON stem_jobs(user_id);
CREATE INDEX IF NOT EXISTS idx_stem_jobs_status ON stem_jobs(status);
