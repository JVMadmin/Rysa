// API de impresión para el ERP dentro de la app: window.rysaEscritorio.
// El proceso principal vuelve a comprobar que quien la usa es el ERP.
const { contextBridge, ipcRenderer } = require("electron");

const version = (process.argv.find((a) => a.startsWith("--rysa-version=")) || "").split("=")[1] || "";

contextBridge.exposeInMainWorld("rysaEscritorio", {
  version,
  listarImpresoras: () => ipcRenderer.invoke("rysa:impresoras"),
  imprimir: (opciones) => ipcRenderer.invoke("rysa:imprimir", opciones),
});
