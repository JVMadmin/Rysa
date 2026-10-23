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
import Icono from "./components/Icono";

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
  const [ahora, setAhora] = useState(() => new Date());

  useEffect(() => {
    const iv = setInterval(() => setAhora(new Date()), 15000);
    return () => clearInterval(iv);
  }, []);

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
    if (!ts) return "sin sincronizar aún";
    return "Actualizado " + new Date(ts).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" });
  }, [bump, online]);

  return (
    <div className={"rysa-app" + (online ? "" : " rc-offline")}>
      <header className="rc-header">
        <img src="/brand/logotipo-oscuro.webp" alt="Grupo RYSA" className="rc-logo" data-testid="logo" />
        <div className="rc-header-txt">
          <h1>Consultor de precios</h1>
          {SUCURSAL && <span>Sucursal {SUCURSAL}</span>}
        </div>
        <div className="rc-header-right">
          <span className={"rc-estado" + (online ? "" : " off")} title={online ? "Conectado" : "Sin conexión"}>
            <i aria-hidden="true" />{online ? "En línea" : "Sin conexión"}
          </span>
          <span className="rc-reloj">{ahora.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" })}</span>
          <button type="button" className="rc-iconbtn" onClick={toggleFullscreen} title="Pantalla completa" aria-label="Pantalla completa" data-testid="fullscreen">
            <Icono nombre="pantalla" />
          </button>
        </div>
      </header>

      <main className="rc-main">
        {!online && phase !== "offline" && (
          <div className="rc-banner rc-banner-err" data-testid="banner-offline">
            <Icono nombre="alerta" /> <span><b>Sin conexión con RYSA.</b> La información puede estar desactualizada.</span>
          </div>
        )}

        {cacheHit && selected && (
          <div className="rc-banner rc-banner-cache" data-testid="banner-cache">
            Mostrando información guardada en este equipo · {selected.savedAt ? new Date(selected.savedAt).toLocaleString("es-MX") : syncLabel}.
          </div>
        )}

        <section className="rc-search-zone">
          <div className="rc-search-row">
            <Icono nombre="buscar" className="rc-ico rc-search-icon" />
            <input
              className="rc-search"
              data-testid="buscar"
              value={q}
              autoFocus
              inputMode="search"
              autoComplete="off"
              autoCorrect="off"
              spellCheck="false"
              placeholder="Nombre, código o código de barras"
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
              <Icono nombre="escanear" /> Escanear
            </button>
            <button type="button" className="rc-btn rc-btn-min outline" onClick={actualizar} data-testid="actualizar">
              <Icono nombre="actualizar" /> Actualizar
            </button>
          </div>
        </section>

        {phase === "loading" && <div className="rc-state"><span className="rc-spinner grande" /> Consultando precio…</div>}

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
                <Icono nombre="flecha" className="rc-ico rc-result-go" />
              </button>
            ))}
          </section>
        )}

        {phase === "notfound" && !selected && (
          <section className="rc-state" data-testid="no-results">
            <p className="rc-notfound-title">No encontramos ese producto</p>
            <ul className="rc-notfound-list">
              <li>Revisa el código.</li>
              <li>Búscalo por nombre.</li>
              <li>Escanéalo de nuevo.</li>
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
            <div className="rc-hero-scan" aria-hidden="true">
              <Icono nombre="escanear" className="rc-hero-ico" />
              <span className="rc-hero-laser" />
            </div>
            <p className="rc-hero-kicker">Precio al público</p>
            <p className="rc-hero-big">Escanea tu producto</p>
            <p className="rc-hero-sub">Acerca el código de barras al lector o escribe el nombre del producto para conocer su precio al instante.</p>
          </section>
        )}

        {selected && phase === "done" && (
          <ProductCard product={selected} fromCache={cacheHit} onReset={reset} onActualizar={actualizar} online={online} />
        )}
      </main>

      {cameraOpen && <CameraScanner onDetect={onCameraDetect} onClose={() => setCameraOpen(false)} />}
      <footer className="rc-footer"><span>Grupo RYSA · Plásticos · Empaques · Desechables</span><span>Precios con IVA incluido · {syncLabel}</span></footer>
    </div>
  );
}