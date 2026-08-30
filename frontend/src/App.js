import "@/App.css";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import { CartProvider } from "@/context/CartContext";
import { Toaster } from "@/components/ui/sonner";
import { ShieldX } from "lucide-react";
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
import Usuarios from "@/pages/Usuarios";
import Auditoria from "@/pages/Auditoria";
import Configuracion from "@/pages/Configuracion";
import DevTools from "@/pages/DevTools";
import EnConstruccion from "@/pages/EnConstruccion";
import Finanzas from "@/pages/Finanzas";
import Cotizaciones from "@/pages/Cotizaciones";
import Pedidos from "@/pages/Pedidos";
// FUERZA DE VENTAS consolidada (2 módulos por rol)
import SupervisionComercial from "@/pages/SupervisionComercial";
import MiActividadCampo from "@/pages/MiActividadCampo";
import Catalogo from "@/pages/Catalogo";
import { ShieldX as ShieldXIcon } from "lucide-react";

/** Guarda REAL de ruta: aunque el menú se oculte, escribir la URL no da acceso. */
function RequirePerm({ perm, children }) {
  const { can, user } = useAuth();
  const { pathname } = useLocation();
  if (user === undefined) return null; // sesión cargando
  if (user === null) return <Navigate to="/login" replace />;
  if (!can(perm)) {
    return (
      <div className="p-10 flex justify-center" data-testid="sin-acceso-modulo">
        <div className="card-soft p-8 max-w-md text-center">
          <ShieldX className="w-10 h-10 mx-auto text-slate-300 mb-3" />
          <h2 className="font-display font-bold text-lg">Sin acceso a este módulo</h2>
          <p className="text-sm text-slate-500 mt-1">
            Tu perfil (<b>{user.role}</b>) no tiene permisos para <code className="text-xs">{pathname}</code>.
          </p>
        </div>
      </div>
    );
  }
  return children;
}

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
            <Route path="/app/inventario" element={<RequirePerm perm="producto.crear"><Productos /></RequirePerm>} />
            <Route path="/app/categorias" element={<RequirePerm perm="producto.editar"><Categorias /></RequirePerm>} />
            <Route path="/app/clientes" element={<RequirePerm perm="clientes.gestionar"><Clientes /></RequirePerm>} />
            <Route path="/app/cxc" element={<RequirePerm perm="cxc.ver"><CuentasPorCobrar /></RequirePerm>} />
            <Route path="/app/facturacion" element={<RequirePerm perm="venta.facturar"><Facturacion /></RequirePerm>} />
            <Route path="/app/reportes" element={<RequirePerm perm="reportes.ver"><Reportes /></RequirePerm>} />
            <Route path="/app/caja" element={<RequirePerm perm="caja.ver"><Caja /></RequirePerm>} />
            <Route path="/app/pos" element={<MultiPos />} />
            <Route path="/app/recargas" element={<RequirePerm perm="recargas.usar"><Recargas /></RequirePerm>} />
            <Route path="/app/ventas" element={<Ventas />} />
            <Route path="/app/compras" element={<RequirePerm perm="compra.ver"><Compras /></RequirePerm>} />
            <Route path="/app/proveedores" element={<RequirePerm perm="proveedor.ver"><Proveedores /></RequirePerm>} />
            <Route path="/app/cxp" element={<RequirePerm perm="cxp.pagar"><CuentasPorPagar /></RequirePerm>} />
            <Route path="/app/cotizaciones" element={<Cotizaciones />} />
            <Route path="/app/pedidos" element={<Pedidos />} />

            {/* ===== FUERZA DE VENTAS (consolidada) ===== */}
            <Route path="/app/supervision-comercial" element={<RequirePerm perm="supervision.ver"><SupervisionComercial /></RequirePerm>} />
            <Route path="/app/mi-actividad" element={<RequirePerm perm="visita.ver"><MiActividadCampo /></RequirePerm>} />
            <Route path="/app/catalogo" element={<Catalogo />} />

            {/* Redirecciones de los módulos antiguos (enlaces guardados) */}
            <Route path="/app/supervision" element={<Navigate to="/app/supervision-comercial" replace />} />
            <Route path="/app/seguimiento" element={<Navigate to="/app/supervision-comercial" replace />} />
            <Route path="/app/vendedores" element={<Navigate to="/app/supervision-comercial" replace />} />
            <Route path="/app/clientes-en-campo" element={<Navigate to="/app/supervision-comercial" replace />} />
            <Route path="/app/mapa" element={<Navigate to="/app/supervision-comercial" replace />} />
            <Route path="/app/rutas" element={<Navigate to="/app/mi-actividad" replace />} />
            <Route path="/app/mi-ruta" element={<Navigate to="/app/mi-actividad" replace />} />
            <Route path="/app/visitas" element={<Navigate to="/app/mi-actividad" replace />} />

            <Route path="/app/finanzas" element={<RequirePerm perm="finanzas.ver"><Finanzas /></RequirePerm>} />
            <Route path="/app/sucursales" element={<EnConstruccion titulo="Sucursales" />} />
            <Route path="/app/impresoras" element={<EnConstruccion titulo="Impresoras" />} />
            <Route path="/app/cuentas-bancarias" element={<EnConstruccion titulo="Cuentas bancarias" />} />
            <Route path="/app/usuarios" element={<RequirePerm perm="usuarios.ver"><Usuarios /></RequirePerm>} />
            <Route path="/app/configuracion" element={<Configuracion />} />
            <Route path="/app/auditoria" element={<RequirePerm perm="auditoria.ver"><Auditoria /></RequirePerm>} />
            <Route path="/app/devtools" element={<RequirePerm perm="dev.errores"><DevTools /></RequirePerm>} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
      </CartProvider>
    </AuthProvider>
  );
}

export default App;
