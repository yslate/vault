import { ChevronLeft, Play, Square, Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import BaseModal from "./BaseModal";
import { useStems, useSplitStems } from "@/hooks/useStems";
import { getStemStreamUrl, getStemDownloadUrl } from "@/api/stems";
import { toast } from "@/routes/__root";
import { useState, useRef, useCallback } from "react";
import { cn } from "@/lib/utils";

interface StemsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onBack: () => void;
  trackId: string;
  trackTitle: string;
}

const STEM_LABELS: Record<string, string> = {
  vocals: "Vocals",
  drums: "Drums",
  bass: "Bass",
  other: "Other",
};

const STEM_COLORS: Record<string, string> = {
  vocals: "#a78bfa",
  drums: "#f87171",
  bass: "#34d399",
  other: "#fbbf24",
};

export default function StemsModal({
  isOpen,
  onClose,
  onBack,
  trackId,
  trackTitle,
}: StemsModalProps) {
  const { data: stemsData, isLoading } = useStems(trackId, isOpen);
  const splitMutation = useSplitStems();
  const [playingStemId, setPlayingStemId] = useState<number | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const handleSplit = useCallback(async () => {
    try {
      await splitMutation.mutateAsync(trackId);
      toast.success("Stem splitting started");
    } catch {
      toast.error("Failed to start stem splitting");
    }
  }, [trackId, splitMutation]);

  const handlePlay = useCallback((stemId: number) => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }

    if (playingStemId === stemId) {
      setPlayingStemId(null);
      return;
    }

    const audio = new Audio(getStemStreamUrl(stemId));
    audio.crossOrigin = "use-credentials";
    audio.onended = () => setPlayingStemId(null);
    audio.play().catch(() => {
      toast.error("Failed to play stem");
      setPlayingStemId(null);
    });
    audioRef.current = audio;
    setPlayingStemId(stemId);
  }, [playingStemId]);

  const handleDownload = useCallback((stemId: number) => {
    const link = document.createElement("a");
    link.href = getStemDownloadUrl(stemId);
    link.click();
  }, []);

  const isProcessing =
    stemsData?.status === "pending" || stemsData?.status === "processing";
  const hasStems =
    stemsData?.status === "completed" && stemsData.stems.length > 0;
  const hasFailed = stemsData?.status === "failed";
  const hasNone = !stemsData || stemsData.status === "none";

  return (
    <BaseModal isOpen={isOpen} onClose={onClose}>
      <div className="p-6 md:p-8 space-y-6">
        <div className="flex items-center gap-3">
          <Button size="icon-lg" onClick={onBack}>
            <ChevronLeft className="size-5" />
          </Button>
          <div>
            <h2 className="text-xl font-semibold text-white">Stems</h2>
            <p className="text-sm text-muted-foreground truncate max-w-[250px]">
              {trackTitle}
            </p>
          </div>
        </div>

        {isLoading && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {!isLoading && isProcessing && (
          <div className="flex flex-col items-center gap-4 py-8">
            <Loader2 className="size-8 animate-spin text-white" />
            <div className="text-center">
              <p className="text-white font-medium">Splitting stems...</p>
              <p className="text-sm text-muted-foreground mt-1">
                This may take a few minutes depending on the track length
              </p>
            </div>
          </div>
        )}

        {!isLoading && hasFailed && (
          <div className="flex flex-col items-center gap-4 py-8">
            <div className="text-center">
              <p className="text-[#ff5656] font-medium">Stem splitting failed</p>
              {stemsData?.error && (
                <p className="text-sm text-muted-foreground mt-1">
                  {stemsData.error}
                </p>
              )}
            </div>
            <Button onClick={handleSplit} disabled={splitMutation.isPending}>
              {splitMutation.isPending ? "Starting..." : "Try again"}
            </Button>
          </div>
        )}

        {!isLoading && hasNone && (
          <div className="flex flex-col items-center gap-4 py-8">
            <div className="text-center">
              <p className="text-white font-medium">
                Split this track into stems
              </p>
              <p className="text-sm text-muted-foreground mt-1">
                AI will separate vocals, drums, bass, and other instruments
              </p>
            </div>
            <Button onClick={handleSplit} disabled={splitMutation.isPending}>
              {splitMutation.isPending ? "Starting..." : "Split stems"}
            </Button>
          </div>
        )}

        {!isLoading && hasStems && (
          <div className="space-y-2">
            {stemsData!.stems.map((stem) => (
              <div
                key={stem.id}
                className="flex items-center gap-3 px-4 py-3 rounded-2xl border border-white/10 bg-white/5"
              >
                <div
                  className="w-2 h-8 rounded-full shrink-0"
                  style={{
                    backgroundColor: STEM_COLORS[stem.stem_type] ?? "#888",
                  }}
                />
                <div className="flex-1 min-w-0">
                  <p className="text-white font-medium text-sm">
                    {STEM_LABELS[stem.stem_type] ?? stem.stem_type}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {(stem.file_size / (1024 * 1024)).toFixed(1)} MB
                  </p>
                </div>
                <button
                  onClick={() => handlePlay(stem.id)}
                  className={cn(
                    "p-2 rounded-full transition-colors",
                    playingStemId === stem.id
                      ? "bg-white/20 text-white"
                      : "bg-white/5 text-muted-foreground hover:text-white hover:bg-white/10",
                  )}
                >
                  {playingStemId === stem.id ? (
                    <Square className="size-4" />
                  ) : (
                    <Play className="size-4" />
                  )}
                </button>
                <button
                  onClick={() => handleDownload(stem.id)}
                  className="p-2 rounded-full bg-white/5 text-muted-foreground hover:text-white hover:bg-white/10 transition-colors"
                >
                  <Download className="size-4" />
                </button>
              </div>
            ))}

            <div className="pt-2">
              <Button
                onClick={handleSplit}
                disabled={splitMutation.isPending}
                className="w-full"
              >
                {splitMutation.isPending ? "Starting..." : "Re-split stems"}
              </Button>
            </div>
          </div>
        )}
      </div>
    </BaseModal>
  );
}
