import AsyncStorage from '@react-native-async-storage/async-storage';

export const DEFAULT_PROD_URL = "https://gruporysa.com/api";
export const DEFAULT_LOCAL_LAN_URL = "http://192.168.1.100:8002/api";
export const DEFAULT_LOCAL_USB_URL = "http://localhost:8002/api";

// Por defecto el backend oficial de produccion/preproduccion
export const DEFAULT_API_URL = DEFAULT_PROD_URL;

const BASE_URL_STORAGE_KEY = "@rysa_api_base_url";
const TOKEN_STORAGE_KEY = "@rysa_auth_token";
const USER_STORAGE_KEY = "@rysa_auth_user";

let inMemoryBaseUrl: string | null = null;
let inMemoryToken: string | null = null;

export async function getBaseUrl(): Promise<string> {
  if (inMemoryBaseUrl) return inMemoryBaseUrl;
  try {
    const stored = await AsyncStorage.getItem(BASE_URL_STORAGE_KEY);
    if (stored && stored.trim()) {
      inMemoryBaseUrl = stored.trim();
      return inMemoryBaseUrl;
    }
  } catch {}
  inMemoryBaseUrl = DEFAULT_API_URL;
  return DEFAULT_API_URL;
}

export async function setBaseUrl(url: string): Promise<void> {
  const cleanUrl = url.trim().replace(/\/+$/, '');
  inMemoryBaseUrl = cleanUrl;
  await AsyncStorage.setItem(BASE_URL_STORAGE_KEY, cleanUrl);
}

// Mantener compatibilidad de export
export let API_URL = DEFAULT_API_URL;

export async function testServerConnection(urlToCheck?: string): Promise<{ ok: boolean; message: string }> {
  const base = (urlToCheck || await getBaseUrl()).trim().replace(/\/+$/, '');
  const healthUrl = base.replace(/\/api$/, '') + '/health';
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), 6000);
  try {
    const res = await fetch(healthUrl, { signal: controller.signal });
    clearTimeout(id);
    if (res.ok) {
      const data = await res.json().catch(() => ({}));
      return {
        ok: true,
        message: `Conectado exitosamente (${data.service || 'RYSA ERP'} - ${data.env || 'activo'})`
      };
    }
    return { ok: false, message: `Servidor respondió con código HTTP ${res.status}` };
  } catch (e: any) {
    clearTimeout(id);
    return {
      ok: false,
      message: e.name === 'AbortError' ? 'Tiempo de espera agotado (Timeout 6s)' : (e.message || 'No se pudo conectar')
    };
  }
}

export async function setAuthToken(token: string | null): Promise<void> {
  inMemoryToken = token;
  if (token) {
    await AsyncStorage.setItem(TOKEN_STORAGE_KEY, token);
  } else {
    await AsyncStorage.removeItem(TOKEN_STORAGE_KEY);
    await AsyncStorage.removeItem(USER_STORAGE_KEY);
  }
}

export async function getAuthToken(): Promise<string | null> {
  if (inMemoryToken) return inMemoryToken;
  try {
    const stored = await AsyncStorage.getItem(TOKEN_STORAGE_KEY);
    inMemoryToken = stored;
    return stored;
  } catch {
    return null;
  }
}

export async function storeUserData(user: any): Promise<void> {
  if (user) {
    await AsyncStorage.setItem(USER_STORAGE_KEY, JSON.stringify(user));
  } else {
    await AsyncStorage.removeItem(USER_STORAGE_KEY);
  }
}

export async function getStoredUserData(): Promise<any | null> {
  try {
    const raw = await AsyncStorage.getItem(USER_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export interface ApiFetchOptions extends RequestInit {
  timeoutMs?: number;
}

export async function apiFetch<T = any>(
  endpoint: string,
  options: ApiFetchOptions = {}
): Promise<T> {
  const token = await getAuthToken();
  const currentBaseUrl = await getBaseUrl();
  API_URL = currentBaseUrl;

  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...(options.headers as Record<string, string> || {}),
  };

  if (!(options.body instanceof FormData) && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }

  if (token && !headers['Authorization']) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const url = endpoint.startsWith('http') ? endpoint : `${currentBaseUrl}${endpoint}`;
  const timeoutMs = options.timeoutMs || 15000;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      headers,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    const data = await response.json().catch(() => null);

    if (!response.ok) {
      const errMsg = formatApiError(data?.detail) || data?.message || `Error de servidor (${response.status})`;
      const error: any = new Error(errMsg);
      error.status = response.status;
      error.data = data;
      throw error;
    }

    return data as T;
  } catch (err: any) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      throw new Error('Tiempo de espera agotado al comunicarse con el servidor.');
    }
    throw err;
  }
}

export function formatApiError(detail: any): string {
  if (detail == null) return '';
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) {
    return detail
      .map((e: any) => {
        if (!e) return '';
        if (typeof e === 'string') return e;
        const loc = Array.isArray(e.loc) ? e.loc.filter((l: any) => l !== 'body').join('.') : '';
        const msg = e.msg || JSON.stringify(e);
        return loc ? `${loc}: ${msg}` : msg;
      })
      .filter(Boolean)
      .join('\n');
  }
  if (detail && typeof detail.msg === 'string') return detail.msg;
  if (typeof detail === 'object') return JSON.stringify(detail);
  return String(detail);
}

