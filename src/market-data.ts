import type { MarketApi, SymbolInfo, Ticker24h } from './binance-public.ts';
import { isTradablePerpetual } from './symbols.ts';

export const RANKING_REFRESH_MS = 60_000; // RF-23
export const RANKING_MAX_AGE_MS = 120_000; // RF-21

export interface Ranking {
  gainers: string[];
  losers: string[];
  fetchedAt: number; // epoch ms
}

// RF-23: solo perpetuos en TRADING, ordenados por priceChangePercent de 24 h.
export function buildRanking(
  tickers: readonly Ticker24h[],
  symbols: ReadonlyMap<string, SymbolInfo>,
  fetchedAt: number,
): Ranking {
  const eligible = tickers.filter((t) => {
    const info = symbols.get(t.symbol);
    return info !== undefined && isTradablePerpetual(info) && Number.isFinite(t.priceChangePercent);
  });
  const sorted = [...eligible].sort((a, b) => b.priceChangePercent - a.priceChangePercent);
  return {
    gainers: sorted.slice(0, 3).map((t) => t.symbol),
    losers: sorted.slice(-3).reverse().map((t) => t.symbol),
    fetchedAt,
  };
}

export type RankingCheck = { ok: true } | { ok: false; reason: 'ranking no disponible' | 'top 3 ganadores/perdedores'; detail: string };

// RF-21 y RF-04, en ese orden (RF-38).
export function checkRanking(symbol: string, ranking: Ranking | null, now: number): RankingCheck {
  if (!ranking) return { ok: false, reason: 'ranking no disponible', detail: 'todavía no se pudo leer el ranking' };
  const age = now - ranking.fetchedAt;
  if (age > RANKING_MAX_AGE_MS) {
    return { ok: false, reason: 'ranking no disponible', detail: `la copia tiene ${Math.round(age / 1000)} s` };
  }
  if (ranking.gainers.includes(symbol)) {
    return { ok: false, reason: 'top 3 ganadores/perdedores', detail: `${symbol} está entre los 3 mayores ganadores` };
  }
  if (ranking.losers.includes(symbol)) {
    return { ok: false, reason: 'top 3 ganadores/perdedores', detail: `${symbol} está entre los 3 mayores perdedores` };
  }
  return { ok: true };
}

// Copia local de símbolos (RF-31/RF-37) y del ranking (RF-23), refrescada cada 60 s.
// Si un refresco falla se conserva la copia anterior: los símbolos casi no cambian, y
// para el ranking la antigüedad la controla RF-21.
export class MarketData {
  private symbolMap: ReadonlyMap<string, SymbolInfo> = new Map();
  private currentRanking: Ranking | null = null;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly api: MarketApi,
    private readonly onError: (err: Error) => void = () => {},
    private readonly now: () => number = Date.now,
  ) {}

  get symbols(): ReadonlyMap<string, SymbolInfo> {
    return this.symbolMap;
  }

  get ranking(): Ranking | null {
    return this.currentRanking;
  }

  async refresh(): Promise<void> {
    try {
      const info = await this.api.exchangeInfo();
      this.symbolMap = new Map(info.map((s) => [s.symbol, s]));
    } catch (err) {
      this.onError(err as Error);
      if (this.symbolMap.size === 0) throw err;
    }
    try {
      const tickers = await this.api.tickers24h();
      this.currentRanking = buildRanking(tickers, this.symbolMap, this.now());
    } catch (err) {
      this.onError(err as Error);
    }
  }

  // El primer refresco tiene que traer los símbolos: sin ellos no se puede validar nada.
  async start(): Promise<void> {
    await this.refresh();
    this.timer = setInterval(() => void this.refresh().catch(() => {}), RANKING_REFRESH_MS);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  closes1h(symbol: string): Promise<number[]> {
    return this.api.closes1h(symbol);
  }
}
