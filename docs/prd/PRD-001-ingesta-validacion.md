# PRD-001: SignalBridge — Ingesta y validación de alertas

## Contexto y Problema

Ver [PRD-000](PRD-000-marco.md) (problema, personas, glosario y ciclo de vida). Este
documento cubre el tramo desde que llega un mensaje del grupo hasta que la alerta
queda válida o rechazada: filtrado, extracción de datos (texto e imagen), mapeo del
ticker, deduplicación, cálculo del TP cuando no viene numérico y validaciones de
dirección, remitente y ranking.

## Objetivos

Validar cada señal contra reglas objetivas (dirección, señal completa, exclusión de
top 3 ganadores/perdedores) antes de operar, sin intervención manual del operador.

## Requerimientos Funcionales
- RF-01: El sistema debe clasificar una señal como LONG cuando el Stop Loss (SL) esté
  por debajo del precio de Entrada.
- RF-02: El sistema debe clasificar una señal como SHORT cuando el Stop Loss (SL) esté
  por encima del precio de Entrada.
- RF-03: El sistema debe ignorar, sin procesarlos ni loguearlos, los mensajes del grupo
  cuyo texto no contenga "alerta de trading" en cualquier posición, sin distinguir
  mayúsculas/minúsculas ni tildes.
- RF-04: El sistema no debe operar una alerta cuyo símbolo (RF-31) esté entre los 3
  mayores ganadores o los 3 mayores perdedores según la copia local vigente del
  ranking (RF-23).
- RF-09: El sistema debe extraer de cada alerta la entrada, el objetivo, el stop loss,
  el nivel de riesgo y el ticker a partir del texto del mensaje.
- RF-11: El sistema debe asignar a cada alerta procesada (cargada o rechazada) un
  identificador único persistente, formado por el ID del mensaje de WhatsApp y un hash
  de (ticker, Entrada, SL, TP).
- RF-13: El sistema debe rechazar una señal cuyo Take Profit no esté del lado correcto
  de la Entrada: por encima para LONG, por debajo para SHORT.
- RF-14: El sistema debe rechazar una señal cuyo Stop Loss sea igual a la Entrada.
- RF-16: El sistema debe analizar la imagen adjunta cuando el texto no contenga todos
  los datos de RF-09, para completar los que falten.
- RF-17: El sistema debe rechazar una alerta a la que le falte cualquiera de los datos
  de RF-09 después de analizar texto e imagen.
- RF-21: El sistema debe rechazar una alerta si la copia local del ranking de top 3
  (RF-23) tiene más de 120 s de antigüedad al recibirla.
- RF-22: El sistema debe rechazar las alertas cuyo remitente no esté en una lista
  configurable de remitentes autorizados.
- RF-23: En ambos modos, el sistema debe refrescar cada 60 s una copia local del
  ranking de top 3 ganadores/perdedores desde los endpoints públicos de producción de
  Futuros USDS-M (24 h ticker), sin credenciales, considerando solo contratos
  perpetuos en estado TRADING y ordenándolos por porcentaje de cambio de precio en
  24 h (priceChangePercent).
- RF-24: Si el objetivo de la alerta no trae un precio numérico, sin importar qué
  indicadores mencione, el sistema debe calcular el Take Profit como el más cercano a
  la Entrada entre ASL21 y EMA55, considerando solo los que estén del lado correcto de
  la Entrada (RF-13), donde ASL21 = (EMA(cierre, 20) + WMA(cierre, 21)) / 2 y
  EMA55 = EMA(cierre, 55), sobre las velas de 1 h del símbolo en Binance Futuros
  USDS-M, incluyendo la vela en curso (endpoint público, sin credenciales).
- RF-28: Si el objetivo de la alerta trae un precio numérico, el sistema debe usar ese
  precio como Take Profit.
- RF-29: El sistema debe rechazar como duplicado, sin operarla, una alerta cuyo ID de
  mensaje de WhatsApp coincida con el de cualquier alerta ya registrada, o cuyo hash
  de (ticker, Entrada, SL, TP) coincida con el de una alerta registrada en las últimas
  24 h (RF-11).
- RF-31: El sistema debe mapear el ticker de la alerta al contrato perpetuo
  TICKERUSDT; si no existe, a 1000TICKERUSDT, multiplicando Entrada, SL y TP por 1000.
- RF-32: El sistema debe rechazar una alerta cuyo ticker no exista en Futuros USDS-M
  ni como TICKERUSDT ni como 1000TICKERUSDT.
- RF-36: El sistema debe rechazar una alerta si, al calcular el TP (RF-24), ni ASL21 ni
  EMA55 quedan del lado correcto de la Entrada.
- RF-37: El sistema debe ajustar los precios de la alerta al tickSize del símbolo: la
  Entrada al tick más cercano, el SL alejándolo de la Entrada y el TP acercándolo a la
  Entrada.
- RF-38: El sistema debe evaluar las validaciones en este orden y registrar como
  motivo de rechazo solo la primera que falle: remitente no autorizado, duplicado (ID
  de WhatsApp), incompleta, duplicado (hash), ticker inexistente, SL igual a la
  Entrada, SL fuera de rango, TP inválido, ranking no disponible, top 3
  ganadores/perdedores, bajo mínimo, excede máximos, límite de posiciones, límite de
  capital.
- RF-50: El sistema debe rechazar una alerta cuyo Stop Loss esté a una distancia de la
  Entrada mayor que un porcentaje máximo configurable (por defecto 15 %), calculada
  como |Entrada − SL| / Entrada.

## Requerimientos No Funcionales
- RNF-01: El tiempo desde que el mensaje llega al sistema hasta que la alerta queda
  clasificada (válida o rechazada) debe ser < 3 s (p95) si alcanza con el texto, y
  < 10 s (p95) si requiere analizar la imagen.

## Criterios de Aceptación
- AC-01 (RF-01): Dado que el sistema recibe una señal con un Stop Loss (SL) menor que
  la Entrada, cuando calcula la dirección de la señal, entonces la clasifica como LONG.
- AC-02 (RF-13): Dada una señal LONG con TP menor o igual a la Entrada, cuando el
  sistema la valida, entonces la rechaza y loguea el motivo "TP inválido".
- AC-03 (RF-02): Dado que el sistema recibe una señal con un Stop Loss (SL) mayor que
  la Entrada, cuando calcula la dirección de la señal, entonces la clasifica como SHORT.
- AC-04 (RF-13): Dada una señal SHORT con TP mayor o igual a la Entrada, cuando el
  sistema la valida, entonces la rechaza y loguea el motivo "TP inválido".
- AC-05 (RF-03): Dado un mensaje del grupo cuyo texto no contiene "alerta de trading"
  (sin distinguir mayúsculas ni tildes), cuando llega al sistema, entonces no se
  procesa ni se registra en el log.
- AC-06 (RF-04): Dada una alerta cuyo símbolo está entre los 3 mayores perdedores de la
  copia local vigente del ranking (RF-23), cuando el sistema la valida, entonces la
  rechaza y loguea el motivo "top 3 ganadores/perdedores".
- AC-07 (RF-04): Dada una alerta cuyo símbolo está entre los 3 mayores ganadores de la
  copia local vigente del ranking (RF-23), cuando el sistema la valida, entonces la
  rechaza y loguea el motivo "top 3 ganadores/perdedores".
- AC-14 (RF-16): Dado un mensaje cuyo texto no trae todos los datos y la imagen sí,
  cuando el sistema lo procesa, entonces extrae los valores faltantes desde la imagen.
- AC-17 (RF-11, RF-29): Dado que una alerta ya fue registrada, cuando el sistema vuelve
  a recibir el mismo mensaje de WhatsApp (por ejemplo, tras un reinicio), entonces no
  la opera y la loguea como "duplicado".
- AC-19 (RF-14): Dada una señal con SL igual a la Entrada, cuando el sistema la
  valida, entonces la rechaza y loguea el motivo "SL igual a la Entrada".
- AC-20 (RF-09): Dado un mensaje cuyo texto trae todos los datos, cuando el sistema lo
  procesa, entonces extrae los valores del texto sin analizar la imagen.
- AC-21 (RF-17): Dada una alerta a la que le falta algún dato tanto en el texto como
  en la imagen, cuando el sistema la procesa, entonces la rechaza y loguea el motivo
  "incompleta".
- AC-25 (RF-21): Dada una copia local del ranking con más de 120 s de antigüedad,
  cuando llega una alerta, entonces el sistema la rechaza y loguea el motivo
  "ranking no disponible".
- AC-26 (RF-22): Dada una alerta completa enviada por un remitente que no está en la
  lista de autorizados, cuando llega al sistema, entonces la rechaza y loguea el
  motivo "remitente no autorizado".
- AC-30 (RF-23): Dado el sistema en DRY o LIVE, cuando pasan 60 s desde el último
  refresco, entonces actualiza la copia local desde el endpoint público de producción
  sin enviar credenciales.
- AC-33 (RF-24, RF-36): Dada una alerta cuyo objetivo es "ASL21, EMA55" sin precio, y
  un conjunto conocido de velas de 1 h, cuando el sistema calcula el TP, entonces es
  el valor de ASL21 o EMA55 del lado correcto que esté más cerca de la Entrada; si
  ninguno está del lado correcto, la rechaza con el motivo "TP inválido".
- AC-34 (RF-28): Dada una alerta cuyo objetivo es "ASL21, EMA55 y 0.002404 usd",
  cuando el sistema la procesa, entonces el TP es 0.002404 y no calcula indicadores.
- AC-35 (RF-03): Dado un mensaje del grupo que contiene "ALERTA DE TRADÍNG" en medio
  del texto, cuando llega al sistema, entonces se procesa como alerta.
- AC-37 (RF-29): Dada una alerta registrada hace menos de 24 h, cuando llega un reenvío
  con otro ID de mensaje de WhatsApp pero el mismo ticker, Entrada, SL y TP, entonces el sistema no la
  opera y la loguea como "duplicado".
- AC-38 (RF-23): Dado un conjunto conocido de tickers de 24 h que incluye un contrato
  en estado distinto de TRADING con el mayor porcentaje de cambio, cuando el sistema
  arma el ranking, entonces ese contrato queda excluido y el top 3 sale de ordenar el
  resto por priceChangePercent.
- AC-40 (RF-31): Dada una alerta con ticker "X" para el que existe XUSDT, cuando el
  sistema la procesa, entonces opera XUSDT con los precios de la alerta sin modificar.
- AC-41 (RF-31): Dada una alerta con ticker "PEPE" y Entrada 0.002404, donde no existe
  PEPEUSDT y sí 1000PEPEUSDT, cuando el sistema la procesa, entonces opera 1000PEPEUSDT
  con Entrada 2.404 y SL y TP multiplicados por 1000.
- AC-42 (RF-32): Dada una alerta cuyo ticker no existe ni como TICKERUSDT ni como
  1000TICKERUSDT, cuando el sistema la procesa, entonces la rechaza y loguea el motivo
  "ticker inexistente".
- AC-46 (RNF-01): Dado un lote de 20 alertas de prueba solo-texto y otro de 20 que
  requieren imagen, cuando se mide el tiempo desde la llegada hasta la clasificación, entonces el
  p95 es < 3 s para el primero y < 10 s para el segundo.
- AC-52 (RF-37): Dado un símbolo con tickSize 0.01 y una alerta LONG con Entrada
  10.004, SL 9.507 y TP 11.003, cuando el sistema ajusta los precios, entonces quedan
  Entrada 10.00, SL 9.50 y TP 11.00.
- AC-53 (RF-29): Dada una alerta registrada hace más de 24 h, cuando llega otra con otro
  ID de mensaje de WhatsApp y el mismo ticker, Entrada, SL y TP, entonces el sistema no
  la rechaza como duplicado.
- AC-54 (RF-38): Dada una alerta de un remitente no autorizado a la que además le faltan
  datos, cuando el sistema la valida, entonces loguea un único motivo: "remitente no
  autorizado".
- AC-68 (RF-50): Dada una alerta LONG con Entrada 1.246 y SL 0.1222 y el máximo
  configurado en 15 %, cuando el sistema la valida, entonces la rechaza y loguea el
  motivo "SL fuera de rango".

## Fuera de Alcance
- Todo lo posterior a que la alerta queda válida: dimensionamiento, límites de
  exposición y colocación de órdenes (ver [PRD-002](PRD-002-carga-reversion.md)).
- Ver también el Fuera de Alcance global en [PRD-000](PRD-000-marco.md).

## Riesgos y Dependencias
- Riesgo: el filtro de top 3 ganadores/perdedores depende de la copia local del
  ranking (RF-23); si el refresco falla, la copia queda desactualizada → mitigación:
  si la copia tiene más de 120 s, la alerta se rechaza por seguridad en lugar de
  operarse a ciegas (RF-21).
- Riesgo: cambio en el formato de las alertas del grupo (Tomy/Cris cambian cómo
  escriben) → mitigación: las alertas rechazadas quedan logueadas (RF-05/AC-09), lo
  que permite detectar rápido un cambio de formato y ajustar el parseo.
- Riesgo: un ticker mapeado al contrato equivocado (por ejemplo, PEPEUSDT contra
  1000PEPEUSDT) operaría con precios desfasados ×1000 → mitigación: regla de mapeo
  explícita (RF-31) y rechazo de tickers inexistentes (RF-32).
- Riesgo: reprocesar una alerta ya operada —por un reinicio que relee el historial del
  grupo, o por un reenvío del mensaje— generaría una segunda operación no deseada →
  mitigación: registro persistente de alertas ya procesadas por ID de mensaje y hash
  de contenido, consultado antes de operar cualquier alerta (RF-11, RF-29).
- Dependencias:
  - [PRD-000](PRD-000-marco.md): log (RF-05) y modos DRY/LIVE.
  - API de Anthropic Claude (parseo de texto y de imagen).
  - Endpoints públicos de Binance Futuros USDS-M (ticker 24 h, estado y filtros de
    símbolos, velas de 1 h).
  - Almacenamiento local persistente para el registro de alertas ya procesadas
    (idempotencia, RF-11/RF-29).
