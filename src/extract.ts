import type { FieldExtractor } from './claude-extractor.ts';
import { isComplete, missingFields, parseText, type PartialFields } from './parser.ts';
import type { AlertFields, ExtractionSource, FieldName, IncomingMessage } from './types.ts';

export type ExtractResult =
  | { ok: true; fields: AlertFields; source: ExtractionSource }
  | { ok: false; partial: PartialFields; missing: FieldName[]; detail: string };

// RF-09 → RF-16 → RF-17: regex primero; si no alcanza, Claude con el texto y la imagen
// (si hay) en una sola llamada, completando solo los datos que faltan.
export async function extractFields(msg: IncomingMessage, claude: FieldExtractor | null): Promise<ExtractResult> {
  const fromText = parseText(msg.body);
  if (isComplete(fromText)) return { ok: true, fields: fromText, source: 'texto' };

  if (!claude) {
    return fail(fromText, 'faltan datos en el texto y el respaldo con Claude está apagado (sin ANTHROPIC_API_KEY)');
  }

  let image = null;
  if (msg.hasMedia) {
    try {
      image = await msg.downloadImage();
    } catch {
      image = null; // sin imagen se intenta igual con el texto
    }
  }

  let fromClaude: PartialFields;
  try {
    fromClaude = await claude.extract(msg.body, image);
  } catch (err) {
    return fail(fromText, `falló el respaldo con Claude: ${(err as Error).message}`);
  }

  // Lo que sacó el regex manda: Claude solo completa huecos.
  const merged: PartialFields = { ...fromClaude, ...fromText };
  if (isComplete(merged)) return { ok: true, fields: merged, source: image ? 'claude+imagen' : 'claude' };
  return fail(merged, image ? 'faltan datos en el texto y en la imagen' : 'faltan datos en el texto (sin imagen)');
}

function fail(partial: PartialFields, why: string): ExtractResult {
  const missing = missingFields(partial);
  return { ok: false, partial, missing, detail: `${why}: ${missing.join(', ')}` };
}
