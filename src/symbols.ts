import type { SymbolInfo } from './binance-public.ts';
import type { Side } from './types.ts';

export interface MappedSymbol {
  symbol: string;
  multiplier: 1 | 1000;
  tickSize: string;
}

export function isTradablePerpetual(s: SymbolInfo): boolean {
  return s.contractType === 'PERPETUAL' && s.status === 'TRADING';
}

// RF-31: TICKERUSDT; si no existe, 1000TICKERUSDT (con precios ×1000).
// RF-32: si no existe ninguno de los dos, null → "ticker inexistente".
export function mapTicker(ticker: string, symbols: ReadonlyMap<string, SymbolInfo>): MappedSymbol | null {
  for (const [symbol, multiplier] of [
    [`${ticker}USDT`, 1],
    [`1000${ticker}USDT`, 1000],
  ] as const) {
    const info = symbols.get(symbol);
    if (info && isTradablePerpetual(info)) return { symbol, multiplier, tickSize: info.tickSize };
  }
  return null;
}

// Evita el ruido de coma flotante al multiplicar: 0.002404 × 1000 → 2.404, no 2.4040000000000004.
export function scale(value: number, multiplier: number): number {
  return Number((value * multiplier).toPrecision(12));
}

function decimalsOf(tickSize: string): number {
  const [, frac = ''] = tickSize.replace(/0+$/, '').split('.');
  return frac.length;
}

type Rounding = 'nearest' | 'down' | 'up';

export function roundToTick(value: number, tickSize: string, mode: Rounding): number {
  const tick = Number(tickSize);
  if (!(tick > 0)) return value;
  const ticks = value / tick;
  const eps = 1e-9; // 9.50 / 0.01 da 949.9999999 en flotante: no tiene que bajar a 949
  const n = mode === 'nearest' ? Math.round(ticks) : mode === 'down' ? Math.floor(ticks + eps) : Math.ceil(ticks - eps);
  return Number((n * tick).toFixed(decimalsOf(tickSize)));
}

// RF-37: Entrada al tick más cercano, SL alejándose de la Entrada, TP acercándose.
export function adjustPricesToTick(
  side: Side,
  prices: { entry: number; stopLoss: number; takeProfit: number },
  tickSize: string,
): { entry: number; stopLoss: number; takeProfit: number } {
  const long = side === 'LONG';
  return {
    entry: roundToTick(prices.entry, tickSize, 'nearest'),
    stopLoss: roundToTick(prices.stopLoss, tickSize, long ? 'down' : 'up'),
    takeProfit: roundToTick(prices.takeProfit, tickSize, long ? 'down' : 'up'),
  };
}
