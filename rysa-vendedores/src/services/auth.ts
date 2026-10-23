import {
  apiFetch, setAuthToken, storeUserData, getStoredUserData, getAuthToken,
  Jornada, setJornada, getJornada, jornadaVigente,
} from '@/lib/api';

export interface User {
  id: string;
  email: string;
  name: string;
  role: string;
  sucursal_id?: string;
}

export interface LoginResponse {
  token: string;
  user: User;
  jornada: Jornada;
}

const ROLES_APP = ['vendedor', 'vendedor_campo'];

// Login del día: abre la jornada en el servidor. El token vale hasta las 23:59
// (hora de México), así que la app no vuelve a pedir contraseña en el día.
export async function login(email: string, password: string): Promise<User> {
  const data = await apiFetch<LoginResponse>('/auth/login-movil', {
    method: 'POST',
    body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
  });

  if (!data?.token || !data?.jornada) {
    throw new Error('Respuesta de autenticación inválida');
  }
  if (!ROLES_APP.includes((data.user?.role || '').toLowerCase())) {
    await logout();
    throw new Error('Acceso restringido: Esta aplicación móvil es de uso exclusivo para Asesores y Vendedores en Campo.');
  }

  await setAuthToken(data.token);
  await storeUserData(data.user);
  await setJornada(data.jornada);
  return data.user;
}

// Borra la sesión del teléfono (sin avisar al servidor).
export async function logout(): Promise<void> {
  await setAuthToken(null);
  await storeUserData(null);
  await setJornada(null);
}

// Cierre del día: el servidor registra la hora de cierre e invalida el token.
// Si no hay conexión, la sesión se borra igual en el teléfono (la ubicación
// deja de enviarse) y se informa para que lo cierren con señal.
export async function cerrarJornada(): Promise<{ ok: boolean; enServidor: boolean; ubicaciones?: number }> {
  let enServidor = false;
  let ubicaciones: number | undefined;
  try {
    const r = await apiFetch<{ ok: boolean; ubicaciones_hoy: number }>('/auth/jornada/cerrar', { method: 'POST', timeoutMs: 10000 });
    enServidor = !!r?.ok;
    ubicaciones = r?.ubicaciones_hoy;
  } catch {
    enServidor = false;
  }
  await logout();
  return { ok: true, enServidor, ubicaciones };
}

export async function getJornadaActual(): Promise<Jornada | null> {
  return getJornada();
}

// Sesión activa = token + jornada abierta y no vencida. Una sesión de la
// versión anterior (sin jornada) o de otro día pide contraseña de nuevo.
export async function getActiveUser(): Promise<User | null> {
  const token = await getAuthToken();
  if (!token) return null;

  if (!jornadaVigente(await getJornada())) {
    await logout();
    return null;
  }

  const stored = await getStoredUserData();
  if (stored) {
    if (!ROLES_APP.includes((stored.role || '').toLowerCase())) {
      await logout();
      return null;
    }
    return stored;
  }

  try {
    const user = await apiFetch<User>('/auth/me');
    if (!ROLES_APP.includes((user.role || '').toLowerCase())) {
      await logout();
      return null;
    }
    await storeUserData(user);
    return user;
  } catch {
    return null;
  }
}
