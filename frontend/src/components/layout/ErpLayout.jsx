import { NavLink, Outlet, useNavigate, useLocation } from "react-router-dom";
import { useState, useEffect } from "react";
import { useAuth } from "@/context/AuthContext";
import { useBranding } from "@/hooks/useBranding";
import { api } from "@/lib/api";
import {
  LayoutDashboard, Package, Users, Wallet, ShoppingCart, Receipt,
  UserCog, ScrollText, LogOut, Menu, ChevronLeft, Boxes, Settings, Tags, HandCoins, FileText, Stamp, BarChart3, Smartphone, Bug,
  Search, ChevronRight,
} from "lucide-react";
import {
  Command, CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator,
} from "@/components/ui/command";

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
  { to: "/app/cxc", label: "Cuentas por Cobrar", icon: HandCoins, perm: "cxc.ver" },
  { to: "/app/caja", label: "Caja", icon: Wallet, perm: "caja.ver" },
  { to: "/app/usuarios", label: "Usuarios", icon: UserCog, perm: "usuarios.ver" },
  { to: "/app/auditoria", label: "Auditoría", icon: ScrollText, perm: "auditoria.ver" },
  { to: "/app/configuracion", label: "Configuración", icon: Settings, perm: "config" },
  { to: "/app/devtools", label: "Depuración", icon: Bug, perm: "dev.errores", dev: true },
];

export default function ErpLayout() {
  const { user, logout, can } = useAuth();
  const { logo } = useBranding();
  const logoUrl = logo || "";
  const nav = useNavigate();
  const { pathname } = useLocation();
  const [collapsed, setCollapsed] = useState(true);
  const [searchOpen, setSearchOpen] = useState(false);

  const doLogout = async () => { await logout(); nav("/login"); };

  const [timbres, setTimbres] = useState(null);
  useEffect(() => {
    api.get("/facturacion/timbres").then((r) => setTimbres(r.data)).catch(() => {});
  }, []);

  const [cajaOpen, setCajaOpen] = useState(null);
  const [cajaUser, setCajaUser] = useState("");
  useEffect(() => {
    const load = () => {
      api.get("/caja/actual").then((r) => {
        setCajaOpen(!!r.data?.caja);
        setCajaUser(r.data?.caja?.usuario_nombre || "");
      }).catch(() => { setCajaOpen(false); setCajaUser(""); });
    };
    load();
    const id = setInterval(load, 30000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const visible = NAV.filter((n) => !n.perm || can(n.perm));

  const current =
    visible
      .filter((n) => pathname === n.to || pathname.startsWith(n.to + "/"))
      .sort((a, b) => b.to.length - a.to.length)[0] || null;

  const ACTIONS = [
    { to: "/app/pos", label: "Nueva venta", icon: ShoppingCart, perm: "venta.crear" },
    { to: "/app/recargas", label: "Registrar recarga", icon: Smartphone, perm: "venta.crear" },
    { to: "/app/caja", label: "Abrir / cerrar caja", icon: Wallet, perm: "caja.abrir" },
    { to: "/app/productos", label: "Nuevo producto", icon: Package },
    { to: "/app/clientes", label: "Registrar cliente", icon: Users },
    { to: "/app/configuracion", label: "Ajustes del sistema", icon: Settings, perm: "config" },
  ].filter((a) => !a.perm || can(a.perm));

  const run = (to) => { setSearchOpen(false); nav(to); };

  const iconClass = ({ isActive }) =>
    `flex items-center justify-center rounded-xl h-11 w-11 mx-auto transition-colors ${
      isActive
        ? "bg-terracota text-white"
        : "text-slate-400 hover:bg-slate-100 hover:text-slate-700"
    }`;

  return (
    <div className="min-h-screen flex bg-canvas">
      {/* Sidebar izquierdo: solo iconos, angosto */}
      <aside
        data-testid="sidebar"
        className={`${collapsed ? "w-[76px] items-center" : "w-52 items-stretch px-3"} shrink-0 bg-white border-r border-slate-100 flex flex-col py-4 gap-4 transition-[width] duration-200 sticky top-0 h-screen z-30`}
      >
        <div className={`flex items-center justify-center gap-2 ${collapsed ? "mx-auto h-11 w-11" : "px-2"}`}>
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 overflow-hidden ${logoUrl ? "" : "bg-terracota shadow-card"}`}>
            {logoUrl ? (
              <img src={logoUrl} alt="logo" className="w-full h-full object-contain" onError={(e) => { e.currentTarget.style.display = "none"; }} />
            ) : (
              <Boxes className="w-5 h-5 text-white" />
            )}
          </div>
          {!collapsed && (
            <div className="leading-tight">
              <div className="font-display font-extrabold text-slate-900 text-lg tracking-tight">RYSA</div>
              <div className="text-[10px] uppercase tracking-[0.2em] text-slate-400">ERP · POS</div>
            </div>
          )}
        </div>

        <nav className={collapsed ? "flex-1 flex flex-col items-center gap-1.5 overflow-y-auto" : "flex-1 space-y-1 overflow-y-auto"}>
          {visible.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              title={n.label}
              data-testid={`nav-${n.to.split("/").pop()}`}
              className={({ isActive }) =>
                collapsed
                  ? iconClass({ isActive })
                  : `flex items-center gap-3 px-3 h-11 rounded-xl text-sm font-medium transition-colors ${
                      isActive ? "bg-terracota text-white" : "text-slate-500 hover:bg-slate-100 hover:text-slate-800"
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
          className={`${collapsed ? "h-11 w-11 mx-auto" : "h-11 w-full"} flex items-center justify-center rounded-xl hover:bg-slate-100 transition-colors`}
          data-testid="toggle-sidebar"
          title={collapsed ? "Expandir" : "Colapsar"}
        >
          {collapsed ? <Menu className="w-5 h-5 text-slate-400" /> : <ChevronLeft className="w-5 h-5 text-slate-400" />}
        </button>
      </aside>

      <div className="flex-1 flex flex-col min-w-0 bg-canvas">
        {/* Navbar superior: breadcrumb + búsqueda global (sin navegación) */}
        <header className="sticky top-0 z-20 h-16 bg-white/90 backdrop-blur-md border-b border-slate-100 flex items-center justify-between gap-3 sm:gap-6 px-4 sm:px-6 shadow-[0_1px_2px_rgba(26,26,26,0.03)]">
          {/* Breadcrumb del módulo actual */}
          <div className="flex items-center gap-2 shrink-0 min-w-0">
            {current ? (
              <>
                <current.icon className="w-5 h-5 text-terracota shrink-0" strokeWidth={2} />
                <span className="font-display font-semibold text-slate-900 truncate">{current.label}</span>
              </>
            ) : (
              <span className="font-display font-extrabold tracking-tight text-slate-900">Grupo RYSA</span>
            )}
            <span className="hidden md:inline-flex items-center text-xs font-sans font-normal text-slate-400">
              <ChevronRight className="w-3.5 h-3.5 mx-1 text-slate-300" />
              Sistema ERP
            </span>
          </div>

          {/* Búsqueda global */}
          <button
            onClick={() => setSearchOpen(true)}
            data-testid="global-search"
            className="flex items-center gap-2 flex-1 max-w-md h-10 px-3.5 rounded-full bg-slate-100 text-slate-400 hover:bg-slate-200/70 hover:text-slate-500 transition-colors"
          >
            <Search className="w-4 h-4 shrink-0" strokeWidth={2} />
            <span className="text-sm truncate">Buscar módulo o acción…</span>
            <kbd className="ml-auto hidden sm:inline-flex items-center h-5 px-1.5 rounded-md bg-white border border-slate-200 text-[10px] font-semibold text-slate-400">Ctrl K</kbd>
          </button>

          {/* Derecha: caja, timbres, perfil y logout */}
          <div className="flex items-center gap-1.5 sm:gap-3 shrink-0">
            {cajaOpen !== null && (
              <div
                title={cajaOpen ? `Caja abierta por ${cajaUser}` : "No hay caja abierta"}
                data-testid="caja-status"
                className={`hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold tracking-wide transition-all ${
                  cajaOpen ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-500"
                }`}
              >
                <span className={`dot ${cajaOpen ? "dot-success" : "dot-muted"}`} />
                <span>{cajaOpen ? "Caja abierta" : "Caja cerrada"}</span>
                {cajaOpen && cajaUser && <span className="hidden lg:inline opacity-70">· {cajaUser}</span>}
              </div>
            )}

            {timbres && timbres.configurado && (
              <div
                title="Timbres CFDI disponibles"
                data-testid="timbres-badge"
                className={`hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold tracking-wide transition-all ${
                  timbres.alerta ? "rysa-header-badge-alert" : "rysa-header-badge-success"
                }`}
              >
                <Stamp className="w-3.5 h-3.5 shrink-0" strokeWidth={2.2} />
                <span>{timbres.disponibles ?? "—"}</span>
                <span className="hidden lg:inline">timbres</span>
              </div>
            )}

            <div className="flex items-center gap-2.5 sm:gap-3 pl-1 sm:pl-2 border-l border-slate-200/80">
              <div className="text-right leading-tight hidden sm:block">
                <div className="text-xs sm:text-sm font-semibold text-slate-800 tracking-tight" data-testid="user-name">
                  {user?.name}
                </div>
                <div className="inline-block px-1.5 py-0.5 rounded-full text-[10px] uppercase font-bold tracking-wider rysa-header-user-role mt-0.5">
                  {user?.role}
                </div>
              </div>

              <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-full bg-gradient-to-br from-terracota to-terracota-dark text-white flex items-center justify-center font-bold text-xs sm:text-sm shrink-0 select-none shadow-card">
                {user?.name?.[0]?.toUpperCase() || "U"}
              </div>

              <button
                onClick={doLogout}
                data-testid="logout-btn"
                title="Cerrar sesión"
                className="h-9 w-9 flex items-center justify-center rounded-full text-slate-400 hover:bg-red-50 hover:text-red-600 transition-colors"
              >
                <LogOut className="w-[18px] h-[18px]" strokeWidth={2} />
              </button>
            </div>
          </div>
        </header>

        {/* Command palette: búsqueda global */}
        <CommandDialog open={searchOpen} onOpenChange={setSearchOpen}>
          <CommandInput placeholder="Buscar módulo, sección o acción…" />
          <CommandList>
            <CommandEmpty>Sin resultados.</CommandEmpty>
            <CommandGroup heading="Ir a">
              {visible.map((n) => (
                <CommandItem key={n.to} value={`${n.label} ${n.to} ir navegar`} onSelect={() => run(n.to)} data-testid={`palette-${n.to.split("/").pop()}`}>
                  <n.icon className="text-terracota" strokeWidth={2} />
                  <span>{n.label}</span>
                </CommandItem>
              ))}
            </CommandGroup>
            <CommandSeparator />
            <CommandGroup heading="Acciones rápidas">
              {ACTIONS.map((a) => (
                <CommandItem key={a.label} value={`${a.label} acción hacer`} onSelect={() => run(a.to)}>
                  <a.icon className="text-slate-400" strokeWidth={2} />
                  <span>{a.label}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </CommandDialog>

        <main className="flex-1 p-4 sm:p-6 lg:p-8 overflow-x-hidden">
          <Outlet />
        </main>
      </div>
    </div>
  );
}