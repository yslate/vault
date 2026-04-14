import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import * as notificationsApi from '../api/notifications'

export const notificationKeys = {
  all: ['notifications'] as const,
  trackStats: (id: string) => ['track-stream-stats', id] as const,
  projectStats: (id: string) => ['project-stream-stats', id] as const,
}

export function useNotifications(enabled: boolean = true) {
  return useQuery({
    queryKey: notificationKeys.all,
    queryFn: notificationsApi.getNotifications,
    enabled,
    refetchInterval: 60_000,
  })
}

export function useMarkAllNotificationsRead() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: notificationsApi.markAllNotificationsRead,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: notificationKeys.all })
    },
  })
}

export function useTrackStreamStats(trackPublicId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: notificationKeys.trackStats(trackPublicId ?? ''),
    queryFn: () => notificationsApi.getTrackStreamStats(trackPublicId!),
    enabled: enabled && !!trackPublicId,
    staleTime: 30_000,
  })
}

export function useProjectStreamStats(projectPublicId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: notificationKeys.projectStats(projectPublicId ?? ''),
    queryFn: () => notificationsApi.getProjectStreamStats(projectPublicId!),
    enabled: enabled && !!projectPublicId,
    staleTime: 30_000,
  })
}

export function useDeleteNotification() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: notificationsApi.deleteNotification,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: notificationKeys.all })
    },
  })
}
