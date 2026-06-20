import { get, post, put, del } from './api';
import type { IGraphData, IGraphEntity, IGraphRelation, IGraphEntityDetail, IExtractGraphResult } from '../types';

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

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Process complete SSE messages separated by \n\n
        let eventEnd: number;
        while ((eventEnd = buffer.indexOf('\n\n')) !== -1) {
          const eventStr = buffer.slice(0, eventEnd);
          buffer = buffer.slice(eventEnd + 2);

          let eventType = '';
          let dataStr = '';
          for (const line of eventStr.split('\n')) {
            if (line.startsWith('event: ')) eventType = line.slice(7);
            else if (line.startsWith('data: ')) dataStr = line.slice(6);
          }

          if (!eventType || !dataStr) continue;

          try {
            const data = JSON.parse(dataStr);
            if (eventType === 'meta') callbacks.onMeta?.(data);
            else if (eventType === 'entities') callbacks.onEntities?.(data);
            else if (eventType === 'relations') callbacks.onRelations?.(data);
            else if (eventType === 'done') callbacks.onDone?.();
          } catch {
            // Skip malformed JSON events
          }
        }
      }
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
