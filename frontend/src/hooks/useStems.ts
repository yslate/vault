import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getStems, splitStems } from '@/api/stems'
import type { StemsResponse } from '@/api/stems'

export const stemKeys = {
  all: ['stems'] as const,
  detail: (trackId: string) => ['stems', trackId] as const,
}

export function useStems(trackId: string | undefined, enabled: boolean = true) {
  return useQuery<StemsResponse>({
    queryKey: stemKeys.detail(trackId ?? ''),
    queryFn: () => getStems(trackId!),
    enabled: enabled && !!trackId,
    refetchInterval: (query) => {
      const data = query.state.data
      if (data && (data.status === 'pending' || data.status === 'processing')) {
        return 3000
      }
      return false
    },
  })
}

export function useSplitStems() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (trackId: string) => splitStems(trackId),
    onSuccess: (_data, trackId) => {
      queryClient.invalidateQueries({ queryKey: stemKeys.detail(trackId) })
    },
  })
}
