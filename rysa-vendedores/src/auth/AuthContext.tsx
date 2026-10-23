import React, { createContext, useContext, useEffect, useState } from 'react';
import { getActiveUser, logout as authLogout, cerrarJornada as authCerrarJornada, User } from '@/services/auth';
import { trackingService } from '@/services/trackingService';

interface AuthContextType {
  user: User | null;
  loading: boolean;
  setUser: (user: User | null) => void;
  logout: () => Promise<void>;
  cerrarJornada: () => Promise<{ enServidor: boolean; ubicaciones?: number }>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  setUser: () => {},
  logout: async () => {},
  cerrarJornada: async () => ({ enServidor: false }),
  refreshUser: async () => {},
});

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const checkSession = async () => {
    try {
      const activeUser = await getActiveUser();
      setUser(activeUser);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    checkSession();
  }, []);

  const handleLogout = async () => {
    await trackingService.stopTracking().catch(() => {});
    await authLogout();
    setUser(null);
  };

  // Cierre del día: avisa al servidor, apaga el GPS y vuelve al login.
  const handleCerrarJornada = async () => {
    const r = await authCerrarJornada();
    await trackingService.stopTracking().catch(() => {});
    setUser(null);
    return r;
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        setUser,
        logout: handleLogout,
        cerrarJornada: handleCerrarJornada,
        refreshUser: checkSession,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
