-- name: CreateListenEvent :one
INSERT INTO listen_events (event_type, track_owner_id, track_id, track_title, played_by_user_id, played_by_username)
VALUES (?, ?, ?, ?, ?, ?)
RETURNING *;

-- name: GetListenEvents :many
SELECT * FROM listen_events
WHERE track_owner_id = ?
ORDER BY played_at DESC
LIMIT 50;

-- name: GetUnreadListenEventsCount :one
SELECT COUNT(*) FROM listen_events
WHERE track_owner_id = ? AND read = 0;

-- name: MarkAllListenEventsRead :exec
UPDATE listen_events
SET read = 1
WHERE track_owner_id = ? AND read = 0;

-- name: DeleteListenEvent :exec
DELETE FROM listen_events
WHERE id = ? AND track_owner_id = ?;

-- name: RecentListenEventExists :one
SELECT COUNT(*) FROM listen_events
WHERE track_owner_id = ? AND track_id = ? AND played_at > datetime('now', '-30 minutes');

-- name: GetTrackStats :one
SELECT
    COALESCE(SUM(CASE WHEN event_type = 'listen' THEN 1 ELSE 0 END), 0) as stream_count,
    COALESCE(SUM(CASE WHEN event_type = 'download' THEN 1 ELSE 0 END), 0) as download_count
FROM listen_events
WHERE track_id = ?;

-- name: GetProjectStreamStats :many
SELECT
    t.id,
    t.public_id,
    t.title,
    COALESCE(SUM(CASE WHEN le.event_type = 'listen' THEN 1 ELSE 0 END), 0) as stream_count,
    COALESCE(SUM(CASE WHEN le.event_type = 'download' THEN 1 ELSE 0 END), 0) as download_count
FROM tracks t
LEFT JOIN listen_events le ON le.track_id = t.id
WHERE t.project_id = ?
GROUP BY t.id, t.public_id, t.title
HAVING stream_count > 0 OR download_count > 0
ORDER BY stream_count DESC;
