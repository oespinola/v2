import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.ts';
import { filterMessage } from '../src/filter.ts';
import { alerts } from './fixtures/alerts.ts';

const authorized = new Set(['tomy@lid', 'cris@lid']);

describe('filterMessage', () => {
  it('AC-05: ignora un mensaje que no es alerta, aunque lo mande un remitente autorizado', () => {
    expect(filterMessage({ senderId: 'tomy@lid', body: 'Buen día a todos!' }, authorized)).toEqual({ action: 'ignore' });
  });

  it('AC-35: reconoce "ALERTA DE TRADÍNG" con tilde en medio del texto', () => {
    expect(filterMessage({ senderId: 'tomy@lid', body: 'Ojo: ALERTA DE TRADÍNG para hoy' }, authorized)).toEqual({
      action: 'process',
    });
  });

  it.each(['ALERTA DE TRADING', 'Alerta de trading', 'alerta de trading', 'Alertá de Tráding'])(
    'reconoce el disparador sin distinguir mayúsculas ni tildes: "%s"',
    (trigger) => {
      expect(filterMessage({ senderId: 'tomy@lid', body: `KAIA - ${trigger}` }, authorized)).toEqual({
        action: 'process',
      });
    },
  );

  it('AC-26: rechaza una alerta completa de un remitente no autorizado', () => {
    expect(filterMessage({ senderId: 'otro@lid', body: alerts.kaia }, authorized)).toEqual({
      action: 'reject',
      reason: 'remitente no autorizado',
    });
  });
});

describe('loadConfig', () => {
  const base = { SIGNALBRIDGE_MODE: 'DRY', AUTHORIZED_SENDERS: 'tomy@lid, cris@lid' };

  it('lee el modo, los remitentes y los valores por defecto', () => {
    const config = loadConfig(base);
    expect(config.mode).toBe('DRY');
    expect([...config.authorizedSenders]).toEqual(['tomy@lid', 'cris@lid']);
    expect(config.groupName).toBe('ALERTAS CRYPTO+');
    expect(config.anthropicApiKey).toBeNull();
  });

  it.each([undefined, '', ' , '])('falla si AUTHORIZED_SENDERS está vacío (%j)', (value) => {
    expect(() => loadConfig({ ...base, AUTHORIZED_SENDERS: value })).toThrow(/AUTHORIZED_SENDERS/);
  });

  it('falla si el modo no es DRY ni LIVE', () => {
    expect(() => loadConfig({ ...base, SIGNALBRIDGE_MODE: 'PROD' })).toThrow(/SIGNALBRIDGE_MODE/);
  });
});
