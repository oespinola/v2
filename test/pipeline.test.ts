import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SymbolInfo } from '../src/binance-public.ts';
import type { FieldExtractor } from '../src/claude-extractor.ts';
import type { Ranking } from '../src/market-data.ts';
import { processEdit, processMessage, sideOf, type PipelineDeps } from '../src/pipeline.ts';
import { describeEdit } from '../src/report.ts';
import { SqliteAlertStore } from '../src/store.ts';
import type { AlertImage, IncomingMessage } from '../src/types.ts';
import { alerts } from './fixtures/alerts.ts';

const NOW = new Date('2026-10-09T12:00:00Z');

const perp = (symbol: string, tickSize: string): SymbolInfo => ({
  symbol,
  status: 'TRADING',
  contractType: 'PERPETUAL',
  tickSize,
});

let seq = 0;
function message(body: string, overrides: Partial<IncomingMessage> = {}): IncomingMessage {
  seq += 1;
  return {
    waMessageId: `MSG${seq}`,
    senderId: 'tomy@lid',
    senderName: 'Tomy',
    body,
    receivedAt: NOW,
    hasMedia: false,
    downloadImage: async () => null,
    ...overrides,
  };
}

function fakeClaude(result: Awaited<ReturnType<FieldExtractor['extract']>>) {
  const extract = vi.fn<FieldExtractor['extract']>(async () => result);
  return { extract };
}

let store: SqliteAlertStore;
let deps: PipelineDeps;
let ranking: Ranking;
let closes: number[];

beforeEach(() => {
  store = new SqliteAlertStore(null);
  ranking = { gainers: ['XUSDT'], losers: ['YUSDT'], fetchedAt: NOW.getTime() - 30_000 };
  closes = Array(100).fill(0.0125); // ASL21 = EMA55 = 0.0125
  deps = {
    mode: 'DRY',
    authorizedSenders: new Set(['tomy@lid', 'cris@lid']),
    store,
    claude: null,
    market: {
      symbols: new Map(
        [
          perp('KAIAUSDT', '0.0001'),
          perp('KITEUSDT', '0.0001'),
          perp('COTIUSDT', '0.00001'),
          perp('1000PEPEUSDT', '0.0001'),
          perp('XUSDT', '0.01'),
          perp('YUSDT', '0.01'),
        ].map((s) => [s.symbol, s]),
      ),
      get ranking() {
        return ranking;
      },
      closes1h: async () => closes,
    },
    now: () => NOW,
  };
});

afterEach(() => store.close());

describe('dirección (RF-01, RF-02)', () => {
  it('AC-01: SL por debajo de la Entrada → LONG', () => expect(sideOf(10, 9)).toBe('LONG'));
  it('AC-03: SL por encima de la Entrada → SHORT', () => expect(sideOf(10, 11)).toBe('SHORT'));
});

describe('processMessage', () => {
  it('alerta real de Tomy con TP numérico → válida SHORT, sin calcular indicadores', async () => {
    const closes1h = vi.spyOn(deps.market, 'closes1h');
    const result = await processMessage(message(alerts.kaia), deps);
    expect(result).toMatchObject({
      status: 'válida',
      alert: { symbol: 'KAIAUSDT', side: 'SHORT', entry: 0.0402, stopLoss: 0.0414, takeProfit: 0.038, tpSource: 'alerta' },
    });
    expect(closes1h).not.toHaveBeenCalled(); // AC-34
  });

  it('alerta real de Cris por indicadores → TP calculado y ajustado al tick (AC-33)', async () => {
    closes = Array(100).fill(0.013123); // por debajo de la Entrada 0.01444: sirve para SHORT
    const result = await processMessage(message(alerts.coti, { senderId: 'cris@lid' }), deps);
    expect(result).toMatchObject({
      status: 'válida',
      alert: { symbol: 'COTIUSDT', side: 'SHORT', takeProfit: 0.01313, tpSource: 'calculado' },
    });
  });

  it('AC-33 / RF-36: si ni ASL21 ni EMA55 quedan del lado correcto → "TP inválido"', async () => {
    closes = Array(100).fill(0.02); // por encima de la Entrada de un SHORT
    const result = await processMessage(message(alerts.coti), deps);
    expect(result).toMatchObject({ status: 'rechazada', reason: 'TP inválido' });
  });

  it('AC-02: LONG con TP por debajo de la Entrada → "TP inválido"', async () => {
    const body = alerts.kite.replace('0.1459 usd', '0.1300 usd');
    expect(await processMessage(message(body), deps)).toMatchObject({ status: 'rechazada', reason: 'TP inválido' });
  });

  it('AC-04: SHORT con TP igual a la Entrada → "TP inválido"', async () => {
    const body = alerts.kaia.replace('0.0380 usd', '0.0402 usd');
    expect(await processMessage(message(body), deps)).toMatchObject({ status: 'rechazada', reason: 'TP inválido' });
  });

  it('AC-19: SL igual a la Entrada → "SL igual a la Entrada"', async () => {
    const body = alerts.kaia.replace('SL: 0.0414', 'SL: 0.0402');
    expect(await processMessage(message(body), deps)).toMatchObject({
      status: 'rechazada',
      reason: 'SL igual a la Entrada',
    });
  });

  it('AC-41: PEPE sin PEPEUSDT → 1000PEPEUSDT con precios ×1000', async () => {
    const body = alerts.kaia
      .replace('KAIA', 'PEPE')
      .replace('Entrada: 0.0402', 'Entrada: 0.002404')
      .replace('0.0380 usd', '0.002300 usd')
      .replace('SL: 0.0414', 'SL: 0.002500');
    expect(await processMessage(message(body), deps)).toMatchObject({
      status: 'válida',
      alert: { symbol: '1000PEPEUSDT', entry: 2.404, stopLoss: 2.5, takeProfit: 2.3 },
    });
  });

  it('AC-42: ticker inexistente', async () => {
    const body = alerts.kaia.replace('KAIA', 'NOPE');
    expect(await processMessage(message(body), deps)).toMatchObject({ status: 'rechazada', reason: 'ticker inexistente' });
  });

  it('AC-06/AC-07: símbolo en el top 3 → "top 3 ganadores/perdedores"', async () => {
    const body = alerts.kaia.replace('KAIA', 'Y').replace('Entrada: 0.0402', 'Entrada: 10').replace('0.0380 usd', '9 usd').replace('SL: 0.0414', 'SL: 11');
    expect(await processMessage(message(body), deps)).toMatchObject({
      status: 'rechazada',
      reason: 'top 3 ganadores/perdedores',
    });
  });

  it('AC-25: ranking con más de 120 s → "ranking no disponible"', async () => {
    ranking = { ...ranking, fetchedAt: NOW.getTime() - 121_000 };
    expect(await processMessage(message(alerts.kaia), deps)).toMatchObject({
      status: 'rechazada',
      reason: 'ranking no disponible',
    });
  });

  it('AC-05: un mensaje que no es alerta se ignora y no se registra', async () => {
    const save = vi.spyOn(store, 'save');
    expect(await processMessage(message('Buen día!'), deps)).toEqual({ status: 'ignorada' });
    expect(save).not.toHaveBeenCalled();
  });

  it('AC-54: remitente no autorizado y además incompleta → un único motivo, sin llamar a Claude', async () => {
    const claude = fakeClaude({});
    deps.claude = claude;
    const result = await processMessage(message('KAIA - ALERTA DE TRADING', { senderId: 'otro@lid' }), deps);
    expect(result).toMatchObject({ status: 'rechazada', reason: 'remitente no autorizado' });
    expect(claude.extract).not.toHaveBeenCalled();
  });

  it('AC-17: el mismo mensaje de WhatsApp otra vez → "duplicado"', async () => {
    const msg = message(alerts.kaia);
    expect((await processMessage(msg, deps)).status).toBe('válida');
    expect(await processMessage(msg, deps)).toMatchObject({ status: 'rechazada', reason: 'duplicado' });
  });

  it('AC-37: reenvío con otro ID y los mismos datos dentro de 24 h → "duplicado"', async () => {
    await processMessage(message(alerts.kaia), deps);
    const later = new Date(NOW.getTime() + 23 * 3600_000);
    expect(await processMessage(message(alerts.kaia, { receivedAt: later }), { ...deps, now: () => later })).toMatchObject({
      status: 'rechazada',
      reason: 'duplicado',
    });
  });

  it('AC-53: la misma alerta pasadas las 24 h no es duplicado', async () => {
    await processMessage(message(alerts.kaia), deps);
    const later = new Date(NOW.getTime() + 25 * 3600_000);
    ranking = { ...ranking, fetchedAt: later.getTime() };
    expect(await processMessage(message(alerts.kaia, { receivedAt: later }), { ...deps, now: () => later })).toMatchObject({
      status: 'válida',
    });
  });

  it('AC-20: si el texto trae todo, no llama a Claude ni descarga la imagen', async () => {
    const claude = fakeClaude({});
    const downloadImage = vi.fn(async () => null);
    deps.claude = claude;
    const result = await processMessage(message(alerts.kaia, { hasMedia: true, downloadImage }), deps);
    expect(result).toMatchObject({ status: 'válida', record: { extractedFrom: 'texto' } });
    expect(claude.extract).not.toHaveBeenCalled();
    expect(downloadImage).not.toHaveBeenCalled();
  });

  it('AC-14: si al texto le falta el SL y la imagen lo trae, Claude lo completa', async () => {
    const image: AlertImage = { data: 'aW1n', mimeType: 'image/jpeg' };
    const claude = fakeClaude({ stopLoss: 0.0414, entry: 999 });
    deps.claude = claude;
    const body = alerts.kaia.replace(/SL: .*\n/, '');
    const result = await processMessage(message(body, { hasMedia: true, downloadImage: async () => image }), deps);
    expect(claude.extract).toHaveBeenCalledWith(body, image);
    // La Entrada del texto manda sobre la de Claude.
    expect(result).toMatchObject({
      status: 'válida',
      alert: { entry: 0.0402, stopLoss: 0.0414 },
      record: { extractedFrom: 'claude+imagen' },
    });
  });

  it('AC-21: si falta un dato en el texto y en la imagen → "incompleta"', async () => {
    deps.claude = fakeClaude({});
    const body = alerts.kaia.replace(/SL: .*\n/, '');
    expect(await processMessage(message(body, { hasMedia: true }), deps)).toMatchObject({
      status: 'rechazada',
      reason: 'incompleta',
      record: { detail: expect.stringContaining('stopLoss') },
    });
  });

  it('sin ANTHROPIC_API_KEY, una alerta incompleta se rechaza sin respaldo', async () => {
    const body = alerts.kaia.replace(/SL: .*\n/, '');
    expect(await processMessage(message(body), deps)).toMatchObject({ status: 'rechazada', reason: 'incompleta' });
  });

  it('si Claude falla (timeout, error de red) → "incompleta", nunca una excepción', async () => {
    deps.claude = { extract: async () => Promise.reject(new Error('timeout')) };
    const body = alerts.kaia.replace(/SL: .*\n/, '');
    expect(await processMessage(message(body), deps)).toMatchObject({
      status: 'rechazada',
      reason: 'incompleta',
      record: { detail: expect.stringContaining('timeout') },
    });
  });
});

describe('registro (RF-05, RF-11, RNF-10)', () => {
  it('guarda el ID de RF-11 y los campos de la alerta', async () => {
    const result = await processMessage(message(alerts.kaia, { waMessageId: 'ABC' }), deps);
    expect(result.status).toBe('válida');
    if (result.status === 'ignorada') return;
    expect(result.record).toMatchObject({
      alertId: expect.stringMatching(/^ABC:[0-9a-f]{16}$/),
      mode: 'DRY',
      senderId: 'tomy@lid',
      ticker: 'KAIA',
      symbol: 'KAIAUSDT',
      side: 'SHORT',
      riskLevel: 'Alto',
      status: 'válida',
      reason: null,
    });
  });

  it('crea la base y el log con permisos 0600 en un directorio 0700, una línea JSON por alerta', async () => {
    const dir = path.join(mkdtempSync(path.join(tmpdir(), 'sb-')), 'data');
    const diskStore = new SqliteAlertStore(dir);
    await processMessage(message(alerts.kaia), { ...deps, store: diskStore });
    diskStore.close();
    expect(statSync(dir).mode & 0o777).toBe(0o700);
    expect(statSync(path.join(dir, 'signalbridge.db')).mode & 0o777).toBe(0o600);
    expect(statSync(path.join(dir, 'alerts.log')).mode & 0o777).toBe(0o600);
    const lines = readFileSync(path.join(dir, 'alerts.log'), 'utf8').trim().split('\n');
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toMatchObject({ ticker: 'KAIA', status: 'válida' });
  });
});

describe('ediciones de alertas ya procesadas', () => {
  // Las tres ediciones reales que capturó la v1 (7 y 8 de octubre).
  const jto = (entry: string, sl: string) =>
    `*JTO - ALERTA DE TRADING*\nEntrada: ${entry} usd\nObj.: ASL21, EMA55 \nSL: ${sl} usd\nRiesgo medio-alto 🟠`;
  const kava = (ticker: string) =>
    `*${ticker} - ALERTA DE TRADING*\nEntrada: 0.06808 usd\nObj.: ASL21, EMA55 \nSL: 0.06854 usd\nRiesgo medio 🟡`;
  const bananas = (desc: string) =>
    `*BANANAS31 - ALERTA DE TRADING*\n${desc}\nEntrada: 0.006633 usd\nObj.: ASL21, EMA55 \nSL: 0.006431 usd\nRiesgo medio 🟡`;

  const edit = (waMessageId: string, prevBody: string, newBody: string) => ({
    waMessageId,
    senderId: 'cris@lid',
    prevBody,
    newBody,
    editedAt: new Date(NOW.getTime() + 60_000),
  });

  it('JTO: registra el cambio de Entrada y SL ligado a la alerta original, sin operar', async () => {
    const original = await processMessage(message(jto('0.501', '0.0602'), { waMessageId: 'JTO1' }), deps);
    if (original.status === 'ignorada') throw new Error('debía procesarse');
    const record = processEdit(edit('JTO1', jto('0.501', '0.0602'), jto('0.5015', '0.4775')), deps);
    expect(record).toMatchObject({
      event: 'alerta editada tras procesarse',
      alertId: original.record.alertId,
      changes: ['Entrada 0.501 → 0.5015', 'SL 0.0602 → 0.4775'],
    });
    expect(describeEdit(record!)).toBe('[DRY] JTO EDITADA tras procesarse (no se opera): Entrada 0.501 → 0.5015, SL 0.0602 → 0.4775');
  });

  it('KAVA: registra el cambio de ticker en el título', async () => {
    await processMessage(message(kava('ETH'), { waMessageId: 'KAVA1' }), deps);
    expect(processEdit(edit('KAVA1', kava('ETH'), kava('KAVA')), deps)?.changes).toEqual(['Ticker ETH → KAVA']);
  });

  it('BANANAS31: si solo cambia la descripción, lo dice', async () => {
    await processMessage(message(bananas('G es el token de Gravity.'), { waMessageId: 'BAN1' }), deps);
    expect(processEdit(edit('BAN1', bananas('G es el token de Gravity.'), bananas('BANANAS31 es una memecoin.')), deps)?.changes).toEqual([
      'solo cambió el texto, no los datos de la alerta',
    ]);
  });

  it('ignora la edición de un mensaje que nunca se procesó como alerta', () => {
    const saveEdit = vi.spyOn(store, 'saveEdit');
    expect(processEdit(edit('CHARLA1', 'hola', 'hola a todos'), deps)).toBeNull();
    expect(saveEdit).not.toHaveBeenCalled();
  });

  it('la edición no cambia el registro de la alerta: reprocesar el original sigue siendo duplicado', async () => {
    await processMessage(message(jto('0.501', '0.0602'), { waMessageId: 'JTO2' }), deps);
    processEdit(edit('JTO2', jto('0.501', '0.0602'), jto('0.5015', '0.4775')), deps);
    expect(await processMessage(message(jto('0.501', '0.0602'), { waMessageId: 'JTO2' }), deps)).toMatchObject({
      status: 'rechazada',
      reason: 'duplicado',
    });
  });

  it('queda en el log JSONL con el texto anterior y el nuevo', async () => {
    const dir = path.join(mkdtempSync(path.join(tmpdir(), 'sb-')), 'data');
    const diskStore = new SqliteAlertStore(dir);
    const diskDeps = { ...deps, store: diskStore };
    await processMessage(message(jto('0.501', '0.0602'), { waMessageId: 'JTO3' }), diskDeps);
    processEdit(edit('JTO3', jto('0.501', '0.0602'), jto('0.5015', '0.4775')), diskDeps);
    diskStore.close();
    const lines = readFileSync(path.join(dir, 'alerts.log'), 'utf8').trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[1]!)).toMatchObject({
      event: 'alerta editada tras procesarse',
      prevBody: expect.stringContaining('SL: 0.0602'),
      newBody: expect.stringContaining('SL: 0.4775'),
    });
  });
});
