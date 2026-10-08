import { consumeSseStream } from '../utils/sse';

export interface NoteAiRequest {
  modelId?: string;
  systemPrompt?: string;
}

export interface ContinueNoteRequest extends NoteAiRequest {
  selectedText?: string;
}

export interface NoteAiStreamHandlers {
  /** 每收到一段正文回调（可边收边展示） */
  onDelta?: (text: string) => void;
  signal?: AbortSignal;
}

/** 兼容 SSE data 帧既可能是 JSON 字符串（带引号）也可能是纯文本 */
function decodeSseData(data: string): string {
  const trimmed = data.trim();
  if (trimmed.startsWith('"')) {
    try {
      return JSON.parse(trimmed) as string;
    } catch {
      /* 非合法 JSON 字符串时按原文处理 */
    }
  }
  return data;
}

/**
 * 以 SSE 方式调用笔记 AI 接口，逐段回调正文；流结束后返回完整文本。
 * 后端以 IAsyncEnumerable<string> 输出，客户端带 Accept: text/event-stream 时逐字推送。
 */
async function streamNoteAi(
  noteId: string,
  endpoint: 'summarize' | 'continue',
  request: NoteAiRequest | ContinueNoteRequest,
  { onDelta, signal }: NoteAiStreamHandlers = {},
): Promise<string> {
  const response = await fetch(`/api/notes/${noteId}/${endpoint}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    },
    body: JSON.stringify(request),
    signal,
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(extractErrorMessage(detail) || `请求失败（${response.status}）`);
  }

  let full = '';
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('text/event-stream')) {
    // 真正的流式：逐段回调，边收边展示
    await consumeSseStream(response, (event) => {
      const text = decodeSseData(event.data);
      if (!text) return
      full += text
      onDelta?.(text)
    })
  } else {
    // 兜底：后端缓冲后一次性返回（JSON 数组或纯文本）
    const body = await response.text();
    full = decodeBufferedBody(body);
    if (full) onDelta?.(full)
  }
  return full
}

/** 解析非流式响应体：兼容 JSON 字符串数组、JSON 字符串与纯文本 */
function decodeBufferedBody(body: string): string {
  if (!body) return '';
  try {
    const parsed = JSON.parse(body);
    if (Array.isArray(parsed)) return parsed.filter((x): x is string => typeof x === 'string').join('');
    if (typeof parsed === 'string') return parsed;
  } catch {
    /* 非 JSON：按纯文本返回 */
  }
  return body;
}

/** 从错误响应体中提取可读信息（兼容 ProblemDetails 与纯文本） */
function extractErrorMessage(body: string): string | null {
  if (!body) return null
  try {
    const parsed = JSON.parse(body)
    if (typeof parsed?.error === 'string') return parsed.error
    if (Array.isArray(parsed) && typeof parsed[0] === 'string') return parsed[0]
    if (typeof parsed?.title === 'string') return parsed.title
  } catch {
    /* 非 JSON：截取首行作为消息 */
  }
  const firstLine = body.split('\n').find((line) => line.trim())
  return firstLine?.trim() || null
}

export const noteAiService = {
  summarize: (noteId: string, request: NoteAiRequest = {}, handlers: NoteAiStreamHandlers = {}) =>
    streamNoteAi(noteId, 'summarize', request, handlers),
  continue: (noteId: string, request: ContinueNoteRequest = {}, handlers: NoteAiStreamHandlers = {}) =>
    streamNoteAi(noteId, 'continue', request, handlers),
}
