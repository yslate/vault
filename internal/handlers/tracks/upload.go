package tracks

import (
	"context"
	"database/sql"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"bungleware/vault/internal/apperr"
	sqlc "bungleware/vault/internal/db/sqlc"
	"bungleware/vault/internal/httputil"
	"bungleware/vault/internal/ids"
	"bungleware/vault/internal/service"
	"bungleware/vault/internal/storage"
	"bungleware/vault/internal/transcoding"
)

func (h *TracksHandler) UploadTrack(w http.ResponseWriter, r *http.Request) error {
	userID, err := httputil.RequireUserID(r)
	if err != nil {
		return apperr.NewUnauthorized("user not found in context")
	}

	if err := r.ParseMultipartForm(100 << 20); err != nil {
		return apperr.NewBadRequest("failed to parse form")
	}

	file, header, err := r.FormFile("file")
	if err != nil {
		return apperr.NewBadRequest("no file provided")
	}
	defer file.Close()

	ext := strings.ToLower(filepath.Ext(header.Filename))
	if !transcoding.IsAllowedUploadExtension(ext) {
		return apperr.NewBadRequest("unsupported file format")
	}

	projectIDStr := r.FormValue("project_id")
	if projectIDStr == "" {
		return apperr.NewBadRequest("project_id is required")
	}

	project, err := h.resolveEditableProject(r.Context(), projectIDStr, int64(userID))
	if err != nil {
		return err
	}

	title := r.FormValue("title")
	if title == "" {
		title = strings.TrimSuffix(header.Filename, filepath.Ext(header.Filename))
	}

	track, err := h.createTrackFromReader(r.Context(), createTrackFromReaderInput{
		ActingUserID: int64(userID),
		Project:      project,
		Title:        title,
		Artist:       r.FormValue("artist"),
		Album:        r.FormValue("album"),
		OriginalName: header.Filename,
		Reader:       file,
	})
	if err != nil {
		return err
	}

	return httputil.CreatedResult(w, convertTrack(track))
}

type createTrackFromReaderInput struct {
	ActingUserID int64
	Project      sqlc.Project
	Title        string
	Artist       string
	Album        string
	VersionName  string
	OriginalName string
	Reader       io.Reader
}

func (h *TracksHandler) resolveEditableProject(ctx context.Context, projectIDStr string, userID int64) (sqlc.Project, error) {
	var project sqlc.Project

	if id, err := strconv.ParseInt(projectIDStr, 10, 64); err == nil {
		p, err := h.db.GetProjectByID(ctx, id)
		if err == nil {
			project = p
		}
	}

	if project.ID == 0 {
		p, err := h.db.Queries.GetProjectByPublicIDNoFilter(ctx, projectIDStr)
		if err == nil {
			project = service.ProjectRowToProject(p)
		}
	}

	if project.ID == 0 {
		return sqlc.Project{}, apperr.NewNotFound("project not found")
	}

	if project.UserID == userID {
		return project, nil
	}

	share, err := h.db.Queries.GetUserProjectShare(ctx, sqlc.GetUserProjectShareParams{
		ProjectID: project.ID,
		SharedTo:  userID,
	})
	if errors.Is(err, sql.ErrNoRows) {
		return sqlc.Project{}, apperr.NewForbidden("access denied")
	}
	if err != nil {
		return sqlc.Project{}, apperr.NewInternal("failed to check share access", err)
	}
	if !share.CanEdit {
		return sqlc.Project{}, apperr.NewForbidden("editing not allowed for this shared project")
	}

	return project, nil
}

func (h *TracksHandler) createTrackFromReader(ctx context.Context, input createTrackFromReaderInput) (sqlc.Track, error) {
	ext := strings.ToLower(filepath.Ext(input.OriginalName))
	if !transcoding.IsAllowedUploadExtension(ext) {
		return sqlc.Track{}, apperr.NewBadRequest("unsupported file format")
	}

	title := strings.TrimSpace(input.Title)
	if title == "" {
		title = strings.TrimSuffix(input.OriginalName, filepath.Ext(input.OriginalName))
	}

	artist := sql.NullString{}
	if artistVal := strings.TrimSpace(input.Artist); artistVal != "" {
		artist = sql.NullString{String: artistVal, Valid: true}
	}

	album := sql.NullString{}
	if albumVal := strings.TrimSpace(input.Album); albumVal != "" {
		album = sql.NullString{String: albumVal, Valid: true}
	}

	publicID, err := ids.NewPublicID()
	if err != nil {
		return sqlc.Track{}, apperr.NewInternal("failed to generate track id", err)
	}

	insertPosition := "bottom"
	prefs, err := h.db.Queries.GetUserPreferences(ctx, input.ActingUserID)
	if err == nil && (prefs.TrackInsertPosition == "top" || prefs.TrackInsertPosition == "bottom") {
		insertPosition = prefs.TrackInsertPosition
	} else if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return sqlc.Track{}, apperr.NewInternal("failed to get user preferences", err)
	}

	targetOrder := int64(0)
	if insertPosition == "top" {
		if err := h.db.Queries.IncrementTrackOrdersByProject(ctx, input.Project.ID); err != nil {
			return sqlc.Track{}, apperr.NewInternal("failed to shift track order", err)
		}
	} else {
		maxOrderResult, err := h.db.Queries.GetMaxTrackOrderByProject(ctx, input.Project.ID)
		if err != nil {
			return sqlc.Track{}, apperr.NewInternal("failed to get track order", err)
		}

		maxOrder, ok := maxOrderResult.(int64)
		if !ok {
			maxOrder = -1
		}
		targetOrder = maxOrder + 1
	}

	track, err := h.db.CreateTrack(ctx, sqlc.CreateTrackParams{
		UserID:    input.ActingUserID,
		ProjectID: input.Project.ID,
		Title:     title,
		Artist:    artist,
		Album:     album,
		PublicID:  publicID,
	})
	if err != nil {
		return sqlc.Track{}, apperr.NewInternal("failed to create track", err)
	}

	if err := h.db.Queries.UpdateTrackOrder(ctx, sqlc.UpdateTrackOrderParams{
		TrackOrder: targetOrder,
		ID:         track.ID,
	}); err != nil {
		return sqlc.Track{}, apperr.NewInternal("failed to set track order", err)
	}

	versionName := strings.TrimSpace(input.VersionName)
	if versionName == "" {
		versionName = strings.TrimSuffix(input.OriginalName, filepath.Ext(input.OriginalName))
	}
	if versionName == "" {
		versionName = "Original Upload"
	}

	version, err := h.db.CreateTrackVersion(ctx, sqlc.CreateTrackVersionParams{
		TrackID:         track.ID,
		VersionName:     versionName,
		Notes:           sql.NullString{},
		DurationSeconds: sql.NullFloat64{},
		VersionOrder:    1,
	})
	if err != nil {
		return sqlc.Track{}, apperr.NewInternal("failed to create version", err)
	}

	if err := h.db.SetActiveVersion(ctx, sqlc.SetActiveVersionParams{
		ActiveVersionID: sql.NullInt64{Int64: version.ID, Valid: true},
		ID:              track.ID,
	}); err != nil {
		return sqlc.Track{}, apperr.NewInternal("failed to set active version", err)
	}

	saveResult, err := h.storage.SaveTrackSource(ctx, storage.SaveTrackSourceInput{
		ProjectPublicID: input.Project.PublicID,
		TrackID:         track.ID,
		VersionID:       version.ID,
		OriginalName:    input.OriginalName,
		Reader:          input.Reader,
	})
	if err != nil {
		return sqlc.Track{}, apperr.NewInternal("failed to save file", err)
	}

	if transcoding.IsVideoExtension(ext) {
		wavPath, err := transcoding.ExtractAudioToWAV(saveResult.Path)
		if err != nil {
			return sqlc.Track{}, apperr.NewInternal("failed to extract audio from video", err)
		}
		saveResult.Path = wavPath
		saveResult.Format = "wav"
		if fi, err := os.Stat(wavPath); err == nil {
			saveResult.Size = fi.Size()
		}
	}

	metadata, err := transcoding.ExtractMetadata(saveResult.Path)
	if err != nil {
		slog.Debug("failed to extract metadata", "error", err)
		metadata = &transcoding.AudioMetadata{}
	}

	if metadata.Duration > 0 {
		if err := h.db.UpdateTrackVersionDuration(ctx, sqlc.UpdateTrackVersionDurationParams{
			DurationSeconds: sql.NullFloat64{Float64: metadata.Duration, Valid: true},
			ID:              version.ID,
		}); err != nil {
			slog.Debug("failed to persist version duration", "error", err)
		}
	}

	var bitrate sql.NullInt64
	if metadata.Bitrate > 0 {
		bitrate = sql.NullInt64{Int64: int64(metadata.Bitrate), Valid: true}
	}

	if _, err := h.db.CreateTrackFile(ctx, sqlc.CreateTrackFileParams{
		VersionID:         version.ID,
		Quality:           "source",
		FilePath:          saveResult.Path,
		FileSize:          saveResult.Size,
		Format:            saveResult.Format,
		Bitrate:           bitrate,
		ContentHash:       sql.NullString{},
		TranscodingStatus: sql.NullString{String: "completed", Valid: true},
		OriginalFilename:  sql.NullString{String: input.OriginalName, Valid: true},
	}); err != nil {
		return sqlc.Track{}, apperr.NewInternal("failed to create track file record", err)
	}

	if h.transcoder != nil {
		if err := h.transcoder.TranscodeVersion(ctx, transcoding.TranscodeVersionInput{
			VersionID:      version.ID,
			SourceFilePath: saveResult.Path,
			TrackPublicID:  track.PublicID,
			UserID:         input.ActingUserID,
		}); err != nil {
			slog.Debug("failed to queue transcoding", "error", err)
		}
	}

	return track, nil
}
