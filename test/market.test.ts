import { describe, expect, it } from 'vitest';
import type { SymbolInfo } from '../src/binance-public.ts';
import { computeIndicators, ema, pickTakeProfit, wma } from '../src/indicators.ts';
import { buildRanking, checkRanking, RANKING_MAX_AGE_MS } from '../src/market-data.ts';
import { adjustPricesToTick, mapTicker, scale } from '../src/symbols.ts';

const perp = (symbol: string, tickSize = '0.0001', status = 'TRADING'): SymbolInfo => ({
  symbol,
  status,
  contractType: 'PERPETUAL',
  tickSize,
});
const symbolMap = (...list: SymbolInfo[]) => new Map(list.map((s) => [s.symbol, s]));

describe('mapTicker (RF-31, RF-32)', () => {
  const symbols = symbolMap(perp('KAIAUSDT'), perp('1000PEPEUSDT', '0.0001'), perp('OLDUSDT', '0.01', 'SETTLING'));

  it('AC-40: usa TICKERUSDT si existe, sin multiplicar', () => {
    expect(mapTicker('KAIA', symbols)).toEqual({ symbol: 'KAIAUSDT', multiplier: 1, tickSize: '0.0001' });
  });

  it('AC-41: si no existe TICKERUSDT, usa 1000TICKERUSDT con precios ×1000', () => {
    expect(mapTicker('PEPE', symbols)?.symbol).toBe('1000PEPEUSDT');
    expect(scale(0.002404, 1000)).toBe(2.404);
  });

  it('AC-42: devuelve null si no existe ninguno de los dos', () => {
    expect(mapTicker('NOPE', symbols)).toBeNull();
  });

  it('no mapea a un contrato que no está en TRADING', () => {
    expect(mapTicker('OLD', symbols)).toBeNull();
  });
});

describe('adjustPricesToTick (RF-37)', () => {
  it('AC-52: LONG con tickSize 0.01', () => {
    expect(adjustPricesToTick('LONG', { entry: 10.004, stopLoss: 9.507, takeProfit: 11.003 }, '0.01')).toEqual({
      entry: 10,
      stopLoss: 9.5,
      takeProfit: 11,
    });
  });

  it('SHORT: el SL sube (se aleja) y el TP sube (se acerca)', () => {
    expect(adjustPricesToTick('SHORT', { entry: 10.006, stopLoss: 10.501, takeProfit: 9.003 }, '0.01')).toEqual({
      entry: 10.01,
      stopLoss: 10.51,
      takeProfit: 9.01,
    });
  });

  it('no mueve un precio que ya está en el tick', () => {
    expect(adjustPricesToTick('LONG', { entry: 0.0402, stopLoss: 0.0395, takeProfit: 0.0414 }, '0.0001')).toEqual({
      entry: 0.0402,
      stopLoss: 0.0395,
      takeProfit: 0.0414,
    });
  });
});

describe('indicadores (RF-24)', () => {
  it('EMA arranca con la SMA y después aplica alpha = 2/(n+1)', () => {
    // SMA(1,2,3) = 2; luego 0.5*4 + 0.5*2 = 3; luego 0.5*5 + 0.5*3 = 4
    expect(ema([1, 2, 3, 4, 5], 3)).toBe(4);
  });

  it('WMA pondera más la vela más reciente', () => {
    // (3*1 + 4*2 + 5*3) / 6
    expect(wma([1, 2, 3, 4, 5], 3)).toBeCloseTo(26 / 6);
  });

  it('con menos velas que el período no hay valor', () => {
    expect(computeIndicators([1, 2, 3])).toEqual({ asl21: null, ema55: null });
  });

  it('con una serie constante ASL21 y EMA55 valen lo mismo que el precio', () => {
    const { asl21, ema55 } = computeIndicators(Array(100).fill(2));
    expect(asl21).toBeCloseTo(2);
    expect(ema55).toBeCloseTo(2);
  });
});

describe('pickTakeProfit (RF-24, RF-36, AC-33)', () => {
  it('LONG: elige el más cercano a la Entrada entre los que están por encima', () => {
    expect(pickTakeProfit('LONG', 1, { asl21: 1.2, ema55: 1.1 })).toEqual({ takeProfit: 1.1, indicator: 'EMA55' });
  });

  it('LONG: descarta el que está por debajo aunque sea el más cercano', () => {
    expect(pickTakeProfit('LONG', 1, { asl21: 0.99, ema55: 1.3 })).toEqual({ takeProfit: 1.3, indicator: 'EMA55' });
  });

  it('SHORT: elige el más cercano entre los que están por debajo', () => {
    expect(pickTakeProfit('SHORT', 1, { asl21: 0.95, ema55: 0.9 })).toEqual({ takeProfit: 0.95, indicator: 'ASL21' });
  });

  it('si ninguno queda del lado correcto, null (→ "TP inválido")', () => {
    expect(pickTakeProfit('SHORT', 1, { asl21: 1.1, ema55: 1.2 })).toBeNull();
    expect(pickTakeProfit('LONG', 1, { asl21: 1, ema55: null })).toBeNull();
  });
});

describe('ranking (RF-23, RF-21, RF-04)', () => {
  const symbols = symbolMap(
    perp('AUSDT'),
    perp('BUSDT'),
    perp('CUSDT'),
    perp('DUSDT'),
    perp('EUSDT'),
    perp('FUSDT'),
    perp('GUSDT'),
    perp('HALTUSDT', '0.01', 'SETTLING'),
    { symbol: 'AUSDT_261225', status: 'TRADING', contractType: 'CURRENT_QUARTER', tickSize: '0.01' },
  );
  const tickers = [
    { symbol: 'HALTUSDT', priceChangePercent: 99 },
    { symbol: 'AUSDT_261225', priceChangePercent: 80 },
    { symbol: 'AUSDT', priceChangePercent: 30 },
    { symbol: 'BUSDT', priceChangePercent: 20 },
    { symbol: 'CUSDT', priceChangePercent: 10 },
    { symbol: 'DUSDT', priceChangePercent: 0 },
    { symbol: 'EUSDT', priceChangePercent: -10 },
    { symbol: 'FUSDT', priceChangePercent: -20 },
    { symbol: 'GUSDT', priceChangePercent: -30 },
  ];

  it('AC-38: excluye contratos que no están en TRADING o no son perpetuos', () => {
    expect(buildRanking(tickers, symbols, 0)).toEqual({
      gainers: ['AUSDT', 'BUSDT', 'CUSDT'],
      losers: ['GUSDT', 'FUSDT', 'EUSDT'],
      fetchedAt: 0,
    });
  });

  const ranking = buildRanking(tickers, symbols, 1_000_000);

  it('AC-07: rechaza un símbolo entre los 3 mayores ganadores', () => {
    expect(checkRanking('BUSDT', ranking, 1_000_000)).toMatchObject({ ok: false, reason: 'top 3 ganadores/perdedores' });
  });

  it('AC-06: rechaza un símbolo entre los 3 mayores perdedores', () => {
    expect(checkRanking('FUSDT', ranking, 1_000_000)).toMatchObject({ ok: false, reason: 'top 3 ganadores/perdedores' });
  });

  it('acepta un símbolo fuera del top 3', () => {
    expect(checkRanking('DUSDT', ranking, 1_000_000)).toEqual({ ok: true });
  });

  it('AC-25: rechaza si la copia tiene más de 120 s', () => {
    expect(checkRanking('DUSDT', ranking, 1_000_000 + RANKING_MAX_AGE_MS)).toEqual({ ok: true });
    expect(checkRanking('DUSDT', ranking, 1_000_000 + RANKING_MAX_AGE_MS + 1)).toMatchObject({
      ok: false,
      reason: 'ranking no disponible',
    });
  });

  it('rechaza si todavía no hay ranking', () => {
    expect(checkRanking('DUSDT', null, 0)).toMatchObject({ ok: false, reason: 'ranking no disponible' });
  });
});
