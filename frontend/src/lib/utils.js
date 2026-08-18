import { clsx } from "clsx";
import { twMerge } from "tailwind-merge"

const UNIDADES = ["", "UNO", "DOS", "TRES", "CUATRO", "CINCO", "SEIS", "SIETE", "OCHO", "NUEVE", "DIEZ", "ONCE", "DOCE", "TRECE", "CATORCE", "QUINCE", "DIECISÉIS", "DIECISIETE", "DIECIOCHO", "DIECINUEVE", "VEINTE"];
const DECENAS = ["", "", "VEINTI", "TREINTA", "CUARENTA", "CINCUENTA", "SESENTA", "SETENTA", "OCHENTA", "NOVENTA"];
const CENTENAS = ["", "CIENTO", "DOSCIENTOS", "TRESCIENTOS", "CUATROCIENTOS", "QUINIENTOS", "SEISCIENTOS", "SETECIENTOS", "OCHOCIENTOS", "NOVECIENTOS"];

function tresDigitos(n) {
  const centena = Math.floor(n / 100);
  const resto = n % 100;
  let palabras = "";
  if (centena === 1 && resto === 0) palabras += "CIEN";
  else if (centena > 0) palabras += CENTENAS[centena] + (resto > 0 ? " " : "");
  if (resto > 0) {
    if (resto <= 20) palabras += UNIDADES[resto];
    else {
      const dec = Math.floor(resto / 10);
      const uni = resto % 10;
      if (dec === 2) palabras += "VEINTI" + (uni > 0 ? UNIDADES[uni] : "");
      else {
        palabras += DECENAS[dec];
        if (uni > 0) palabras += " Y " + UNIDADES[uni];
      }
    }
  }
  return palabras.trim();
}

function grupo(n, singular, plural) {
  if (n <= 0) return "";
  return n === 1 ? `${singular} ` : `${tresDigitos(n)} ${plural} `;
}

function enteroEnLetras(n) {
  if (n === 0) return "";
  const billions = Math.floor(n / 1000000000);
  const millions = Math.floor((n % 1000000000) / 1000000);
  const miles = Math.floor((n % 1000000) / 1000);
  const resto = n % 1000;
  let texto = "";
  texto += grupo(billions % 1000000, "UN BILLÓN", "BILLONES");
  texto += grupo(millions, "UN MILLÓN", "MILLONES");
  if (miles > 0) texto += miles === 1 ? "MIL " : `${tresDigitos(miles)} MIL `;
  if (resto > 0) texto += tresDigitos(resto);
  return texto.trim();
}

export function numeroALetras(valor) {
  const num = Number(valor) || 0;
  const signo = num < 0 ? "MENOS " : "";
  const abs = Math.abs(num);
  const entero = Math.floor(abs);
  const decimales = Math.round((abs - entero) * 100);
  const partes = entero > 0 ? enteroEnLetras(entero) : "CERO";
  const decTxt = String(decimales).padStart(2, "0");
  return `${signo}${partes} PESOS ${decTxt}/100 M.N.`.trim();
}

export function cn(...inputs) {
  return twMerge(clsx(inputs));
}