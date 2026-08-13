import axios from "axios";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

export const api = axios.create({ baseURL: API, withCredentials: true });

// Rutas que jamás deben intentar rotar sesión.
const AUTH_SKIP = ["/auth/login", "/auth/refresh", "/auth/logout"];

let refreshing = null;

api.interceptors.response.use(
  (res) => res,
  async (err) => {
    const { response, config } = err || {};
    if (
      response &&
      response.status === 401 &&
      config &&
      !config._retried &&
      !AUTH_SKIP.some((p) => (config.url || "").startsWith(p))
    ) {
      config._retried = true;
      if (!refreshing) {
        refreshing = api
          .post("/auth/refresh")
          .then(() => {
            refreshing = null;
          })
          .catch((e) => {
            refreshing = null;
            throw e;
          });
      }
      try {
        await refreshing;
        return api(config);
      } catch (e) {
        return Promise.reject(e);
      }
    }
    return Promise.reject(err);
  }
);

export function formatApiError(detail) {
  if (detail == null) return "Ocurrió un error. Intenta de nuevo.";
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail))
    return detail.map((e) => (e && typeof e.msg === "string" ? e.msg : JSON.stringify(e))).join(" ");
  if (detail && typeof detail.msg === "string") return detail.msg;
  return String(detail);
}

export const money = (n) =>
  new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(Number(n || 0));

export const BLOB = API;

// Convierte una URL relativa de archivo (/api/files/...) en absoluta usando el backend.
export const fileUrl = (u) => (!u ? "" : /^https?:\/\//.test(u) ? u : `${process.env.REACT_APP_BACKEND_URL}${u.startsWith("/") ? "" : "/"}${u}`);