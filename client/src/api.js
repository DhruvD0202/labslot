let token = sessionStorage.getItem('labslot-token');
export function setToken(value) {
  token = value;
  if (value) sessionStorage.setItem('labslot-token', value);
  else sessionStorage.removeItem('labslot-token');
}
export function hasToken() { return Boolean(token); }
export async function api(path, options = {}) {
  let response;
  try {
    response = await fetch(`/api${path}`, {
      ...options,
      headers: { 'Content-Type':'application/json', ...(token ? { Authorization:`Bearer ${token}` } : {}), ...options.headers },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } catch {
    throw Object.assign(new Error('Cannot reach LabSlot. Check that the server is running, then try again.'), { code:'NETWORK_ERROR' });
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && !path.startsWith('/auth/')) window.dispatchEvent(new Event('labslot-session-expired'));
    throw Object.assign(new Error(data.message || 'The request failed.'), { code:data.code, status:response.status });
  }
  return data;
}
