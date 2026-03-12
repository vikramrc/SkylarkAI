import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import apiService from './api.service';
import type { Conversation, ListConversationsResponse } from '@/types';

const keys = {
  list: (page = 1, pageSize = 20) => ['conversations', { page, pageSize }] as const,
};

export function useConversations(page = 1, pageSize = 20) {
  return useQuery({
    queryKey: keys.list(page, pageSize),
    queryFn: async () => {
      const res = await apiService['client'].get('/phoenix/conversations', { params: { page, pageSize } });
      return res.data as ListConversationsResponse;
    },
    refetchOnWindowFocus: true,
    staleTime: 0,
  });
}

export function useTogglePin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ conversationId, pinned }: { conversationId: string; pinned: boolean }) => {
      await apiService['client'].patch(`/phoenix/conversations/${conversationId}/pin`, { pinned });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['conversations'] }); },
  });
}

