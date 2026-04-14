const STORAGE_KEY = "vault_last_played_item";

export interface LastPlayedItem {
  projectId: string;
  folderId: number | null;
  playedAt: number;
}

export function setLastPlayed(projectId: string, folderId: number | null) {
  try {
    const value: LastPlayedItem = {
      projectId,
      folderId,
      playedAt: Date.now(),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {}
}

export function getLastPlayed(): LastPlayedItem | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (typeof parsed?.projectId !== "string") return null;
    return {
      projectId: parsed.projectId,
      folderId: typeof parsed.folderId === "number" ? parsed.folderId : null,
      playedAt: typeof parsed.playedAt === "number" ? parsed.playedAt : 0,
    };
  } catch {
    return null;
  }
}
