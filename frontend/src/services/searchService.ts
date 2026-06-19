import { get } from './api';
import type { INoteSearchResult, IPagedResult } from '../types';

export interface SearchNotesRequest {
  keyword: string;
  notebookId?: string;
  tagId?: string;
  includeDeleted?: boolean;
  page?: number;
  pageSize?: number;
}

export const searchService = {
  searchNotes: (params: SearchNotesRequest) =>
    get<IPagedResult<INoteSearchResult>>('/search/notes', params as unknown as Record<string, unknown>),

  semanticSearch: (query: string, topK: number = 10) =>
    get<IPagedResult<INoteSearchResult>>('/search/semantic', { query, topK } as unknown as Record<string, unknown>),
};
