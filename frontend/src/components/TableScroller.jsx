import { useRef, useState, useEffect, useCallback } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

// Envuelve una tabla ancha: botones flotantes laterales + barra de scroll inferior fija (sticky)
// que permite desplazar horizontalmente sin llegar al final del listado.
export function TableScroller({ children, testid = "table-scroller" }) {
  const mainRef = useRef(null);
  const proxyRef = useRef(null);
  const innerRef = useRef(null);
  const [state, setState] = useState({ canL: false, canR: false, overflow: false });

  const update = useCallback(() => {
    const el = mainRef.current;
    if (!el) return;
    const overflow = el.scrollWidth - el.clientWidth > 4;
    setState({
      canL: el.scrollLeft > 4,
      canR: el.scrollLeft + el.clientWidth < el.scrollWidth - 4,
      overflow,
    });
    if (innerRef.current) innerRef.current.style.width = `${el.scrollWidth}px`;
  }, []);

  useEffect(() => {
    update();
    const el = mainRef.current;
    const ro = new ResizeObserver(update);
    if (el) ro.observe(el);
    window.addEventListener("resize", update);
    const t = setTimeout(update, 300);
    return () => { ro.disconnect(); window.removeEventListener("resize", update); clearTimeout(t); };
  }, [update, children]);

  const onMainScroll = () => {
    update();
    if (proxyRef.current && mainRef.current) proxyRef.current.scrollLeft = mainRef.current.scrollLeft;
  };
  const onProxyScroll = () => {
    if (proxyRef.current && mainRef.current) mainRef.current.scrollLeft = proxyRef.current.scrollLeft;
  };
  const scrollBy = (d) => mainRef.current?.scrollBy({ left: d, behavior: "smooth" });

  return (
    <div className="relative" data-testid={testid}>
      <div ref={mainRef} onScroll={onMainScroll} className="overflow-x-auto scrollbar-thin">
        {children}
      </div>

      {state.overflow && (
        <>
          <button
            type="button" onClick={() => scrollBy(-320)} aria-label="Desplazar a la izquierda"
            data-testid={`${testid}-left`}
            className={`hidden sm:flex items-center justify-center absolute left-1 top-1/2 -translate-y-1/2 z-20 w-9 h-9 rounded-full bg-white/95 shadow-lg border border-slate-200 text-[#0055A4] transition-opacity hover:bg-[#0055A4] hover:text-white ${state.canL ? "opacity-100" : "opacity-0 pointer-events-none"}`}>
            <ChevronLeft className="w-5 h-5" />
          </button>
          <button
            type="button" onClick={() => scrollBy(320)} aria-label="Desplazar a la derecha"
            data-testid={`${testid}-right`}
            className={`hidden sm:flex items-center justify-center absolute right-1 top-1/2 -translate-y-1/2 z-20 w-9 h-9 rounded-full bg-white/95 shadow-lg border border-slate-200 text-[#0055A4] transition-opacity hover:bg-[#0055A4] hover:text-white ${state.canR ? "opacity-100" : "opacity-0 pointer-events-none"}`}>
            <ChevronRight className="w-5 h-5" />
          </button>

          {/* Barra de scroll inferior flotante (sticky) sincronizada */}
          <div
            ref={proxyRef} onScroll={onProxyScroll} data-testid={`${testid}-bottombar`}
            className="sticky bottom-0 left-0 z-20 overflow-x-auto h-3.5 bg-slate-50/90 backdrop-blur border-t border-slate-200 rounded-b-md">
            <div ref={innerRef} className="h-px" />
          </div>
        </>
      )}
    </div>
  );
}

export default TableScroller;
