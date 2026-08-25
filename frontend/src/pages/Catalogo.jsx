import { useEffect, useMemo, useState } from "react";
import { api, money, fileUrl } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Loader2, Images, Search, PackageX, RefreshCw } from "lucide-react";

/**
 * CATÁLOGO por categoría — módulo de SOLO CONSULTA compartido por
 * vendedor de piso, cajera y vendedor de campo (§3.8).
 * Muestra imagen/nombre/categoría/precio público. NUNCA costo, stock
 * exacto ni utilidad.
 */
export default function Catalogo() {
  const [items, setItems] = useState(null);
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("");
  const [soloConExistencia, setSoloConExistencia] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/catalogo", { params: soloConExistencia ? { con_existencia: true } : {} });
      setItems(data || []);
    } catch { setItems([]); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [soloConExistencia]);

  const categorias = useMemo(() => {
    const s = new Set();
    (items || []).forEach((i) => { if (i.categoria) s.add(i.categoria); });
    return [...s].sort((a, b) => a.localeCompare(b));
  }, [items]);

  const filtrados = useMemo(() => (items || []).filter((p) => {
    if (cat && p.categoria !== cat) return false;
    if (q && !`${p.nombre} ${p.codigo}`.toLowerCase().includes(q.toLowerCase())) return false;
    return true;
  }), [items, q, cat]);

  return (
    <div className="space-y-4" data-testid="catalogo-page">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-black tracking-tight flex items-center gap-2">
            <Images className="w-6 h-6 text-[#C1401E]" /> Catálogo
          </h1>
          <p className="text-slate-500 text-sm">Productos disponibles para mostrar al cliente · {filtrados.length} artículos</p>
        </div>
        <Button variant="outline" onClick={load} data-testid="catalogo-refresh">
          <RefreshCw className={`w-4 h-4 mr-1 ${loading ? "animate-spin" : ""}`} /> Actualizar
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px] max-w-md">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar producto…" className="pl-9 h-9" data-testid="catalogo-q" />
        </div>
        <button onClick={() => setCat("")}
          className={`px-3 py-1.5 rounded-full text-xs border ${!cat ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-600 hover:bg-slate-50"}`}>
          Todas
        </button>
        {categorias.map((c) => (
          <button key={c} onClick={() => setCat(c === cat ? "" : c)}
            className={`px-3 py-1.5 rounded-full text-xs border ${cat === c ? "bg-[#C1401E] text-white border-[#C1401E]" : "bg-white text-slate-600 hover:bg-slate-50"}`}
            data-testid={`catalogo-cat-${c}`}>
            {c}
          </button>
        ))}
        <button onClick={() => setSoloConExistencia((v) => !v)}
          className={`ml-auto px-3 py-1.5 rounded-full text-xs border font-medium ${soloConExistencia ? "bg-green-600 text-white border-green-600" : "bg-white text-slate-600 hover:bg-slate-50"}`}
          data-testid="catalogo-solo-existencia">
          Solo con existencia
        </button>
      </div>

      {loading && !items ? (
        <div className="flex justify-center py-20"><Loader2 className="w-8 h-8 animate-spin text-[#C1401E]" /></div>
      ) : filtrados.length === 0 ? (
        <div className="card-soft p-12 text-center" data-testid="catalogo-vacio">
          <PackageX className="w-10 h-10 mx-auto text-slate-300 mb-3" />
          <p className="text-sm text-slate-500">Sin productos para esta búsqueda.</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4">
          {filtrados.map((p) => (
            <div key={p.id} className="card-soft overflow-hidden flex flex-col" data-testid={`catalogo-item-${p.codigo}`}>
              <div className="h-36 bg-slate-100 flex items-center justify-center overflow-hidden relative">
                {p.imagen ? (
                  <img src={fileUrl(p.imagen)} alt={p.nombre} loading="lazy"
                       className="w-full h-full object-cover" />
                ) : (
                  <Images className="w-10 h-10 text-slate-300" />
                )}
                {/* Existencia visible (§ actualizada: sí se muestra) */}
                <span className={`absolute top-2 right-2 px-1.5 py-0.5 rounded-full text-[10px] font-bold border ${
                  Number(p.existencia) <= 0 ? "bg-red-600 text-white border-red-600"
                    : Number(p.existencia) < 5 ? "bg-amber-500 text-white border-amber-500"
                    : "bg-white/90 text-slate-700 border-slate-200"}`}>
                  {Number(p.existencia) <= 0 ? "Agotado" : `Exist: ${p.existencia}`}
                </span>
              </div>
              <div className="p-3 flex-1 flex flex-col">
                <div className="font-semibold text-sm leading-snug line-clamp-2">{p.nombre}</div>
                {p.categoria && <Badge variant="outline" className="mt-1 w-fit text-[10px]">{p.categoria}</Badge>}
                <div className="mt-auto pt-2 flex items-center justify-between">
                  {Number(p.precio_publico) > 0
                    ? <span className="font-display font-black text-lg text-[#C1401E]">{money(p.precio_publico)}</span>
                    : <span className="text-xs text-slate-400">Precio a consultar</span>}
                  <span className={`text-[11px] tabular-nums ${Number(p.existencia) <= 0 ? "text-red-600 font-semibold" : "text-slate-500"}`}>
                    {Number(p.existencia)} pza
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
