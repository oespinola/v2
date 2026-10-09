import type { Mode } from './types.ts';

export interface Config {
  mode: Mode;
  authorizedSenders: ReadonlySet<string>;
  groupName: string;
  dataDir: string;
  whatsappAuthDir: string;
  // Sin clave el respaldo con Claude queda apagado: si el regex no alcanza, la alerta
  // se rechaza como incompleta (RF-17).
  anthropicApiKey: string | null;
}

function parseMode(raw: string | undefined): Mode {
  if (raw === 'DRY' || raw === 'LIVE') return raw;
  throw new Error(`SIGNALBRIDGE_MODE debe ser DRY o LIVE (llegó ${JSON.stringify(raw)}). Usá pnpm dev o pnpm start.`);
}

// Una lista vacía no significa "aceptar a todos": sin remitentes autorizados
// el sistema no arranca (RF-22).
function parseSenders(raw: string | undefined): ReadonlySet<string> {
  const senders = new Set(
    (raw ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );
  if (senders.size === 0) {
    throw new Error('AUTHORIZED_SENDERS está vacío: definí al menos un remitente autorizado.');
  }
  return senders;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    mode: parseMode(env.SIGNALBRIDGE_MODE),
    authorizedSenders: parseSenders(env.AUTHORIZED_SENDERS),
    groupName: env.WHATSAPP_GROUP_NAME?.trim() || 'ALERTAS CRYPTO+',
    dataDir: env.SIGNALBRIDGE_DATA_DIR?.trim() || 'data',
    whatsappAuthDir: env.WHATSAPP_AUTH_DIR?.trim() || '.wwebjs_auth',
    anthropicApiKey: env.ANTHROPIC_API_KEY?.trim() || null,
  };
}

// Carga .env si existe (Node ≥ 21.7). Las variables ya definidas en el entorno ganan.
export function loadDotEnv(path = '.env'): void {
  try {
    process.loadEnvFile(path);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
}
