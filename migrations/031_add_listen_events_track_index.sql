-- Add index on track_id for efficient stream count queries
CREATE INDEX IF NOT EXISTS listen_events_track_idx ON listen_events(track_id, event_type);
