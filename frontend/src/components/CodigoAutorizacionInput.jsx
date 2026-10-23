import { useContext } from "react";
import { OTPInput, OTPInputContext, REGEXP_ONLY_DIGITS } from "input-otp";
import { cn } from "@/lib/utils";

// Casilla del código. Por defecto el dígito se muestra como •: quien autoriza
// teclea su código frente al cajero (y el navegador no lo ofrece guardar,
// como pasaría con un campo de contraseña).
function Casilla({ index, oculto }) {
  const { char, hasFakeCaret, isActive } = useContext(OTPInputContext).slots[index];
  return (
    <div className={cn(
      "relative flex h-12 w-11 items-center justify-center border-y border-r border-slate-300 bg-white font-display text-xl font-bold text-slate-900 transition-shadow first:rounded-l-md first:border-l last:rounded-r-md",
      isActive && "z-10 ring-2 ring-brand-600",
    )}>
      {char ? (oculto ? "•" : char) : null}
      {hasFakeCaret && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="h-5 w-px animate-pulse bg-slate-900" />
        </div>
      )}
    </div>
  );
}

/** Código de autorización de 6 dígitos. */
export default function CodigoAutorizacionInput({ value, onChange, onComplete, oculto = true, autoFocus, disabled, testId }) {
  return (
    <OTPInput
      maxLength={6} value={value} onChange={onChange} onComplete={onComplete}
      pattern={REGEXP_ONLY_DIGITS} inputMode="numeric" autoComplete="off"
      pushPasswordManagerStrategy="none"
      autoFocus={autoFocus} disabled={disabled} data-testid={testId}
      containerClassName="flex items-center justify-center has-[:disabled]:opacity-50"
    >
      {[0, 1, 2, 3, 4, 5].map((i) => <Casilla key={i} index={i} oculto={oculto} />)}
    </OTPInput>
  );
}
