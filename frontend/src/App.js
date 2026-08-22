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
import Compras from "@/pages/Compras";
import Proveedores from "@/pages/Proveedores";
import CuentasPorPagar from "@/pages/CuentasPorPagar";
import Visitas from "@/pages/Visitas";
import Supervision from "@/pages/Supervision";
import MiRuta from "@/pages/MiRuta";
import Usuarios from "@/pages/Usuarios";
import Auditoria from "@/pages/Auditoria";
import Configuracion from "@/pages/Configuracion";
import DevTools from "@/pages/DevTools";
import EnConstruccion from "@/pages/EnConstruccion";
import Vendedores from "@/pages/Vendedores";
import ClientesEnCampo from "@/pages/ClientesEnCampo";
import Mapa from "@/pages/Mapa";
import Finanzas from "@/pages/Finanzas";
import Cotizaciones from "@/pages/Cotizaciones";
import Pedidos from "@/pages/Pedidos";

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
            <Route path="/app/inventario" element={<Productos />} />
            <Route path="/app/categorias" element={<Categorias />} />
            <Route path="/app/clientes" element={<Clientes />} />
            <Route path="/app/cxc" element={<CuentasPorCobrar />} />
            <Route path="/app/facturacion" element={<Facturacion />} />
            <Route path="/app/reportes" element={<Reportes />} />
            <Route path="/app/caja" element={<Caja />} />
            <Route path="/app/pos" element={<MultiPos />} />
            <Route path="/app/recargas" element={<Recargas />} />
            <Route path="/app/ventas" element={<Ventas />} />
            <Route path="/app/compras" element={<Compras />} />
            <Route path="/app/proveedores" element={<Proveedores />} />
            <Route path="/app/cxp" element={<CuentasPorPagar />} />
            <Route path="/app/visitas" element={<Visitas />} />
            <Route path="/app/supervision" element={<Supervision />} />
            <Route path="/app/mi-ruta" element={<MiRuta />} />
            <Route path="/app/rutas" element={<MiRuta />} />
            <Route path="/app/seguimiento" element={<Supervision />} />
            <Route path="/app/cotizaciones" element={<Cotizaciones />} />
            <Route path="/app/pedidos" element={<Pedidos />} />
            <Route path="/app/vendedores" element={<Vendedores />} />
            <Route path="/app/clientes-en-campo" element={<ClientesEnCampo />} />
            <Route path="/app/mapa" element={<Mapa />} />
            <Route path="/app/finanzas" element={<Finanzas />} />
            <Route path="/app/sucursales" element={<EnConstruccion titulo="Sucursales" />} />
            <Route path="/app/impresoras" element={<EnConstruccion titulo="Impresoras" />} />
            <Route path="/app/cuentas-bancarias" element={<EnConstruccion titulo="Cuentas bancarias" />} />
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
