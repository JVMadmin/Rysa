export interface SemaforoCrediticio {
  color: 'verde' | 'amarillo' | 'rojo';
  nivel: string;
  badge: string;
  resumen: string;
  dias_mora?: number;
}

export interface ClientDocumento {
  url: string;
  filename: string;
  mime?: string;
  size?: number;
  fecha?: string;
}

export interface SellerDashboardData {
  vendedor?: {
    id: string;
    name: string;
    role: string;
    sucursal_id?: string;
  };
  sucursal?: string;
  fecha?: string;
  mes?: string;
  ventas_dia?: {
    monto: number;
    numero: number;
  };
  ventas_mes?: {
    monto: number;
    numero: number;
    meta: number;
    avance_pct: number;
  };
  cartera_credito_total?: {
    saldo_total: number;
    vencido: number;
    por_vencer: number;
  };
  cxc?: {
    saldo_total: number;
    vencido: number;
    por_vencer: number;
    cobrado_hoy: number;
  };
  cobros_hoy?: {
    monto: number;
    numero: number;
  };
  clientes_atendidos_hoy?: number;
  visitas?: {
    programadas: number;
    realizadas_hoy: number;
    total_hoy: number;
    proximas?: any[];
  };
  actividad?: {
    ultimas_ventas?: any[];
    ultimos_clientes?: any[];
    ultimos_cobros?: any[];
    proximas_visitas?: any[];
  };
}

export interface Client {
  id: string;
  nombre: string;
  codigo?: string;
  rfc?: string;
  telefono?: string;
  celular?: string;
  whatsapp?: string;
  correo?: string;
  direccion?: string;
  colonia?: string;
  ciudad?: string;
  estado_geo?: string;
  cp?: string;
  saldo?: number;
  limite_credito?: number;
  dias_credito?: number;
  vencido?: number;
  credito_autorizado?: boolean;
  condicion_pago?: string;
  semaforo?: SemaforoCrediticio;
  documentos?: Record<string, ClientDocumento>;
  foto_fachada?: string;
  latitud?: number;
  longitud?: number;
  contacto?: string;
  email?: string;
  vendedor_id?: string;
  vendedor?: string;
  lista_precios?: number;
  ult_fecha_compra?: string;
  proxima_visita?: string;
  en_cartera?: boolean;
}

export interface Product {
  id: string;
  sku: string;
  descripcion: string;
  nombre?: string;
  precio: number;
  precio1?: number;
  precio2?: number;
  precios?: Array<{ nombre: string; precio_con_iva: number; precio_sin_iva?: number; precio?: number }>;
  existencia: number;
  stock?: number;
  unidad_medida?: string;
  unidad?: string;
  categoria?: string;
  linea?: string;
  foto?: string;
  imagen?: string;
  imagen_url?: string;
  presentaciones?: any[];
  iva_tasa?: number;
}

export interface CartItem {
  product: Product;
  cantidad: number;
  precio: number;
  subtotal: number;
}

export interface PedidoItemInput {
  product_id?: string;
  codigo: string;
  descripcion: string;
  unidad?: string;
  solicitado: number;
  precio: number;
  iva_tasa?: number;
}

export interface PedidoInput {
  cliente_id?: string;
  vendedor_id?: string;
  fecha_pedido?: string;
  fecha_entrega?: string;
  notas?: string;
  items: PedidoItemInput[];
  idempotency_key?: string;
}

export interface PedidoCreatedResponse {
  id: string;
  folio: string;
  cliente_id?: string;
  cliente_nombre?: string;
  vendedor_id?: string;
  vendedor_nombre?: string;
  fecha_pedido?: string;
  subtotal: number;
  iva: number;
  total: number;
  items: any[];
  estado: string;
}

export interface SaleInput {
  cliente_id: string;
  condicion: 'contado' | 'credito';
  forma_pago?: string;
  items: Array<{
    producto_id: string;
    cantidad: number;
    precio_unitario: number;
    descripcion?: string;
  }>;
  notas?: string;
}

export interface AbonoInput {
  monto: number;
  metodo?: string;
  forma_pago?: string;
  referencia?: string;
  nota?: string;
}

export interface Visit {
  id: string;
  cliente_id: string;
  cliente_nombre: string;
  cliente_codigo?: string;
  fecha_programada?: string;
  hora?: string;
  tipo_visita: string;
  estado: 'programada' | 'en_camino' | 'realizada' | 'cancelada' | 'no_localizado';
  comentarios?: string;
  resultado?: string;
  latitud?: number;
  longitud?: number;
  direccion?: string;
  fecha_registro?: string;
}
