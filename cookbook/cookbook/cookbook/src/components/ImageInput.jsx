import { useRef, useState } from 'react';
import { ingressBase } from '../lib/api';

export function ImageInput({
  value,
  onChange,
  accessToken,
  placeholder = 'https://…',
  accept = 'image/*',
  disabled = false,
}) {
  const fileRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);

  const handleUpload = async (file) => {
    setUploading(true);
    setError(null);
    try {
      const body = new FormData();
      body.append('file', file);
      const res = await fetch(`${ingressBase()}/api/uploads`, {
        method: 'POST',
        headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
        body,
      });
      const payload = await parseUploadResponse(res);
      if (!res.ok) throw new Error(getUploadError(res, payload));
      if (!payload?.url) throw new Error('Upload failed: server returned an unexpected response');
      onChange(payload.url);
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5, flex: 1 }}>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <input
          className="input"
          style={{ minWidth: 0, flex: 1 }}
          placeholder={placeholder}
          value={value || ''}
          onChange={e => onChange(e.target.value)}
          disabled={disabled}
        />
        <button
          type="button"
          className="btn"
          style={{ flexShrink: 0 }}
          onClick={() => fileRef.current?.click()}
          disabled={disabled || uploading}
        >
          {uploading ? 'Uploading…' : 'Upload'}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept={accept}
          style={{ display: 'none' }}
          disabled={disabled}
          onChange={e => { if (e.target.files[0]) handleUpload(e.target.files[0]); }}
        />
      </div>
      {error && (
        <span style={{ fontSize: 11.5, color: 'oklch(0.52 0.17 25)', fontFamily: 'var(--font-mono)' }}>
          {error}
        </span>
      )}
    </div>
  );
}

async function parseUploadResponse(res) {
  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    return res.json().catch(() => null);
  }
  return res.text().catch(() => '');
}

function getUploadError(res, payload) {
  if (payload && typeof payload === 'object' && payload.error) return payload.error;
  if (res.status === 413) return 'Upload failed: file is too large (max 20 MB).';
  if (typeof payload === 'string') {
    const text = stripHtml(payload);
    if (text) return `Upload failed: ${text}`;
  }
  return `Upload failed (${res.status})`;
}

function stripHtml(value) {
  return `${value || ''}`
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180);
}
