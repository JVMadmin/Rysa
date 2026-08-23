import { resolveImg, formatMoney } from "../lib/api";

/** Tarjeta grande de producto del Consultor de Precios (solo precio publico). */
export default function ProductCard({ product, fromCache, onReset, onActualizar, online }) {
  if (!product) return null;

  const precio = Number(product.precio_publico || 0);
  const neto = Number(product.precio_sin_iva || 0);
  const ivaImp = Number(product.iva_importe || 0);
  const tasa = Number(product.iva || 0);

  return (
    <section className="rc-card" data-testid="product-card">
      <div className="rc-card-head">
        {product.imagen ? (
          <img src={resolveImg(product.imagen)} alt="" className="rc-card-img" />
        ) : (
          <div className="rc-card-img rc-card-img-ph">RYSA</div>
        )}
        <div className="rc-card-title-wrap">
          <h2 className="rc-card-title">{product.nombre || "Producto"}</h2>
          <div className="rc-chip-row">
            {product.codigo && <span className="rc-chip">Código: {product.codigo}</span>}
            {product.barcode && <span className="rc-chip rc-chip-mono">{product.barcode}</span>}
          </div>
          {(product.presentacion || product.unidad) && (
            <p className="rc-muted rc-card-sub">
              {product.presentacion && <span>{product.presentacion} · </span>}
              {product.unidad}
            </p>
          )}
        </div>
      </div>

      <div className="rc-price-zone">
        <span className="rc-price-label">PRECIO AL PÚBLICO</span>
        <div className="rc-price-big" data-testid="precio-publico">
          {formatMoney(precio)}
        </div>
        <span className="rc-price-note">
          {tasa > 0 ? `IVA incluido (${tasa}%)` : "Precio final · sin impuesto"}
        </span>
      </div>

      {tasa > 0 && (
        <div className="rc-iva-breakdown">
          <div className="rc-iva-row">
            <span>Subtotal {product.incluye_iva ? "(IVA incluido)" : "(sin IVA)"}</span>
            <span>{formatMoney(neto)}</span>
          </div>
          <div className="rc-iva-row">
            <span>IVA ({tasa}%)</span>
            <span>{formatMoney(ivaImp)}</span>
          </div>
          <div className="rc-iva-row rc-iva-total">
            <span>Total</span>
            <span data-testid="iva-total">{formatMoney(precio)}</span>
          </div>
        </div>
      )}

      {fromCache && (
        <p className="rc-muted rc-tiny">
          Precio tomado de la cache local ·{" "}
          {product.savedAt ? new Date(product.savedAt).toLocaleString("es-MX") : "fecha desconocida"}
        </p>
      )}
      {!online && <p className="rc-muted rc-tiny">Sin conexion con RYSA · mostrando lo ultimo conocido.</p>}

      <div className="rc-card-actions">
        <button type="button" className="rc-btn rc-btn-big outline" onClick={onReset} data-testid="buscar-otro">
          Buscar otro producto
        </button>
        <button type="button" className="rc-btn rc-btn-big" onClick={onActualizar} data-testid="actualizar-uno">
          ⟳ Actualizar precio
        </button>
      </div>
    </section>
  );
}