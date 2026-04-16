package handlers

import (
	"database/sql"
	"net/http"
	"strconv"

	"bungleware/vault/internal/apperr"
	"bungleware/vault/internal/db"
	sqlc "bungleware/vault/internal/db/sqlc"
	"bungleware/vault/internal/httputil"
	"bungleware/vault/internal/middleware"
)

type NotificationsHandler struct {
	db *db.DB
}

func NewNotificationsHandler(database *db.DB) *NotificationsHandler {
	return &NotificationsHandler{db: database}
}

type ListenEventResponse struct {
	ID               int64   `json:"id"`
	EventType        string  `json:"event_type"`
	TrackID          *int64  `json:"track_id"`
	TrackTitle       string  `json:"track_title"`
	PlayedByUserID   *int64  `json:"played_by_user_id"`
	PlayedByUsername string  `json:"played_by_username"`
	PlayedAt         *string `json:"played_at"`
	Read             bool    `json:"read"`
}

type NotificationsResponse struct {
	Events      []ListenEventResponse `json:"events"`
	UnreadCount int64                 `json:"unread_count"`
}

func toListenEventResponse(e sqlc.ListenEvent) ListenEventResponse {
	resp := ListenEventResponse{
		ID:               e.ID,
		EventType:        e.EventType,
		TrackTitle:       e.TrackTitle,
		PlayedByUsername: e.PlayedByUsername,
		Read:             e.Read != 0,
	}
	if e.TrackID.Valid {
		resp.TrackID = &e.TrackID.Int64
	}
	if e.PlayedByUserID.Valid {
		resp.PlayedByUserID = &e.PlayedByUserID.Int64
	}
	if !e.PlayedAt.IsZero() {
		t := e.PlayedAt.Format("2006-01-02T15:04:05Z07:00")
		resp.PlayedAt = &t
	}
	return resp
}

func (h *NotificationsHandler) GetNotifications(w http.ResponseWriter, r *http.Request) error {
	userID, ok := middleware.GetUserID(r.Context())
	if !ok {
		return apperr.NewUnauthorized("unauthorized")
	}

	ctx := r.Context()

	events, err := h.db.Queries.GetListenEvents(ctx, int64(userID))
	if err != nil {
		return apperr.NewInternal("failed to get listen events", err)
	}

	unreadCount, err := h.db.Queries.GetUnreadListenEventsCount(ctx, int64(userID))
	if err != nil {
		return apperr.NewInternal("failed to get unread count", err)
	}

	resp := NotificationsResponse{
		Events:      make([]ListenEventResponse, 0, len(events)),
		UnreadCount: unreadCount,
	}
	for _, e := range events {
		resp.Events = append(resp.Events, toListenEventResponse(e))
	}

	httputil.WriteJSON(w, http.StatusOK, resp)
	return nil
}

func (h *NotificationsHandler) MarkAllRead(w http.ResponseWriter, r *http.Request) error {
	userID, ok := middleware.GetUserID(r.Context())
	if !ok {
		return apperr.NewUnauthorized("unauthorized")
	}

	if err := h.db.Queries.MarkAllListenEventsRead(r.Context(), int64(userID)); err != nil {
		return apperr.NewInternal("failed to mark notifications as read", err)
	}

	w.WriteHeader(http.StatusNoContent)
	return nil
}

// GetTrackStreamStats returns stream + download counts for a single track (owner only)
func (h *NotificationsHandler) GetTrackStreamStats(w http.ResponseWriter, r *http.Request) error {
	userID, ok := middleware.GetUserID(r.Context())
	if !ok {
		return apperr.NewUnauthorized("unauthorized")
	}

	publicID := r.PathValue("id")
	ctx := r.Context()

	track, err := h.db.Queries.GetTrackByPublicIDNoFilter(ctx, publicID)
	if err != nil {
		if err == sql.ErrNoRows {
			return apperr.NewNotFound("track not found")
		}
		return apperr.NewInternal("failed to query track", err)
	}
	if track.UserID != int64(userID) {
		return apperr.NewForbidden("access denied")
	}

	stats, err := h.db.Queries.GetTrackStats(ctx, sql.NullInt64{Int64: track.ID, Valid: true})
	if err != nil {
		return apperr.NewInternal("failed to get track stats", err)
	}

	httputil.WriteJSON(w, http.StatusOK, map[string]interface{}{
		"stream_count":   stats.StreamCount,
		"download_count": stats.DownloadCount,
	})
	return nil
}

// GetProjectStreamStats returns per-track + totals for a project (owner only)
func (h *NotificationsHandler) GetProjectStreamStats(w http.ResponseWriter, r *http.Request) error {
	userID, ok := middleware.GetUserID(r.Context())
	if !ok {
		return apperr.NewUnauthorized("unauthorized")
	}

	publicID := r.PathValue("id")
	ctx := r.Context()

	project, err := h.db.Queries.GetProjectByPublicID(ctx, sqlc.GetProjectByPublicIDParams{
		PublicID: publicID,
		UserID:   int64(userID),
	})
	if err != nil {
		if err == sql.ErrNoRows {
			return apperr.NewNotFound("project not found")
		}
		return apperr.NewInternal("failed to query project", err)
	}

	rows, err := h.db.Queries.GetProjectStreamStats(ctx, project.ID)
	if err != nil {
		return apperr.NewInternal("failed to get project stream stats", err)
	}

	var totalStreams, totalDownloads int64
	for _, r := range rows {
		if v, ok := r.StreamCount.(int64); ok {
			totalStreams += v
		}
		if v, ok := r.DownloadCount.(int64); ok {
			totalDownloads += v
		}
	}

	httputil.WriteJSON(w, http.StatusOK, map[string]interface{}{
		"total_streams":   totalStreams,
		"total_downloads": totalDownloads,
		"tracks":          rows,
	})
	return nil
}

func (h *NotificationsHandler) DeleteNotification(w http.ResponseWriter, r *http.Request) error {
	userID, ok := middleware.GetUserID(r.Context())
	if !ok {
		return apperr.NewUnauthorized("unauthorized")
	}

	idStr := r.PathValue("id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		return apperr.NewBadRequest("invalid notification id")
	}

	if err := h.db.Queries.DeleteListenEvent(r.Context(), sqlc.DeleteListenEventParams{
		ID:           id,
		TrackOwnerID: int64(userID),
	}); err != nil {
		return apperr.NewInternal("failed to delete notification", err)
	}

	w.WriteHeader(http.StatusNoContent)
	return nil
}
