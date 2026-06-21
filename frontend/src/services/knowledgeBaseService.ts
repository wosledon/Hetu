import { get, post } from './api';
import type { INoteSearchResult, IPagedResult } from '../types';

export interface IKnowledgeBaseStatus {
  totalNotes: number;
  indexedNotes: number;
  unindexedNotes: number;
  hasEmbeddingProvider: boolean;
  dimensions: number;
}

export interface INoteEmbeddingStatus {
  noteId: string;
  title: string;
  updatedAt: string;
  hasEmbedding: boolean;
  embeddingModel: string | null;
  embeddingDimensions: number;
  embeddingUpdatedAt: string | null;
}

export interface IBatchEmbeddingResult {
  totalUnindexed: number;
  queuedCount: number;
}

export interface IKnowledgeBaseSearchRequest {
  query: string;
  topK?: number;
}

export const knowledgeBaseService = {
  getStatus: () =>
    get<IKnowledgeBaseStatus>('/knowledge-base/status'),

  getEmbeddingStatuses: () =>
    get<INoteEmbeddingStatus[]>('/knowledge-base/embeddings'),

  generateEmbedding: (noteId: string) =>
    post<void>(`/knowledge-base/embeddings/${noteId}`),

  batchGenerateEmbeddings: () =>
    post<IBatchEmbeddingResult>('/knowledge-base/embeddings/batch'),

  testSearch: (request: IKnowledgeBaseSearchRequest) =>
    post<IPagedResult<INoteSearchResult>>('/knowledge-base/search', request),
};
