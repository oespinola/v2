import { BinancePublicApi } from './binance-public.ts';
import { ClaudeExtractor } from './claude-extractor.ts';
import { loadConfig, loadDotEnv } from './config.ts';
import { MarketData } from './market-data.ts';
import { processEdit, processMessage } from './pipeline.ts';
import { describe, describeEdit } from './report.ts';
import { SqliteAlertStore } from './store.ts';
import type { IncomingEdit, IncomingMessage } from './types.ts';
import { startWhatsApp } from './whatsapp.ts';

async function main(): Promise<void> {
  process.umask(0o077); // todo lo que cree el proceso nace legible solo por su usuario (RNF-10)
  loadDotEnv();
  const config = loadConfig();
  console.log(`SignalBridge arrancado en modo ${config.mode}.`);
  if (!config.anthropicApiKey) {
    console.warn('Sin ANTHROPIC_API_KEY: si el regex no alcanza, la alerta se rechaza como incompleta.');
  }

  const store = new SqliteAlertStore(config.dataDir);
  const market = new MarketData(new BinancePublicApi(), (err) => console.error(`Binance: ${err.message}`));
  await market.start();
  console.log(`Binance: ${market.symbols.size} símbolos, ranking cada 60 s.`);

  const deps = {
    mode: config.mode,
    authorizedSenders: config.authorizedSenders,
    maxSlDistancePct: config.maxSlDistancePct,
    store,
    claude: config.anthropicApiKey ? new ClaudeExtractor(config.anthropicApiKey) : null,
    market,
  };

  // De a una alerta por vez: así dos reenvíos simultáneos no pasan juntos el control
  // de duplicados (RF-29).
  let queue = Promise.resolve();
  const onMessage = (msg: IncomingMessage) => {
    queue = queue
      .then(async () => {
        const line = describe(await processMessage(msg, deps));
        if (line) console.log(line);
      })
      .catch((err) => console.error(`Error procesando ${msg.waMessageId}:`, err));
  };
  // Las ediciones van por la misma cola: si llega justo después del mensaje, el
  // original ya está registrado cuando se procesa la edición.
  const onEdit = (edit: IncomingEdit) => {
    queue = queue
      .then(() => {
        const record = processEdit(edit, deps);
        if (record) console.log(describeEdit(record));
      })
      .catch((err) => console.error(`Error procesando la edición de ${edit.waMessageId}:`, err));
  };

  const client = await startWhatsApp({
    authDir: config.whatsappAuthDir,
    groupName: config.groupName,
    onMessage,
    onEdit,
    onDisconnected: (reason) => {
      // La reconexión con backoff (RNF-04) y el reinicio con systemd (RNF-05) vienen después.
      console.error(`WhatsApp desconectado: ${reason}`);
      process.exit(1);
    },
  });

  process.on('SIGINT', async () => {
    market.stop();
    await client.destroy();
    store.close();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
