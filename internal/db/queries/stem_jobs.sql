-- name: CreateStemJob :one
INSERT INTO stem_jobs (version_id, user_id, track_public_id, status)
VALUES (?, ?, ?, 'pending')
RETURNING *;

-- name: GetStemJob :one
SELECT * FROM stem_jobs
WHERE id = ?;

-- name: GetStemJobByVersionID :one
SELECT * FROM stem_jobs
WHERE version_id = ?
ORDER BY created_at DESC
LIMIT 1;

-- name: UpdateStemJobStatus :exec
UPDATE stem_jobs
SET status = ?, updated_at = CURRENT_TIMESTAMP
WHERE id = ?;

-- name: UpdateStemJobError :exec
UPDATE stem_jobs
SET status = 'failed', error_message = ?, updated_at = CURRENT_TIMESTAMP
WHERE id = ?;

-- name: DeleteStemJobsByVersion :exec
DELETE FROM stem_jobs
WHERE version_id = ?;

-- name: ListStemFilesByVersion :many
SELECT * FROM track_files
WHERE version_id = ? AND quality LIKE 'stem_%';

-- name: DeleteStemFilesByVersion :exec
DELETE FROM track_files
WHERE version_id = ? AND quality LIKE 'stem_%';
