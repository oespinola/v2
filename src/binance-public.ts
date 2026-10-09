// Endpoints públicos de producción de Binance Futuros USDS-M. Se usan en ambos modos
// (DRY y LIVE) y nunca llevan credenciales (RF-23, RF-24, AC-30).
const BASE_URL = 'https://fapi.binance.com';
const TIMEOUT_MS = 5_000;

export interface SymbolInfo {
  symbol: string;
  status: string; // "TRADING", "SETTLING", …
  contractType: string; // "PERPETUAL", "CURRENT_QUARTER", …
  tickSize: string; // como string para conservar los decimales exactos ("0.00010")
}

export interface Ticker24h {
  symbol: string;
  priceChangePercent: number;
}

// Solo lo que necesita RF-24: precio de cierre (la última vela es la que está en curso).
export type Closes = number[];

export interface MarketApi {
  exchangeInfo(): Promise<SymbolInfo[]>;
  tickers24h(): Promise<Ticker24h[]>;
  closes1h(symbol: string, limit?: number): Promise<Closes>;
}

async function getJson(path: string): Promise<unknown> {
  const res = await fetch(`${BASE_URL}${path}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`Binance ${path}: HTTP ${res.status}`);
  return res.json();
}

interface RawSymbol {
  symbol: string;
  status: string;
  contractType: string;
  filters: Array<{ filterType: string; tickSize?: string }>;
}

export class BinancePublicApi implements MarketApi {
  async exchangeInfo(): Promise<SymbolInfo[]> {
    const data = (await getJson('/fapi/v1/exchangeInfo')) as { symbols: RawSymbol[] };
    return data.symbols.map((s) => ({
      symbol: s.symbol,
      status: s.status,
      contractType: s.contractType,
      tickSize: s.filters.find((f) => f.filterType === 'PRICE_FILTER')?.tickSize ?? '0',
    }));
  }

  async tickers24h(): Promise<Ticker24h[]> {
    const data = (await getJson('/fapi/v1/ticker/24hr')) as Array<{ symbol: string; priceChangePercent: string }>;
    return data.map((t) => ({ symbol: t.symbol, priceChangePercent: Number(t.priceChangePercent) }));
  }

  // 1000 velas para que la EMA55 converja; incluye la vela en curso (RF-24).
  async closes1h(symbol: string, limit = 1000): Promise<Closes> {
    const data = (await getJson(`/fapi/v1/klines?symbol=${encodeURIComponent(symbol)}&interval=1h&limit=${limit}`)) as Array<
      [number, string, string, string, string]
    >;
    return data.map((k) => Number(k[4]));
  }
}
