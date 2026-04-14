import { motion } from "motion/react";
import { Upload, X } from "lucide-react";

interface UploadProgressToastProps {
  id: string | number;
  fileCount: number;
  currentFileIndex: number;
  currentFileName: string;
  currentFileProgress: number;
  onClose: (id: string | number) => void;
}

export default function UploadProgressToast({
  id,
  fileCount,
  currentFileIndex,
  currentFileName,
  currentFileProgress,
  onClose,
}: UploadProgressToastProps) {
  const overallProgress =
    fileCount > 1
      ? Math.round(((currentFileIndex + currentFileProgress / 100) / fileCount) * 100)
      : currentFileProgress;

  const displayName =
    currentFileName.length > 32
      ? currentFileName.slice(0, 29) + "…"
      : currentFileName;

  return (
    <div
      className="group relative overflow-hidden rounded-(--button-radius) border border-(--button-border) bg-background p-4 shadow-lg"
      style={{ minWidth: "280px", maxWidth: "420px" }}
    >
      <button
        onClick={() => onClose(id)}
        className="absolute right-3 top-3 flex h-6 w-6 items-center justify-center rounded-full text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100"
        aria-label="Dismiss"
      >
        <X className="size-3.5" />
      </button>

      <div className="flex items-start gap-3 pr-6">
        <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/6">
          <Upload className="size-4 text-white" />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-sm font-medium text-foreground">
              {fileCount > 1 ? "Uploading tracks" : "Uploading track"}
            </p>
            {fileCount > 1 && (
              <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                {currentFileIndex + 1} / {fileCount}
              </span>
            )}
          </div>

          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {displayName}
          </p>

          <div className="mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
            <motion.div
              className="h-full rounded-full bg-white/70"
              initial={{ width: 0 }}
              animate={{ width: `${overallProgress}%` }}
              transition={{ duration: 0.15, ease: "easeOut" }}
            />
          </div>

          <p className="mt-1 text-right text-xs tabular-nums text-muted-foreground">
            {overallProgress}%
          </p>
        </div>
      </div>
    </div>
  );
}
