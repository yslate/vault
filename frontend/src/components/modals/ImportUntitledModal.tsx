import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { CheckCircle2, Link2, LoaderCircle } from "lucide-react";
import BaseModal from "./BaseModal";
import ModalIcon from "./ModalIcon";
import { Button } from "@/components/ui/button";
import { importUntitled } from "@/api/tracks";
import { importUntitledProject } from "@/api/projects";
import { offWSMessage, onWSMessage } from "@/hooks/useWebSocket";
import type {
  ImportUntitledProjectResponse,
  ImportUntitledResponse,
} from "@/types/api";

interface ImportUntitledModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectId?: string;
  folderId?: number;
  onImported?: (result: ImportUntitledResponse) => void;
  onProjectCreated?: (result: ImportUntitledProjectResponse) => void;
}

interface UntitledImportProgress {
  stage: string;
  current: number;
  total: number;
  filename: string;
}

function stageLabel(stage: string, createsProject: boolean): string {
  switch (stage) {
    case "reading_link":
      return "Reading link";
    case "preparing_import":
      return "Preparing import";
    case "creating_project":
      return createsProject ? "Creating project" : "Preparing project";
    case "importing_cover":
      return "Importing cover";
    case "importing_tracks":
      return "Importing tracks";
    case "completed":
      return "Completed";
    default:
      return createsProject ? "Creating project" : "Importing tracks";
  }
}

function getLinkHint(value: string): string {
  const trimmed = value.trim();
  if (trimmed.includes("/library/project/")) return "Project link detected";
  if (trimmed.includes("/library/track/")) return "Track link detected";
  if (!trimmed) return "Public track and project links are supported";
  return "Paste a public untitled.stream link";
}

export default function ImportUntitledModal({
  isOpen,
  onClose,
  projectId,
  folderId,
  onImported,
  onProjectCreated,
}: ImportUntitledModalProps) {
  const [url, setURL] = useState("");
  const [isImporting, setIsImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<UntitledImportProgress | null>(null);
  const createsProject = !projectId;

  const linkHint = useMemo(() => getLinkHint(url), [url]);
  const progressPercent =
    progress && progress.total > 0
      ? Math.round((progress.current / progress.total) * 100)
      : null;

  useEffect(() => {
    if (!isOpen) {
      setURL("");
      setError(null);
      setIsImporting(false);
      setProgress(null);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isImporting) {
      setProgress(null);
      return;
    }

    const listener = (message: { type: string; payload: unknown }) => {
      if (message.type !== "untitled_import_progress") return;
      setProgress(message.payload as UntitledImportProgress);
    };

    onWSMessage(listener);
    return () => offWSMessage(listener);
  }, [isImporting]);

  const handleImport = async () => {
    const trimmed = url.trim();
    if (!trimmed) {
      setError("Paste an untitled track or project link first.");
      return;
    }

    try {
      setIsImporting(true);
      setError(null);
      if (projectId) {
        const result = await importUntitled({
          project_id: projectId,
          untitled_url: trimmed,
        });
        onImported?.(result);
      } else {
        const result = await importUntitledProject({
          folder_id: folderId,
          untitled_url: trimmed,
        });
        onProjectCreated?.(result);
      }
      onClose();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to import from untitled",
      );
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      disableClose={isImporting}
      maxWidth="lg"
    >
      <div className="p-6 md:p-8">
        <ModalIcon icon={Link2} />

        <h2 className="mb-3 text-center text-2xl font-semibold text-white">
          {createsProject ? "Import Untitled Project" : "Import From Untitled"}
        </h2>

        <p className="mb-6 text-center text-sm leading-relaxed text-muted-foreground">
          {createsProject
            ? "Create a new Vault project from a public untitled track or project link."
            : "Import audio from a public untitled track or project link into this project."}
        </p>

        <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
          <textarea
            value={url}
            onChange={(e) => setURL(e.target.value)}
            placeholder="https://untitled.stream/library/project/..."
            disabled={isImporting}
            className="min-h-24 w-full resize-none bg-transparent text-sm text-white outline-none placeholder:text-muted-foreground disabled:opacity-50"
          />
        </div>

        <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
          <CheckCircle2 className="size-3.5" />
          <span>{linkHint}</span>
        </div>

        <AnimatePresence initial={false} mode="wait">
          {isImporting ? (
            <motion.div
              key="progress"
              initial={{ opacity: 0, height: 0, filter: "blur(4px)" }}
              animate={{ opacity: 1, height: "auto", filter: "blur(0px)" }}
              exit={{ opacity: 0, height: 0, filter: "blur(4px)" }}
              transition={{ type: "spring", bounce: 0, duration: 0.4 }}
              className="overflow-hidden"
            >
              <div className="mt-5 space-y-2">
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>
                    {progress
                      ? stageLabel(progress.stage, createsProject)
                      : createsProject
                        ? "Creating project..."
                        : "Importing tracks..."}
                  </span>
                  {progress && progress.total > 0 && (
                    <span className="tabular-nums">
                      {progress.current} / {progress.total}
                    </span>
                  )}
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-800">
                  {progressPercent !== null ? (
                    <motion.div
                      className="h-full rounded-full bg-white/80"
                      initial={{ width: 0 }}
                      animate={{ width: `${progressPercent}%` }}
                      transition={{ duration: 0.2, ease: "easeOut" }}
                    />
                  ) : (
                    <motion.div
                      className="h-full w-1/3 rounded-full bg-white/80"
                      initial={{ x: "-100%" }}
                      animate={{ x: "400%" }}
                      transition={{ duration: 1.2, repeat: Infinity, ease: "easeInOut" }}
                    />
                  )}
                </div>
                <p className="h-4 truncate text-xs text-muted-foreground">
                  {progress?.filename ?? "\u00A0"}
                </p>
              </div>
            </motion.div>
          ) : error ? (
            <motion.div
              key="error"
              initial={{ opacity: 0, height: 0, filter: "blur(4px)" }}
              animate={{ opacity: 1, height: "auto", filter: "blur(0px)" }}
              exit={{ opacity: 0, height: 0, filter: "blur(4px)" }}
              transition={{ type: "spring", bounce: 0, duration: 0.4 }}
              className="overflow-hidden"
            >
              <div className="mt-5 rounded-2xl border border-red-500/25 bg-red-500/10 p-4 text-sm text-red-200">
                {error}
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="hint"
              initial={{ opacity: 0, height: 0, filter: "blur(4px)" }}
              animate={{ opacity: 1, height: "auto", filter: "blur(0px)" }}
              exit={{ opacity: 0, height: 0, filter: "blur(4px)" }}
              transition={{ type: "spring", bounce: 0, duration: 0.4 }}
              className="overflow-hidden"
            >
              <div className="mt-5 rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-muted-foreground">
                {createsProject
                  ? "Vault will try to import the project name, cover art, and tracks when available."
                  : "Imported files will be added to the current Vault project."}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="mt-6 flex flex-col gap-3">
          <Button
            onClick={handleImport}
            disabled={isImporting}
            className="w-full"
            haptic="medium"
          >
            {isImporting ? (
              <>
                <LoaderCircle className="size-4 animate-spin" />
                {createsProject ? "Creating..." : "Importing..."}
              </>
            ) : createsProject ? (
              "Create Project"
            ) : (
              "Import"
            )}
          </Button>
          <Button
            onClick={onClose}
            disabled={isImporting}
            variant="outline"
            className="w-full"
          >
            Cancel
          </Button>
        </div>
      </div>
    </BaseModal>
  );
}
