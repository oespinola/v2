import type { Side } from './types.ts';

// Igual que ta.ema de TradingView: arranca con la SMA de las primeras `length` velas.
export function ema(values: readonly number[], length: number): number | null {
  if (values.length < length) return null;
  const alpha = 2 / (length + 1);
  let acc = values.slice(0, length).reduce((a, b) => a + b, 0) / length;
  for (let i = length; i < values.length; i++) acc = alpha * values[i]! + (1 - alpha) * acc;
  return acc;
}

// Igual que ta.wma: la vela más reciente pesa `length`, la más vieja pesa 1.
export function wma(values: readonly number[], length: number): number | null {
  if (values.length < length) return null;
  const window = values.slice(-length);
  let num = 0;
  for (let i = 0; i < length; i++) num += window[i]! * (i + 1);
  return num / ((length * (length + 1)) / 2);
}

export interface IndicatorValues {
  asl21: number | null; // (EMA(cierre, 20) + WMA(cierre, 21)) / 2
  ema55: number | null;
}

export function computeIndicators(closes: readonly number[]): IndicatorValues {
  const e20 = ema(closes, 20);
  const w21 = wma(closes, 21);
  return { asl21: e20 !== null && w21 !== null ? (e20 + w21) / 2 : null, ema55: ema(closes, 55) };
}

export function isCorrectSide(side: Side, entry: number, takeProfit: number): boolean {
  return side === 'LONG' ? takeProfit > entry : takeProfit < entry;
}

// RF-24: de ASL21 y EMA55, el más cercano a la Entrada entre los que quedan del lado
// correcto (RF-13). RF-36: si ninguno queda del lado correcto, null → "TP inválido".
export function pickTakeProfit(
  side: Side,
  entry: number,
  values: IndicatorValues,
): { takeProfit: number; indicator: 'ASL21' | 'EMA55' } | null {
  const candidates = (
    [
      ['ASL21', values.asl21],
      ['EMA55', values.ema55],
    ] as const
  ).filter((c): c is readonly ['ASL21' | 'EMA55', number] => c[1] !== null && isCorrectSide(side, entry, c[1]));
  if (candidates.length === 0) return null;
  const [indicator, takeProfit] = candidates.reduce((best, c) =>
    Math.abs(c[1] - entry) < Math.abs(best[1] - entry) ? c : best,
  );
  return { takeProfit, indicator };
}
