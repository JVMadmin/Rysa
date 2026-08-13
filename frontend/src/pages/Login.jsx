import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { api, formatApiError } from "@/lib/api";
import { useBranding } from "@/hooks/useBranding";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Boxes, Loader2, Lock } from "lucide-react";
import { toast } from "sonner";

export default function Login() {
  const { login } = useAuth();
  const nav = useNavigate();
  const { logo, empresa_nombre } = useBranding();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

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
    <div className="min-h-screen flex">
      <div className="hidden lg:flex flex-col justify-between w-1/2 bg-ink p-12 relative overflow-hidden">
        <div className="absolute inset-0 opacity-20"
          style={{ backgroundImage: "url('https://images.unsplash.com/photo-1710141530542-f792450e736e?crop=entropy&cs=srgb&fm=jpg&q=85&w=1200')", backgroundSize: "cover", backgroundPosition: "center" }} />
        <div className="relative z-10 flex items-center gap-3">
          <img src={logo} alt="logo" className="w-10 h-10 rounded-lg object-contain bg-white/10" onError={(e) => { e.currentTarget.style.display = "none"; }} />
          <span className="font-display font-extrabold text-white text-2xl">{empresa_nombre}</span>
        </div>
        <div className="relative z-10">
          <h2 className="font-display text-4xl font-black text-white tracking-tighter leading-tight">
            Sistema ERP & Punto de Venta
          </h2>
          <p className="text-slate-300 mt-4 max-w-md">
            Plásticos y desechables al mayoreo y menudeo. Controla inventario, ventas, caja y clientes en un solo lugar.
          </p>
        </div>
        <div className="relative z-10 text-slate-400 text-sm">© {new Date().getFullYear()} Grupo RYSA</div>
      </div>

      <div className="flex-1 flex items-center justify-center p-6 bg-canvas">
        <form onSubmit={submit} className="w-full max-w-sm animate-fade-up" data-testid="login-form">
          <div className="lg:hidden flex items-center gap-2 mb-8">
            <img src={logo} alt="logo" className="w-9 h-9 rounded-lg object-contain" onError={(e) => { e.currentTarget.style.display = "none"; }} />
            <span className="font-display font-extrabold text-2xl">{empresa_nombre}</span>
          </div>
          <h1 className="font-display text-3xl font-black tracking-tighter text-slate-900">Iniciar sesión</h1>
          <p className="text-slate-500 mt-1 mb-8 text-sm">Ingresa tus credenciales para acceder al sistema.</p>

          <div className="space-y-4">
            <div>
              <Label htmlFor="email" className="text-xs uppercase tracking-wider text-slate-500">Correo</Label>
              <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
                data-testid="login-email" className="mt-1.5 h-11" placeholder="correo@gruporysa.com" />
            </div>
            <div>
              <Label htmlFor="password" className="text-xs uppercase tracking-wider text-slate-500">Contraseña</Label>
              <Input id="password" type="password" required value={password} onChange={(e) => setPassword(e.target.value)}
                data-testid="login-password" className="mt-1.5 h-11" placeholder="••••••••" />
            </div>
          </div>

          <Button type="submit" disabled={loading} data-testid="login-submit"
            className="w-full h-11 mt-6 bg-[#C1401E] hover:bg-[#A03316] text-white font-semibold">
            {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <><Lock className="w-4 h-4 mr-2" /> Entrar</>}
          </Button>
          <Link to="/" className="block text-center text-sm text-slate-500 hover:text-[#C1401E] mt-4">
            ← Volver al inicio
          </Link>
        </form>
      </div>
    </div>
  );
}
