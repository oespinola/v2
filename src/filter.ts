export type FilterOutcome =
  | { action: 'ignore' } // RF-03: no es alerta → ni se procesa ni se loguea
  | { action: 'reject'; reason: 'remitente no autorizado' } // RF-22
  | { action: 'process' };

// Minúsculas y sin tildes: "ALERTA DE TRADÍNG" → "alerta de trading" (RF-03, AC-35).
export function normalize(text: string): string {
  return text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
}

export function isAlert(body: string): boolean {
  return normalize(body).includes('alerta de trading');
}

// Primero el disparador: la charla de cualquier miembro se ignora sin dejar
// rastro en el log (RF-03). Recién después se valida el remitente (RF-22).
export function filterMessage(
  msg: { senderId: string; body: string },
  authorizedSenders: ReadonlySet<string>,
): FilterOutcome {
  if (!isAlert(msg.body)) return { action: 'ignore' };
  if (!authorizedSenders.has(msg.senderId)) return { action: 'reject', reason: 'remitente no autorizado' };
  return { action: 'process' };
}
