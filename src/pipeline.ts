import type { FieldExtractor } from './claude-extractor.ts';
import { extractFields } from './extract.ts';
import { filterMessage } from './filter.ts';
import { isCorrectSide, computeIndicators, pickTakeProfit } from './indicators.ts';
import { checkRanking, type Ranking } from './market-data.ts';
import { parseText, type PartialFields } from './parser.ts';
import { alertId, contentHash, type AlertStore } from './store.ts';
import type { SymbolInfo } from './binance-public.ts';
import { adjustPricesToTick, mapTicker, scale } from './symbols.ts';
import type {
  AlertFields,
  AlertRecord,
  EditRecord,
  ExtractionSource,
  FieldName,
  IncomingEdit,
  IncomingMessage,
  Mode,
  RejectReason,
  Side,
  ValidAlert,
} from './types.ts';

export interface PipelineDeps {
  mode: Mode;
  authorizedSenders: ReadonlySet<string>;
  store: AlertStore;
  claude: FieldExtractor | null;
  market: {
    readonly symbols: ReadonlyMap<string, SymbolInfo>;
    readonly ranking: Ranking | null;
    closes1h(symbol: string): Promise<number[]>;
  };
  now?: () => Date;
}

export type PipelineResult =
  | { status: 'ignorada' } // RF-03: no se loguea
  | { status: 'válida'; alert: ValidAlert; record: AlertRecord }
  | { status: 'rechazada'; reason: RejectReason; record: AlertRecord };

class Rejection {
  constructor(
    readonly reason: RejectReason,
    readonly detail: string | null = null,
  ) {}
}

// RF-01/RF-02. SL = Entrada se rechaza antes (RF-14), así que acá nunca son iguales.
export function sideOf(entry: number, stopLoss: number): Side {
  return stopLoss < entry ? 'LONG' : 'SHORT';
}

function hashOf(fields: PartialFields): string | null {
  const { ticker, entry, stopLoss, target } = fields;
  if (ticker === undefined || entry === undefined || stopLoss === undefined || target === undefined) return null;
  return contentHash({ ticker, entry, stopLoss, target });
}

// Registro en construcción: arranca con lo que se sabe del mensaje y se va completando.
type Draft = Omit<AlertRecord, 'alertId' | 'classifiedAt' | 'latencyMs' | 'status' | 'reason' | 'detail'>;

function draftFrom(msg: IncomingMessage, mode: Mode, fields: PartialFields): Draft {
  return {
    waMessageId: msg.waMessageId,
    contentHash: hashOf(fields),
    receivedAt: msg.receivedAt.toISOString(),
    senderId: msg.senderId,
    senderName: msg.senderName,
    mode,
    ticker: fields.ticker ?? null,
    symbol: null,
    side: null,
    entry: fields.entry ?? null,
    stopLoss: fields.stopLoss ?? null,
    takeProfit: fields.target?.kind === 'price' ? fields.target.price : null,
    tpSource: fields.target === undefined ? null : fields.target.kind === 'price' ? 'alerta' : 'calculado',
    riskLevel: fields.riskLevel ?? null,
    extractedFrom: null,
  };
}

// Pasos 5 a 9 de RF-38 sobre una alerta completa.
async function validate(
  fields: AlertFields,
  draft: Draft,
  deps: PipelineDeps,
  now: Date,
): Promise<ValidAlert> {
  // RF-31/RF-32
  const mapped = mapTicker(fields.ticker, deps.market.symbols);
  if (!mapped) throw new Rejection('ticker inexistente', `no existe ${fields.ticker}USDT ni 1000${fields.ticker}USDT`);
  draft.symbol = mapped.symbol;
  const entry = scale(fields.entry, mapped.multiplier);
  const stopLoss = scale(fields.stopLoss, mapped.multiplier);
  draft.entry = entry;
  draft.stopLoss = stopLoss;

  // RF-14
  if (entry === stopLoss) throw new Rejection('SL igual a la Entrada');
  const side = sideOf(entry, stopLoss);
  draft.side = side;

  // RF-28 / RF-24 / RF-36
  let takeProfit: number;
  let tpSource: ValidAlert['tpSource'];
  if (fields.target.kind === 'price') {
    takeProfit = scale(fields.target.price, mapped.multiplier);
    tpSource = 'alerta';
  } else {
    let closes: number[];
    try {
      closes = await deps.market.closes1h(mapped.symbol);
    } catch (err) {
      throw new Rejection('TP inválido', `no se pudieron leer las velas de 1 h: ${(err as Error).message}`);
    }
    const values = computeIndicators(closes);
    const picked = pickTakeProfit(side, entry, values);
    if (!picked) {
      throw new Rejection(
        'TP inválido',
        `ni ASL21 (${values.asl21}) ni EMA55 (${values.ema55}) quedan del lado correcto de la Entrada ${entry} para ${side}`,
      );
    }
    takeProfit = picked.takeProfit;
    tpSource = 'calculado';
  }
  draft.takeProfit = takeProfit;
  draft.tpSource = tpSource;

  // RF-37, y RF-13 sobre los precios ya ajustados (un TP a menos de un tick de la
  // Entrada puede quedar igual a ella al redondear).
  const adjusted = adjustPricesToTick(side, { entry, stopLoss, takeProfit }, mapped.tickSize);
  Object.assign(draft, adjusted);
  if (!isCorrectSide(side, adjusted.entry, adjusted.takeProfit)) {
    throw new Rejection(
      'TP inválido',
      `TP ${adjusted.takeProfit} ${side === 'LONG' ? 'no está por encima' : 'no está por debajo'} de la Entrada ${adjusted.entry}`,
    );
  }

  // RF-21 / RF-04
  const ranking = checkRanking(mapped.symbol, deps.market.ranking, now.getTime());
  if (!ranking.ok) throw new Rejection(ranking.reason, ranking.detail);

  return { symbol: mapped.symbol, side, ...adjusted, tpSource, riskLevel: fields.riskLevel };
}

// Desde que llega el mensaje hasta que la alerta queda válida o rechazada (PRD-001).
// Evalúa en el orden de RF-38 y registra solo el primer motivo que falla.
export async function processMessage(msg: IncomingMessage, deps: PipelineDeps): Promise<PipelineResult> {
  const now = deps.now ?? (() => new Date());

  const filter = filterMessage(msg, deps.authorizedSenders);
  if (filter.action === 'ignore') return { status: 'ignorada' };

  // Para los rechazos tempranos el log lleva lo que saca el regex (gratis), sin llamar a Claude.
  let draft = draftFrom(msg, deps.mode, parseText(msg.body));
  let extractedFrom: ExtractionSource | null = null;

  const finish = (status: 'válida' | 'rechazada', reason: RejectReason | null, detail: string | null): AlertRecord => {
    const classified = now();
    const record: AlertRecord = {
      ...draft,
      extractedFrom,
      alertId: alertId(msg.waMessageId, draft.contentHash),
      classifiedAt: classified.toISOString(),
      latencyMs: classified.getTime() - msg.receivedAt.getTime(),
      status,
      reason,
      detail,
    };
    deps.store.save(record);
    return record;
  };

  try {
    if (filter.action === 'reject') throw new Rejection(filter.reason, `remitente ${msg.senderId}`);

    if (deps.store.hasWaMessage(msg.waMessageId)) {
      throw new Rejection('duplicado', 'el mensaje de WhatsApp ya fue registrado');
    }

    const extracted = await extractFields(msg, deps.claude);
    if (!extracted.ok) {
      draft = draftFrom(msg, deps.mode, extracted.partial);
      throw new Rejection('incompleta', extracted.detail);
    }
    draft = draftFrom(msg, deps.mode, extracted.fields);
    extractedFrom = extracted.source;

    if (draft.contentHash && deps.store.hasRecentHash(draft.contentHash, msg.receivedAt)) {
      throw new Rejection('duplicado', 'misma alerta (ticker, Entrada, SL, TP) en las últimas 24 h');
    }

    const alert = await validate(extracted.fields, draft, deps, now());
    return { status: 'válida', alert, record: finish('válida', null, null) };
  } catch (err) {
    if (!(err instanceof Rejection)) throw err;
    return { status: 'rechazada', reason: err.reason, record: finish('rechazada', err.reason, err.detail) };
  }
}

const FIELD_LABELS: Record<FieldName, string> = {
  ticker: 'Ticker',
  entry: 'Entrada',
  stopLoss: 'SL',
  target: 'Obj.',
  riskLevel: 'Riesgo',
};

function formatField(fields: PartialFields, name: FieldName): string {
  const value = fields[name];
  if (value === undefined) return '(falta)';
  if (typeof value === 'object') return value.kind === 'price' ? String(value.price) : 'ASL21, EMA55';
  return String(value);
}

// Qué datos de RF-09 cambió la edición, p. ej. ["SL 145 → 148"].
export function describeChanges(prevBody: string, newBody: string): string[] {
  const before = parseText(prevBody);
  const after = parseText(newBody);
  const changes = (Object.keys(FIELD_LABELS) as FieldName[])
    .map((name) => [name, formatField(before, name), formatField(after, name)] as const)
    .filter(([, a, b]) => a !== b)
    .map(([name, a, b]) => `${FIELD_LABELS[name]} ${a} → ${b}`);
  return changes.length > 0 ? changes : ['solo cambió el texto, no los datos de la alerta'];
}

// Edición de un mensaje del grupo. Si el original ya se procesó como alerta, se
// registra para revisión manual y no se opera; si no, se ignora.
export function processEdit(edit: IncomingEdit, deps: Pick<PipelineDeps, 'mode' | 'store'>): EditRecord | null {
  const alertIdOfOriginal = deps.store.alertIdFor(edit.waMessageId);
  if (alertIdOfOriginal === null) return null;
  const record: EditRecord = {
    event: 'alerta editada tras procesarse',
    alertId: alertIdOfOriginal,
    waMessageId: edit.waMessageId,
    editedAt: edit.editedAt.toISOString(),
    senderId: edit.senderId,
    mode: deps.mode,
    changes: describeChanges(edit.prevBody, edit.newBody),
    prevBody: edit.prevBody,
    newBody: edit.newBody,
  };
  deps.store.saveEdit(record);
  return record;
}
