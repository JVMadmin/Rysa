// Deteccion automatica de lectores de codigo de barras (USB/Bluetooth que
// inyectan teclado) y del Enter final. Un escaner real teclea los digitos en
// < ~60 ms por tecla; una persona no. Tambien se invoca cuando el usuario
// presiona Enter con texto en la barra de busqueda.
import { useEffect, useRef } from "react";

const SCAN_GAP_MS = 60;

export function useBarcodeKeys(onScan) {
  const bufferRef = useRef("");
  const lastRef = useRef(0);
  const handlerRef = useRef(onScan);
  handlerRef.current = onScan;

  useEffect(() => {
    const down = (e) => {
      const isEnter = e.key === "Enter";
      if (isEnter) {
        const code = bufferRef.current.trim();
        if (code.length >= 2) handlerRef.current(code);
        bufferRef.current = "";
        lastRef.current = 0;
        return;
      }
      if (e.key === "Escape" || e.key === "Tab") {
        bufferRef.current = "";
        lastRef.current = 0;
        return;
      }
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const now = performance.now();
        if (now - lastRef.current > SCAN_GAP_MS) bufferRef.current = e.key;
        else bufferRef.current += e.key;
        lastRef.current = now;
      }
    };
    window.addEventListener("keydown", down, true);
    return () => window.removeEventListener("keydown", down, true);
  }, []);
}

/** Indica si el navegador puede usar la camara con BarcodeDetector. */
export function canScanCamera() {
  return "BarcodeDetector" in window && !!navigator.mediaDevices?.getUserMedia;
}

/**
 * Abre la camara y detecta codigos de barras. Llama onDetect(code) con el
 * primer codigo valido. Devuelve una funcion para cerrar el stream.
 */
export async function startCameraScan({ onDetect, onClose }) {
  let mediaStream = null;
  let scanning = null;
  const video = document.createElement("video");
  video.setAttribute("playsinline", "");
  video.playsInline = true;
  video.autoplay = true;
  const closed = { value: false };

  const stop = () => {
    closed.value = true;
    if (scanning) clearInterval(scanning);
    if (mediaStream) mediaStream.getTracks().forEach((t) => t.stop());
    if (video.srcObject) video.srcObject = null;
    if (onClose) onClose();
  };

  if (!canScanCamera()) {
    if (onDetect) onDetect(null);
    return stop;
  }

  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" } },
      audio: false,
    });
  } catch (e) {
    if (onDetect) onDetect("__NO_CAMERA__");
    return stop;
  }
  video.srcObject = mediaStream;
  await video.play();

  const detector = new BarcodeDetector({ formats: ["ean_13", "ean_8", "code_128", "code_39", "upc_a", "upc_e", "qr_code"] });
  scanning = setInterval(async () => {
    if (closed.value || video.readyState < 2) return;
    try {
      const codes = await detector.detect(video);
      if (codes && codes.length) {
        const raw = codes[0].rawValue;
        stop();
        if (onDetect) onDetect(String(raw || ""));
      }
    } catch (e) {
      /* self rotate: detector aun no listo */
    }
  }, 250);

  return stop;
}