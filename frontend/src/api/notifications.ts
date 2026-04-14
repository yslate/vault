import { get, put, del } from './client'
import type { NotificationsResponse, TrackStats, ProjectStreamStats } from '../types/api'

export async function getNotifications(): Promise<NotificationsResponse> {
  return get<NotificationsResponse>('/api/notifications')
}

export async function markAllNotificationsRead(): Promise<void> {
  return put<void>('/api/notifications/read-all')
}

export async function deleteNotification(id: number): Promise<void> {
  return del<void>(`/api/notifications/${id}`)
}

export async function getTrackStreamStats(trackPublicId: string): Promise<TrackStats> {
  return get<TrackStats>(`/api/tracks/${trackPublicId}/stream-stats`)
}

export async function getProjectStreamStats(projectPublicId: string): Promise<ProjectStreamStats> {
  return get<ProjectStreamStats>(`/api/projects/${projectPublicId}/stream-stats`)
}
