import { CheckCircle2, X } from "lucide-react";

interface UntitledImportToastProps {
  id: string | number;
  title: string;
  description: string;
  imported: number;
  failed?: number;
  onClose: (id?: string | number) => void;
  action?: {
    label: string;
    onClick: () => void;
  };
}

export default function UntitledImportToast({
  id,
  title,
  description,
  imported,
  failed = 0,
  onClose,
  action,
}: UntitledImportToastProps) {
  return (
    <div
      className="group relative overflow-hidden rounded-(--button-radius) border border-(--button-border) bg-background p-4 shadow-lg"
      style={{ minWidth: "280px", maxWidth: "420px" }}
    >
      <button
        onClick={() => onClose(id)}
        className="absolute right-3 top-3 flex h-6 w-6 items-center justify-center rounded-full text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100"
        aria-label="Close"
      >
        <X className="size-3.5" />
      </button>

      <div className="flex items-start gap-3 pr-6">
        <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/6">
          <CheckCircle2 className="size-4 text-white" />
        </div>

        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-foreground">{title}</p>
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
          <p className="mt-2 text-xs text-muted-foreground">
            {imported} imported{failed > 0 ? `, ${failed} skipped` : ""}
          </p>
        </div>
      </div>

      {action && (
        <div className="mt-3 flex justify-end">
          <button
            onClick={() => {
              action.onClick();
              onClose(id);
            }}
            className="text-xs font-medium text-foreground/90 transition-opacity hover:opacity-70"
          >
            {action.label}
          </button>
        </div>
      )}
    </div>
  );
}
