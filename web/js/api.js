// Backend API client (DEC-004 envelope). All server calls from the UI go through here (DEC-009).

export class ApiError extends Error {
  constructor({ code = 'NETWORK', message = 'Request failed', details, upstream } = {}, status = 0) {
    super(message);
    Object.assign(this, { name: 'ApiError', code, details, upstream, status });
  }
}

async function request(method, path, body, rawType) {
  let res;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers: body === undefined ? {} : { 'content-type': rawType ?? 'application/json' },
      body: body === undefined ? undefined : rawType ? body : JSON.stringify(body),
    });
  } catch {
    throw new ApiError({ code: 'NETWORK', message: 'Cannot reach the backend' });
  }
  let payload;
  try { payload = await res.json(); } catch { throw new ApiError({ code: 'BAD_RESPONSE', message: `Unexpected response (${res.status})` }, res.status); }
  if (!payload.ok) throw new ApiError(payload.error, res.status);
  return payload.data;
}

export const api = {
  get: path => request('GET', path),
  post: (path, body = {}) => request('POST', path, body),
  put: (path, body) => request('PUT', path, body),
  patch: (path, body) => request('PATCH', path, body),
  /** Send a file/blob as the raw body (e.g. a project file, WO-057). */
  upload: (method, path, blob, type = blob.type || 'application/octet-stream') => request(method, path, blob, type),
  del: path => request('DELETE', path),
  /** System-independent actions (DEC-010): domain('POST', '/discussion/speakers', { seatId }). */
  domain: (method, path, body) => request(method, `/domain${path}`, body),
  /** Call a wireless REST endpoint through the passthrough (WO-015). */
  wireless: (method, path, body) => request(method, `/wireless${path}`, body),
  /** Call a DCN-SW API method through the passthrough (WO-060): dcn('control.DiscussionApi', 'SpeakNow', { participantId: 0, seatId: 3 }). */
  dcn: (apiKey, method, args = {}) => request('POST', `/dcn/ops/${encodeURIComponent(apiKey)}/${encodeURIComponent(method)}`, args),
  /** Call a Conference Protocol operation through the passthrough (WO-011). */
  wired: (operation, params = {}) => request('POST', `/wired/ops/${encodeURIComponent(operation)}`, params),
  /** DICENTIS-only feature actions over the DCNM API (DEC-029), e.g. dicentis('/audio/gain', { type, value }). */
  dicentis: (path, body = {}) => request('POST', `/dicentis${path}`, body),
  connection: {
    status: () => request('GET', '/connection'),
    settings: () => request('GET', '/connection/settings'),
    saveSettings: patch => request('PUT', '/connection/settings', patch),
    connect: (options = {}) => request('POST', '/connection/connect', options),
    disconnect: () => request('POST', '/connection/disconnect', {}),
  },
};
