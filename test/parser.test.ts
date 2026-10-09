import { describe, expect, it } from 'vitest';
import { toPartialFields } from '../src/claude-extractor.ts';
import { missingFields, parseText } from '../src/parser.ts';
import type { AlertFields } from '../src/types.ts';
import { alerts } from './fixtures/alerts.ts';

const indicators = { kind: 'indicators' } as const;
const price = (p: number) => ({ kind: 'price', price: p }) as const;

const expected: Record<keyof typeof alerts, AlertFields> = {
  kaia: { ticker: 'KAIA', entry: 0.0402, target: price(0.038), stopLoss: 0.0414, riskLevel: 'Alto' },
  kite: { ticker: 'KITE', entry: 0.1355, target: price(0.1459), stopLoss: 0.1298, riskLevel: 'Alto' },
  eth: { ticker: 'ETH', entry: 2500, target: price(2577.29), stopLoss: 2400, riskLevel: 'Alto' },
  zec: { ticker: 'ZEC', entry: 1202.96, target: price(1293.4), stopLoss: 1161.2, riskLevel: 'Alto' },
  flux: { ticker: 'FLUX', entry: 0.0822, target: indicators, stopLoss: 0.0847, riskLevel: 'Medio' },
  coti: { ticker: 'COTI', entry: 0.01444, target: indicators, stopLoss: 0.01467, riskLevel: 'Medio-Alto' },
  axs: { ticker: 'AXS', entry: 1.246, target: indicators, stopLoss: 1.222, riskLevel: 'Alto' },
  g: { ticker: 'G', entry: 0.00407, target: indicators, stopLoss: 0.00392, riskLevel: 'Medio' },
  bananas31: { ticker: 'BANANAS31', entry: 0.006633, target: indicators, stopLoss: 0.006431, riskLevel: 'Medio' },
};

describe('parseText', () => {
  it.each(Object.keys(alerts) as Array<keyof typeof alerts>)('AC-20: parsea la alerta real %s', (name) => {
    expect(parseText(alerts[name])).toEqual(expected[name]);
  });

  it('AC-34: si el objetivo trae precio, ese es el objetivo', () => {
    const body = alerts.kaia.replace('0.0380 usd', '0.002404 usd');
    expect(parseText(body).target).toEqual(price(0.002404));
  });

  it('si el objetivo solo trae indicadores, no toma el 21 ni el 55 como precio', () => {
    expect(parseText(alerts.flux).target).toEqual(indicators);
  });

  it('reconoce el título con tilde', () => {
    expect(parseText(alerts.kaia.replace('TRADING', 'TRADÍNG')).ticker).toBe('KAIA');
  });

  it('informa los datos que faltan, en orden', () => {
    expect(missingFields(parseText(alerts.kaia.replace(/SL: .*\n/, '')))).toEqual(['stopLoss']);
    expect(missingFields(parseText(alerts.coti.replace(/Entrada: .*\n/, '')))).toEqual(['entry']);
    expect(missingFields(parseText('KAIA - ALERTA DE TRADING'))).toEqual(['entry', 'target', 'stopLoss', 'riskLevel']);
  });

  it('acepta coma decimal solo si el número no tiene punto', () => {
    expect(parseText(alerts.kaia.replace('Entrada: 0.0402', 'Entrada: 0,0402')).entry).toBe(0.0402);
    expect(parseText(alerts.kaia.replace('Entrada: 0.0402', 'Entrada: 1,234.5')).entry).toBe(1234.5);
  });
});

describe('toPartialFields (respuesta de Claude)', () => {
  const base = {
    ticker: 'nmrusdt',
    entry: 12.21,
    stop_loss: 12.68,
    target_price: null,
    target_is_indicators_only: true,
    risk_level: 'Medio-Alto' as const,
  };

  it('normaliza el ticker y traduce el objetivo por indicadores', () => {
    expect(toPartialFields(base)).toEqual({
      ticker: 'NMR',
      entry: 12.21,
      stopLoss: 12.68,
      target: indicators,
      riskLevel: 'Medio-Alto',
    });
  });

  it('descarta valores nulos o no positivos: quedan como faltantes', () => {
    expect(toPartialFields({ ...base, entry: null, stop_loss: 0, target_is_indicators_only: false })).toEqual({
      ticker: 'NMR',
      riskLevel: 'Medio-Alto',
    });
  });
});
