import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useState } from "react";
import { useAuth } from "@/context/AuthContext";
import {
  LayoutDashboard, Package, Users, Wallet, ShoppingCart, Receipt,
  UserCog, ScrollText, LogOut, Menu, ChevronLeft, Boxes,
} from "lucide-react";

const NAV = [
  { to: "/app/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/app/pos", label: "Punto de Venta", icon: ShoppingCart, perm: "venta.crear" },
  { to: "/app/ventas", label: "Ventas", icon: Receipt },
  { to: "/app/productos", label: "Productos", icon: Package },
  { to: "/app/clientes", label: "Clientes", icon: Users },
  { to: "/app/caja", label: "Caja", icon: Wallet, perm: "caja.abrir" },
  { to: "/app/usuarios", label: "Usuarios", icon: UserCog, perm: "usuarios.ver" },
  { to: "/app/auditoria", label: "Auditoría", icon: ScrollText, perm: "reportes.ver" },
];

export default function ErpLayout() {
  const { user, logout, can } = useAuth();
  const nav = useNavigate();
  const [collapsed, setCollapsed] = useState(false);

  const doLogout = async () => { await logout(); nav("/login"); };

  return (
    <div className="min-h-screen flex bg-[#F1F5F9]">
      <aside
        data-testid="sidebar"
        className={`${collapsed ? "w-[68px]" : "w-64"} shrink-0 bg-[#0F172A] text-slate-300 flex flex-col transition-[width] duration-200 sticky top-0 h-screen`}
      >
        <div className="h-16 flex items-center gap-2 px-4 border-b border-white/10">
          <div className="w-9 h-9 rounded-md bg-[#FF5A00] flex items-center justify-center shrink-0">
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
                  isActive ? "bg-[#0055A4] text-white" : "hover:bg-white/10 hover:text-white"
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

      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-6 sticky top-0 z-20">
          <div className="font-display font-bold text-slate-800 text-lg">Grupo RYSA</div>
          <div className="flex items-center gap-4">
            <div className="text-right leading-tight">
              <div className="text-sm font-semibold text-slate-800" data-testid="user-name">{user?.name}</div>
              <div className="text-xs uppercase tracking-wider text-[#FF5A00] font-medium">{user?.role}</div>
            </div>
            <div className="w-9 h-9 rounded-full bg-[#0055A4] text-white flex items-center justify-center font-semibold">
              {user?.name?.[0]?.toUpperCase()}
            </div>
            <button onClick={doLogout} data-testid="logout-btn"
              className="p-2 rounded-md hover:bg-slate-100 text-slate-500 hover:text-red-600 transition-colors">
              <LogOut className="w-5 h-5" />
            </button>
          </div>
        </header>
        <main className="flex-1 p-6 overflow-x-hidden">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
