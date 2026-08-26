@'
export const API_URL = "https://gruporysa.com/api";

export async function apiFetch(
  endpoint: string,
  options: RequestInit = {}
) {
  const response = await fetch(`${API_URL}${endpoint}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(
      data?.detail || data?.message || `Error HTTP ${response.status}`
    );
  }

  return data;
}
'@ | Set-Content .\src\lib\api.ts -Encoding UTF8