import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import type { PartialFields } from './parser.ts';
import type { AlertImage } from './types.ts';

// Respaldo del parser de regex (RF-16): Claude solo se llama si el regex no sacó los
// cinco datos de RF-09.
export interface FieldExtractor {
  extract(body: string, image: AlertImage | null): Promise<PartialFields>;
}

const MODEL = 'claude-sonnet-5-5';
const TIMEOUT_MS = 8_000; // margen para el p95 < 10 s de RNF-01

const ExtractionSchema = z.object({
  ticker: z.string().nullable(),
  entry: z.number().nullable(),
  stop_loss: z.number().nullable(),
  target_price: z.number().nullable(),
  target_is_indicators_only: z.boolean(),
  risk_level: z.enum(['Medio', 'Medio-Alto', 'Alto']).nullable(),
});
type Extraction = z.infer<typeof ExtractionSchema>;

const SYSTEM = `Extraés datos de alertas de trading de criptomonedas (Binance Futuros) que llegan por WhatsApp, a veces con una captura de TradingView.
Devolvé solo lo que esté escrito en el texto o se lea claramente en la imagen; si un dato no aparece, devolvé null. Nunca estimes ni completes valores.
- ticker: el activo del título "<TICKER> - ALERTA DE TRADING", sin USDT (p. ej. "KAIA").
- entry: precio de "Entrada".
- stop_loss: precio de "SL".
- target_price: el precio numérico de "Obj." si lo trae; null si el objetivo solo menciona indicadores (ASL21, EMA55).
- target_is_indicators_only: true si el objetivo menciona indicadores y no trae precio numérico.
- risk_level: "Riesgo medio" → "Medio", "medio-alto" → "Medio-Alto", "alto" → "Alto".`;

export function toPartialFields(e: Extraction): PartialFields {
  const fields: PartialFields = {};
  const ticker = e.ticker?.trim().toUpperCase().replace(/USDT$/, '');
  if (ticker && /^[A-Z0-9]+$/.test(ticker)) fields.ticker = ticker;
  if (e.entry !== null && e.entry > 0) fields.entry = e.entry;
  if (e.stop_loss !== null && e.stop_loss > 0) fields.stopLoss = e.stop_loss;
  if (e.target_price !== null && e.target_price > 0) fields.target = { kind: 'price', price: e.target_price };
  else if (e.target_is_indicators_only) fields.target = { kind: 'indicators' };
  if (e.risk_level !== null) fields.riskLevel = e.risk_level;
  return fields;
}

export class ClaudeExtractor implements FieldExtractor {
  private readonly client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey, timeout: TIMEOUT_MS, maxRetries: 0 });
  }

  async extract(body: string, image: AlertImage | null): Promise<PartialFields> {
    const content: Anthropic.ContentBlockParam[] = [];
    if (image) {
      content.push({
        type: 'image',
        source: { type: 'base64', media_type: image.mimeType as 'image/jpeg', data: image.data },
      });
    }
    content.push({ type: 'text', text: `Texto de la alerta:\n<alerta>\n${body}\n</alerta>` });

    const response = await this.client.messages.parse({
      model: MODEL,
      max_tokens: 1024,
      system: SYSTEM,
      messages: [{ role: 'user', content }],
      output_config: { effort: 'low', format: zodOutputFormat(ExtractionSchema) },
    });
    // Una negativa o una respuesta sin parsear no completa nada: la alerta termina
    // rechazada como incompleta, nunca operada con datos dudosos.
    if (response.stop_reason === 'refusal' || !response.parsed_output) return {};
    return toPartialFields(response.parsed_output);
  }
}
