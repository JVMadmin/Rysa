import { useEffect, useRef } from "react";

/**
 * Modal de escaneo por camara (BarcodeDetector). Si el dispositivo no tiene
 * camara o el navegador no soporta la deteccion, avisa y cierra.
 * onDetect(code) se llama con el primer codigo leido ("__NO_CAMERA__" si no
 * hay soporte). onClose() cierra el modal manualmente.
 */
export default function CameraScanner({ onDetect, onClose }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const timerRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    let localStream = null;

    const stop = () => {
      cancelled = true;
      clearInterval(timerRef.current);
      if (localStream) localStream.getTracks().forEach((t) => t.stop());
      if (videoRef.current) videoRef.current.srcObject = null;
    };

    const init = async () => {
      if (!("BarcodeDetector" in window) || !navigator.mediaDevices?.getUserMedia) {
        onDetect("__NO_CAMERA__");
        return;
      }
      try {
        localStream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" } },
          audio: false,
        });
      } catch (e) {
        onDetect("__NO_CAMERA__");
        return;
      }
      streamRef.current = localStream;
      if (videoRef.current) {
        videoRef.current.srcObject = localStream;
        await videoRef.current.play().catch(() => {});
      }
      timerRef.current = setInterval(loop, 250);
    };

    async function loop() {
      if (cancelled || !videoRef.current) return;
      try {
        const detector = new BarcodeDetector({
          formats: ["ean_13", "ean_8", "code_128", "code_39", "upc_a", "upc_e", "qr_code"],
        });
        const codes = await detector.detect(videoRef.current);
        if (cancelled) return;
        if (codes && codes.length && codes[0].rawValue) {
          const raw = String(codes[0].rawValue || "");
          if (raw) {
            stop();
            onDetect(raw);
          }
        }
      } catch (e) {
        /* el detector puede no estar listo aun: reintenta */
      }
    }

    init();
    return stop;
  }, [onDetect]);

  return (
    <div className="rc-cam-overlay" data-testid="camera-scanner">
      <div className="rc-cam-box">
        <div className="rc-cam-head">
          <b>ESCANEAR CON CÁMARA</b>
          <button type="button" className="rc-iconbtn" onClick={onClose} aria-label="Cerrar" data-testid="close-cam">
            ✕
          </button>
        </div>
        <video ref={videoRef} className="rc-cam-video" muted playsInline autoPlay />
        <p className="rc-muted rc-tiny">Apunta al codigo de barras del producto. La captura se cierra sola.</p>
      </div>
    </div>
  );
}