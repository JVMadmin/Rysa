import { createContext, useContext, useState, useCallback } from "react";

export const CartContext = createContext(null);

export function useCart(windowId) {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be inside CartProvider");
  const { carts, updateCart } = ctx;
  const state = carts[windowId] || {};

  const cart = state.cart || [];
  const setCart = useCallback((updater) => {
    updateCart(windowId, (s) => ({
      ...s,
      cart: typeof updater === "function" ? updater(s.cart || []) : updater,
    }));
  }, [windowId, updateCart]);

  const descGlobal = state.descGlobal ?? 0;
  const setDescGlobal = useCallback((v) => {
    updateCart(windowId, (s) => ({
      ...s,
      descGlobal: typeof v === "function" ? v(s.descGlobal ?? 0) : v,
    }));
  }, [windowId, updateCart]);

  const descMode = state.descMode ?? "$";
  const setDescMode = useCallback((v) => {
    updateCart(windowId, (s) => ({ ...s, descMode: v }));
  }, [windowId, updateCart]);

  const descPct = state.descPct ?? 0;
  const setDescPct = useCallback((v) => {
    updateCart(windowId, (s) => ({ ...s, descPct: v }));
  }, [windowId, updateCart]);

  const clienteId = state.clienteId ?? "";
  const setClienteId = useCallback((v) => {
    updateCart(windowId, (s) => ({ ...s, clienteId: v }));
  }, [windowId, updateCart]);

  const lista = state.lista ?? 1;
  const setLista = useCallback((v) => {
    updateCart(windowId, (s) => ({
      ...s,
      lista: typeof v === "function" ? v(s.lista ?? 1) : v,
    }));
  }, [windowId, updateCart]);

  const tipoVenta = state.tipoVenta ?? "directa";
  const setTipoVenta = useCallback((v) => {
    updateCart(windowId, (s) => ({ ...s, tipoVenta: v }));
  }, [windowId, updateCart]);

  const formaPago = state.formaPago ?? "contado";
  const setFormaPago = useCallback((v) => {
    updateCart(windowId, (s) => ({ ...s, formaPago: v }));
  }, [windowId, updateCart]);

  const vendedorId = state.vendedorId ?? "";
  const setVendedorId = useCallback((v) => {
    updateCart(windowId, (s) => ({ ...s, vendedorId: v }));
  }, [windowId, updateCart]);

  const pagos = state.pagos ?? [{ metodo: "efectivo", monto: "" }];
  const setPagos = useCallback((updater) => {
    updateCart(windowId, (s) => ({
      ...s,
      pagos: typeof updater === "function"
        ? updater(s.pagos ?? [{ metodo: "efectivo", monto: "" }])
        : updater,
    }));
  }, [windowId, updateCart]);

  return {
    cart, setCart,
    descGlobal, setDescGlobal,
    descMode, setDescMode,
    descPct, setDescPct,
    clienteId, setClienteId,
    lista, setLista,
    tipoVenta, setTipoVenta,
    formaPago, setFormaPago,
    vendedorId, setVendedorId,
    pagos, setPagos,
  };
}

export function CartProvider({ children }) {
  const [carts, setCarts] = useState({});

  const updateCart = useCallback((windowId, updater) => {
    setCarts((prev) => {
      const current = prev[windowId] || {};
      const next = typeof updater === "function" ? updater(current) : updater;
      return { ...prev, [windowId]: next };
    });
  }, []);

  const clearCartState = useCallback((windowId) => {
    setCarts((prev) => {
      if (!(windowId in prev)) return prev;
      const next = { ...prev };
      delete next[windowId];
      return next;
    });
  }, []);

  return (
    <CartContext.Provider value={{ carts, updateCart, clearCartState }}>
      {children}
    </CartContext.Provider>
  );
}