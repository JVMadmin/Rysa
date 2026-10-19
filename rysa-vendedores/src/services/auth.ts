import { apiFetch, setAuthToken, storeUserData, getStoredUserData, getAuthToken } from '@/lib/api';

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
}

export async function login(email: string, password: string): Promise<User> {
  const data = await apiFetch<LoginResponse>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
  });

  if (!data?.token) {
    throw new Error('Respuesta de autenticación inválida');
  }

  const allowedRoles = ['vendedor', 'vendedor_campo'];
  const userRole = (data.user?.role || '').toLowerCase();
  if (!allowedRoles.includes(userRole)) {
    await logout();
    throw new Error('Acceso restringido: Esta aplicación móvil es de uso exclusivo para Asesores y Vendedores en Campo.');
  }

  await setAuthToken(data.token);
  await storeUserData(data.user);
  return data.user;
}

export async function logout(): Promise<void> {
  await setAuthToken(null);
  await storeUserData(null);
}

export async function getActiveUser(): Promise<User | null> {
  const token = await getAuthToken();
  if (!token) return null;

  const stored = await getStoredUserData();
  const allowedRoles = ['vendedor', 'vendedor_campo'];
  if (stored) {
    if (!allowedRoles.includes((stored.role || '').toLowerCase())) {
      await logout();
      return null;
    }
    return stored;
  }

  try {
    const user = await apiFetch<User>('/auth/me');
    if (!allowedRoles.includes((user.role || '').toLowerCase())) {
      await logout();
      return null;
    }
    await storeUserData(user);
    return user;
  } catch {
    return null;
  }
}
