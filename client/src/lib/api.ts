import type { AnalysisListItem, AnalysisResult, DocumentInfo, Health, UploadResponse } from './types';

import { ApiError } from './apiError';

export { ApiError };

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, init);
  } catch {
    throw new ApiError(0, 'NETWORK', 'Cannot reach the server. Check your connection and try again.');
  }
  if (res.status === 204) return undefined as T;
  const body = (await res.json().catch(() => null)) as { error?: { code: string; message: string } } | null;
  if (!res.ok) throw new ApiError(res.status, body?.error?.code ?? 'HTTP_ERROR', body?.error?.message ?? `Request failed (${res.status}).`);
  return body as T;
}

const json = (data: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(data),
});

export const api = {
  health: () => call<Health>('/health'),
  createWorkspace: () => call<{ id: string }>('/workspaces', json({ name: 'Workbench session' })),
  listDocuments: (ws: string) => call<{ documents: DocumentInfo[] }>(`/workspaces/${ws}/documents`),
  upload: (ws: string, files: File[]) => {
    const fd = new FormData();
    files.forEach((f) => fd.append('files', f, f.name));
    return call<UploadResponse>(`/workspaces/${ws}/documents`, { method: 'POST', body: fd });
  },
  loadSamples: (ws: string) => call<{ loaded: number; documents: DocumentInfo[] }>(`/workspaces/${ws}/samples`, { method: 'POST' }),
  listSamples: () => call<{ files: string[] }>('/samples'),
  deleteDocument: (ws: string, id: string) => call<void>(`/workspaces/${ws}/documents/${id}`, { method: 'DELETE' }),
  analyze: (ws: string, instruction: string, documentIds: string[]) =>
    call<{ id: string; result: AnalysisResult }>(`/workspaces/${ws}/analyses`, json({ instruction, documentIds })),
  listAnalyses: (ws: string) => call<{ analyses: AnalysisListItem[] }>(`/workspaces/${ws}/analyses`),
  getAnalysis: (ws: string, id: string) => call<{ id: string; result: AnalysisResult | null }>(`/workspaces/${ws}/analyses/${id}`),
};
