import type { PipelineResult } from './pipeline.ts';
import { parseText } from './parser.ts';
import type { EditRecord } from './types.ts';

// Una línea por alerta en la consola; el detalle completo queda en data/alerts.log.
export function describe(result: PipelineResult): string | null {
  if (result.status === 'ignorada') return null;
  const r = result.record;
  const head = `[${r.mode}] ${r.ticker ?? '?'}${r.symbol ? ` → ${r.symbol}` : ''}`;
  const timing = `${r.latencyMs} ms${r.extractedFrom ? `, ${r.extractedFrom}` : ''}`;
  if (result.status === 'válida') {
    const a = result.alert;
    return `${head} VÁLIDA ${a.side} entrada ${a.entry} SL ${a.stopLoss} TP ${a.takeProfit} (${a.tpSource}) [${timing}]`;
  }
  return `${head} RECHAZADA: ${r.reason}${r.detail ? ` (${r.detail})` : ''} [${timing}]`;
}

export function describeEdit(record: EditRecord): string {
  const ticker = parseText(record.newBody).ticker ?? parseText(record.prevBody).ticker ?? '?';
  return `[${record.mode}] ${ticker} EDITADA tras procesarse (no se opera): ${record.changes.join(', ')}`;
}
