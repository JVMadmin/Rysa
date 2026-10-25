import { useEffect, useState } from "react";
import { api, formatApiError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import CodigoAutorizacionInput from "@/components/CodigoAutorizacionInput";
import { useConfirm } from "@/components/ConfirmProvider";
import { etiquetaRol } from "@/lib/etiquetas";
import { toast } from "sonner";
import { KeyRound, Loader2, UserRound, Eye, EyeOff, Info } from "lucide-react";

const fechaHora = (iso) => {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString("es-MX", { dateStyle: "medium", timeStyle: "short" });
  } catch { return ""; }
};

export default function MiCuenta() {
  const { user } = useAuth();
  const [estado, setEstado] = useState(null);
  const [codigo, setCodigo] = useState("");
  const [confirma, setConfirma] = useState("");
  const [password, setPassword] = useState("");
  const [ver, setVer] = useState(false);
  const [saving, setSaving] = useState(false);
  const confirmar = useConfirm();

  const cargar = () => api.get("/mi-cuenta/codigo-autorizacion")
    .then((r) => setEstado(r.data))
    .catch((e) => toast.error(formatApiError(e.response?.data?.detail)));
  useEffect(() => { cargar(); }, []);

  const guardar = async () => {
    if (codigo.length !== 6) return toast.error("El código debe tener 6 dígitos");
    if (codigo !== confirma) return toast.error("Los dos códigos no coinciden");
    if (!password) return toast.error("Escribe tu contraseña para confirmar");
    setSaving(true);
    try {
      await api.put("/mi-cuenta/codigo-autorizacion", { codigo, password });
      toast.success(estado?.configurado ? "Código de autorización actualizado" : "Código de autorización guardado");
      setCodigo(""); setConfirma(""); setPassword(""); setVer(false);
      cargar();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
    finally { setSaving(false); }
  };

  const quitar = async () => {
    if (!(await confirmar({ titulo: "¿Quitar tu código?", mensaje: "Ya no podrás autorizar movimientos hasta que definas uno nuevo.", accion: "Quitar código", peligro: true }))) return;
    try {
      await api.delete("/mi-cuenta/codigo-autorizacion");
      toast.success("Código de autorización eliminado");
      cargar();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };

  return (
    <div className="space-y-5 max-w-2xl" data-testid="mi-cuenta-page">
      <div>
        <h1 className="font-display text-2xl font-black tracking-tight">Mi cuenta</h1>
        <p className="text-slate-500 text-sm">Tus datos y tu código de autorización</p>
      </div>

      <div className="card-soft p-5 space-y-3">
        <div className="flex items-center gap-2 text-slate-700 font-semibold"><UserRound className="w-4 h-4 text-brand-600" /> Datos de la cuenta</div>
        <dl className="grid grid-cols-[7rem_1fr] gap-y-1.5 text-sm">
          <dt className="text-slate-500">Nombre</dt><dd className="font-medium text-slate-900">{user?.name}</dd>
          <dt className="text-slate-500">Correo</dt><dd className="text-slate-700">{user?.email}</dd>
          <dt className="text-slate-500">Rol</dt><dd className="text-slate-700">{etiquetaRol(user?.role)}</dd>
        </dl>
      </div>

      <div className="card-soft p-5 space-y-4" data-testid="codigo-autorizacion-card">
        <div className="flex items-center gap-2 text-slate-700 font-semibold"><KeyRound className="w-4 h-4 text-brand-600" /> Código de autorización</div>

        {!estado ? (
          <div className="py-6 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-brand-600" /></div>
        ) : !estado.puede_autorizar ? (
          <div className="flex gap-3 rounded-md border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600" data-testid="codigo-sin-permiso">
            <Info className="w-4 h-4 mt-0.5 shrink-0 text-slate-400" />
            <p>
              Tu usuario no autoriza movimientos. Cuando hagas uno que lo requiera, como el precio manual en el
              Punto de venta (F6), una persona autorizada teclea su código en tu pantalla. Un administrador puede
              darte este permiso en <b>Usuarios y permisos</b> con el módulo «Autorizar movimientos con código».
            </p>
          </div>
        ) : (
          <>
            <p className="text-sm text-slate-500">
              Con este código de 6 dígitos autorizas movimientos de otros usuarios, como el precio manual en el
              Punto de venta (F6). Tecléalo tú en la pantalla del cajero y no lo compartas: cada autorización queda
              registrada a tu nombre.
              {estado.precio_manual_directo && " Tus propios precios manuales no lo piden."}
            </p>

            <div className="flex items-center gap-2 text-sm" data-testid="codigo-estado">
              <span className={`dot ${estado.configurado ? "dot-success" : "dot-muted"}`} />
              {estado.configurado
                ? <span className="text-slate-700">Código activo <span className="text-slate-400">· actualizado {fechaHora(estado.actualizado)}</span></span>
                : <span className="text-slate-500">Aún no tienes código</span>}
            </div>

            <div className="border border-slate-200 rounded-lg p-4 space-y-4">
              <div className="flex items-center justify-between">
                <div className="text-xs uppercase tracking-wider text-slate-500">{estado.configurado ? "Cambiar código" : "Definir código"}</div>
                <button type="button" onClick={() => setVer((v) => !v)} className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-800" data-testid="codigo-ver">
                  {ver ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />} {ver ? "Ocultar" : "Mostrar"}
                </button>
              </div>
              <div className="grid sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label className="text-xs text-slate-500">Nuevo código</Label>
                  <CodigoAutorizacionInput value={codigo} onChange={setCodigo} oculto={!ver} testId="codigo-nuevo" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-slate-500">Confírmalo</Label>
                  <CodigoAutorizacionInput value={confirma} onChange={setConfirma} oculto={!ver} testId="codigo-confirma" />
                </div>
              </div>
              <p className="text-xs text-slate-400">No uses un dígito repetido (111111) ni una secuencia (123456).</p>
              <div>
                <Label className="text-xs text-slate-500">Tu contraseña</Label>
                <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") guardar(); }}
                  autoComplete="current-password" className="mt-1 max-w-xs" data-testid="codigo-password" />
              </div>
              <div className="flex items-center justify-between gap-2">
                {estado.configurado
                  ? <Button variant="ghost" onClick={quitar} className="text-red-600 hover:text-red-700 hover:bg-red-50" data-testid="codigo-quitar">Quitar código</Button>
                  : <span />}
                <Button onClick={guardar} disabled={saving} className="bg-brand-600 hover:bg-brand-700" data-testid="codigo-guardar">
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : estado.configurado ? "Cambiar código" : "Guardar código"}
                </Button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
