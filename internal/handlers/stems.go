package handlers

import (
	"context"
	"net/http"
	"os"
	"strconv"

	"bungleware/vault/internal/apperr"
	"bungleware/vault/internal/db"
	sqlc "bungleware/vault/internal/db/sqlc"
	"bungleware/vault/internal/handlers/tracks"
	"bungleware/vault/internal/httputil"
	"bungleware/vault/internal/stemming"
)

type StemsHandler struct {
	db           *db.DB
	stemSplitter StemSplitter
}

type StemSplitter interface {
	SplitStems(ctx context.Context, input stemming.SplitStemsInput) error
}

func NewStemsHandler(database *db.DB, stemSplitter StemSplitter) *StemsHandler {
	return &StemsHandler{db: database, stemSplitter: stemSplitter}
}

func (h *StemsHandler) SplitStems(w http.ResponseWriter, r *http.Request) error {
	userID, err := httputil.RequireUserID(r)
	if err != nil {
		return apperr.NewUnauthorized("user not found in context")
	}

	publicID := r.PathValue("id")
	ctx := r.Context()

	track, err := h.db.Queries.GetTrackByPublicIDNoFilter(ctx, publicID)
	if err := httputil.HandleDBError(err, "track not found", "failed to query track"); err != nil {
		return err
	}

	access, err := tracks.CheckTrackAccess(ctx, h.db, track.ID, track.ProjectID, int64(userID))
	if err != nil {
		return apperr.NewInternal("failed to check track access", err)
	}
	if !access.HasAccess {
		return apperr.NewForbidden("access denied")
	}

	if !track.ActiveVersionID.Valid {
		return apperr.NewBadRequest("track has no active version")
	}

	versionID := track.ActiveVersionID.Int64

	// Check if stems are already being processed
	existingJob, err := h.db.Queries.GetStemJobByVersionID(ctx, versionID)
	if err == nil && (existingJob.Status == "pending" || existingJob.Status == "processing") {
		return apperr.NewBadRequest("stem splitting is already in progress")
	}

	// Find source file
	sourceFile, err := h.db.Queries.GetCompletedTrackFile(ctx, sqlc.GetCompletedTrackFileParams{
		VersionID: versionID,
		Quality:   "source",
	})
	if err != nil {
		return apperr.NewBadRequest("no source file found for this track")
	}

	if h.stemSplitter == nil {
		return apperr.NewBadRequest("stem splitting is not available on this instance")
	}

	if err := h.stemSplitter.SplitStems(ctx, stemming.SplitStemsInput{
		VersionID:      versionID,
		SourceFilePath: sourceFile.FilePath,
		TrackPublicID:  track.PublicID,
		UserID:         int64(userID),
	}); err != nil {
		return apperr.NewInternal("failed to start stem splitting", err)
	}

	return httputil.OKResult(w, map[string]interface{}{
		"status":  "pending",
		"message": "Stem splitting started",
	})
}

func (h *StemsHandler) GetStems(w http.ResponseWriter, r *http.Request) error {
	userID, err := httputil.RequireUserID(r)
	if err != nil {
		return apperr.NewUnauthorized("user not found in context")
	}

	publicID := r.PathValue("id")
	ctx := r.Context()

	track, err := h.db.Queries.GetTrackByPublicIDNoFilter(ctx, publicID)
	if err := httputil.HandleDBError(err, "track not found", "failed to query track"); err != nil {
		return err
	}

	access, err := tracks.CheckTrackAccess(ctx, h.db, track.ID, track.ProjectID, int64(userID))
	if err != nil {
		return apperr.NewInternal("failed to check track access", err)
	}
	if !access.HasAccess {
		return apperr.NewForbidden("access denied")
	}

	if !track.ActiveVersionID.Valid {
		return apperr.NewBadRequest("track has no active version")
	}

	versionID := track.ActiveVersionID.Int64

	// Get stem job status
	job, err := h.db.Queries.GetStemJobByVersionID(ctx, versionID)
	jobStatus := "none"
	var errorMessage *string
	if err == nil {
		jobStatus = job.Status
		if job.ErrorMessage.Valid {
			errorMessage = &job.ErrorMessage.String
		}
	}

	// Get stem files
	stemFiles, err := h.db.Queries.ListStemFilesByVersion(ctx, versionID)
	if err != nil {
		stemFiles = []sqlc.TrackFile{}
	}

	type StemFile struct {
		ID       int64  `json:"id"`
		StemType string `json:"stem_type"`
		FileSize int64  `json:"file_size"`
		Format   string `json:"format"`
	}

	stems := make([]StemFile, 0, len(stemFiles))
	for _, f := range stemFiles {
		stemType := f.Quality[5:] // strip "stem_" prefix
		stems = append(stems, StemFile{
			ID:       f.ID,
			StemType: stemType,
			FileSize: f.FileSize,
			Format:   f.Format,
		})
	}

	return httputil.OKResult(w, map[string]interface{}{
		"status": jobStatus,
		"error":  errorMessage,
		"stems":  stems,
	})
}

func (h *StemsHandler) resolveStemFileAccess(ctx context.Context, userID int, stemFileID int64) (*sqlc.TrackFile, error) {
	stemFile, err := h.db.Queries.GetTrackFileByID(ctx, stemFileID)
	if err != nil {
		return nil, apperr.NewNotFound("stem file not found")
	}

	if len(stemFile.Quality) < 5 || stemFile.Quality[:5] != "stem_" {
		return nil, apperr.NewBadRequest("not a stem file")
	}

	version, err := h.db.Queries.GetTrackVersion(ctx, stemFile.VersionID)
	if err != nil {
		return nil, apperr.NewInternal("failed to find version", err)
	}

	trackRecord, err := h.db.Queries.GetTrackByID(ctx, version.TrackID)
	if err != nil {
		return nil, apperr.NewInternal("failed to find track", err)
	}

	access, err := tracks.CheckTrackAccess(ctx, h.db, trackRecord.ID, trackRecord.ProjectID, int64(userID))
	if err != nil {
		return nil, apperr.NewInternal("failed to check track access", err)
	}
	if !access.HasAccess {
		return nil, apperr.NewForbidden("access denied")
	}

	return &stemFile, nil
}

func (h *StemsHandler) StreamStem(w http.ResponseWriter, r *http.Request) error {
	userID, err := httputil.RequireUserID(r)
	if err != nil {
		return apperr.NewUnauthorized("user not found in context")
	}

	stemFileID, err := strconv.ParseInt(r.PathValue("stemFileId"), 10, 64)
	if err != nil {
		return apperr.NewBadRequest("invalid stem file ID")
	}

	stemFile, err := h.resolveStemFileAccess(r.Context(), userID, stemFileID)
	if err != nil {
		return err
	}

	f, err := os.Open(stemFile.FilePath)
	if err != nil {
		return apperr.NewInternal("failed to open stem file", err)
	}
	defer f.Close()

	stat, err := f.Stat()
	if err != nil {
		return apperr.NewInternal("failed to stat stem file", err)
	}

	w.Header().Set("Content-Type", "audio/wav")
	http.ServeContent(w, r, stemFile.FilePath, stat.ModTime(), f)
	return nil
}

func (h *StemsHandler) DownloadStem(w http.ResponseWriter, r *http.Request) error {
	userID, err := httputil.RequireUserID(r)
	if err != nil {
		return apperr.NewUnauthorized("user not found in context")
	}

	stemFileID, err := strconv.ParseInt(r.PathValue("stemFileId"), 10, 64)
	if err != nil {
		return apperr.NewBadRequest("invalid stem file ID")
	}

	ctx := r.Context()

	stemFile, err := h.resolveStemFileAccess(ctx, userID, stemFileID)
	if err != nil {
		return err
	}

	// Get track title for filename
	version, _ := h.db.Queries.GetTrackVersion(ctx, stemFile.VersionID)
	trackRecord, _ := h.db.Queries.GetTrackByID(ctx, version.TrackID)

	stemType := stemFile.Quality[5:]
	filename := trackRecord.Title + "_" + stemType + ".wav"

	f, err := os.Open(stemFile.FilePath)
	if err != nil {
		return apperr.NewInternal("failed to open stem file", err)
	}
	defer f.Close()

	stat, err := f.Stat()
	if err != nil {
		return apperr.NewInternal("failed to stat stem file", err)
	}

	w.Header().Set("Content-Type", "audio/wav")
	w.Header().Set("Content-Disposition", "attachment; filename=\""+filename+"\"")
	http.ServeContent(w, r, stemFile.FilePath, stat.ModTime(), f)
	return nil
}
