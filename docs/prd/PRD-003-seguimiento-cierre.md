# PRD-003: SignalBridge — Seguimiento de la posición hasta su cierre

## Contexto y Problema

Ver [PRD-000](PRD-000-marco.md) (problema, personas, glosario y ciclo de vida). Este
documento cubre el tramo desde que una operación queda completa (RF-10) hasta que la
posición se cierra. Sin este seguimiento el sistema no sabe cuándo una posición dejó
de estar abierta: los límites de posiciones y capital comprometido (RF-12, RF-20)
quedarían ocupados para siempre, la orden de SL o TP que sobrevive al cierre podría
abrir una posición no deseada, y el log no mostraría cómo terminó cada operación.

## Objetivos

Que cada operación tenga registrado cómo terminó (causa, PnL y comisiones), que el
cupo de exposición se libere apenas una posición se cierra, y que no queden en Binance
órdenes huérfanas de operaciones ya cerradas, sin intervención manual del operador.

## Requerimientos Funcionales
- RF-40: El sistema debe detectar el cierre de cada posición completa (RF-10) e
  identificar su causa: TP, SL, cierre manual del operador o liquidación.
- RF-41: Al detectar el cierre de una posición, el sistema debe cancelar las órdenes de
  SL y TP de esa operación que sigan abiertas en Binance.
- RF-42: Al detectar el cierre de una posición, el sistema debe dejar de contarla para
  los límites de posiciones (RF-12) y de capital comprometido (RF-20).
- RF-43: Al detectar el cierre de una posición, el sistema debe registrar en el log de
  la alerta (RF-05) la causa, la fecha/hora de cierre, el PnL realizado (USDT) y las
  comisiones, según Binance.
- RF-44: El sistema debe registrar como estado final "cerrada" una posición cerrada
  por TP, SL o cierre manual, y "liquidada" una posición liquidada.
- RF-45: Al arrancar, antes de procesar alertas nuevas, el sistema debe comparar sus
  posiciones abiertas y entradas pendientes locales con las de Binance en el modo
  activo.
- RF-46: Durante la comparación de RF-45, el sistema debe tratar cada posición local
  que ya no exista en Binance como cerrada, aplicando RF-40, RF-41, RF-42, RF-43 y
  RF-44.
- RF-47: Si una posición abierta pierde su orden de SL o de TP sin haberse cerrado, el
  sistema debe registrarlo como evento crítico en el log, sin modificar la posición.

## Requerimientos No Funcionales
- RNF-11: El tiempo desde que una posición se cierra en Binance hasta que el sistema
  registra el cierre (RF-43) y libera su cupo (RF-42) debe ser < 10 s.

## Criterios de Aceptación
- AC-56 (RF-40, RF-43, RF-44): Dada una posición completa, cuando se ejecuta su orden
  de TP, entonces el log de la alerta tiene estado "cerrada", causa "TP", fecha/hora de
  cierre, PnL realizado y comisiones, no vacíos.
- AC-57 (RF-40, RF-44): Dada una posición completa, cuando se ejecuta su orden de SL,
  entonces el log de la alerta tiene estado "cerrada" y causa "SL".
- AC-58 (RF-40, RF-44): Dada una posición completa, cuando el operador la cierra a mano
  desde Binance, entonces el log de la alerta tiene estado "cerrada" y causa "cierre
  manual".
- AC-59 (RF-40, RF-44): Dada una posición completa, cuando Binance la liquida,
  entonces el log de la alerta tiene estado "liquidada" y causa "liquidación".
- AC-60 (RF-41): Dada una posición completa cerrada por TP, cuando el sistema detecta
  el cierre, entonces cancela la orden de SL y no queda en Binance ninguna orden
  abierta de esa operación.
- AC-61 (RF-42): Dado un máximo de 1 posición y una posición abierta que se cierra,
  cuando llega una alerta válida después de que el sistema detectó el cierre, entonces
  no la rechaza por "límite de posiciones".
- AC-62 (RNF-11): Dados 20 cierres de posición de prueba en DRY, cuando se mide el
  tiempo desde el cierre en Binance hasta su registro en el log, entonces todos son
  < 10 s.
- AC-63 (RF-45, RF-46): Dado el proceso detenido y una posición que se cierra por SL
  mientras tanto, cuando el sistema vuelve a arrancar, entonces, antes de procesar
  cualquier alerta nueva, registra el cierre con causa "SL" y cancela la orden de TP
  huérfana.
- AC-64 (RF-47): Dada una posición completa, cuando el operador cancela a mano su
  orden de SL, entonces el sistema registra un evento crítico y la posición y su TP
  quedan sin cambios.

## Fuera de Alcance
- Mensajes de seguimiento de una alerta ya operada (cerrar, mover el SL, tomar
  parciales).
- Gestión activa de la posición abierta (trailing stop, múltiples TP).
- Volver a colocar un SL o TP que desapareció (RF-47 solo lo registra).
- Precio de salida y duración de la operación en el log.
- Análisis o reportes de PnL (ver Fuera de Alcance global en
  [PRD-000](PRD-000-marco.md)).

## Riesgos y Dependencias
- Riesgo: una orden de SL o TP que sobrevive al cierre de la posición podría
  ejecutarse más tarde y abrir una posición no deseada → mitigación: cancelación de
  las órdenes restantes al detectar el cierre (RF-41) y al reconciliar tras un
  reinicio (RF-46).
- Riesgo: un cierre que ocurre mientras el proceso está caído dejaría la posición
  contada como abierta → mitigación: reconciliación con Binance al arrancar (RF-45,
  RF-46).
- Riesgo: si el operador cancela a mano el SL o el TP, la posición queda desprotegida
  → mitigación: registro como evento crítico (RF-47); se respeta la decisión del
  operador y el riesgo se acepta.
- Dependencias:
  - [PRD-002](PRD-002-carga-reversion.md): operaciones completas con sus órdenes de
    entrada, SL y TP identificadas.
  - [PRD-000](PRD-000-marco.md): log (RF-05), modos DRY/LIVE y reconexión (RNF-04).
  - API de Binance Futuros vía CCXT (posiciones, órdenes, PnL realizado y comisiones).
  - Almacenamiento local persistente de posiciones abiertas y entradas pendientes.
