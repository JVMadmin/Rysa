import { Component } from "react";
import { AlertTriangle } from "lucide-react";

/**
 * Error boundary para mapas: si Leaflet/react-leaflet lanza durante el
 * render (coords imposibles, contenedor de tamaño 0, etc.), se muestra un
 * panel informativo en lugar de una pantalla en blanco.
 * `resetKey` permite reintentar desde el padre cambiando la prop.
 */
export default class ErrorBoundaryMapa extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null, resetKey: props.resetKey };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidUpdate(prev) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null });
    }
  }

  render() {
    if (this.state.error) {
      return (
        <div className="h-full min-h-[240px] flex flex-col items-center justify-center gap-2 text-center p-6"
             data-testid="mapa-error">
          <AlertTriangle className="w-8 h-8 text-amber-500" />
          <div className="font-semibold text-slate-700 text-sm">El mapa no pudo dibujarse</div>
          <p className="text-xs text-slate-400 max-w-sm">
            Ocurrió un problema al renderizar el mapa{this.state.error?.message ? `: ${String(this.state.error.message).slice(0, 140)}` : ""}.
            Los datos siguen disponibles; intenta recargar.
          </p>
        </div>
      );
    }
    return this.props.children;
  }
}
