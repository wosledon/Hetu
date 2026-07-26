import { QueryClient } from '@tanstack/react-query';

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
