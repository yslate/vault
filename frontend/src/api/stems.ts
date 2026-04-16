import { get, post } from './client'
import { env } from '../env'

const API_BASE_URL = env.VITE_API_URL || ''

export interface StemFile {
  id: number
  stem_type: string
  file_size: number
  format: string
}

export interface StemsResponse {
  status: 'none' | 'pending' | 'processing' | 'completed' | 'failed'
  error: string | null
  stems: StemFile[]
}

export interface SplitStemsResponse {
  status: string
  message: string
}

export async function splitStems(trackId: string): Promise<SplitStemsResponse> {
  return post<SplitStemsResponse>(`/api/tracks/${trackId}/split-stems`, {})
}

export async function getStems(trackId: string): Promise<StemsResponse> {
  return get<StemsResponse>(`/api/tracks/${trackId}/stems`)
}

export function getStemStreamUrl(stemFileId: number): string {
  return `${API_BASE_URL}/api/stems/${stemFileId}/stream`
}

export function getStemDownloadUrl(stemFileId: number): string {
  return `${API_BASE_URL}/api/stems/${stemFileId}/download`
}
