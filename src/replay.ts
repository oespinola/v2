// Pasa alertas capturadas (fixtures/captured/<carpeta>/message.json) por el pipeline
// completo contra los endpoints públicos reales de Binance, sin WhatsApp y sin tocar
// data/: la base es en memoria. Uso: pnpm replay [carpeta de capturas]
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { BinancePublicApi } from './binance-public.ts';
import { ClaudeExtractor } from './claude-extractor.ts';
import { loadConfig, loadDotEnv } from './config.ts';
import { MarketData } from './market-data.ts';
import { processMessage } from './pipeline.ts';
import { describe } from './report.ts';
import { SqliteAlertStore } from './store.ts';
import type { IncomingMessage } from './types.ts';

interface CapturedMessage {
  id: string;
  date: string;
  senderId: string;
  senderName: string | null;
  body: string;
  hasMedia: boolean;
}

function loadCaptured(dir: string): IncomingMessage[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort()
    .map((name) => {
      const folder = path.join(dir, name);
      const m = JSON.parse(readFileSync(path.join(folder, 'message.json'), 'utf8')) as CapturedMessage;
      const imageFile = readdirSync(folder).find((f) => f.startsWith('image.'));
      return {
        waMessageId: m.id.split('_')[2] ?? m.id,
        senderId: m.senderId,
        senderName: m.senderName,
        body: m.body,
        receivedAt: new Date(),
        hasMedia: m.hasMedia,
        downloadImage: async () => {
          if (!imageFile) return null;
          const ext = path.extname(imageFile).slice(1);
          return {
            data: readFileSync(path.join(folder, imageFile)).toString('base64'),
            mimeType: `image/${ext === 'jpg' ? 'jpeg' : ext}`,
          };
        },
      };
    });
}

async function main(): Promise<void> {
  loadDotEnv();
  const config = loadConfig();
  const dir = process.argv[2] ?? path.join('..', 'fixtures', 'captured');
  const messages = loadCaptured(dir);
  console.log(`Replay de ${messages.length} mensajes de ${dir} (modo ${config.mode}, base en memoria).`);

  const market = new MarketData(new BinancePublicApi());
  await market.refresh();
  const store = new SqliteAlertStore(null);
  const deps = {
    mode: config.mode,
    authorizedSenders: config.authorizedSenders,
    store,
    claude: config.anthropicApiKey ? new ClaudeExtractor(config.anthropicApiKey) : null,
    market,
  };

  const counts = new Map<string, number>();
  for (const msg of messages) {
    const result = await processMessage({ ...msg, receivedAt: new Date() }, deps);
    const key = result.status === 'rechazada' ? `rechazada: ${result.reason}` : result.status;
    counts.set(key, (counts.get(key) ?? 0) + 1);
    const line = describe(result);
    if (line) console.log(line);
  }
  console.log('\nResumen:');
  for (const [key, n] of [...counts].sort()) console.log(`  ${key}: ${n}`);
  store.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
