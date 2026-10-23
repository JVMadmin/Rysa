import { resolveImg, formatMoney } from "../lib/api";
import Icono from "./Icono";

// Separa "$1,234.50" en signo, enteros y centavos para el precio gigante.
function partesPrecio(n) {
  const txt = formatMoney(n);
  const m = txt.match(/^(\D*)([\d,]+)(?:\.(\d+))?/);
  return m ? { signo: m[1].trim() || "$", enteros: m[2], centavos: m[3] || "00" } : { signo: "$", enteros: txt, centavos: "" };
}

/** Ficha grande del producto consultado (solo precio público). */
export default function ProductCard({ product, fromCache, onReset, onActualizar, online }) {
  if (!product) return null;

  const precio = Number(product.precio_publico || 0);
  const neto = Number(product.precio_sin_iva || 0);
  const ivaImp = Number(product.iva_importe || 0);
  const tasa = Number(product.iva || 0);
  const p = partesPrecio(precio);

  return (
    <section className="rc-card" data-testid="product-card">
      <div className="rc-card-media">
        {product.imagen ? (
          <img src={resolveImg(product.imagen)} alt="" className="rc-card-img" />
        ) : (
          <div className="rc-card-img-ph"><Icono nombre="caja" className="rc-ico-ph" /><span>Grupo RYSA</span></div>
        )}
      </div>

      <div className="rc-card-body">
        <div className="rc-chip-row">
          {product.codigo && <span className="rc-chip">Código {product.codigo}</span>}
          {product.barcode && product.barcode !== product.codigo && <span className="rc-chip rc-chip-mono">{product.barcode}</span>}
        </div>
        <h2 className="rc-card-title">{product.nombre || "Producto"}</h2>
        {(product.presentacion || product.unidad) && (
          <p className="rc-card-sub">
            {product.presentacion && <span>{product.presentacion} · </span>}
            {product.unidad}
          </p>
        )}

        <div className="rc-price-zone">
          <span className="rc-price-label">Precio al público</span>
          <div className="rc-price-big" data-testid="precio-publico" aria-label={formatMoney(precio)}>
            <span className="rc-price-signo">{p.signo}</span>
            <span>{p.enteros}</span>
            <span className="rc-price-cent">.{p.centavos}</span>
          </div>
          <span className="rc-price-note">{tasa > 0 ? `IVA incluido (${tasa}%)` : "Precio final"}</span>
        </div>

        {tasa > 0 && (
          <dl className="rc-iva-breakdown">
            <div className="rc-iva-row"><dt>Subtotal</dt><dd>{formatMoney(neto)}</dd></div>
            <div className="rc-iva-row"><dt>IVA {tasa}%</dt><dd>{formatMoney(ivaImp)}</dd></div>
            <div className="rc-iva-row rc-iva-total"><dt>Total</dt><dd data-testid="iva-total">{formatMoney(precio)}</dd></div>
          </dl>
        )}

        {fromCache && (
          <p className="rc-tiny">
            Precio guardado en este equipo · {product.savedAt ? new Date(product.savedAt).toLocaleString("es-MX") : "fecha desconocida"}
          </p>
        )}
        {!online && <p className="rc-tiny">Sin conexión con RYSA · se muestra el último precio conocido.</p>}

        <div className="rc-card-actions">
          <button type="button" className="rc-btn rc-btn-big outline" onClick={onReset} data-testid="buscar-otro">
            <Icono nombre="regresar" /> Buscar otro
          </button>
          <button type="button" className="rc-btn rc-btn-big" onClick={onActualizar} data-testid="actualizar-uno">
            <Icono nombre="actualizar" /> Actualizar precio
          </button>
        </div>
      </div>
    </section>
  );
}
