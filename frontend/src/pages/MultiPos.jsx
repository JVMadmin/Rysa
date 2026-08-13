import { useState } from "react";
import POS from "@/pages/POS";
import { Button } from "@/components/ui/button";
import { Plus, X, ShoppingCart } from "lucide-react";

let _seq = 2;

function one(id, label) {
  return { id, label: label || `POS ${id}` };
}

export default function MultiPos() {
  const [windows, setWindows] = useState(() => [
    { id: 1, label: "POS 1" },
    { id: _seq++, label: "POS 2" },
  ]);
  const [active, setActive] = useState(1);

  const add = () => {
    const id = _seq++;
    setWindows((w) => [...w, { id, label: `POS ${id}` }]);
    setActive(id);
  };
  const close = (id) => {
    setWindows((w) => {
      const rest = w.filter((x) => x.id !== id);
      return rest.length ? rest : [{ id: _seq++, label: `POS ${_seq}` }];
    });
    setActive((a) => (a === id ? (windows.length > 1 ? windows.find((x) => x.id !== id).id : _seq) : a));
  };

  return (
    <div className="flex flex-col h-full -m-6 p-6" data-testid="multipos-page">
      {/* Barra de pestañas (ventanas POS) */}
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        {windows.map((w) => (
          <div key={w.id} className="flex items-center">
            <button
              onClick={() => setActive(w.id)}
              data-testid={`multipos-tab-${w.id}`}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-t-lg text-sm font-medium border border-b-0 transition-colors ${active === w.id ? "bg-[#C1401E] text-white border-[#C1401E]" : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"}`}
            >
              <ShoppingCart className="w-4 h-4" />
              {w.label}
            </button>
            {windows.length > 1 && (
              <button onClick={() => close(w.id)} className={`-ml-2 z-10 rounded-full p-0.5 ${active === w.id ? "text-white/70 hover:text-white" : "text-slate-400 hover:text-red-600"}`}
                data-testid={`multipos-close-${w.id}`} aria-label="Cerrar ventana">
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
        ))}
        <Button variant="outline" size="sm" onClick={add} className="ml-2 bg-white" data-testid="multipos-add">
          <Plus className="w-4 h-4 mr-1" /> Nueva ventana
        </Button>
      </div>

      {/* Contenido: todas las ventanas permanecen montadas para conservar su carrito;
          solo se muestra la activa. Cada <POS/> es una instancia independiente. */}
      <div className="flex-1 min-h-0">
        {windows.map((w) => (
          <div key={w.id} style={{ display: active === w.id ? "block" : "none" }} className="h-full">
            <POS windowId={w.id} windowLabel={w.label} />
          </div>
        ))}
      </div>
    </div>
  );
}
