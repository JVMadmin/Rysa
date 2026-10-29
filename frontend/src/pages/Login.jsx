import { useEffect, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { formatApiError } from "@/lib/api";
import { useBranding } from "@/hooks/useBranding";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowLeft, Loader2, Lock } from "lucide-react";
import { toast } from "sonner";

export default function Login() {
  const { login } = useAuth();
  const nav = useNavigate();
  const { empresa_nombre } = useBranding();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => { document.title = "Acceso al sistema — Grupo RYSA"; }, []);

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await login(email.trim(), password);
      nav("/app/dashboard");
      setTimeout(() => toast.success("Bienvenido a Grupo RYSA"), 60);
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail) || "Error al iniciar sesión");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex bg-white">
      <aside className="grafito grano relative hidden w-[46%] flex-col justify-between overflow-hidden p-12 text-white lg:flex">
        <img src="/images/categorias/hero.webp" alt="" className="absolute inset-0 h-full w-full object-cover opacity-35" />
        <div className="absolute inset-0 bg-gradient-to-t from-carbon-900 via-carbon-900/70 to-carbon-900/30" aria-hidden="true" />
        <Link to="/" className="relative z-10" aria-label="Grupo RYSA, ir al sitio">
          <img src="/brand/logotipo-oscuro.webp" alt="Grupo RYSA" width="900" height="424" className="h-14 w-auto" />
        </Link>
        <div className="relative z-10 max-w-md">
          <p className="etiqueta text-brand-400">Sistema interno</p>
          <h2 className="titular-ancho mt-3 text-[2.6rem] font-extrabold leading-[1.02]">ERP y punto de venta</h2>
          <p className="mt-4 text-[1.05rem] leading-7 text-slate-300">
            Inventario, ventas, caja, clientes, cotizaciones y facturación de {empresa_nombre} en un solo lugar.
          </p>
        </div>
        <p className="relative z-10 text-sm text-slate-500">© {new Date().getFullYear()} {empresa_nombre} · RYSA v{process.env.REACT_APP_VERSION || "dev"}</p>
      </aside>

      <main className="flex flex-1 items-center justify-center bg-slate-50 p-6 sm:p-10">
        <form onSubmit={submit} className="w-full max-w-sm animate-fade-up" data-testid="login-form" aria-labelledby="login-titulo">
          <Link to="/" className="mb-10 block lg:hidden" aria-label="Grupo RYSA, ir al sitio">
            <img src="/brand/logotipo-color.webp" alt="Grupo RYSA" className="h-12 w-auto" />
          </Link>
          <h1 id="login-titulo" className="titular text-[2rem] font-extrabold text-carbon-900">Iniciar sesión</h1>
          <p className="mt-2 mb-8 text-[0.95rem] text-slate-600">Ingresa con tu correo y contraseña de usuario.</p>

          <div className="space-y-5">
            <div>
              <Label htmlFor="email" className="text-sm font-medium text-slate-700">Correo</Label>
              <Input id="email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)}
                data-testid="login-email" className="mt-1.5 h-11" placeholder="correo@gruporysa.com" />
            </div>
            <div>
              <Label htmlFor="password" className="text-sm font-medium text-slate-700">Contraseña</Label>
              <Input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)}
                data-testid="login-password" className="mt-1.5 h-11" placeholder="••••••••" />
            </div>
          </div>

          <Button type="submit" variant="terracota" disabled={loading} data-testid="login-submit" className="mt-7 h-11 w-full text-[0.95rem]">
            {loading ? <Loader2 className="h-5 w-5 animate-spin" aria-label="Entrando" /> : <><Lock className="h-4 w-4" /> Entrar</>}
          </Button>
          <Link to="/" className="mt-6 inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-carbon-900">
            <ArrowLeft className="h-4 w-4" /> Volver al sitio
          </Link>
        </form>
      </main>
    </div>
  );
}
