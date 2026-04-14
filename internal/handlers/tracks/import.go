package tracks

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"path"
	"strings"

	"bungleware/vault/internal/apperr"
	sqlc "bungleware/vault/internal/db/sqlc"
	"bungleware/vault/internal/handlers/shared"
	"bungleware/vault/internal/httputil"
	"bungleware/vault/internal/service"
)

const (
	untitledHost         = "untitled.stream"
	untitledAnonKey      = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR5eW1hcXdwcnFzdXBpcHlhbHBqIiwicm9sZSI6ImFub24iLCJpYXQiOjE2ODExMzk5NDMsImV4cCI6MTk5NjcxNTk0M30.Voc3Rcv5uxslGhpNTE7yNW5OcyRuBX3I_7JusGAk3wI"
	untitledProjectRoute = "routes/library.project.$projectSlug"
	untitledTrackRoute   = "routes/library.track.$trackSlug"
)

type untitledRemixContext struct {
	State struct {
		LoaderData map[string]json.RawMessage `json:"loaderData"`
	} `json:"state"`
}

type untitledTrackRouteData struct {
	Track untitledTrack `json:"track"`
}

type untitledProjectRouteData struct {
	Project untitledProjectPayload `json:"project"`
}

type untitledProjectPayload struct {
	Project untitledProject `json:"project"`
	Tracks  []untitledTrack `json:"tracks"`
}

type untitledProject struct {
	Title                 string  `json:"title"`
	Username              string  `json:"username"`
	ArtistName            *string `json:"artist_name"`
	ArtworkURL            string  `json:"artwork_url"`
	ArtworkSignedURL      string  `json:"artwork_signed_url"`
	ArtworkSmallSignedURL string  `json:"artwork_small_signed_url"`
}

type untitledTrack struct {
	Title            string  `json:"title"`
	Slug             string  `json:"slug"`
	Username         string  `json:"username"`
	AudioURL         string  `json:"audio_url"`
	AudioFallbackURL string  `json:"audio_fallback_url"`
	Duration         float64 `json:"duration"`
	VersionTitle     string  `json:"version_title"`
	FileType         string  `json:"file_type"`
}

type untitledImportSource struct {
	SourceType  string
	SourceTitle string
	OwnerName   string
	CoverURL    string
	Tracks      []untitledTrack
}

type importUntitledRequest struct {
	ProjectID   string `json:"project_id"`
	UntitledURL string `json:"untitled_url"`
}

type importUntitledResponse struct {
	SourceType   string   `json:"source_type"`
	SourceTitle  string   `json:"source_title"`
	Imported     int      `json:"imported"`
	Failed       int      `json:"failed"`
	ImportedRows []string `json:"imported_rows,omitempty"`
	FailedRows   []string `json:"failed_rows,omitempty"`
}

type importUntitledProjectRequest struct {
	FolderID    *int64 `json:"folder_id,omitempty"`
	UntitledURL string `json:"untitled_url"`
}

type importUntitledProjectResponse struct {
	Project      shared.ProjectResponse `json:"project"`
	SourceType   string                 `json:"source_type"`
	SourceTitle  string                 `json:"source_title"`
	Imported     int                    `json:"imported"`
	Failed       int                    `json:"failed"`
	ImportedRows []string               `json:"imported_rows,omitempty"`
	FailedRows   []string               `json:"failed_rows,omitempty"`
}

func (h *TracksHandler) ImportUntitled(w http.ResponseWriter, r *http.Request) error {
	userID, err := httputil.RequireUserID(r)
	if err != nil {
		return apperr.NewUnauthorized("user not found in context")
	}

	req, err := httputil.DecodeJSON[importUntitledRequest](r)
	if err != nil {
		return apperr.NewBadRequest("invalid request body")
	}
	if strings.TrimSpace(req.ProjectID) == "" {
		return apperr.NewBadRequest("project_id is required")
	}
	if strings.TrimSpace(req.UntitledURL) == "" {
		return apperr.NewBadRequest("untitled_url is required")
	}

	h.sendUntitledImportProgress(int64(userID), "reading_link", 0, 0, "")

	project, err := h.resolveEditableProject(r.Context(), req.ProjectID, int64(userID))
	if err != nil {
		return err
	}

	source, err := fetchUntitledImportSource(r.Context(), req.UntitledURL)
	if err != nil {
		return apperr.NewBadRequest(err.Error())
	}
	if len(source.Tracks) == 0 {
		return apperr.NewBadRequest("no importable tracks found at that untitled URL")
	}

	h.sendUntitledImportProgress(int64(userID), "preparing_import", 0, len(source.Tracks), source.SourceTitle)

	importedRows, failedRows := h.importUntitledTracksIntoProject(r.Context(), int64(userID), project, source)

	if len(importedRows) == 0 {
		return apperr.NewInternal("failed to import tracks from untitled", fmt.Errorf("all %d imports failed", len(source.Tracks)))
	}

	h.sendUntitledImportProgress(int64(userID), "completed", len(source.Tracks), len(source.Tracks), source.SourceTitle)

	return httputil.OKResult(w, importUntitledResponse{
		SourceType:   source.SourceType,
		SourceTitle:  source.SourceTitle,
		Imported:     len(importedRows),
		Failed:       len(failedRows),
		ImportedRows: importedRows,
		FailedRows:   failedRows,
	})
}

func (h *TracksHandler) ImportUntitledAsProject(w http.ResponseWriter, r *http.Request) error {
	userID, err := httputil.RequireUserID(r)
	if err != nil {
		return apperr.NewUnauthorized("user not found in context")
	}

	req, err := httputil.DecodeJSON[importUntitledProjectRequest](r)
	if err != nil {
		return apperr.NewBadRequest("invalid request body")
	}
	if strings.TrimSpace(req.UntitledURL) == "" {
		return apperr.NewBadRequest("untitled_url is required")
	}

	h.sendUntitledImportProgress(int64(userID), "reading_link", 0, 0, "")

	source, err := fetchUntitledImportSource(r.Context(), req.UntitledURL)
	if err != nil {
		return apperr.NewBadRequest(err.Error())
	}
	if len(source.Tracks) == 0 {
		return apperr.NewBadRequest("no importable tracks found at that untitled URL")
	}

	h.sendUntitledImportProgress(int64(userID), "creating_project", 0, len(source.Tracks), source.SourceTitle)

	projectService := service.NewProjectService(h.db, h.storage, nil)
	project, err := projectService.CreateProject(r.Context(), service.CreateProjectInput{
		UserID:         int64(userID),
		Name:           firstNonEmpty(source.SourceTitle, "Untitled Project"),
		AuthorOverride: stringPointer(source.OwnerName),
		FolderID:       req.FolderID,
	})
	if err != nil {
		if err.Error() == "project name is required" || err.Error() == "invalid quality override value" {
			return apperr.NewBadRequest(err.Error())
		}
		return apperr.NewInternal("failed to create project", err)
	}

	if coverURL := strings.TrimSpace(source.CoverURL); coverURL != "" {
		h.sendUntitledImportProgress(int64(userID), "importing_cover", 0, len(source.Tracks), source.SourceTitle)
		if coverReader, filename, coverErr := fetchUntitledCover(r.Context(), coverURL); coverErr == nil {
			if _, uploadErr := projectService.UploadCover(r.Context(), service.UploadCoverInput{
				UserID:   int64(userID),
				PublicID: project.PublicID,
				Filename: filename,
				Reader:   coverReader,
			}); uploadErr == nil {
				updatedProject, getErr := projectService.GetProject(r.Context(), project.PublicID, int64(userID))
				if getErr == nil {
					project = updatedProject
				}
			}
			coverReader.Close()
		}
	}

	importedRows, failedRows := h.importUntitledTracksIntoProject(r.Context(), int64(userID), project, source)
	if len(importedRows) == 0 {
		return apperr.NewInternal("failed to import tracks from untitled", fmt.Errorf("all %d imports failed", len(source.Tracks)))
	}

	h.sendUntitledImportProgress(int64(userID), "completed", len(source.Tracks), len(source.Tracks), source.SourceTitle)

	return httputil.CreatedResult(w, importUntitledProjectResponse{
		Project:      shared.ConvertProject(project),
		SourceType:   source.SourceType,
		SourceTitle:  source.SourceTitle,
		Imported:     len(importedRows),
		Failed:       len(failedRows),
		ImportedRows: importedRows,
		FailedRows:   failedRows,
	})
}

func fetchUntitledImportSource(ctx context.Context, rawURL string) (*untitledImportSource, error) {
	normalized, err := normalizeUntitledURL(rawURL)
	if err != nil {
		return nil, err
	}

	html, err := fetchUntitledHTML(ctx, normalized.String())
	if err != nil {
		return nil, err
	}

	remixJSON, err := extractRemixContextJSON(html)
	if err != nil {
		return nil, err
	}

	var remix untitledRemixContext
	if err := json.Unmarshal(remixJSON, &remix); err != nil {
		return nil, fmt.Errorf("failed to parse untitled page state")
	}

	switch {
	case strings.Contains(normalized.Path, "/library/project/"):
		raw, ok := remix.State.LoaderData[untitledProjectRoute]
		if !ok {
			return nil, fmt.Errorf("could not find untitled project data on that page")
		}
		var data untitledProjectRouteData
		if err := json.Unmarshal(raw, &data); err != nil {
			return nil, fmt.Errorf("failed to decode untitled project data")
		}
		return &untitledImportSource{
			SourceType:  "project",
			SourceTitle: firstNonEmpty(data.Project.Project.Title, "Untitled Project"),
			OwnerName:   firstNonEmpty(valueOrEmpty(data.Project.Project.ArtistName), data.Project.Project.Username),
			CoverURL: firstNonEmpty(
				data.Project.Project.ArtworkSignedURL,
				data.Project.Project.ArtworkSmallSignedURL,
				data.Project.Project.ArtworkURL,
			),
			Tracks: data.Project.Tracks,
		}, nil
	case strings.Contains(normalized.Path, "/library/track/"):
		raw, ok := remix.State.LoaderData[untitledTrackRoute]
		if !ok {
			return nil, fmt.Errorf("could not find untitled track data on that page")
		}
		var data untitledTrackRouteData
		if err := json.Unmarshal(raw, &data); err != nil {
			return nil, fmt.Errorf("failed to decode untitled track data")
		}
		return &untitledImportSource{
			SourceType:  "track",
			SourceTitle: firstNonEmpty(data.Track.Title, "Untitled Track"),
			OwnerName:   data.Track.Username,
			Tracks:      []untitledTrack{data.Track},
		}, nil
	default:
		return nil, fmt.Errorf("unsupported untitled URL: only public track and project links are supported")
	}
}

func normalizeUntitledURL(raw string) (*url.URL, error) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return nil, fmt.Errorf("untitled URL is required")
	}
	if !strings.Contains(trimmed, "://") {
		trimmed = "https://" + trimmed
	}

	parsed, err := url.Parse(trimmed)
	if err != nil {
		return nil, fmt.Errorf("invalid untitled URL")
	}
	if !strings.EqualFold(parsed.Hostname(), untitledHost) {
		return nil, fmt.Errorf("only untitled.stream URLs are supported")
	}
	return parsed, nil
}

func fetchUntitledHTML(ctx context.Context, rawURL string) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")
	req.Header.Set("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")
	req.Header.Set("Accept-Language", "en-US,en;q=0.5")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to load untitled page")
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("untitled page returned %s", resp.Status)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read untitled page")
	}
	return body, nil
}

func extractRemixContextJSON(html []byte) ([]byte, error) {
	marker := []byte("window.__remixContext = ")
	start := bytes.Index(html, marker)
	if start == -1 {
		return nil, fmt.Errorf("untitled page did not include remix state")
	}

	remaining := html[start+len(marker):]
	end := bytes.Index(remaining, []byte("</script>"))
	if end == -1 {
		return nil, fmt.Errorf("untitled remix state was incomplete")
	}

	payload := bytes.TrimSpace(remaining[:end])
	payload = bytes.TrimSuffix(payload, []byte(";"))
	return payload, nil
}

func fetchUntitledAudio(ctx context.Context, track untitledTrack) (io.ReadCloser, error) {
	audioURL := strings.TrimSpace(track.AudioURL)
	if audioURL == "" {
		audioURL = strings.TrimSpace(track.AudioFallbackURL)
	}
	if audioURL == "" {
		return nil, fmt.Errorf("track %q has no audio URL", track.Title)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, audioURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("apikey", untitledAnonKey)
	req.Header.Set("Authorization", "Bearer "+untitledAnonKey)
	req.Header.Set("User-Agent", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")
	req.Header.Set("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")
	req.Header.Set("Accept-Language", "en-US,en;q=0.5")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		resp.Body.Close()
		return nil, fmt.Errorf("audio download failed with %s", resp.Status)
	}

	return resp.Body, nil
}

func fetchUntitledCover(ctx context.Context, coverURL string) (io.ReadCloser, string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, coverURL, nil)
	if err != nil {
		return nil, "", err
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")
	req.Header.Set("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")
	req.Header.Set("Accept-Language", "en-US,en;q=0.5")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, "", err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		resp.Body.Close()
		return nil, "", fmt.Errorf("cover download failed with %s", resp.Status)
	}

	filename := "cover" + path.Ext(strings.TrimSpace(resp.Request.URL.Path))
	if filename == "cover" {
		filename = "cover.jpg"
	}

	return resp.Body, filename, nil
}

func untitledFilename(track untitledTrack) (string, error) {
	ext := strings.TrimSpace(track.FileType)
	if ext != "" && !strings.HasPrefix(ext, ".") {
		ext = "." + ext
	}
	if ext == "" {
		ext = path.Ext(track.AudioURL)
	}
	if ext == "" {
		ext = path.Ext(track.AudioFallbackURL)
	}
	if ext == "" {
		return "", fmt.Errorf("missing audio file extension")
	}

	base := firstNonEmpty(track.VersionTitle, track.Title, track.Slug, "untitled-track")
	return base + ext, nil
}

func untitledTrackLabel(track untitledTrack) string {
	return firstNonEmpty(track.Title, track.VersionTitle, track.Slug, "Untitled Track")
}

func (h *TracksHandler) importUntitledTracksIntoProject(ctx context.Context, userID int64, project sqlc.Project, source *untitledImportSource) ([]string, []string) {
	importedRows := make([]string, 0, len(source.Tracks))
	failedRows := make([]string, 0)
	totalTracks := len(source.Tracks)

	for index, track := range source.Tracks {
		h.sendUntitledImportProgress(userID, "importing_tracks", index, totalTracks, untitledTrackLabel(track))

		filename, err := untitledFilename(track)
		if err != nil {
			failedRows = append(failedRows, untitledTrackLabel(track))
			h.sendUntitledImportProgress(userID, "importing_tracks", index+1, totalTracks, untitledTrackLabel(track))
			continue
		}

		body, err := fetchUntitledAudio(ctx, track)
		if err != nil {
			failedRows = append(failedRows, untitledTrackLabel(track))
			h.sendUntitledImportProgress(userID, "importing_tracks", index+1, totalTracks, untitledTrackLabel(track))
			continue
		}

		_, createErr := h.createTrackFromReader(ctx, createTrackFromReaderInput{
			ActingUserID: userID,
			Project:      project,
			Title:        track.Title,
			Artist:       track.Username,
			Album:        source.SourceTitle,
			VersionName:  firstNonEmpty(track.VersionTitle, track.Title),
			OriginalName: filename,
			Reader:       body,
		})
		body.Close()
		if createErr != nil {
			failedRows = append(failedRows, untitledTrackLabel(track))
			h.sendUntitledImportProgress(userID, "importing_tracks", index+1, totalTracks, untitledTrackLabel(track))
			continue
		}

		importedRows = append(importedRows, untitledTrackLabel(track))
		h.sendUntitledImportProgress(userID, "importing_tracks", index+1, totalTracks, untitledTrackLabel(track))
	}

	return importedRows, failedRows
}

func (h *TracksHandler) sendUntitledImportProgress(userID int64, stage string, current, total int, filename string) {
	if h.progressSender == nil {
		return
	}
	h.progressSender.SendUntitledImportProgress(userID, stage, current, total, filename)
}

func stringPointer(value string) *string {
	if trimmed := strings.TrimSpace(value); trimmed != "" {
		return &trimmed
	}
	return nil
}

func valueOrEmpty(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if trimmed := strings.TrimSpace(value); trimmed != "" {
			return trimmed
		}
	}
	return ""
}
