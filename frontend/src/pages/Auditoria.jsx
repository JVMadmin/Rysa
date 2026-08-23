import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Loader2, ScrollText } from "lucide-react";

export default function Auditoria() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const load = () => {
    setLoading(true); setErr("");
    api.get("/audit")
      .then((r) => { setRows(r.data); setLoading(false); })
      .catch(() => { setErr("No se pudo cargar el registro de auditoría."); setLoading(false); });
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  return (
    <div className="space-y-5" data-testid="auditoria-page">
      <div><h1 className="font-display text-2xl font-black tracking-tight">Auditoría</h1><p className="text-slate-500 text-sm">Registro de acciones críticas del sistema</p></div>
      {err && (
        <div className="card-soft p-6 text-center text-red-600">
          <p className="mb-3">{err}</p>
          <button className="px-4 py-2 rounded-xl border border-slate-200 text-sm font-semibold" onClick={load}>Reintentar</button>
        </div>
      )}
      {!err && (
      <div className="card-soft overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50"><tr className="text-left text-xs uppercase tracking-wider text-slate-500">
            <th className="p-3">Fecha</th><th className="p-3">Usuario</th><th className="p-3">Acción</th><th className="p-3">Entidad</th><th className="p-3">Detalle</th>
          </tr></thead>
          <tbody>
            {loading && <tr><td colSpan={5} className="p-10 text-center"><Loader2 className="w-6 h-6 animate-spin mx-auto text-[#C1401E]" /></td></tr>}
            {!loading && rows.length === 0 && <tr><td colSpan={5} className="p-10 text-center text-slate-400"><ScrollText className="w-8 h-8 mx-auto mb-2" />Sin registros.</td></tr>}
            {!loading && rows.map((a) => (
              <tr key={a.id} className="border-t border-slate-100 hover:bg-slate-50">
                <td className="p-3 text-slate-500 whitespace-nowrap">{a.fecha?.slice(0, 16).replace("T", " ")}</td>
                <td className="p-3">{a.usuario_nombre}</td>
                <td className="p-3"><Badge variant="outline">{a.accion}</Badge></td>
                <td className="p-3">{a.entidad}</td>
                <td className="p-3 text-slate-500">{a.detalle}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      )}
    </div>
  );
}
