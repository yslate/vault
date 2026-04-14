import { get, post, put, del, getCSRFToken } from './client'
import type {
  Track,
  TrackWithShareInfo,
  CreateTrackRequest,
  UpdateTrackRequest,
  ImportUntitledRequest,
  ImportUntitledResponse,
} from '../types/api'
import { env } from '../env'

const API_BASE_URL = env.VITE_API_URL || ''

export async function getTracks(projectId?: number): Promise<Track[]> {
  const endpoint = projectId
    ? `/api/tracks?project_id=${projectId}`
    : '/api/tracks'
  return get<Track[]>(endpoint)
}

export async function searchTracks(query?: string, limit?: number): Promise<Track[]> {
  const params = new URLSearchParams()
  if (query) params.append('q', query)
  if (limit) params.append('limit', limit.toString())
  const endpoint = params.toString() ? `/api/tracks/search?${params}` : '/api/tracks/search'
  return get<Track[]>(endpoint)
}

export async function getTrack(id: string): Promise<TrackWithShareInfo> {
  return get<TrackWithShareInfo>(`/api/tracks/${id}`)
}

export async function createTrack(data: CreateTrackRequest): Promise<Track> {
  return post<Track>('/api/tracks', data)
}

export async function updateTrack(
  id: string,
  data: UpdateTrackRequest
): Promise<Track> {
  return put<Track>(`/api/tracks/${id}`, data)
}

export async function deleteTrack(id: string): Promise<void> {
  return del<void>(`/api/tracks/${id}`)
}

export async function uploadTrack(
  file: File,
  projectId: number,
  metadata?: {
    title?: string
    artist?: string
    album?: string
  },
  onProgress?: (percent: number) => void
): Promise<Track> {
  return new Promise((resolve, reject) => {
    const formData = new FormData()
    formData.append('file', file)
    formData.append('project_id', String(projectId))

    if (metadata?.title) formData.append('title', metadata.title)
    if (metadata?.artist) formData.append('artist', metadata.artist)
    if (metadata?.album) formData.append('album', metadata.album)

    const xhr = new XMLHttpRequest()

    if (onProgress) {
      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) {
          onProgress(Math.round((e.loaded / e.total) * 100))
        }
      })
    }

    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText))
        } catch {
          reject(new Error('Invalid response'))
        }
      } else {
        try {
          const err = JSON.parse(xhr.responseText)
          reject(new Error(err.error || 'Upload failed'))
        } catch {
          reject(new Error('Upload failed'))
        }
      }
    })

    xhr.addEventListener('error', () => reject(new Error('Upload failed')))
    xhr.addEventListener('abort', () => reject(new Error('Upload cancelled')))

    xhr.open('POST', `${API_BASE_URL}/api/library/upload`)
    xhr.withCredentials = true
    const csrf = getCSRFToken()
    if (csrf) xhr.setRequestHeader('X-CSRF-Token', csrf)
    xhr.send(formData)
  })
}

export async function importUntitled(
  data: ImportUntitledRequest
): Promise<ImportUntitledResponse> {
  return post<ImportUntitledResponse>('/api/tracks/import/untitled', data)
}

export async function reorderTracks(
  trackOrders: Array<{ id: number; order: number }>
): Promise<void> {
  return post<void>('/api/tracks/reorder', { track_orders: trackOrders })
}

export async function downloadTrack(trackId: string, versionId: number): Promise<void> {
	const response = await fetch(`${API_BASE_URL}/api/tracks/${trackId}/versions/${versionId}/download`, {
		method: 'GET',
		credentials: 'include',
	})

  if (!response.ok) {
    throw new Error('Failed to download track')
  }

  const contentDisposition = response.headers.get('Content-Disposition')
  let filename = 'track.mp3'
  if (contentDisposition) {
    const filenameMatch = contentDisposition.match(/filename="([^"]+)"|filename=([^;]+)/i)
    if (filenameMatch) {
      filename = (filenameMatch[1] || filenameMatch[2]).trim()
    }
  }

  const blob = await response.blob()

  const url = window.URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()

  window.URL.revokeObjectURL(url)
  document.body.removeChild(a)
}

export async function duplicateTrack(trackId: string): Promise<Track> {
  return post<Track>(`/api/tracks/${trackId}/duplicate`, {})
}

export async function moveTrack(trackId: string, projectId: number): Promise<Track> {
  return updateTrack(trackId, { project_id: projectId })
}

export async function updateTrackNotes(trackId: string, notes: string, authorName?: string): Promise<Track> {
  return updateTrack(trackId, { notes, notes_author_name: authorName })
}
