-- name: CreateListenEvent :one
INSERT INTO listen_events (track_owner_id, track_id, track_title, played_by_user_id, played_by_username)
VALUES (?, ?, ?, ?, ?)
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
