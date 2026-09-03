import React from "react";
import { AlertTriangle } from "lucide-react";

/**
 * Error Boundary global: captura errores de renderizado de React en toda la
 * aplicación y muestra un fallback amigable en vez de pantalla en blanco.
 */
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    // Loguear al servidor si tenemos endpoint disponible (no bloqueante)
    console.error("ErrorBoundary capturó:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
          <div className="card-soft p-8 max-w-md text-center">
            <AlertTriangle className="w-12 h-12 mx-auto text-amber-500 mb-4" />
            <h1 className="font-display font-bold text-xl mb-2">
              Algo salió mal
            </h1>
            <p className="text-sm text-slate-500 mb-4">
              Ocurrió un error inesperado en la aplicación. Intenta recargar la
              página.
            </p>
            {this.state.error && (
              <p className="text-xs text-slate-400 mb-4 font-mono break-all">
                {String(this.state.error.message || this.state.error).slice(
                  0,
                  200
                )}
              </p>
            )}
            <button
              onClick={() => window.location.reload()}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 transition-colors"
            >
              Recargar página
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
