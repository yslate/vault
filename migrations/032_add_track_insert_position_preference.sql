-- Add preference for where newly dropped/uploaded tracks should appear in a project
ALTER TABLE user_preferences
ADD COLUMN track_insert_position TEXT NOT NULL DEFAULT 'bottom'
CHECK(track_insert_position IN ('top', 'bottom'));
