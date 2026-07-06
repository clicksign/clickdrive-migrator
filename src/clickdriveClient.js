const fs = require('node:fs');

class ApiError extends Error {
  constructor(status, body) {
    super(`ClickDrive API respondeu ${status}: ${typeof body === 'string' ? body : JSON.stringify(body)}`);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

class ClickDriveClient {
  constructor({ apiUrl, token }) {
    this.apiUrl = apiUrl;
    this.token = token;
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
    });

    return parseResponse(response);
  }

  async uploadFile({ filePath, name, ancestorId }) {
    const buffer = fs.readFileSync(filePath);
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
