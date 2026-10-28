import { get, post, put, del } from './api';
import i18n from '../i18n';
import type { INoteSearchResult, IPagedResult } from '../types';

// ── 知识库状态 ──

export interface IKnowledgeBaseStatus {
  totalItems: number;
  indexedItems: number;
  unindexedItems: number;
  noteCount: number;
  fileCount: number;
  urlCount: number;
  /** 项目 Wiki 页面（自动同步）数量 */
  wikiCount: number;
  noteIndexedCount: number;
  fileIndexedCount: number;
  urlIndexedCount: number;
  wikiIndexedCount: number;
  /** 分块总量（不含已删除知识项的分块） */
  totalChunks: number;
  /** 已建立向量的分块数 */
  indexedChunks: number;
  hasEmbeddingProvider: boolean;
  dimensions: number;
  /** 正在运行的后台任务数（Queued + Running） */
  runningTaskCount: number;
  /** 已失败的索引任务数 */
  failedTaskCount: number;
  /** 最近一次建立向量的时间 */
  lastIndexedAt: string | null;
  /** 最近一次使用的 Embedding 模型 */
  embeddingModel: string | null;
  /** 最近建立索引的知识项（按向量更新时间倒序） */
  recentIndexed: IRecentIndexedItem[];
}

/** 概览「最近索引」列表的一行 */
export interface IRecentIndexedItem {
  id: string;
  type: 'note' | 'file' | 'url' | 'wiki';
  title: string;
  chunkCount: number;
  updatedAt: string;
}

// ── 知识项 Embedding 状态 ──

export interface IKnowledgeItemEmbeddingStatus {
  id: string;
  type: 'note' | 'file' | 'url' | 'wiki';
  title: string;
  sourceUrl: string | null;
  fileName: string | null;
  fileSize: number | null;
  noteId: string | null;
  /** Wiki 类型知识项对应的 Wiki 页面 ID */
  wikiDocumentId: string | null;
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
  type: 'note' | 'file' | 'url' | 'wiki';
  title: string;
  content: string;
  sourceUrl: string | null;
  fileName: string | null;
  fileSize: number | null;
  mimeType: string | null;
  noteId: string | null;
  /** Wiki 类型知识项对应的 Wiki 页面 ID */
  wikiDocumentId: string | null;
  createdAt: string;
  updatedAt: string;
}

export const knowledgeBaseService = {
  // ── 状态 ──
  getStatus: () =>
    get<IKnowledgeBaseStatus>('/knowledge-base/status'),

  getEmbeddingStatuses: (params: { type?: string; noteId?: string; page?: number; pageSize?: number }) =>
    get<IPagedResult<IKnowledgeItemEmbeddingStatus>>('/knowledge-base/embeddings', params),

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
      throw new Error(error.message || i18n.t('knowledge:kb.uploadFailed'));
    }
    const data = await response.json();
    return data.data as IKnowledgeItem;
  },
};
