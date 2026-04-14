package sharing

import (
	"context"
	"database/sql"
	"fmt"
	"log"
	"net/http"

	"bungleware/vault/internal/db"
	sqlc "bungleware/vault/internal/db/sqlc"
	"bungleware/vault/internal/storage"

	"golang.org/x/crypto/bcrypt"
)

// ListenEventNotifier is satisfied by handlers.WSHub without importing that package.
type ListenEventNotifier interface {
	NotifyListenEvent(ownerID, trackID, eventID int64, trackTitle, username string)
}

type SharingHandler struct {
	db       *db.DB
	storage  storage.Storage
	notifier ListenEventNotifier
}

func NewSharingHandler(database *db.DB, storageAdapter storage.Storage, notifier ListenEventNotifier) *SharingHandler {
	return &SharingHandler{db: database, storage: storageAdapter, notifier: notifier}
}

func buildShareURL(r *http.Request, token string) string {
	scheme := "http"
	if r.TLS != nil {
		scheme = "https"
	}
	return fmt.Sprintf("%s://%s/share/%s", scheme, r.Host, token)
}

func hashSharePassword(password *string) (sql.NullString, error) {
	if password == nil || *password == "" {
		return sql.NullString{Valid: false}, nil
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(*password), bcrypt.DefaultCost)
	if err != nil {
		return sql.NullString{}, fmt.Errorf("failed to hash password: %w", err)
	}

	return sql.NullString{String: string(hash), Valid: true}, nil
}

func (h *SharingHandler) recordEvent(ctx context.Context, eventType string, ownerID int64, trackID *int64, trackTitle string, playerUserID *int64, playerUsername string) {
	nullPlayerID := sql.NullInt64{}
	if playerUserID != nil {
		nullPlayerID = sql.NullInt64{Int64: *playerUserID, Valid: true}
	}
	nullTrackID := sql.NullInt64{}
	if trackID != nil {
		nullTrackID = sql.NullInt64{Int64: *trackID, Valid: true}
	}

	// Debounce: skip listen events if same track was already recorded in the last 30 min
	if eventType == "listen" && nullTrackID.Valid {
		count, err := h.db.Queries.RecentListenEventExists(ctx, sqlc.RecentListenEventExistsParams{
			TrackOwnerID: ownerID,
			TrackID:      nullTrackID,
		})
		if err == nil && count > 0 {
			return
		}
	}

	event, err := h.db.Queries.CreateListenEvent(ctx, sqlc.CreateListenEventParams{
		EventType:        eventType,
		TrackOwnerID:     ownerID,
		TrackID:          nullTrackID,
		TrackTitle:       trackTitle,
		PlayedByUserID:   nullPlayerID,
		PlayedByUsername: playerUsername,
	})
	if err != nil {
		log.Printf("[SharingHandler] Failed to create %s event: %v", eventType, err)
		return
	}

	if h.notifier != nil {
		notifyTrackID := int64(0)
		if nullTrackID.Valid {
			notifyTrackID = nullTrackID.Int64
		}
		h.notifier.NotifyListenEvent(ownerID, notifyTrackID, event.ID, trackTitle, playerUsername)
	}
}

func (h *SharingHandler) canManageTrackShares(ctx context.Context, track sqlc.Track, userID int64) (bool, error) {
	project, err := h.db.Queries.GetProjectByID(ctx, track.ProjectID)
	if err == nil && project.UserID == userID {
		return true, nil
	}

	share, err := h.db.Queries.GetUserProjectShare(ctx, sqlc.GetUserProjectShareParams{
		ProjectID: track.ProjectID,
		SharedTo:  userID,
	})
	if err == nil && share.CanEdit {
		return true, nil
	}

	return false, nil
}
