import { get, post, put, del } from './api';
import type { IGraphData, IGraphEntity, IGraphRelation, IGraphEntityDetail, IExtractGraphResult } from '../types';
import { consumeSseStream } from '../utils/sse';

export interface StreamGraphCallbacks {
  onMeta?: (meta: { entityCount: number; relationCount: number }) => void;
  onEntities?: (entities: IGraphEntity[]) => void;
  onRelations?: (relations: IGraphRelation[]) => void;
  onDone?: () => void;
  onError?: (error: Error) => void;
}

export const graphService = {
  getGraph: () => get<IGraphData>('/graph'),

  streamGraph: async (callbacks: StreamGraphCallbacks, signal?: AbortSignal): Promise<void> => {
    const response = await fetch('/api/graph/stream', {
      headers: { Accept: 'text/event-stream' },
      signal,
    });

    if (!response.ok || !response.body) {
      throw new Error(`SSE request failed: ${response.status}`);
    }

    try {
      await consumeSseStream(
        response,
        ({ event, data }) => {
          if (!event) return;
          try {
            const payload = JSON.parse(data);
            if (event === 'meta') callbacks.onMeta?.(payload);
            else if (event === 'entities') callbacks.onEntities?.(payload);
            else if (event === 'relations') callbacks.onRelations?.(payload);
            else if (event === 'done') callbacks.onDone?.();
          } catch {
            // 跳过格式错误的 JSON 事件
          }
        },
        { signal },
      );
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        callbacks.onError?.(err as Error);
      }
    }
  },

  getEntity: (id: string) => get<IGraphEntityDetail>(`/graph/entities/${id}`),

  createEntity: (data: { name: string; type: string; description?: string }) =>
    post<IGraphEntity>('/graph/entities', data),

  updateEntity: (id: string, data: { name?: string; type?: string; description?: string }) =>
    put<IGraphEntity>(`/graph/entities/${id}`, data),

  deleteEntity: (id: string) => del<void>(`/graph/entities/${id}`),

  createRelation: (data: { sourceEntityId: string; targetEntityId: string; relationType: string; description?: string }) =>
    post<IGraphRelation>('/graph/relations', data),

  deleteRelation: (id: string) => del<void>(`/graph/relations/${id}`),

  extractFromNote: (noteId: string) =>
    post<IExtractGraphResult>(`/graph/extract/${noteId}`),

  batchExtract: (noteIds: string[]) =>
    post<IExtractGraphResult[]>('/graph/extract/batch', { noteIds }),

  batchExtractQueue: (noteIds: string[]) =>
    post<void>('/graph/extract/batch-queue', { noteIds }),

  mergeEntities: (keepEntityId: string, mergeEntityId: string) =>
    post<void>('/graph/merge', { keepEntityId, mergeEntityId }),

  getEntityTypes: () => get<string[]>('/graph/entities/types'),

  getRelationTypes: () => get<string[]>('/graph/relations/types'),
};
