-- Recreate listen_events with nullable played_by_user_id (for anonymous share listeners)
DROP TABLE IF EXISTS listen_events;

CREATE TABLE listen_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    track_owner_id INTEGER NOT NULL,
    track_id INTEGER NOT NULL,
    track_title TEXT NOT NULL,
    played_by_user_id INTEGER,
    played_by_username TEXT NOT NULL DEFAULT 'Someone',
    played_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    read INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (track_owner_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (track_id) REFERENCES tracks(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS listen_events_owner_idx ON listen_events(track_owner_id);
CREATE INDEX IF NOT EXISTS listen_events_read_idx ON listen_events(track_owner_id, read);
