import api from './api';

export interface NoteAiRequest {
  modelId?: string;
  systemPrompt?: string;
}

export interface ContinueNoteRequest extends NoteAiRequest {
  selectedText?: string;
}

async function collectStream(noteId: string, endpoint: string, body: object): Promise<string> {
  const response = await api.post<string>(`/notes/${noteId}/${endpoint}`, body, {
    responseType: 'text',
  });
  try {
    const chunks = JSON.parse(response.data) as string[];
    return chunks.join('');
  } catch {
    return response.data;
  }
}

export const noteAiService = {
  summarize: (noteId: string, request: NoteAiRequest = {}) =>
    collectStream(noteId, 'summarize', request),
  continue: (noteId: string, request: ContinueNoteRequest = {}) =>
    collectStream(noteId, 'continue', request),
};
