import { createContext, useContext, useEffect, useState } from "react";
import { api } from "@/lib/api";

const AuthContext = createContext(null);
export const useAuth = () => useContext(AuthContext);

const ADMIN_ROLES = ["admin", "admin_propietario", "admin_desarrollador"];

export function AuthProvider({ children }) {
  const [user, setUser] = useState(undefined); // undefined=cargando, null=no auth
  const [permissions, setPermissions] = useState([]);

  const loadMe = async () => {
    try {
      const { data } = await api.get("/auth/me");
      setUser(data.user);
      setPermissions(data.permissions || []);
    } catch {
      setUser(null);
    }
  };

  // Sin almacenamiento en el navegador: la sesión vive en cookies HttpOnly
  // (access + refresh). Si el access caducó, el interceptor de la API intenta
  // /auth/refresh automáticamente antes de reportar 401.
  useEffect(() => {
    loadMe();
  }, []);

  const login = async (email, password) => {
    const { data } = await api.post("/auth/login", { email, password });
    await loadMe();
    return data.user;
  };

  const logout = async () => {
    try {
      await api.post("/auth/logout");
    } catch {}
    setUser(null);
    setPermissions([]);
  };

  const can = (perm) => {
    if (perm?.startsWith("dev.")) return permissions.includes(perm);
    return permissions.includes("*") || permissions.includes(perm);
  };
  const isAdminOrOwner = !!user && ADMIN_ROLES.includes(user.role);

  return (
    <AuthContext.Provider value={{ user, permissions, login, logout, can, isAdminOrOwner, isAdmin: user?.role === "admin" }}>
      {children}
    </AuthContext.Provider>
  );
}