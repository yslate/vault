import { useRef, useState, useEffect } from "react";
import { BellIcon, XIcon } from "lucide-react";
import { Button } from "./ui/button";
import {
  useNotifications,
  useMarkAllNotificationsRead,
  useDeleteNotification,
} from "@/hooks/useNotifications";
import { useQueryClient } from "@tanstack/react-query";
import { notificationKeys } from "@/hooks/useNotifications";
import { onWSMessage, offWSMessage } from "@/hooks/useWebSocket";
import type { ListenEvent } from "@/types/api";

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return "";
  const date = new Date(dateStr);
  const now = new Date();
  const diff = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export default function NotificationCenter() {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const queryClient = useQueryClient();

  const { data } = useNotifications(true);
  const markAllRead = useMarkAllNotificationsRead();
  const deleteNotif = useDeleteNotification();

  const unreadCount = data?.unread_count ?? 0;

  // Listen for live WS events and refresh
  useEffect(() => {
    const handler = (msg: { type: string; payload: unknown }) => {
      if (msg.type === "listen_event") {
        queryClient.invalidateQueries({ queryKey: notificationKeys.all });
      }
    };
    onWSMessage(handler);
    return () => offWSMessage(handler);
  }, [queryClient]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (
        panelRef.current &&
        !panelRef.current.contains(e.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  const handleOpen = () => {
    setOpen((prev) => !prev);
  };

  const handleMarkAllRead = () => {
    markAllRead.mutate(undefined);
  };

  const handleDelete = (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    deleteNotif.mutate(id);
  };

  const events: ListenEvent[] = data?.events ?? [];

  return (
    <div className="relative">
      <Button
        ref={buttonRef}
        variant="default"
        size="icon-lg"
        haptic="light"
        onClick={handleOpen}
        className="relative"
        aria-label="Notifications"
      >
        <BellIcon
          fill={unreadCount > 0 ? "white" : "none"}
          className="size-4.5"
        />
        {unreadCount > 0 && (
          <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-blue-500 border border-background" />
        )}
      </Button>

      {open && (
        <div
          ref={panelRef}
          className="absolute right-0 top-full mt-2 w-80 rounded-[var(--button-radius)] bg-background border border-[var(--button-border)] shadow-xl z-50 overflow-hidden"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--button-border)]">
            <span className="text-sm font-semibold text-foreground">
              Notifications
            </span>
            {unreadCount > 0 && (
              <button
                onClick={handleMarkAllRead}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                Mark all read
              </button>
            )}
          </div>

          {/* List */}
          <div className="max-h-96 overflow-y-auto">
            {events.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                No notifications yet
              </div>
            ) : (
              events.map((event) => (
                <div
                  key={event.id}
                  className={`group flex items-start gap-3 px-4 py-3 border-b border-[var(--button-border)] last:border-b-0 ${
                    !event.read ? "bg-foreground/[0.03]" : ""
                  }`}
                >
                  {/* Unread dot */}
                  <div className="mt-1.5 shrink-0">
                    {!event.read ? (
                      <span className="w-2 h-2 rounded-full bg-blue-500 block" />
                    ) : (
                      <span className="w-2 h-2 rounded-full bg-transparent block" />
                    )}
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-foreground leading-snug">
                      <span className="font-medium">
                        {event.played_by_username}
                      </span>{" "}
                      {event.event_type === "download" ? "downloaded" : "listened to"}{" "}
                      <span className="font-medium">
                        &ldquo;{event.track_title}&rdquo;
                      </span>
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {timeAgo(event.played_at)}
                    </p>
                  </div>

                  {/* Delete */}
                  <button
                    onClick={(e) => handleDelete(event.id, e)}
                    className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0 mt-0.5 text-muted-foreground hover:text-foreground"
                    aria-label="Dismiss"
                  >
                    <XIcon className="size-3.5" />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
