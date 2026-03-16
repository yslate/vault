import { put } from './client'
import type {
  OrganizeItemRequest,
  SharedProjectOrganization,
  SharedTrackOrganization,
} from '../types/api'


export async function organizeSharedProject(
  projectId: number,
  data: OrganizeItemRequest
): Promise<SharedProjectOrganization> {
  return put<SharedProjectOrganization>(`/api/shared-projects/${projectId}/organize`, data)
}

export async function organizeSharedTrack(
  trackId: number,
  data: OrganizeItemRequest
): Promise<SharedTrackOrganization> {
  return put<SharedTrackOrganization>(`/api/shared-tracks/${trackId}/organize`, data)
}

