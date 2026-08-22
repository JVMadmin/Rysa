import { Boxes } from "lucide-react";

export default function EnConstruccion({ titulo, descripcion }) {
  return (
    <div className="space-y-5" data-testid="en-construccion">
      <div>
        <h1 className="font-display text-2xl font-black tracking-tight">{titulo}</h1>
        <p className="text-slate-500 text-sm">Módulo en preparación</p>
      </div>
      <div className="card-soft flex flex-col items-center justify-center gap-3 py-20 text-center">
        <div className="w-14 h-14 rounded-2xl bg-terracota/10 flex items-center justify-center">
          <Boxes className="w-7 h-7 text-[#C1401E]" />
        </div>
        <p className="text-slate-600 font-semibold">{descripcion || "Este módulo aún no está disponible."}</p>
        <p className="text-sm text-slate-400">RYSA ERP · Prepárate para próximas actualizaciones</p>
      </div>
    </div>
  );
}