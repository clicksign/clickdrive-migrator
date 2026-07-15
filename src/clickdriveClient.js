const fs = require('node:fs/promises');

class ApiError extends Error {
  constructor(status, body) {
    super(`ClickDrive API respondeu ${status}: ${typeof body === 'string' ? body : JSON.stringify(body)}`);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

class ClickDriveClient {
  constructor({ apiUrl, token, requestTimeoutMs = 30000 }) {
    this.apiUrl = apiUrl;
    this.token = token;
    this.requestTimeoutMs = requestTimeoutMs;
  }

  async createFolder({ name, ancestorId }) {
    const response = await fetch(`${this.apiUrl}/api/v1/folders`, {
      method: 'POST',
      headers: {
        Authorization: this.token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name,
        ...(ancestorId ? { ancestor_id: ancestorId } : {}),
      }),
      signal: AbortSignal.timeout(this.requestTimeoutMs),
    });

    return parseResponse(response);
  }

  async listWorkspace({ ancestorId, cursor } = {}) {
    const url = new URL(`${this.apiUrl}/api/v1/workspace`);
    if (ancestorId) url.searchParams.set('ancestor_id', ancestorId);
    if (cursor) url.searchParams.set('cursor', cursor);

    const response = await fetch(url, {
      headers: {
        Authorization: this.token,
      },
      signal: AbortSignal.timeout(this.requestTimeoutMs),
    });

    return parseResponse(response);
  }

  async uploadFile({ filePath, name, ancestorId }) {
    const buffer = await fs.readFile(filePath);
    const form = new FormData();
    form.append('file', new Blob([buffer]), name);
    form.append('name', name);
    if (ancestorId) form.append('ancestor_id', ancestorId);

    const response = await fetch(`${this.apiUrl}/api/v1/files`, {
      method: 'POST',
      headers: {
        Authorization: this.token,
      },
      body: form,
      signal: AbortSignal.timeout(this.requestTimeoutMs),
    });

    return parseResponse(response);
  }
}

async function parseResponse(response) {
  const text = await response.text();
  const body = text ? safeJsonParse(text) : null;

  if (!response.ok) {
    throw new ApiError(response.status, body ?? text);
  }

  return body;
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

module.exports = { ClickDriveClient, ApiError };
