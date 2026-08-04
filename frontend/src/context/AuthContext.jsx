import { createContext, useContext, useEffect, useState } from "react";
import { api } from "@/lib/api";

const AuthContext = createContext(null);
export const useAuth = () => useContext(AuthContext);

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

  useEffect(() => {
    if (localStorage.getItem("rysa_token")) loadMe();
    else setUser(null);
  }, []);

  const login = async (email, password) => {
    const { data } = await api.post("/auth/login", { email, password });
    localStorage.setItem("rysa_token", data.token);
    await loadMe();
    return data.user;
  };

  const logout = async () => {
    try { await api.post("/auth/logout"); } catch {}
    localStorage.removeItem("rysa_token");
    setUser(null);
    setPermissions([]);
  };

  const can = (perm) => permissions.includes("*") || permissions.includes(perm);

  return (
    <AuthContext.Provider value={{ user, permissions, login, logout, can, isAdmin: user?.role === "admin" }}>
      {children}
    </AuthContext.Provider>
  );
}
