import React from "react";
import { NavLink, Outlet, useNavigate, useLocation } from "react-router-dom";
import { useState, useEffect } from "react";
import { useAuth } from "@/context/AuthContext";
import { toast } from "sonner";
import { api } from "@/lib/api";
import AutorizacionesRemotas from "@/components/AutorizacionesRemotas";
import { ConfirmProvider } from "@/components/ConfirmProvider";
import ErrorBoundary from "@/components/ErrorBoundary";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  LayoutDashboard, Package, Users, Wallet, ShoppingCart, Receipt,
  UserCog, ScrollText, LogOut, Menu, ChevronLeft, Settings, HandCoins, FileText, Stamp, BarChart3, Smartphone, Wrench,
  Search, ChevronDown, Radar, Route as RouteIcon, ShoppingBag, Truck, Images, ClipboardList, FileSignature, PieChart,
  CreditCard, ShieldCheck, UserRound, Mail, MessageCircle,
} from "lucide-react";
import {
  CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";

// Cada módulo aparece UNA sola vez y con el mismo permiso que exige su ruta
// en App.js, para que nadie vea un acceso que luego lo rechaza.
// Sucursales, impresoras y cuentas bancarias viven en Configuración (pestañas);
// Categorías vive dentro de Inventario (botón en la cabecera de Productos).
const NAV = [
  // PRINCIPAL
  { to: "/app/dashboard", label: "Tablero", icon: LayoutDashboard, section: "PRINCIPAL" },

  // OPERACIÓN Y VENTAS
  { to: "/app/pos", label: "Punto de venta", icon: ShoppingCart, perm: "venta.crear", section: "OPERACIÓN Y VENTAS" },
  { to: "/app/ventas", label: "Ventas", icon: Receipt, perm: "venta.crear", section: "OPERACIÓN Y VENTAS" },
  { to: "/app/catalogo", label: "Catálogo", icon: Images, perm: "catalogo.ver", section: "OPERACIÓN Y VENTAS" },
  { to: "/app/inventario", label: "Inventario", icon: Package, perm: "producto.crear", section: "OPERACIÓN Y VENTAS" },
  { to: "/app/clientes", label: "Clientes", icon: Users, perm: "clientes.gestionar", section: "OPERACIÓN Y VENTAS" },
  { to: "/app/cxc", label: "Cuentas por cobrar", icon: HandCoins, perm: "cxc.ver", section: "OPERACIÓN Y VENTAS" },
  { to: "/app/recargas", label: "Recargas y servicios", icon: Smartphone, perm: "recargas.usar", section: "OPERACIÓN Y VENTAS" },

  // ABASTECIMIENTO
  { to: "/app/compras", label: "Compras y gastos", icon: ShoppingBag, perm: "compra.ver", section: "ABASTECIMIENTO" },
  { to: "/app/proveedores", label: "Proveedores", icon: Truck, perm: "proveedor.ver", section: "ABASTECIMIENTO" },
  { to: "/app/cxp", label: "Cuentas por pagar", icon: CreditCard, perm: "cxp.pagar", section: "ABASTECIMIENTO" },

  // COMERCIAL
  { to: "/app/cotizaciones", label: "Cotizaciones", icon: FileSignature, perm: "venta.crear", section: "COMERCIAL" },
  { to: "/app/pedidos", label: "Pedidos", icon: ClipboardList, perm: "pedido.gestionar", section: "COMERCIAL" },
  { to: "/app/facturacion", label: "Facturación", icon: FileText, perm: "venta.facturar", section: "COMERCIAL" },
  { to: "/app/correo", label: "Correo", icon: Mail, perm: "correo.ver", section: "COMERCIAL" },
  { to: "/app/whatsapp", label: "WhatsApp · Agente", icon: MessageCircle, perm: "whatsapp.ver", section: "COMERCIAL" },

  // FUERZA DE VENTAS · consolidada en 2 módulos por rol (regla 1):
  //   · Supervisión Comercial: solo admin/dueño/supervisor (supervision.ver)
  //   · Mi Actividad de Campo: solo vendedores de campo (visita.*), oculta si
  //     el usuario ya ve Supervisión (los admins usan el toggle interno
  //     "Actuar como vendedor" dentro del propio módulo).
  { to: "/app/supervision-comercial", label: "Supervisión comercial", icon: Radar, perm: "supervision.ver", section: "FUERZA DE VENTAS" },
  { to: "/app/mi-actividad", label: "Mi actividad de campo", icon: RouteIcon, perm: "visita.ver", ocultoConPerm: "supervision.ver", section: "FUERZA DE VENTAS" },
  
  // ADMINISTRACIÓN
  { to: "/app/caja", label: "Caja", icon: Wallet, perm: "caja.ver", section: "ADMINISTRACIÓN" },
  { to: "/app/finanzas", label: "Finanzas", icon: PieChart, perm: "finanzas.ver", section: "ADMINISTRACIÓN" },
  { to: "/app/reportes", label: "Reportes", icon: BarChart3, perm: "reportes.ver", section: "ADMINISTRACIÓN" },

  // SISTEMA
  { to: "/app/usuarios", label: "Usuarios y permisos", icon: UserCog, perm: "usuarios.ver", section: "SISTEMA" },
  { to: "/app/configuracion", label: "Configuración", icon: Settings, perm: "config", section: "SISTEMA" },
  { to: "/app/machotes", label: "Formatos de documentos", icon: ScrollText, perm: "config", section: "SISTEMA" },
  { to: "/app/auditoria", label: "Auditoría", icon: ShieldCheck, perm: "auditoria.ver", section: "SISTEMA" },
  { to: "/app/devtools", label: "Desarrollador", icon: Wrench, perm: "dev.errores", dev: true, section: "SISTEMA" },
];

// Mi cuenta no va en el menú: se abre desde el nombre del usuario (barra superior).
const MI_CUENTA = { to: "/app/mi-cuenta", label: "Mi cuenta", icon: UserRound };

export default function ErpLayout() {
  const { user, logout, can } = useAuth();
  const nav = useNavigate();
  const { pathname } = useLocation();
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem("rysa_sidebar_collapsed") === "true";
    } catch {
      return false;
    }
  });
  const [searchOpen, setSearchOpen] = useState(false);
  // En el Punto de venta el menú se contrae solo para dar espacio al ticket;
  // se puede abrir ahí mismo sin cambiar la preferencia guardada, y al salir
  // del POS vuelve a como estaba.
  const enPOS = pathname.startsWith("/app/pos");
  const [posExpandido, setPosExpandido] = useState(false);
  useEffect(() => { if (!enPOS) setPosExpandido(false); }, [enPOS]);
  // Celular y tableta vertical: el menú se abre con un botón y cubre la
  // pantalla; en escritorio es fijo (completo o contraído a iconos).
  const [esEscritorio, setEsEscritorio] = useState(() => window.matchMedia?.("(min-width: 1024px)").matches ?? true);
  const [menuMovil, setMenuMovil] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia?.("(min-width: 1024px)");
    if (!mq) return undefined;
    const fn = (e) => setEsEscritorio(e.matches);
    mq.addEventListener?.("change", fn);
    return () => mq.removeEventListener?.("change", fn);
  }, []);
  useEffect(() => { setMenuMovil(false); }, [pathname]);
  const contraido = esEscritorio && (enPOS ? !posExpandido : collapsed);
  const anchoMenu = esEscritorio ? (contraido ? "72px" : "240px") : "0px";

  // Guardar preferencia de colapso en localStorage
  const handleToggleCollapsed = () => {
    if (enPOS) { setPosExpandido((v) => !v); return; }
    setCollapsed((prev) => {
      const next = !prev;
      try { localStorage.setItem("rysa_sidebar_collapsed", String(next)); } catch {}
      return next;
    });
  };

  const DEFAULT_SECTIONS = {
    "PRINCIPAL": true,
    "OPERACIÓN Y VENTAS": true,
    "ABASTECIMIENTO": false,
    "COMERCIAL": false,
    "FUERZA DE VENTAS": true,
    "ADMINISTRACIÓN": false,
    "SISTEMA": false,
  };

  // Acordeón persistente con localStorage
  const [openSections, setOpenSections] = useState(() => {
    try {
      const saved = localStorage.getItem("rysa_sidebar_accordions");
      if (saved) return { ...DEFAULT_SECTIONS, ...JSON.parse(saved) };
    } catch {}
    return DEFAULT_SECTIONS;
  });

  const toggleSection = (sec) => {
    setOpenSections((prev) => {
      const next = { ...prev, [sec]: !prev[sec] };
      try { localStorage.setItem("rysa_sidebar_accordions", JSON.stringify(next)); } catch {}
      return next;
    });
  };

  // Mantener expandida automáticamente la sección que contiene la ruta activa actual
  useEffect(() => {
    const currentItem = NAV.find((n) => n.to === pathname || (n.to !== "/app/dashboard" && pathname.startsWith(n.to)));
    if (currentItem?.section && !openSections[currentItem.section]) {
      setOpenSections((prev) => {
        const next = { ...prev, [currentItem.section]: true };
        try { localStorage.setItem("rysa_sidebar_accordions", JSON.stringify(next)); } catch {}
        return next;
      });
    }
  }, [pathname]);

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

  // Notificación en vivo: comprobantes de pago enviados desde el QR (§12).
  const puedeRevisarCxc = can("cxc.abono");
  const [evPendientes, setEvPendientes] = useState(0);
  useEffect(() => {
    if (!puedeRevisarCxc) return;
    let prev = null;
    const tick = async () => {
      try {
        const { data } = await api.get("/comprobantes-pago/pendientes");
        setEvPendientes(data.total || 0);
        if (prev !== null && (data.total || 0) > prev) {
          toast.info(`📥 Nuevo comprobante de pago recibido (${data.total} por revisar)`, {
            action: { label: "Ver", onClick: () => nav("/app/cotizaciones") },
          });
        }
        prev = data.total || 0;
      } catch { /* silencioso */ }
    };
    tick();
    const id = setInterval(tick, 60000);
    return () => clearInterval(id);
  }, [puedeRevisarCxc]);

  // Visibilidad: permiso requerido + ocultamiento por permiso excluyente
  // (p. ej. Mi Actividad se oculta para quien ya ve Supervisión Comercial).
  const visible = NAV.filter((n) =>
    (!n.perm || can(n.perm)) && !(n.ocultoConPerm && can(n.ocultoConPerm)));

  const current = pathname === MI_CUENTA.to ? MI_CUENTA :
    visible
      .filter((n) => pathname === n.to || pathname.startsWith(n.to + "/"))
      .sort((a, b) => b.to.length - a.to.length)[0] || null;

  const run = (to) => { setSearchOpen(false); nav(to); };

  // Densidad del ERP (87.5 %): solo mientras se está dentro del sistema.
  useEffect(() => {
    document.documentElement.classList.add("erp-densidad");
    return () => document.documentElement.classList.remove("erp-densidad");
  }, []);

  const visibleGrouped = (() => {
    const groups = {};
    visible.forEach((n) => {
      const sec = n.section || "OTHERS";
      if (!groups[sec]) groups[sec] = [];
      groups[sec].push(n);
    });
    return groups;
  })();

  const sectionsOrder = ["PRINCIPAL", "OPERACIÓN Y VENTAS", "ABASTECIMIENTO", "COMERCIAL", "FUERZA DE VENTAS", "ADMINISTRACIÓN", "SISTEMA"];
  const seccionLabel = (sec) => sec.charAt(0) + sec.slice(1).toLowerCase();

  return (
    <TooltipProvider delayDuration={120} skipDelayDuration={300}>
    <ConfirmProvider>
    <div className="min-h-[var(--erp-vh)] flex bg-canvas" style={{ "--sidebar-w": anchoMenu }}>
      {!esEscritorio && menuMovil && (
        <div className="fixed inset-0 z-40 bg-carbon-950/50 backdrop-blur-[1px] animate-in fade-in-0" onClick={() => setMenuMovil(false)} aria-hidden="true" />
      )}
      {/* Barra lateral en carbón: marca arriba, secciones en acordeón,
          indicador rojo en el módulo activo. */}
      <aside
        data-testid="sidebar"
        className={`${esEscritorio ? (contraido ? "w-[72px]" : "w-60") : "w-64"} grafito grano shrink-0 text-slate-300 flex flex-col ${esEscritorio ? "sticky z-30" : `fixed left-0 z-50 shadow-raised ${menuMovil ? "translate-x-0" : "-translate-x-full"}`} top-0 h-[var(--erp-vh)] transition-[width,transform] duration-200 ease-out-rysa`}
      >
        {/* Logotipo oficial para fondo oscuro (el mismo del sitio); colapsado,
            solo la "R" del isotipo. */}
        <div className={`flex items-center h-16 border-b border-white/[0.06] ${contraido ? "justify-center" : "px-5"}`}>
          {contraido ? (
            <img src="/brand/isotipo-oscuro.webp" alt="Grupo RYSA" width="240" height="161" className="h-7 w-auto" />
          ) : (
            <img src="/brand/logotipo-oscuro.webp" alt="Grupo RYSA" width="900" height="424" className="h-10 w-auto" />
          )}
        </div>

        <nav aria-label="Módulos del sistema" className={`flex-1 overflow-y-auto overflow-x-hidden py-3 ${contraido ? "px-2" : "px-3"}`}>
          {sectionsOrder.map((sec) => {
            const items = visibleGrouped[sec];
            if (!items || items.length === 0) return null;
            const isOpen = openSections[sec] !== false;
            const activaAqui = items.some((n) => current?.to === n.to);
            return (
              <div key={sec} className="mb-1">
                {contraido ? (
                  <div className="mx-auto my-2 h-px w-6 bg-brand-400/30" />
                ) : (
                  // Encabezado de sección en rojo claro de la marca (legible sobre
                  // grafito: 5:1) con un brillo rojo suave; los módulos quedan en gris.
                  <button
                    type="button"
                    onClick={() => toggleSection(sec)}
                    aria-expanded={isOpen}
                    className="w-full flex items-center justify-between px-2 pt-3 pb-1.5 text-2xs font-bold uppercase tracking-[0.12em] text-brand-300 [text-shadow:0_0_12px_rgba(235,15,17,0.45)] hover:text-brand-200 hover:[text-shadow:0_0_14px_rgba(235,15,17,0.7)] transition-[color,text-shadow] duration-200"
                  >
                    <span className="flex items-center gap-2 truncate">
                      {seccionLabel(sec)}
                      {!isOpen && activaAqui && <span className="h-1.5 w-1.5 rounded-full bg-brand-500" aria-hidden="true" />}
                    </span>
                    <ChevronDown className={`w-3.5 h-3.5 shrink-0 transition-transform duration-200 ${isOpen ? "" : "-rotate-90"}`} />
                  </button>
                )}
                {(contraido || isOpen) && (
                  <ul className={contraido ? "flex flex-col items-center gap-1" : "space-y-0.5"}>
                    {items.map((n) => {
                      const enlace = (
                        <NavLink
                          to={n.to}
                          aria-label={n.label}
                          data-testid={`nav-${n.to.split("/").pop()}`}
                          className={({ isActive }) =>
                            contraido
                              // Contraído: el recuadro crece y brilla al pasar el cursor
                              // o con el teclado; el nombre sale en la etiqueta flotante.
                              ? `relative flex h-10 w-10 items-center justify-center rounded-md transition-[transform,background-color,box-shadow,color] duration-150 ease-out-rysa motion-reduce:transition-none motion-reduce:hover:scale-100 hover:scale-110 hover:bg-white/[0.10] hover:text-white hover:shadow-[0_0_0_1px_rgba(242,122,124,.35),0_0_18px_-4px_rgba(235,15,17,.6)] focus-visible:outline-none focus-visible:scale-110 focus-visible:ring-2 focus-visible:ring-brand-400 ${
                                  isActive ? "bg-white/[0.08] text-white" : "text-slate-300"
                                }`
                              : `group relative flex items-center gap-3 h-9 pl-3 pr-2 rounded-md text-[0.9rem] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 ${
                                  isActive ? "bg-white/[0.08] text-white font-semibold" : "text-slate-300 hover:bg-white/[0.06] hover:text-white"
                                }`
                          }
                        >
                          {({ isActive }) => (
                            <>
                              {isActive && <span className={`absolute ${contraido ? "-left-2" : "-left-3"} top-1.5 bottom-1.5 w-[3px] rounded-r bg-brand-500`} aria-hidden="true" />}
                              <n.icon className={`w-[18px] h-[18px] shrink-0 transition-transform duration-150 ${contraido ? "" : "group-hover:scale-110 motion-reduce:group-hover:scale-100"} ${isActive ? "text-brand-400" : ""}`} strokeWidth={1.9} />
                              {!contraido && <span className="truncate animate-in fade-in-0 duration-200">{n.label}</span>}
                            </>
                          )}
                        </NavLink>
                      );
                      return (
                        <li key={n.to} className={contraido ? "" : "w-full"}>
                          {contraido ? (
                            <Tooltip>
                              <TooltipTrigger asChild>{enlace}</TooltipTrigger>
                              <TooltipContent side="right" sideOffset={14}
                                className="bg-carbon-950 text-white border border-white/10 shadow-raised text-xs font-medium">
                                {n.label}
                              </TooltipContent>
                            </Tooltip>
                          ) : enlace}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            );
          })}
        </nav>

        <button
          onClick={esEscritorio ? handleToggleCollapsed : () => setMenuMovil(false)}
          className={`flex items-center gap-2 h-12 border-t border-white/[0.06] text-slate-400 hover:text-white transition-colors ${contraido ? "justify-center" : "px-5"}`}
          data-testid="toggle-sidebar"
          title={!esEscritorio ? "Cerrar menú" : contraido ? "Expandir menú" : "Contraer menú"}
          aria-label={!esEscritorio ? "Cerrar menú" : contraido ? "Expandir menú" : "Contraer menú"}
        >
          {contraido ? <Menu className="w-5 h-5" /> : <><ChevronLeft className="w-4 h-4" /><span className="text-sm">{esEscritorio ? "Contraer" : "Cerrar menú"}</span></>}
        </button>
      </aside>

      <div className="flex-1 flex flex-col min-w-0 bg-canvas">
        {/* Barra superior: módulo actual, búsqueda global, estado y perfil */}
        <header className="sticky top-0 z-20 h-16 bg-white/95 backdrop-blur-md border-b border-slate-200 flex items-center justify-between gap-3 sm:gap-6 px-4 sm:px-6">
          <div className="flex items-center gap-2.5 shrink-0 min-w-0">
            {!esEscritorio && (
              <button type="button" onClick={() => setMenuMovil(true)} className="-ml-1 flex h-9 w-9 items-center justify-center rounded-md text-slate-600 hover:bg-slate-100"
                aria-label="Abrir menú" title="Abrir menú" data-testid="abrir-menu-movil">
                <Menu className="h-5 w-5" />
              </button>
            )}
            {current ? (
              <>
                <span className="flex h-8 w-8 items-center justify-center rounded-md bg-brand-50 text-brand-600"><current.icon className="w-[18px] h-[18px]" strokeWidth={2} /></span>
                <h1 className="font-display text-[1.05rem] font-bold text-slate-900 truncate">{current.label}</h1>
              </>
            ) : (
              <h1 className="font-display text-[1.05rem] font-bold text-slate-900">Grupo RYSA</h1>
            )}
          </div>

          <button
            onClick={() => setSearchOpen(true)}
            data-testid="global-search"
            className="flex items-center gap-2 flex-1 max-w-md h-10 px-3.5 rounded-md border border-slate-200 bg-slate-50 text-slate-500 hover:border-slate-300 hover:bg-white transition-colors"
          >
            <Search className="w-4 h-4 shrink-0" strokeWidth={2} />
            <span className="text-sm truncate">Buscar módulo o acción…</span>
            <kbd className="ml-auto hidden sm:inline-flex items-center h-5 px-1.5 rounded border border-slate-200 bg-white text-2xs font-semibold text-slate-500">Ctrl K</kbd>
          </button>

          <div className="flex items-center gap-1.5 sm:gap-3 shrink-0">
            {cajaOpen !== null && (
              <div
                title={cajaOpen ? `Caja abierta por ${cajaUser}` : "No hay caja abierta"}
                data-testid="caja-status"
                className={`hidden sm:flex items-center gap-1.5 h-7 px-2.5 rounded-md text-xs font-semibold ${
                  cajaOpen ? "bg-green-50 text-success ring-1 ring-green-200" : "bg-slate-100 text-slate-600"
                }`}
              >
                <span className={`dot ${cajaOpen ? "dot-success" : "dot-muted"}`} />
                <span>{cajaOpen ? "Caja abierta" : "Caja cerrada"}</span>
                {cajaOpen && cajaUser && <span className="hidden lg:inline font-normal opacity-80">· {cajaUser}</span>}
              </div>
            )}

            {timbres && timbres.configurado && (
              <div
                title="Timbres CFDI disponibles"
                data-testid="timbres-badge"
                className={`hidden sm:flex items-center gap-1.5 h-7 px-2.5 rounded-md text-xs font-semibold ${
                  timbres.alerta ? "rysa-header-badge-alert" : "rysa-header-badge-success"
                }`}
              >
                <Stamp className="w-3.5 h-3.5 shrink-0" strokeWidth={2.2} />
                <span className="cifras">{timbres.disponibles ?? "·"}</span>
                <span className="hidden lg:inline font-normal">timbres</span>
              </div>
            )}

            <div className="flex items-center gap-1.5 sm:gap-2 pl-2 sm:pl-3 border-l border-slate-200">
              <NavLink
                to={MI_CUENTA.to}
                title="Mi cuenta"
                data-testid="mi-cuenta-link"
                className="flex items-center gap-2.5 sm:gap-3 rounded-md px-1.5 py-1 hover:bg-slate-100 transition-colors"
              >
                <div className="text-right leading-tight hidden sm:block">
                  <div className="text-sm font-semibold text-slate-900" data-testid="user-name">{user?.name}</div>
                  <div className="text-2xs uppercase tracking-[0.08em] font-semibold text-slate-500 mt-0.5">{(user?.role || "").replace(/_/g, " ")}</div>
                </div>
                <div className="w-9 h-9 rounded-md bg-carbon-900 text-white flex items-center justify-center font-display font-bold text-sm shrink-0 select-none">
                  {user?.name?.[0]?.toUpperCase() || "U"}
                </div>
              </NavLink>
              <button
                onClick={doLogout}
                data-testid="logout-btn"
                title="Cerrar sesión"
                aria-label="Cerrar sesión"
                className="h-9 w-9 flex items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-900 transition-colors"
              >
                <LogOut className="w-[18px] h-[18px]" strokeWidth={2} />
              </button>
            </div>
          </div>
        </header>

        {/* Command palette: búsqueda global */}
        <CommandDialog open={searchOpen} onOpenChange={setSearchOpen}>
          <CommandInput placeholder="Buscar módulo…" />
          <CommandList>
            <CommandEmpty>Sin resultados.</CommandEmpty>
            <CommandGroup heading="Ir a">
              {visible.map((n) => (
                <CommandItem key={n.to} value={`${n.label} ${n.to} ir navegar`} onSelect={() => run(n.to)} data-testid={`palette-${n.to.split("/").pop()}`}>
                  <n.icon className="text-brand-600" strokeWidth={2} />
                  <span>{n.label}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </CommandDialog>

        <main className="flex-1 p-4 sm:p-6 lg:p-8 overflow-x-hidden">
          {/* Un error en una pantalla ya no tumba toda la app: el menú sigue disponible. */}
          <ErrorBoundary key={pathname} compacto>
            <Outlet />
          </ErrorBoundary>
        </main>
      </div>
      <AutorizacionesRemotas />
    </div>
    </ConfirmProvider>
    </TooltipProvider>
  );
}

