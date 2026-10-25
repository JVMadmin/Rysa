// Etiquetas legibles para valores internos (estados y roles) que llegan del
// servidor en minúsculas y con guion bajo ("parcialmente_recibida",
// "vendedor_campo"). Usar SIEMPRE al mostrarlos; nunca el valor crudo.

const ESTADOS = {
  confirmada: "Confirmada",
  confirmado: "Confirmado",
  cancelada: "Cancelada",
  cancelado: "Cancelado",
  cotizacion: "Cotización",
  credito: "Crédito",
  contado: "Contado",
  abierta: "Abierta",
  abierto: "Abierto",
  cerrada: "Cerrada",
  cerrado: "Cerrado",
  borrador: "Borrador",
  surtido: "Surtido",
  convertido: "Convertido",
  convertida: "Convertida",
  parcialmente_recibida: "Parcialmente recibida",
  recibida: "Recibida",
  pendiente: "Pendiente",
  pagada: "Pagada",
  pagado: "Pagado",
  vencida: "Vencida",
  activo: "Activo",
  activa: "Activa",
  inactivo: "Inactivo",
  inactiva: "Inactiva",
  suspendido: "Suspendido",
  baja: "Baja",
  aprobada: "Aprobada",
  aprobado: "Aprobado",
  rechazada: "Rechazada",
  rechazado: "Rechazado",
  enviada: "Enviada",
  enviado: "Enviado",
  entregado: "Entregado",
  facturada: "Facturada",
  timbrada: "Timbrada",
  abono: "Abono",
  apertura: "Apertura",
  cierre: "Cierre",
  entrada: "Entrada",
  salida: "Salida",
  ingreso: "Ingreso",
  egreso: "Egreso",
  retiro: "Retiro",
  efectivo: "Efectivo",
  tarjeta: "Tarjeta",
  transferencia: "Transferencia",
  mixto: "Mixto",
  ajuste: "Ajuste",
  merma: "Merma",
  devolucion: "Devolución",
  correccion: "Corrección",
  venta: "Venta",
  compra: "Compra",
};

const ROLES = {
  admin: "Administrador",
  admin_propietario: "Propietario",
  admin_desarrollador: "Desarrollador",
  encargado: "Encargado",
  vendedor: "Vendedor",
  vendedor_campo: "Vendedor de campo",
  cajero: "Cajero",
};

const clave = (v) => String(v).trim().toLowerCase().replace(/\s+/g, "_");

/** "parcialmente_recibida" → "Parcialmente recibida"; cualquier otro: primera letra mayúscula. */
export function etiquetaGenerica(valor) {
  if (valor === null || valor === undefined || valor === "") return "";
  const s = String(valor).replace(/_/g, " ").trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Estado de venta, caja, compra, pedido, etc. listo para mostrar. */
export function etiquetaEstado(valor) {
  if (valor === null || valor === undefined || valor === "") return "";
  return ESTADOS[clave(valor)] || etiquetaGenerica(valor);
}

/** Rol de usuario listo para mostrar ("vendedor_campo" → "Vendedor de campo"). */
export function etiquetaRol(valor) {
  if (valor === null || valor === undefined || valor === "") return "";
  return ROLES[clave(valor)] || etiquetaGenerica(valor);
}
