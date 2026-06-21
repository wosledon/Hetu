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
  chunkCount: number;
}

export interface IBatchEmbeddingResult {
  totalUnindexed: number;
  queuedCount: number;
}

export interface IKnowledgeBaseSearchRequest {
  query: string;
  topK?: number;
}

export interface INoteChunk {
  id: string;
  noteId: string;
  chunkIndex: number;
  content: string;
  summary: string | null;
  chunkMethod: string;
  hasEmbedding: boolean;
  createdAt: string;
  updatedAt: string;
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

  getChunks: (noteId: string) =>
    get<INoteChunk[]>(`/knowledge-base/chunks/${noteId}`),
};
