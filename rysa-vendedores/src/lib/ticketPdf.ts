import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { RYSA_LOGO_BASE64 } from './logoBase64';

export interface TicketItem {
  cantidad: number;
  codigo: string;
  descripcion: string;
  unidad: string;
  precio: number;
  subtotal: number;
}

export interface TicketData {
  folio: string;
  fecha: string;
  vendedor: string;
  clienteNombre: string;
  clienteRfc?: string;
  clienteTelefono?: string;
  clienteDireccion?: string;
  condicion: string;
  formaPago?: string;
  notas?: string;
  items: TicketItem[];
  subtotalNeto: number;
  tasaIva: number;
  aplicaIva: boolean;
  ivaMonto: number;
  total: number;
}

function formatCurrency(num: number): string {
  return `$${num.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function buildTicketHtml(data: TicketData): string {
  const itemsHtml = data.items
    .map(
      (it) => `
      <tr style="border-bottom: 1px dashed #e2e8f0;">
        <td style="padding: 6px 4px; font-weight: bold; text-align: center;">${it.cantidad} ${it.unidad || 'PZA'}</td>
        <td style="padding: 6px 4px;">
          <div style="font-weight: 600; color: #1a202c;">${it.descripcion}</div>
          <div style="font-size: 10px; color: #718096;">SKU: ${it.codigo || 'S/N'}</div>
        </td>
        <td style="padding: 6px 4px; text-align: right; color: #4a5568;">${formatCurrency(it.precio)}</td>
        <td style="padding: 6px 4px; text-align: right; font-weight: bold; color: #1a202c;">${formatCurrency(it.subtotal)}</td>
      </tr>
    `
    )
    .join('');

  return `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Pedido ${data.folio} - Grupo RYSA</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      margin: 0;
      padding: 24px;
      color: #2d3748;
      background: #ffffff;
      font-size: 12px;
    }
    .ticket-card {
      max-width: 480px;
      margin: 0 auto;
      border: 1px solid #e2e8f0;
      border-radius: 12px;
      padding: 24px;
      box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);
    }
    .header {
      text-align: center;
      border-bottom: 2px solid #D32F2F;
      padding-bottom: 16px;
      margin-bottom: 16px;
    }
    .logo {
      max-height: 56px;
      margin-bottom: 8px;
    }
    .company-name {
      font-size: 18px;
      font-weight: 800;
      color: #1a202c;
      letter-spacing: 0.5px;
      margin: 0;
    }
    .branch-name {
      font-size: 12px;
      color: #D32F2F;
      font-weight: 700;
      margin-top: 2px;
    }
    .badge-folio {
      display: inline-block;
      background: #fff5f5;
      color: #D32F2F;
      border: 1px solid #feb2b2;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 700;
      padding: 4px 12px;
      margin-top: 10px;
      letter-spacing: 1px;
    }
    .meta-table {
      width: 100%;
      margin-bottom: 16px;
      border-collapse: collapse;
      font-size: 11px;
    }
    .meta-table td {
      padding: 3px 0;
    }
    .meta-label {
      color: #718096;
      width: 32%;
    }
    .meta-value {
      font-weight: 600;
      color: #2d3748;
    }
    .items-table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 16px;
      font-size: 11px;
    }
    .items-header th {
      background: #f7fafc;
      padding: 8px 4px;
      color: #4a5568;
      font-weight: 700;
      border-top: 1px solid #edf2f7;
      border-bottom: 1px solid #cbd5e0;
      text-align: left;
    }
    .totals-box {
      border-top: 2px solid #e2e8f0;
      padding-top: 12px;
      margin-bottom: 16px;
    }
    .totals-row {
      display: flex;
      justify-content: space-between;
      margin-bottom: 4px;
      font-size: 12px;
    }
    .total-grand {
      display: flex;
      justify-content: space-between;
      margin-top: 8px;
      padding-top: 8px;
      border-top: 1px solid #e2e8f0;
      font-size: 16px;
      font-weight: 800;
      color: #1a202c;
    }
    .footer {
      text-align: center;
      border-top: 1px dashed #cbd5e0;
      padding-top: 14px;
      margin-top: 16px;
      font-size: 10px;
      color: #718096;
    }
    .legal-notice {
      margin-top: 6px;
      font-size: 9px;
      color: #a0aec0;
    }
  </style>
</head>
<body>
  <div class="ticket-card">
    <div class="header">
      <img src="${RYSA_LOGO_BASE64}" alt="Grupo RYSA" class="logo" />
      <h1 class="company-name">GRUPO RYSA</h1>
      <div class="branch-name">Sucursal Matriz (Palenque, Chiapas)</div>
      <div class="badge-folio">FOLIO: ${data.folio}</div>
    </div>

    <table class="meta-table">
      <tr>
        <td class="meta-label">Fecha y Hora:</td>
        <td class="meta-value">${data.fecha}</td>
      </tr>
      <tr>
        <td class="meta-label">Asesor Comercial:</td>
        <td class="meta-value">${data.vendedor}</td>
      </tr>
      <tr>
        <td class="meta-label">Cliente:</td>
        <td class="meta-value" style="font-weight: 700;">${data.clienteNombre}</td>
      </tr>
      ${data.clienteRfc ? `<tr><td class="meta-label">RFC:</td><td class="meta-value">${data.clienteRfc}</td></tr>` : ''}
      ${data.clienteTelefono ? `<tr><td class="meta-label">Teléfono:</td><td class="meta-value">${data.clienteTelefono}</td></tr>` : ''}
      ${data.clienteDireccion ? `<tr><td class="meta-label">Dirección:</td><td class="meta-value">${data.clienteDireccion}</td></tr>` : ''}
      <tr>
        <td class="meta-label">Condición de Pago:</td>
        <td class="meta-value">${data.condicion.toUpperCase()} ${data.formaPago ? `(${data.formaPago.toUpperCase()})` : ''}</td>
      </tr>
      ${data.notas ? `<tr><td class="meta-label">Observaciones:</td><td class="meta-value">${data.notas}</td></tr>` : ''}
    </table>

    <table class="items-table">
      <thead>
        <tr class="items-header">
          <th style="width: 18%; text-align: center;">Cant.</th>
          <th style="width: 44%;">Descripción</th>
          <th style="width: 18%; text-align: right;">P. Unit</th>
          <th style="width: 20%; text-align: right;">Importe</th>
        </tr>
      </thead>
      <tbody>
        ${itemsHtml}
      </tbody>
    </table>

    <div class="totals-box">
      <div class="totals-row">
        <span style="color: #718096;">Subtotal Neto:</span>
        <span style="font-weight: 600;">${formatCurrency(data.subtotalNeto)}</span>
      </div>
      <div class="totals-row">
        <span style="color: #718096;">IVA Trasladado (${data.aplicaIva ? `${data.tasaIva}%` : '0%'}):</span>
        <span style="font-weight: 600;">${formatCurrency(data.ivaMonto)}</span>
      </div>
      <div class="total-grand">
        <span>TOTAL A PAGAR:</span>
        <span style="color: #D32F2F;">${formatCurrency(data.total)}</span>
      </div>
    </div>

    <div class="footer">
      <div style="font-weight: 700; color: #4a5568; margin-bottom: 4px;">¡GRACIAS POR SU PREFERENCIA!</div>
      <div>Grupo RYSA • Materiales y Soluciones Comerciales</div>
      <div class="legal-notice">Este documento es un comprobante comercial oficial de pedido levantado en campo. Los precios e importes son finales y no modificables.</div>
    </div>
  </div>
</body>
</html>
  `;
}

export async function generateTicketPdf(data: TicketData): Promise<string> {
  const html = buildTicketHtml(data);
  const file = await Print.printToFileAsync({
    html,
    base64: false,
  });
  return file.uri;
}

export async function shareTicketPdf(data: TicketData): Promise<void> {
  const pdfUri = await generateTicketPdf(data);
  const isAvailable = await Sharing.isAvailableAsync();
  if (isAvailable) {
    await Sharing.shareAsync(pdfUri, {
      mimeType: 'application/pdf',
      dialogTitle: `Pedido ${data.folio} - Grupo RYSA`,
      UTI: 'com.adobe.pdf',
    });
  } else {
    throw new Error('La función de compartir no está disponible en este dispositivo.');
  }
}
