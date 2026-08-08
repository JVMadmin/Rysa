import { Navigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { Loader2 } from "lucide-react";

export default function ProtectedRoute({ children }) {
  const { user } = useAuth();
  if (user === undefined)
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-100" data-testid="auth-loading">
        <Loader2 className="w-8 h-8 animate-spin text-[#B95A3A]" />
      </div>
    );
  if (!user) return <Navigate to="/login" replace />;
  return children;
}
