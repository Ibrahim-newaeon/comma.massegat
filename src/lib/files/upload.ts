'use client';
// src/lib/files/upload.ts
// Client-side upload orchestration: presign → PUT direct to storage → complete.
// Bytes never pass through the API server.
import { csrfToken, ApiError } from '@/lib/csrfClient';

export type UploadProgress = {
  attachmentId: string | null;
  filename: string;
  sizeBytes: number;
  percent: number;
  status: 'presigning' | 'uploading' | 'completing' | 'done' | 'failed' | 'cancelled';
  error: string | null;
};

export type UploadHandle = {
  promise: Promise<string>;   // resolves to attachmentId
  cancel: () => void;
};

export function uploadFile(
  file: File,
  channelId: string,
  onProgress: (p: Partial<UploadProgress>) => void,
): UploadHandle {
  const xhr = new XMLHttpRequest();
  let cancelled = false;

  const promise = (async () => {
    onProgress({ status: 'presigning', percent: 0, filename: file.name, sizeBytes: file.size });

    const presignRes = await fetch('/api/files/presign', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrfToken() },
      body: JSON.stringify({
        channelId,
        filename: file.name,
        // Browsers leave type empty for unknown extensions. The server verifies
        // by magic bytes regardless, so a wrong guess here is caught later.
        mimeType: file.type || 'application/octet-stream',
        sizeBytes: file.size,
      }),
    });

    const presign = await presignRes.json();
    if (!presignRes.ok || !presign.ok) {
      throw new ApiError(presign?.error?.code ?? 'PRESIGN_FAILED', presign?.error?.message ?? 'Upload rejected');
    }

    const { attachmentId, uploadUrl } = presign.data as { attachmentId: string; uploadUrl: string };
    onProgress({ attachmentId, status: 'uploading' });

    await new Promise<void>((resolve, reject) => {
      xhr.open('PUT', uploadUrl);
      xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress({ percent: Math.round((e.loaded / e.total) * 100) });
      };
      xhr.onload = () => (xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new ApiError('UPLOAD_FAILED', `Storage returned ${xhr.status}`)));
      xhr.onerror = () => reject(new ApiError('UPLOAD_FAILED', 'Network error during upload'));
      xhr.onabort = () => reject(new ApiError('CANCELLED', 'Upload cancelled'));
      xhr.send(file);
    });

    if (cancelled) throw new ApiError('CANCELLED', 'Upload cancelled');

    onProgress({ status: 'completing', percent: 100 });

    const completeRes = await fetch(`/api/files/${attachmentId}/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrfToken() },
      body: JSON.stringify({}),
    });
    const complete = await completeRes.json();
    if (!completeRes.ok || !complete.ok) {
      throw new ApiError(complete?.error?.code ?? 'COMPLETE_FAILED', complete?.error?.message ?? 'Upload rejected');
    }

    onProgress({ status: 'done' });
    return attachmentId;
  })();

  return {
    promise,
    cancel: () => { cancelled = true; xhr.abort(); onProgress({ status: 'cancelled' }); },
  };
}

export async function requestDownload(
  attachmentId: string,
  opts: { inline?: boolean } = {},
): Promise<{ url: string; filename: string }> {
  // inline=1 is honoured only for types that cannot execute — see INLINE_SAFE.
  const query = opts.inline ? '?inline=1' : '';
  const res = await fetch(`/api/files/${attachmentId}/download${query}`);
  const json = await res.json();
  if (!res.ok || !json.ok) {
    throw new ApiError(json?.error?.code ?? 'DOWNLOAD_FAILED', json?.error?.message ?? 'Download failed');
  }
  return json.data;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1_048_576) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1_073_741_824) return `${(n / 1_048_576).toFixed(1)} MB`;
  return `${(n / 1_073_741_824).toFixed(2)} GB`;
}
