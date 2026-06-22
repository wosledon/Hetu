import { get, post, put, del } from './api';
import type { INoteSearchResult, IPagedResult } from '../types';

// ── 知识库状态 ──

export interface IKnowledgeBaseStatus {
  totalItems: number;
  indexedItems: number;
  unindexedItems: number;
  noteCount: number;
  fileCount: number;
  urlCount: number;
  hasEmbeddingProvider: boolean;
  dimensions: number;
  /** 正在运行的后台任务数（Queued + Running） */
  runningTaskCount: number;
}

// ── 知识项 Embedding 状态 ──

export interface IKnowledgeItemEmbeddingStatus {
  id: string;
  type: 'note' | 'file' | 'url';
  title: string;
  sourceUrl: string | null;
  fileName: string | null;
  fileSize: number | null;
  noteId: string | null;
  updatedAt: string;
  hasEmbedding: boolean;
  embeddingModel: string | null;
  embeddingDimensions: number;
  embeddingUpdatedAt: string | null;
  chunkCount: number;
  /** 是否有正在进行的索引任务 */
  hasRunningTask: boolean;
}

export interface IBatchEmbeddingResult {
  totalUnindexed: number;
  queuedCount: number;
  /** 因已有进行中任务而跳过的数量 */
  skippedCount: number;
}

export interface IKnowledgeBaseSearchRequest {
  query: string;
  topK?: number;
}

export interface INoteChunk {
  id: string;
  knowledgeItemId: string;
  chunkIndex: number;
  content: string;
  summary: string | null;
  chunkMethod: string;
  hasEmbedding: boolean;
  createdAt: string;
  updatedAt: string;
}

// ── 知识项 CRUD ──

export interface IKnowledgeItem {
  id: string;
  type: 'note' | 'file' | 'url';
  title: string;
  content: string;
  sourceUrl: string | null;
  fileName: string | null;
  fileSize: number | null;
  mimeType: string | null;
  noteId: string | null;
  createdAt: string;
  updatedAt: string;
}

export const knowledgeBaseService = {
  // ── 状态 ──
  getStatus: () =>
    get<IKnowledgeBaseStatus>('/knowledge-base/status'),

  getEmbeddingStatuses: (type?: string) =>
    get<IKnowledgeItemEmbeddingStatus[]>(`/knowledge-base/embeddings${type ? `?type=${type}` : ''}`),

  generateEmbedding: (id: string) =>
    post<void>(`/knowledge-base/embeddings/${id}`),

  batchGenerateEmbeddings: () =>
    post<IBatchEmbeddingResult>('/knowledge-base/embeddings/batch'),

  testSearch: (request: IKnowledgeBaseSearchRequest) =>
    post<IPagedResult<INoteSearchResult>>('/knowledge-base/search', request),

  getChunks: (id: string) =>
    get<INoteChunk[]>(`/knowledge-base/chunks/${id}`),
};

export const knowledgeItemService = {
  // ── 列表 ──
  getList: (type?: string) =>
    get<IKnowledgeItem[]>(`/knowledge-items${type ? `?type=${type}` : ''}`),

  getById: (id: string) =>
    get<IKnowledgeItem>(`/knowledge-items/${id}`),

  // ── 添加网址 ──
  addUrl: (request: { url: string; title?: string; content?: string }) =>
    post<IKnowledgeItem>('/knowledge-items/url', request),

  // ── 更新 ──
  update: (id: string, request: { title?: string; content?: string }) =>
    put<IKnowledgeItem>(`/knowledge-items/${id}`, request),

  // ── 删除 ──
  delete: (id: string) =>
    del(`/knowledge-items/${id}`),

  // ── 上传文件 ──
  uploadFile: async (file: File, title?: string) => {
    const formData = new FormData();
    formData.append('file', file);
    if (title) formData.append('title', title);

    const response = await fetch('/api/knowledge-items/file', {
      method: 'POST',
      body: formData,
    });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || '上传失败');
    }
    const data = await response.json();
    return data.data as IKnowledgeItem;
  },
};
