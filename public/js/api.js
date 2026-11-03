// Thin JSON client for the ScopePay API.

async function request(method, route, body) {
  const response = await fetch(route, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status}).`);
  return data;
}

export const api = {
  get: (route) => request('GET', route),
  post: (route, body = {}) => request('POST', route, body),
  del: (route) => request('DELETE', route),
};

export async function fetchSample(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error('Sample file not found.');
  const blob = await response.blob();
  return new File([blob], path.split('/').pop(), { type: blob.type });
}
