const API_BASE = '/api/export';

const downloadBlob = (blob: Blob, filename: string) => {
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.URL.revokeObjectURL(url);
};

export const exportService = {
  exportNotes: async () => {
    const response = await fetch(`${API_BASE}/notes`);
    if (!response.ok) throw new Error('导出失败');
    const blob = await response.blob();
    const date = new Date().toISOString().slice(0, 10);
    downloadBlob(blob, `hetu-notes-${date}.zip`);
  },

  backupDatabase: async () => {
    const response = await fetch(`${API_BASE}/backup`);
    if (!response.ok) throw new Error('备份失败');
    const blob = await response.blob();
    const date = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    downloadBlob(blob, `hetu-backup-${date}.db`);
  },

  restoreDatabase: async (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    const response = await fetch(`${API_BASE}/restore`, {
      method: 'POST',
      body: formData,
    });
    const data = await response.json();
    if (!data.success) throw new Error(data.error || '恢复失败');
    return data.data as string;
  },
};
