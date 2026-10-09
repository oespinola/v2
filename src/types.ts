export type Mode = 'DRY' | 'LIVE';
export type Side = 'LONG' | 'SHORT';
export type RiskLevel = 'Medio' | 'Medio-Alto' | 'Alto';

// Objetivo tal como viene en la alerta: un precio (RF-28) o "por indicadores" (RF-24).
export type Target = { kind: 'price'; price: number } | { kind: 'indicators' };

// Datos de RF-09, tal como los escribe la alerta (antes del mapeo de RF-31).
export interface AlertFields {
  ticker: string; // "KAIA": el contrato se arma después (KAIAUSDT o 1000KAIAUSDT)
  entry: number;
  stopLoss: number;
  target: Target;
  riskLevel: RiskLevel;
}

export type FieldName = keyof AlertFields;

export interface AlertImage {
  data: string; // base64
  mimeType: string;
}

// Mensaje del grupo, ya desacoplado de whatsapp-web.js.
export interface IncomingMessage {
  waMessageId: string;
  senderId: string; // LID de WhatsApp, p. ej. "42799684665569@lid"
  senderName: string | null;
  body: string;
  receivedAt: Date;
  hasMedia: boolean;
  // La imagen se descarga solo si el texto no alcanza (RF-16).
  downloadImage: () => Promise<AlertImage | null>;
}

// Motivos de rechazo de PRD-001, en el orden de evaluación de RF-38.
export const REJECT_REASONS = [
  'remitente no autorizado',
  'duplicado',
  'incompleta',
  'ticker inexistente',
  'SL igual a la Entrada',
  'TP inválido',
  'ranking no disponible',
  'top 3 ganadores/perdedores',
] as const;
export type RejectReason = (typeof REJECT_REASONS)[number];

// De dónde salieron los datos de RF-09.
export type ExtractionSource = 'texto' | 'claude' | 'claude+imagen';

// Alerta válida según PRD-001: lista para el dimensionamiento de PRD-002.
export interface ValidAlert {
  symbol: string; // contrato perpetuo de Binance (RF-31)
  side: Side;
  entry: number; // ya mapeados (×1000 si corresponde) y ajustados al tickSize (RF-37)
  stopLoss: number;
  takeProfit: number;
  tpSource: 'alerta' | 'calculado';
  riskLevel: RiskLevel;
}

// Edición de un mensaje del grupo, ya desacoplada de whatsapp-web.js.
export interface IncomingEdit {
  waMessageId: string;
  senderId: string;
  prevBody: string;
  newBody: string;
  editedAt: Date;
}

// Edición de una alerta ya procesada: se registra para revisión manual y no se opera
// (Fuera de Alcance de PRD-000).
export interface EditRecord {
  event: 'alerta editada tras procesarse';
  alertId: string; // el de la alerta original (RF-11)
  waMessageId: string;
  editedAt: string; // ISO
  senderId: string;
  mode: Mode;
  changes: string[]; // p. ej. ["SL 145 → 148"]
  prevBody: string;
  newBody: string;
}

// Registro de RF-05 para el tramo de PRD-001. Los campos de órdenes, cantidad y cierre
// llegan con PRD-002/PRD-003.
export interface AlertRecord {
  alertId: string; // RF-11
  waMessageId: string;
  contentHash: string | null;
  receivedAt: string; // ISO
  classifiedAt: string; // ISO
  latencyMs: number;
  senderId: string;
  senderName: string | null;
  mode: Mode;
  ticker: string | null;
  symbol: string | null;
  side: Side | null;
  entry: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  tpSource: 'alerta' | 'calculado' | null;
  riskLevel: RiskLevel | null;
  extractedFrom: ExtractionSource | null;
  status: 'válida' | 'rechazada';
  reason: RejectReason | null;
  detail: string | null;
}
