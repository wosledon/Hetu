import { get, post, put, del } from './api';
import type { IGraphData, IGraphEntity, IGraphRelation, IGraphEntityDetail } from '../types';

export const graphService = {
  getGraph: () => get<IGraphData>('/graph'),

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
    post<void>(`/graph/extract/${noteId}`),

  mergeEntities: (keepEntityId: string, mergeEntityId: string) =>
    post<void>('/graph/merge', { keepEntityId, mergeEntityId }),

  getEntityTypes: () => get<string[]>('/graph/entities/types'),

  getRelationTypes: () => get<string[]>('/graph/relations/types'),
};
