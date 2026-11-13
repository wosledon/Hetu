import { QueryClient } from '@tanstack/react-query';

/** 冷启动或短暂断连时持续恢复关键只读数据，失败后无需整页刷新。 */
export const recoverableQueryOptions = {
  retry: 4,
  retryDelay: (attempt: number) => Math.min(1000 * 2 ** attempt, 5000),
  refetchOnMount: 'always',
  refetchOnWindowFocus: true,
  refetchOnReconnect: true,
  refetchInterval: (query: { state: { status: 'pending' | 'error' | 'success' } }) =>
    query.state.status === 'error' ? 5000 : false,
} as const;

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 30,
      refetchOnWindowFocus: false,
      // 缓存 10 分钟后回收，避免长期停留占用内存
      gcTime: 1000 * 60 * 10,
      // 失败重试 1 次即可，避免本地工具场景下的无谓重试
      retry: 1,
    },
  },
});
