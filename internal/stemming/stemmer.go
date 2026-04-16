package stemming

import (
	"context"
	"database/sql"
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"sync"

	"bungleware/vault/internal/db"
	sqlc "bungleware/vault/internal/db/sqlc"
)

var StemTypes = []string{"vocals", "drums", "bass", "other"}

type Job struct {
	StemJobID     int64
	VersionID     int64
	TrackPublicID string
	UserID        int64
	SourcePath    string
	OutputDir     string
}

type StemNotifier interface {
	NotifyStemUpdate(userID int64, trackPublicID string, versionID int64, status string)
}

type StemSplitter struct {
	db       *db.DB
	queue    chan Job
	workers  int
	wg       sync.WaitGroup
	ctx      context.Context
	cancel   context.CancelFunc
	notifier StemNotifier
}

func NewStemSplitter(database *db.DB, workers int) *StemSplitter {
	ctx, cancel := context.WithCancel(context.Background())
	return &StemSplitter{
		db:      database,
		queue:   make(chan Job, 50),
		workers: workers,
		ctx:     ctx,
		cancel:  cancel,
	}
}

func (s *StemSplitter) SetNotifier(n StemNotifier) {
	s.notifier = n
}

func (s *StemSplitter) Start() {
	log.Printf("Starting %d stem splitting workers", s.workers)
	for i := 0; i < s.workers; i++ {
		s.wg.Add(1)
		go s.worker(i)
	}
}

func (s *StemSplitter) Stop() {
	log.Println("Stopping stem splitting workers...")
	s.cancel()
	close(s.queue)
	s.wg.Wait()
	log.Println("All stem splitting workers stopped")
}

func (s *StemSplitter) QueueJob(job Job) {
	select {
	case s.queue <- job:
		log.Printf("Queued stem splitting job for version %d", job.VersionID)
	case <-s.ctx.Done():
		log.Println("Cannot queue stem job: splitter is shutting down")
	}
}

func (s *StemSplitter) worker(id int) {
	defer s.wg.Done()
	log.Printf("Stem worker %d started", id)

	for {
		select {
		case job, ok := <-s.queue:
			if !ok {
				log.Printf("Stem worker %d: queue closed, exiting", id)
				return
			}
			log.Printf("Stem worker %d: processing job for version %d", id, job.VersionID)
			s.processJob(job)
		case <-s.ctx.Done():
			log.Printf("Stem worker %d: context cancelled, exiting", id)
			return
		}
	}
}

func (s *StemSplitter) processJob(job Job) {
	ctx := context.Background()

	// Update status to processing
	if err := s.db.UpdateStemJobStatus(ctx, sqlc.UpdateStemJobStatusParams{
		Status: "processing",
		ID:     job.StemJobID,
	}); err != nil {
		log.Printf("Failed to update stem job status to processing: %v", err)
		return
	}

	s.notify(job, "processing")

	// Run demucs
	err := s.runDemucs(job.SourcePath, job.OutputDir)
	if err != nil {
		log.Printf("Stem splitting failed for version %d: %v", job.VersionID, err)
		s.db.UpdateStemJobError(ctx, sqlc.UpdateStemJobErrorParams{
			ErrorMessage: sql.NullString{String: err.Error(), Valid: true},
			ID:           job.StemJobID,
		})
		s.notify(job, "failed")
		return
	}

	// Register each stem file in the database
	for _, stemType := range StemTypes {
		stemPath := filepath.Join(job.OutputDir, stemType+".wav")

		stat, err := os.Stat(stemPath)
		if err != nil {
			log.Printf("Stem file not found for %s (version %d): %v", stemType, job.VersionID, err)
			continue
		}

		quality := "stem_" + stemType
		if _, err := s.db.CreateTrackFile(ctx, sqlc.CreateTrackFileParams{
			VersionID:         job.VersionID,
			Quality:           quality,
			FilePath:          stemPath,
			FileSize:          stat.Size(),
			Format:            "wav",
			Bitrate:           sql.NullInt64{},
			ContentHash:       sql.NullString{},
			TranscodingStatus: sql.NullString{String: "completed", Valid: true},
			OriginalFilename:  sql.NullString{String: stemType + ".wav", Valid: true},
		}); err != nil {
			log.Printf("Failed to create track file for stem %s: %v", stemType, err)
		}
	}

	// Update job status to completed
	if err := s.db.UpdateStemJobStatus(ctx, sqlc.UpdateStemJobStatusParams{
		Status: "completed",
		ID:     job.StemJobID,
	}); err != nil {
		log.Printf("Failed to update stem job status to completed: %v", err)
		return
	}

	s.notify(job, "completed")
	log.Printf("Successfully split stems for version %d", job.VersionID)
}

func (s *StemSplitter) notify(job Job, status string) {
	if s.notifier != nil {
		s.notifier.NotifyStemUpdate(job.UserID, job.TrackPublicID, job.VersionID, status)
	}
}

func (s *StemSplitter) runDemucs(inputPath, outputDir string) error {
	if err := os.MkdirAll(outputDir, 0755); err != nil {
		return fmt.Errorf("failed to create stems output directory: %w", err)
	}

	// Use demucs with htdemucs model (best quality), output as float32 WAV stems
	// --segment limits peak RAM to ~2GB (default is full track which needs 4-6GB)
	// --two-stems is NOT used so we get all 4 stems: vocals, drums, bass, other
	cmd := exec.Command(
		"demucs",
		"-n", "htdemucs",
		"-o", outputDir,
		"--filename", "{stem}.{ext}",
		"--float32",
		"--segment", "25",
		inputPath,
	)

	output, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("demucs failed: %w, output: %s", err, string(output))
	}

	// demucs outputs to: {outputDir}/htdemucs/{stem}.wav
	// Move files up to outputDir for cleaner paths
	demucsDir := filepath.Join(outputDir, "htdemucs")
	entries, err := os.ReadDir(demucsDir)
	if err != nil {
		return fmt.Errorf("failed to read demucs output directory: %w", err)
	}

	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		src := filepath.Join(demucsDir, entry.Name())
		dst := filepath.Join(outputDir, entry.Name())
		if err := os.Rename(src, dst); err != nil {
			return fmt.Errorf("failed to move stem file %s: %w", entry.Name(), err)
		}
	}

	// Clean up the nested directory
	os.RemoveAll(demucsDir)

	return nil
}

type SplitStemsInput struct {
	VersionID      int64
	SourceFilePath string
	TrackPublicID  string
	UserID         int64
}

func (s *StemSplitter) SplitStems(ctx context.Context, input SplitStemsInput) error {
	// Clean up any previous stem job/files for this version
	s.db.DeleteStemFilesByVersion(ctx, input.VersionID)
	s.db.DeleteStemJobsByVersion(ctx, input.VersionID)

	stemJob, err := s.db.CreateStemJob(ctx, sqlc.CreateStemJobParams{
		VersionID:     input.VersionID,
		UserID:        input.UserID,
		TrackPublicID: input.TrackPublicID,
	})
	if err != nil {
		return fmt.Errorf("failed to create stem job: %w", err)
	}

	stemsDir := filepath.Join(filepath.Dir(input.SourceFilePath), "stems")

	s.QueueJob(Job{
		StemJobID:     stemJob.ID,
		VersionID:     input.VersionID,
		TrackPublicID: input.TrackPublicID,
		UserID:        input.UserID,
		SourcePath:    input.SourceFilePath,
		OutputDir:     stemsDir,
	})

	return nil
}

// IsAvailable checks if demucs is installed
func IsAvailable() bool {
	_, err := exec.LookPath("demucs")
	return err == nil
}
