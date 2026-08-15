import "@/App.css";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "@/context/AuthContext";
import { CartProvider } from "@/context/CartContext";
import { Toaster } from "@/components/ui/sonner";
import ProtectedRoute from "@/components/ProtectedRoute";
import ErpLayout from "@/components/layout/ErpLayout";
import Landing from "@/pages/Landing";
import Login from "@/pages/Login";
import Dashboard from "@/pages/Dashboard";
import Productos from "@/pages/Productos";
import Categorias from "@/pages/Categorias";
import Clientes from "@/pages/Clientes";
import CuentasPorCobrar from "@/pages/CuentasPorCobrar";
import Facturacion from "@/pages/Facturacion";
import Reportes from "@/pages/Reportes";
import TicketVerificar from "@/pages/TicketVerificar";
import Caja from "@/pages/Caja";
import POS from "@/pages/POS";
import MultiPos from "@/pages/MultiPos";
import Recargas from "@/pages/Recargas";
import Ventas from "@/pages/Ventas";
import Usuarios from "@/pages/Usuarios";
import Auditoria from "@/pages/Auditoria";
import Configuracion from "@/pages/Configuracion";
import DevTools from "@/pages/DevTools";

function App() {
  return (
    <AuthProvider>
      <CartProvider>
        <BrowserRouter>
        <Toaster position="top-right" richColors />
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/login" element={<Login />} />
          <Route path="/verificar/:saleId" element={<TicketVerificar />} />
          <Route element={<ProtectedRoute><ErpLayout /></ProtectedRoute>}>
            <Route path="/app" element={<Navigate to="/app/dashboard" replace />} />
            <Route path="/app/dashboard" element={<Dashboard />} />
            <Route path="/app/productos" element={<Productos />} />
            <Route path="/app/categorias" element={<Categorias />} />
            <Route path="/app/clientes" element={<Clientes />} />
            <Route path="/app/cxc" element={<CuentasPorCobrar />} />
            <Route path="/app/facturacion" element={<Facturacion />} />
            <Route path="/app/reportes" element={<Reportes />} />
            <Route path="/app/caja" element={<Caja />} />
            <Route path="/app/pos" element={<MultiPos />} />
            <Route path="/app/recargas" element={<Recargas />} />
            <Route path="/app/ventas" element={<Ventas />} />
            <Route path="/app/usuarios" element={<Usuarios />} />
            <Route path="/app/configuracion" element={<Configuracion />} />
            <Route path="/app/auditoria" element={<Auditoria />} />
            <Route path="/app/devtools" element={<DevTools />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
      </CartProvider>
    </AuthProvider>
  );
}

export default App;
