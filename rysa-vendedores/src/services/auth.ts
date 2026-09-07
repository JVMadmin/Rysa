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
  if (stored) return stored;

  try {
    const user = await apiFetch<User>('/auth/me');
    await storeUserData(user);
    return user;
  } catch {
    return null;
  }
}
