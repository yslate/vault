-- Add event type to distinguish listen vs download events
-- Also make track_id nullable to support project-level download events
PRAGMA foreign_keys=OFF;

CREATE TABLE listen_events_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_type TEXT NOT NULL DEFAULT 'listen',
    track_owner_id INTEGER NOT NULL,
    track_id INTEGER,
    track_title TEXT NOT NULL,
    played_by_user_id INTEGER,
    played_by_username TEXT NOT NULL DEFAULT 'Someone',
    played_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    read INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (track_owner_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (track_id) REFERENCES tracks(id) ON DELETE CASCADE
);

INSERT INTO listen_events_new SELECT id, 'listen', track_owner_id, track_id, track_title, played_by_user_id, played_by_username, played_at, read FROM listen_events;

DROP TABLE listen_events;
ALTER TABLE listen_events_new RENAME TO listen_events;

CREATE INDEX IF NOT EXISTS listen_events_owner_idx ON listen_events(track_owner_id);
CREATE INDEX IF NOT EXISTS listen_events_read_idx ON listen_events(track_owner_id, read);

PRAGMA foreign_keys=ON;
