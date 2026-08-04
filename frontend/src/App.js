import "@/App.css";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "@/context/AuthContext";
import { Toaster } from "@/components/ui/sonner";
import ProtectedRoute from "@/components/ProtectedRoute";
import ErpLayout from "@/components/layout/ErpLayout";
import Landing from "@/pages/Landing";
import Login from "@/pages/Login";
import Dashboard from "@/pages/Dashboard";
import Productos from "@/pages/Productos";
import Clientes from "@/pages/Clientes";
import Caja from "@/pages/Caja";
import POS from "@/pages/POS";
import Ventas from "@/pages/Ventas";
import Usuarios from "@/pages/Usuarios";
import Auditoria from "@/pages/Auditoria";
import Configuracion from "@/pages/Configuracion";

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Toaster position="top-right" richColors />
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/login" element={<Login />} />
          <Route element={<ProtectedRoute><ErpLayout /></ProtectedRoute>}>
            <Route path="/app" element={<Navigate to="/app/dashboard" replace />} />
            <Route path="/app/dashboard" element={<Dashboard />} />
            <Route path="/app/productos" element={<Productos />} />
            <Route path="/app/clientes" element={<Clientes />} />
            <Route path="/app/caja" element={<Caja />} />
            <Route path="/app/pos" element={<POS />} />
            <Route path="/app/ventas" element={<Ventas />} />
            <Route path="/app/usuarios" element={<Usuarios />} />
            <Route path="/app/configuracion" element={<Configuracion />} />
            <Route path="/app/auditoria" element={<Auditoria />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;
