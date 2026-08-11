import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useState, useEffect } from "react";
import { useAuth } from "@/context/AuthContext";
import { api } from "@/lib/api";
import {
  LayoutDashboard, Package, Users, Wallet, ShoppingCart, Receipt,
  UserCog, ScrollText, LogOut, Menu, ChevronLeft, Boxes, Settings, Tags, HandCoins, FileText, Stamp, BarChart3, Smartphone,
} from "lucide-react";

const NAV = [
  { to: "/app/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/app/pos", label: "Punto de Venta", icon: ShoppingCart, perm: "venta.crear" },
  { to: "/app/recargas", label: "Recargas", icon: Smartphone, perm: "venta.crear" },
  { to: "/app/ventas", label: "Ventas", icon: Receipt },
  { to: "/app/reportes", label: "Reportes", icon: BarChart3, perm: "reportes.ver" },
  { to: "/app/facturacion", label: "Facturación", icon: FileText },
  { to: "/app/productos", label: "Productos", icon: Package },
  { to: "/app/categorias", label: "Categorías", icon: Tags },
  { to: "/app/clientes", label: "Clientes", icon: Users },
  { to: "/app/cxc", label: "Cuentas por Cobrar", icon: HandCoins, perm: "caja.entrada" },
  { to: "/app/caja", label: "Caja", icon: Wallet, perm: "caja.abrir" },
  { to: "/app/usuarios", label: "Usuarios", icon: UserCog, perm: "usuarios.ver" },
  { to: "/app/auditoria", label: "Auditoría", icon: ScrollText, perm: "reportes.ver" },
  { to: "/app/configuracion", label: "Configuración", icon: Settings, perm: "config" },
];

export default function ErpLayout() {
  const { user, logout, can } = useAuth();
  const nav = useNavigate();
  const [collapsed, setCollapsed] = useState(false);

  const doLogout = async () => { await logout(); nav("/login"); };

  const [timbres, setTimbres] = useState(null);
  useEffect(() => {
    api.get("/facturacion/timbres").then((r) => setTimbres(r.data)).catch(() => {});
  }, []);

  return (
    <div className="min-h-screen flex bg-[#F4F0EA]">
      <aside
        data-testid="sidebar"
        className={`${collapsed ? "w-[68px]" : "w-64"} shrink-0 bg-[#4B4E53] text-slate-300 flex flex-col transition-[width] duration-200 sticky top-0 h-screen`}
      >
        <div className="h-16 flex items-center gap-2 px-4 border-b border-white/10">
          <div className="w-9 h-9 rounded-md bg-[#B95A3A] flex items-center justify-center shrink-0">
            <Boxes className="w-5 h-5 text-white" />
          </div>
          {!collapsed && (
            <div className="leading-tight">
              <div className="font-display font-extrabold text-white text-lg tracking-tight">RYSA</div>
              <div className="text-[10px] uppercase tracking-[0.2em] text-slate-400">ERP · POS</div>
            </div>
          )}
        </div>
        <nav className="flex-1 py-3 px-2 space-y-1 overflow-y-auto">
          {NAV.filter((n) => !n.perm || can(n.perm)).map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              data-testid={`nav-${n.to.split("/").pop()}`}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors ${
                  isActive ? "bg-[#B95A3A] text-white" : "hover:bg-white/10 hover:text-white"
                }`
              }
            >
              <n.icon className="w-5 h-5 shrink-0" strokeWidth={2} />
              {!collapsed && <span>{n.label}</span>}
            </NavLink>
          ))}
        </nav>
        <button
          onClick={() => setCollapsed((c) => !c)}
          className="h-11 flex items-center justify-center border-t border-white/10 hover:bg-white/10 transition-colors"
          data-testid="toggle-sidebar"
        >
          {collapsed ? <Menu className="w-5 h-5" /> : <ChevronLeft className="w-5 h-5" />}
        </button>
      </aside>

      <div className="flex-1 flex flex-col min-w-0 bg-[#F4F0EA]">
        <header className="rysa-header sticky top-0 z-20 h-14 sm:h-16 2xl:h-18 flex items-center justify-between px-3 sm:px-5 lg:px-6 2xl:px-8 transition-all duration-200">
          {/* Lado izquierdo: Título / Identificador de marca */}
          <div className="flex items-center gap-2">
            <div className="font-display font-extrabold text-base sm:text-lg 2xl:text-xl tracking-tight rysa-header-title flex items-center gap-2">
              <span>Grupo RYSA</span>
              <span className="hidden md:inline-block w-1.5 h-1.5 rounded-full bg-[#B95A3A]/40" />
              <span className="hidden md:inline-block text-xs font-normal text-slate-400 tracking-normal font-sans">Sistema ERP</span>
            </div>
          </div>

          {/* Lado derecho: Timbres, Perfil de Usuario y Logout */}
          <div className="flex items-center gap-2 sm:gap-4">
            {timbres && timbres.configurado && (
              <div
                title="Timbres CFDI disponibles"
                data-testid="timbres-badge"
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold tracking-wide transition-all ${
                  timbres.alerta ? "rysa-header-badge-alert" : "rysa-header-badge-success"
                }`}
              >
                <Stamp className="w-3.5 h-3.5 shrink-0" strokeWidth={2.2} />
                <span>{timbres.disponibles ?? "—"}</span>
                <span className="hidden sm:inline">timbres</span>
              </div>
            )}

            {/* Información del usuario */}
            <div className="flex items-center gap-2.5 sm:gap-3 pl-1 sm:pl-2 border-l border-slate-200/80">
              <div className="text-right leading-tight hidden sm:block">
                <div className="text-xs sm:text-sm font-semibold rysa-header-user-name tracking-tight" data-testid="user-name">
                  {user?.name}
                </div>
                <div className="inline-block px-1.5 py-0.2 rounded text-[10px] uppercase font-bold tracking-wider rysa-header-user-role mt-0.5">
                  {user?.role}
                </div>
              </div>

              {/* Avatar */}
              <div className="w-8 h-8 sm:w-9 sm:h-9 2xl:w-10 2xl:h-10 rounded-full rysa-header-avatar flex items-center justify-center font-bold text-xs sm:text-sm shrink-0 select-none">
                {user?.name?.[0]?.toUpperCase() || "U"}
              </div>

              {/* Botón de Salir */}
              <button
                onClick={doLogout}
                data-testid="logout-btn"
                title="Cerrar sesión"
                className="p-1.5 sm:p-2 rysa-header-btn-logout flex items-center justify-center"
              >
                <LogOut className="w-4 h-4 sm:w-5 sm:h-5" strokeWidth={2} />
              </button>
            </div>
          </div>
        </header>
        <main className="flex-1 p-6 overflow-x-hidden">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
