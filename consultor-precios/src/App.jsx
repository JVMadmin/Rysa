import { useCallback, useEffect, useMemo, useState } from "react";
import {
  searchProducts,
  productByBarcode,
  productByCodigo,
  health,
  resolveImg,
  formatMoney,
  SUCURSAL,
} from "./lib/api";
import { cacheSet, cacheGet, lastSync } from "./lib/cache";
import { useBarcodeKeys, canScanCamera } from "./lib/scanner";
import ProductCard from "./components/ProductCard";
import CameraScanner from "./components/CameraScanner";

const AUTO_REFRESH_MS = 15 * 60 * 1000;

export default function App() {
  const [q, setQ] = useState("");
  const [results, setResults] = useState([]);
  const [selected, setSelected] = useState(null);
  const [cacheHit, setCacheHit] = useState(false);
  const [phase, setPhase] = useState("idle"); // idle | loading | done | notfound | offline
  const [searching, setSearching] = useState(false);
  const [online, setOnline] = useState(typeof navigator === "undefined" ? true : navigator.onLine);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraReady, setCameraReady] = useState(canScanCamera());
  const [bump, setBump] = useState(0);

  const refreshOnline = useCallback(async () => {
    const ok = await health().catch(() => false);
    setOnline(ok);
  }, []);

  useEffect(() => {
    refreshOnline();
    const iv = setInterval(() => refreshOnline(), 15000);
    const auto = setInterval(() => refreshOnline(), AUTO_REFRESH_MS);
    const onEvt = () => refreshOnline();
    window.addEventListener("online", onEvt);
    window.addEventListener("offline", onEvt);
    return () => {
      clearInterval(iv);
      clearInterval(auto);
      window.removeEventListener("online", onEvt);
      window.removeEventListener("offline", onEvt);
    };
  }, [refreshOnline]);

  const mostrarProducto = useCallback((dto, fromCache) => {
    setSelected(dto);
    setCacheHit(!!fromCache);
    setResults([]);
    setQ(dto.nombre || dto.codigo || "");
    setPhase("done");
    if (!fromCache) {
      cacheSet(dto);
      setBump((b) => b + 1);
    }
  }, []);

  const fallbackCacheOnly = useCallback(
    (clave) => {
      const hit = clave ? cacheGet(clave) : null;
      if (hit) {
        mostrarProducto(hit, true);
        return;
      }
      setOnline(false);
      setPhase("offline");
    },
    [mostrarProducto]
  );

  const handleCode = useCallback(
    async (code) => {
      const c = String(code || "").trim();
      if (!c) return;
      setQ(c);
      setPhase("loading");
      setSelected(null);
      setResults([]);
      try {
        const r = await productByBarcode(c);
        if (r && r.found && r.product) return mostrarProducto(r.product, false);
      } catch (e) {
        return fallbackCacheOnly(c);
      }
      try {
        const r = await productByCodigo(c);
        if (r && r.found && r.product) return mostrarProducto(r.product, false);
      } catch (e) {
        return fallbackCacheOnly(c);
      }
      try {
        const s = await searchProducts(c);
        const list = (s && s.results) || [];
        if (list.length === 1) return mostrarProducto(list[0], false);
        setResults(list);
        setPhase(list.length ? "done" : "notfound");
        list.forEach((p) => cacheSet(p));
      } catch (e) {
        return fallbackCacheOnly(c);
      }
    },
    [mostrarProducto, fallbackCacheOnly]
  );

  const runSearch = useCallback(
    (text) => {
      const term = (text || "").trim();
      if (!term) {
        setResults([]);
        setSelected(null);
        setPhase("idle");
        return;
      }
      setSearching(true);
      setSelected(null);
      searchProducts(term)
        .then((s) => {
          const list = (s && s.results) || [];
          setResults(list);
          setPhase(list.length ? "done" : "notfound");
          list.forEach((p) => cacheSet(p));
        })
        .catch(() => {
          const c = cacheGet(term);
          if (c) {
            setResults([c]);
            setPhase("done");
          } else {
            setOnline(false);
            setPhase("offline");
          }
        })
        .finally(() => setSearching(false));
    },
    []
  );

  const onKeyDown = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      runSearch(q);
    }
  };

  const reset = () => {
    setQ("");
    setSelected(null);
    setResults([]);
    setCacheHit(false);
    setPhase("idle");
    setSearching(false);
  };

  const actualizar = () => {
    setBump((b) => b + 1);
    if ((q || selected?.codigo || "").trim()) handleCode((q || selected?.codigo || "").trim());
    else refreshOnline();
  };

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => {});
    else document.exitFullscreen?.();
  };

  const onCameraDetect = (code) => {
    setCameraOpen(false);
    if (code === "__NO_CAMERA__") setCameraReady(false);
    else if (code) handleCode(code);
  };

  const syncLabel = useMemo(() => {
    const ts = lastSync();
    if (!ts) return "aun sin sincronizacion";
    return "Actualizado " + new Date(ts).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" });
  }, [bump, online]);

  return (
    <div className={"rysa-app" + (online ? "" : " rc-offline")}>
      <header className="rc-header">
        <img src="/brand/ISOTIPO-Photoroom.png" alt="RYSA" className="rc-logo" data-testid="logo" />
        <div className="rc-header-txt">
          <h1>RYSA</h1>
          <span>CONSULTOR DE PRECIOS</span>
        </div>
        <div className="rc-header-right">
          {SUCURSAL && <span className="rc-sucursal">{SUCURSAL}</span>}
          <button type="button" className="rc-iconbtn" onClick={toggleFullscreen} title="Pantalla completa" data-testid="fullscreen">
            ⛶
          </button>
        </div>
      </header>

      <main className="rc-main">
        {!online && phase !== "offline" && (
          <div className="rc-banner rc-banner-err" data-testid="banner-offline">
            <b>Sin conexion con RYSA</b> — la informacion puede estar desactualizada.
          </div>
        )}

        {cacheHit && selected && (
          <div className="rc-banner rc-banner-cache" data-testid="banner-cache">
            Mostrando informacion almacenada (solo lectura) · {selected.savedAt ? new Date(selected.savedAt).toLocaleString("es-MX") : syncLabel}.
          </div>
        )}

        <section className="rc-search-zone">
          <div className="rc-search-row">
            <span className="rc-search-icon">🔍</span>
            <input
              className="rc-search"
              data-testid="buscar"
              value={q}
              autoFocus
              inputMode="search"
              autoComplete="off"
              autoCorrect="off"
              spellCheck="false"
              placeholder="Buscar por nombre, codigo o codigo de barras…"
              onChange={(e) => {
                setQ(e.target.value);
                runSearch(e.target.value);
              }}
              onKeyDown={onKeyDown}
            />
            {searching && <span className="rc-spinner" aria-label="cargando" />}
          </div>
          <div className="rc-actions">
            <button type="button" className="rc-btn rc-btn-min" data-testid="scan" onClick={() => (cameraReady ? setCameraOpen(true) : handleCode(q))}>
              📷 ESCANEAR
            </button>
            <button type="button" className="rc-btn rc-btn-min outline" onClick={actualizar} data-testid="actualizar">
              ⟳ Actualizar
            </button>
          </div>
        </section>

        {phase === "loading" && <div className="rc-state">Consultando precio…</div>}

        {!selected && phase === "done" && results.length > 0 && (
          <section className="rc-results" data-testid="results">
            {results.map((p) => (
              <button key={p.id || p.codigo} type="button" className="rc-result-row" onClick={() => mostrarProducto(p, false)} data-testid={"row-" + (p.codigo || p.id)}>
                {p.imagen && <img src={resolveImg(p.imagen)} alt="" className="rc-thumb" loading="lazy" />}
                <div className="rc-result-info">
                  <b>{p.nombre}</b>
                  <span className="rc-muted">
                    {p.codigo} {p.presentacion && "· " + p.presentacion} {p.unidad && " · " + p.unidad}
                  </span>
                </div>
                <div className="rc-result-price">{formatMoney(p.precio_publico)}</div>
              </button>
            ))}
          </section>
        )}

        {phase === "notfound" && !selected && (
          <section className="rc-state" data-testid="no-results">
            <p className="rc-notfound-title">Producto no encontrado.</p>
            <ul className="rc-notfound-list">
              <li>Revisa el codigo.</li>
              <li>Busca por nombre.</li>
              <li>Escanea nuevamente.</li>
            </ul>
            <button type="button" className="rc-btn rc-btn-min outline" onClick={reset}>
              Buscar otro
            </button>
          </section>
        )}

        {phase === "offline" && !selected && (
          <section className="rc-state" data-testid="off-msg">
            <p>No se puede consultar el precio en este momento.</p>
            <button type="button" className="rc-btn rc-btn-min outline" onClick={actualizar}>
              Reintentar
            </button>
          </section>
        )}

        {phase === "idle" && (
          <section className="rc-hero">
            <p className="rc-hero-big">PRECIO AL PUBLICO</p>
            <p className="rc-hero-sub">Escanee o busque un producto para consultar su precio al instante.</p>
          </section>
        )}

        {selected && phase === "done" && (
          <ProductCard product={selected} fromCache={cacheHit} onReset={reset} onActualizar={actualizar} online={online} />
        )}
      </main>

      {cameraOpen && <CameraScanner onDetect={onCameraDetect} onClose={() => setCameraOpen(false)} />}
      <footer className="rc-footer">RYSA Consultor de Precios · Fuente oficial: ERP RYSA</footer>
    </div>
  );
}