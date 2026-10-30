// Novedades por versión (se muestran en «Acerca de RYSA»). Al publicar una
// versión: subir VERSION en la raíz del repositorio y agregar su entrada
// arriba de todo. Versión = MAYOR.MENOR.PARCHE:
//   MAYOR  cambio grande de operación (p. ej. arranque con datos reales)
//   MENOR  funciones nuevas
//   PARCHE correcciones sin funciones nuevas
export const NOVEDADES = [
  {
    version: "2.0.2",
    fecha: "2026-10-30",
    cambios: [
      "Tickets y comprobantes carta vuelven a imprimir desde el navegador (antes salían en blanco o no abría el diálogo).",
    ],
  },
  {
    version: "2.0.1",
    fecha: "2026-10-29",
    cambios: [
      "Actualizaciones más rápidas: el sistema llega listo y ya no se compila en el servidor.",
      "Si una actualización falla, RYSA vuelve sola a la versión anterior.",
    ],
  },
  {
    version: "2.0.0",
    fecha: "2026-10-29",
    cambios: [
      "Indicador de versión y aviso de versión nueva al publicar cambios.",
      "Impresora de tickets y de carta por equipo; impresión directa con la app de escritorio 1.1.0 (Xprinter XP-N160II y Brother DCP-L2660DW).",
      "Ventas y app de campo a prueba de duplicados; folios sin huecos.",
      "Punto de venta, tablero, cuentas por cobrar y búsquedas mucho más rápidos.",
      "Menú rediseñado: secciones en rojo, se contrae en el punto de venta y funciona en celular.",
      "Fechas y horas en hora de México en todas las pantallas.",
      "Autorización remota de precio manual con aviso a pantalla completa.",
    ],
  },
];
