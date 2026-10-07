# PRD-001: SignalBridge — Alertas de trading de WhatsApp a Binance

## Contexto y Problema

Sigo un servicio de alertas de trading por WhatsApp: los mensajes llegan a cualquier
hora, con formato variable, y para no perder la oportunidad hay que leerlos, decidir
si son operables, y cargar la orden a mano en Binance Futuros con el side (long/short),
el stop loss y el take profit correctos. Hacerlo manualmente es lento, propenso a
errores de tipeo o de dirección bajo presión, y depende de estar disponible en el
momento exacto en que llega la alerta.

Personas:
- Tomy (fuente de alertas): envía alertas con una imagen y un texto que normalmente
  contiene todo lo necesario (entrada, SL, TP, ticker); con el texto solo alcanza en
  la mayoría de los casos.
- Cris (fuente de alertas): envía alertas en un formato similar, pero a veces los
  datos completos solo están en la imagen y hay que analizarla también.
- Martín (usuario y operador del sistema): está suscripto al servicio de alertas por
  WhatsApp y quiere automatizar la carga de esas alertas en Binance como long o short
  según corresponda, sin tener que estar pendiente del chat todo el día.

Definiciones:
- Alerta: mensaje del grupo que pasa el filtro de RF-03.
- Alerta válida: alerta que superó todas las validaciones y rechazos de este PRD y
  está lista para colocarse en Binance.
- Modo DRY: arranque con `pnpm dev`; opera contra Binance Demo Trading
  (demo.binance.com), sin dinero real.
- Modo LIVE: arranque con `pnpm start`; opera contra Binance Futuros USDS-M de
  producción, con dinero real.
- Nocional: cantidad × precio de Entrada, en USDT.

## Objetivos

Que una señal de trading que llega al grupo de WhatsApp se convierta, en segundos
(RNF-09), en una orden validada y cargada en Binance Futuros (long o short, con SL y TP
correctos), sin intervención manual del operador. Eliminar la demora y el margen de
error de la carga manual, validando cada señal contra reglas objetivas (dirección,
señal completa, exclusión de top 3 ganadores/perdedores) antes de operar, y dejando
todo registrado para poder auditar qué se ejecutó, qué se descartó, y por qué.

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
- RF-05: El sistema debe registrar en un log toda alerta procesada, cargada o
  rechazada, con los campos: identificador (RF-11), fecha/hora, remitente, modo
  (DRY/LIVE), ticker, símbolo, side, Entrada, SL, TP y origen del TP (alerta o
  calculado), cantidad, riesgo R configurado, nivel de riesgo, IDs de las órdenes de
  Binance y estado final (completa, rechazada + motivo, cerrada por emergencia, entrada
  no ejecutada). Los campos que no apliquen quedan vacíos.
- RF-06: El sistema debe requerir autenticación para conectarse a WhatsApp, mediante
  un código QR que vincule la cuenta cuyo(s) grupo(s) de alertas se van a monitorear.
- RF-07: El sistema debe arrancar en modo DRY con `pnpm dev` y en modo LIVE con
  `pnpm start`.
- RF-08: El sistema debe calcular la cantidad a operar dividiendo un riesgo fijo R en
  USDT, configurado por el operador, por la distancia |Entrada − SL|, redondeando hacia
  abajo al stepSize del símbolo.
- RF-09: El sistema debe extraer de cada alerta la entrada, el objetivo, el stop loss,
  el nivel de riesgo y el ticker a partir del texto del mensaje.
- RF-10: El sistema debe considerar una operación completa solo cuando la entrada tenga
  ejecución y el SL y el TP estén colocados y aceptados por Binance cubriendo la
  posición abierta.
- RF-11: El sistema debe asignar a cada alerta procesada (cargada o rechazada) un
  identificador único persistente, formado por el ID del mensaje de WhatsApp y un hash
  de (ticker, Entrada, SL, TP).
- RF-12: El sistema debe rechazar una alerta válida si abrirla superaría el máximo
  configurable de posiciones simultáneas abiertas.
- RF-13: El sistema debe rechazar una señal cuyo Take Profit no esté del lado correcto
  de la Entrada: por encima para LONG, por debajo para SHORT.
- RF-14: El sistema debe rechazar una señal cuyo Stop Loss sea igual a la Entrada.
- RF-15: El sistema debe rechazar una alerta cuyo nocional exceda el tamaño de posición
  máximo configurado (USDT), o cuyo apalancamiento efectivo (nocional / balance de la
  cuenta del modo activo) exceda el apalancamiento máximo configurado.
- RF-16: El sistema debe analizar la imagen adjunta cuando el texto no contenga todos
  los datos de RF-09, para completar los que falten.
- RF-17: El sistema debe rechazar una alerta a la que le falte cualquiera de los datos
  de RF-09 después de analizar texto e imagen.
- RF-18: Si la orden de entrada tuvo ejecución y la colocación del SL o del TP falla, el
  sistema debe cerrar la posición con una orden a mercado y registrar el evento como
  crítico en el log.
- RF-19: Si la orden de entrada falla o no tiene ninguna ejecución a los 3 minutos de
  colocada, el sistema debe cancelarla y no colocar SL ni TP.
- RF-20: El sistema debe rechazar una alerta válida si abrirla haría que el nocional
  total de las posiciones abiertas supere el máximo configurable de capital
  comprometido (USDT).
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
- RF-25: En modo DRY, el sistema debe enviar todas las órdenes y consultas de balance a
  Binance Demo Trading (demo.binance.com).
- RF-26: En modo LIVE, el sistema debe enviar todas las órdenes y consultas de balance
  a Binance Futuros USDS-M de producción.
- RF-27: El nivel de riesgo de la alerta (Medio, Medio-Alto, Alto) no debe modificar la
  cantidad calculada en RF-08.
- RF-28: Si el objetivo de la alerta trae un precio numérico, el sistema debe usar ese
  precio como Take Profit.
- RF-29: El sistema debe rechazar como duplicado, sin operarla, una alerta cuyo ID de
  mensaje de WhatsApp o cuyo hash de (ticker, Entrada, SL, TP) coincida con el de una
  alerta ya registrada (RF-11).
- RF-30: El sistema debe rechazar una alerta cuya cantidad redondeada (RF-08) quede por
  debajo de la cantidad mínima o del nocional mínimo del símbolo.
- RF-31: El sistema debe mapear el ticker de la alerta al contrato perpetuo
  TICKERUSDT; si no existe, a 1000TICKERUSDT, multiplicando Entrada, SL y TP por 1000.
- RF-32: El sistema debe rechazar una alerta cuyo ticker no exista en Futuros USDS-M
  ni como TICKERUSDT ni como 1000TICKERUSDT.
- RF-33: El sistema debe colocar la entrada como una orden límite al precio de Entrada
  de la alerta.
- RF-34: El sistema debe colocar el SL y el TP apenas la orden de entrada registre
  cualquier ejecución (total o parcial), cubriendo el total de la posición abierta,
  incluidas las ejecuciones posteriores.
- RF-35: Si a los 3 minutos de colocada la orden de entrada tiene ejecución parcial, el
  sistema debe cancelar la parte no ejecutada y mantener el SL y el TP sobre la
  posición abierta.
- RF-36: El sistema debe rechazar una alerta si, al calcular el TP (RF-24), ni ASL21 ni
  EMA55 quedan del lado correcto de la Entrada.

## Requerimientos No Funcionales
- RNF-01: El tiempo desde que el mensaje llega al sistema hasta que la alerta queda
  clasificada (válida o rechazada) debe ser < 3 s (p95) si alcanza con el texto, y
  < 10 s (p95) si requiere analizar la imagen.
- RNF-02: Las API keys (ANTHROPIC_API_KEY y las credenciales de Binance) no deben
  estar en el código; se leen de variables de entorno.
- RNF-03: Los datos de sesión de WhatsApp deben guardarse cifrados en disco con una
  clave leída de una variable de entorno, en un directorio con permisos 0700, y estar
  excluidos del repositorio vía .gitignore.
- RNF-04: El sistema debe detectar la desconexión de WhatsApp o de la API de Binance
  en < 30 s y reintentar la reconexión con backoff exponencial (1 s, 2 s, 4 s… hasta
  un máximo de 60 s entre intentos); cada interrupción se registra en el log, y tras
  10 intentos fallidos consecutivos se registra como evento crítico.
- RNF-05: Si el proceso se cae, debe reiniciarse automáticamente y retomar la ingesta
  en < 60 s.
- RNF-06: (Retirado: pasó a Riesgos como política manual de habilitación de LIVE.)
- RNF-07: Las credenciales de Binance Demo Trading (DRY) y las de producción (LIVE)
  deben leerse de variables de entorno con nombres distintos.
- RNF-08: La API key de Binance de producción debe tener permisos de trading
  únicamente, con el retiro de fondos deshabilitado.
- RNF-09: El tiempo desde que el mensaje llega al sistema hasta que la orden límite de
  entrada queda aceptada por Binance debe ser < 5 s (p95) si alcanza con el texto, y
  < 12 s (p95) si requiere analizar la imagen.
- RNF-10: El log y el almacenamiento local (alertas procesadas, posiciones abiertas)
  deben tener permisos 0600, legibles solo por el usuario del proceso.

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
- AC-08 (RF-05): Dada una alerta válida que se transforma en una orden long o short en
  Binance, cuando la operación termina, entonces el log tiene una entrada con todos los
  campos de RF-05 que aplican, no vacíos.
- AC-09 (RF-05): Dada una alerta rechazada, cuando el sistema la descarta, entonces
  guarda un log con el motivo, que es uno de: incompleta, TP inválido, SL igual a la
  Entrada, top 3 ganadores/perdedores, ranking no disponible, excede máximos, bajo
  mínimo, ticker inexistente, límite de posiciones, límite de capital, remitente no
  autorizado, duplicado.
- AC-10 (RF-06): Dado que no hay una sesión de WhatsApp guardada, cuando se arranca el
  sistema, entonces muestra un código QR para vincular la cuenta.
- AC-11 (RF-07, RF-25): Dado el sistema arrancado con `pnpm dev`, cuando llega una
  alerta válida, entonces las órdenes y la consulta de balance se envían a Binance Demo
  Trading y ninguna a producción.
- AC-12 (RF-07, RF-26): Dado el sistema arrancado con `pnpm start`, cuando llega una
  alerta válida, entonces las órdenes y la consulta de balance se envían a producción
  y ninguna a Binance Demo Trading.
- AC-13 (RF-08): Dado un riesgo configurado R (USDT) y una alerta con Entrada E y
  Stop Loss S, cuando el sistema calcula la cantidad a operar, entonces la cantidad es
  R / |E − S| redondeada hacia abajo al stepSize del símbolo.
- AC-14 (RF-16): Dado un mensaje cuyo texto no trae todos los datos y la imagen sí,
  cuando el sistema lo procesa, entonces extrae los valores faltantes desde la imagen.
- AC-15 (RF-10): Dada una alerta válida y ya dimensionada (RF-08), cuando el sistema
  coloca la operación, entonces el log la marca como "completa" solo después de que
  Binance confirma la ejecución de la entrada y la aceptación del SL y del TP.
- AC-16 (RF-18): Dado que la orden de entrada ya tuvo ejecución, cuando la colocación
  del SL o del TP falla, entonces el sistema cierra la posición con una orden a mercado
  en < 5 s desde la falla y registra el evento como crítico en el log.
- AC-17 (RF-11, RF-29): Dado que una alerta ya fue registrada, cuando el sistema vuelve
  a recibir el mismo mensaje de WhatsApp (por ejemplo, tras un reinicio), entonces no
  la opera y la loguea como "duplicado".
- AC-18 (RF-12): Dado que la cantidad de posiciones abiertas es igual al máximo
  configurado, cuando llega una nueva alerta válida, entonces el sistema la rechaza y
  loguea el motivo "límite de posiciones".
- AC-19 (RF-14): Dada una señal con SL igual a la Entrada, cuando el sistema la
  valida, entonces la rechaza y loguea el motivo "SL igual a la Entrada".
- AC-20 (RF-09): Dado un mensaje cuyo texto trae todos los datos, cuando el sistema lo
  procesa, entonces extrae los valores del texto sin analizar la imagen.
- AC-21 (RF-17): Dada una alerta a la que le falta algún dato tanto en el texto como
  en la imagen, cuando el sistema la procesa, entonces la rechaza y loguea el motivo
  "incompleta".
- AC-22 (RF-15): Dada una alerta cuyo nocional excede el tamaño de posición máximo, o
  cuyo nocional / balance excede el apalancamiento máximo, cuando el sistema la
  dimensiona, entonces la rechaza y loguea el motivo "excede máximos".
- AC-23 (RF-19): Dada una orden de entrada sin ninguna ejecución, cuando falla o pasan
  3 minutos desde que se colocó, entonces el sistema la cancela, no coloca SL ni TP y
  registra el estado "entrada no ejecutada".
- AC-24 (RF-20): Dado un nocional total de posiciones abiertas C y un máximo M, cuando
  llega una alerta válida con nocional X y C + X > M, entonces el sistema la rechaza y
  loguea el motivo "límite de capital".
- AC-25 (RF-21): Dada una copia local del ranking con más de 120 s de antigüedad,
  cuando llega una alerta, entonces el sistema la rechaza y loguea el motivo
  "ranking no disponible".
- AC-26 (RF-22): Dada una alerta completa enviada por un remitente que no está en la
  lista de autorizados, cuando llega al sistema, entonces la rechaza y loguea el
  motivo "remitente no autorizado".
- AC-27 (RNF-02): Dado el repositorio, cuando se corre gitleaks sobre el árbol de
  trabajo y todo el historial, entonces reporta 0 hallazgos.
- AC-28 (RNF-08): Dada la API key de Binance de producción configurada, cuando se
  revisan sus permisos en Binance, entonces el retiro de fondos está deshabilitado y
  solo está habilitado el trading.
- AC-29 (RNF-03): Dado el directorio de sesión de WhatsApp, cuando se revisan su
  contenido, sus permisos y el .gitignore, entonces ningún archivo contiene en texto
  plano el número de teléfono vinculado, el directorio tiene permisos 0700 y está
  excluido del repo.
- AC-30 (RF-23): Dado el sistema en DRY o LIVE, cuando pasan 60 s desde el último
  refresco, entonces actualiza la copia local desde el endpoint público de producción
  sin enviar credenciales.
- AC-31 (RNF-05): Dado el proceso corriendo, cuando se lo termina abruptamente,
  entonces vuelve a estar ingiriendo mensajes en < 60 s.
- AC-32: (Retirado junto con RNF-06.)
- AC-33 (RF-24, RF-36): Dada una alerta cuyo objetivo es "ASL21, EMA55" sin precio, y
  un conjunto conocido de velas de 1 h, cuando el sistema calcula el TP, entonces es
  el valor de ASL21 o EMA55 del lado correcto que esté más cerca de la Entrada; si
  ninguno está del lado correcto, la rechaza con el motivo "TP inválido".
- AC-34 (RF-28): Dada una alerta cuyo objetivo es "ASL21, EMA55 y 0.002404 usd",
  cuando el sistema la procesa, entonces el TP es 0.002404 y no calcula indicadores.
- AC-35 (RF-03): Dado un mensaje del grupo que contiene "ALERTA DE TRADÍNG" en medio
  del texto, cuando llega al sistema, entonces se procesa como alerta.
- AC-36 (RF-27): Dadas dos alertas idénticas salvo el nivel de riesgo (Medio y Alto),
  cuando el sistema calcula la cantidad, entonces ambas dan la misma cantidad.
- AC-37 (RF-29): Dada una alerta ya registrada, cuando llega un reenvío con otro ID de
  mensaje de WhatsApp pero el mismo ticker, Entrada, SL y TP, entonces el sistema no la
  opera y la loguea como "duplicado".
- AC-38 (RF-23): Dado un conjunto conocido de tickers de 24 h que incluye un contrato
  en estado distinto de TRADING con el mayor porcentaje de cambio, cuando el sistema
  arma el ranking, entonces ese contrato queda excluido y el top 3 sale de ordenar el
  resto por priceChangePercent.
- AC-39 (RF-30): Dada una alerta cuya cantidad redondeada queda por debajo de la
  cantidad mínima o del nocional mínimo del símbolo, cuando el sistema la dimensiona,
  entonces la rechaza y loguea el motivo "bajo mínimo".
- AC-40 (RF-31): Dada una alerta con ticker "X" para el que existe XUSDT, cuando el
  sistema la procesa, entonces opera XUSDT con los precios de la alerta sin modificar.
- AC-41 (RF-31): Dada una alerta con ticker "PEPE" y Entrada 0.002404, donde no existe
  PEPEUSDT y sí 1000PEPEUSDT, cuando el sistema la procesa, entonces opera 1000PEPEUSDT
  con Entrada 2.404 y SL y TP multiplicados por 1000.
- AC-42 (RF-32): Dada una alerta cuyo ticker no existe ni como TICKERUSDT ni como
  1000TICKERUSDT, cuando el sistema la procesa, entonces la rechaza y loguea el motivo
  "ticker inexistente".
- AC-43 (RF-33): Dada una alerta válida con Entrada E, cuando el sistema coloca la
  entrada, entonces la orden enviada a Binance es de tipo límite con precio E.
- AC-44 (RF-34): Dada una orden de entrada sin ejecución, cuando registra una ejecución
  parcial, entonces el sistema coloca el SL y el TP cubriendo la posición abierta; y
  mientras no hubo ejecución, no hay SL ni TP enviados.
- AC-45 (RF-35): Dada una orden de entrada con ejecución parcial, cuando pasan 3
  minutos desde que se colocó, entonces el sistema cancela la parte no ejecutada y el
  SL y el TP siguen cubriendo la posición abierta.
- AC-46 (RNF-01): Dado un lote de alertas de prueba solo-texto y otro que requiere
  imagen, cuando se mide el tiempo desde la llegada hasta la clasificación, entonces el
  p95 es < 3 s para el primero y < 10 s para el segundo.
- AC-47 (RNF-04): Dada una conexión activa a WhatsApp o a Binance, cuando se corta,
  entonces el sistema registra la interrupción en < 30 s, reintenta con esperas de 1 s,
  2 s, 4 s… hasta 60 s, y al 10.º intento fallido consecutivo registra un evento
  crítico.
- AC-48 (RNF-09): Dado un lote de alertas válidas de prueba solo-texto y otro que
  requiere imagen, cuando se mide el tiempo desde la llegada hasta que Binance acepta
  la orden de entrada, entonces el p95 es < 5 s para el primero y < 12 s para el
  segundo.
- AC-49 (RNF-07): Dada la configuración del sistema, cuando se revisan las variables de
  entorno que lee cada modo, entonces DRY y LIVE leen credenciales de Binance de
  variables con nombres distintos.
- AC-50 (RNF-10): Dado el sistema corriendo, cuando se revisan los permisos del log y
  del almacenamiento local, entonces son 0600 y el dueño es el usuario del proceso.

## Fuera de Alcance
- Backtesting o análisis de performance histórica (no se calcula drawdown
  máximo/mínimo en esta versión).
- Dashboard o interfaz de monitoreo.
- Soporte para más de un exchange (solo Binance Futuros).
- Soporte simultáneo para más de un grupo de alertas.
- Notificaciones externas (Telegram/email).
- Mensajes de seguimiento de una alerta ya operada (cerrar, mover el SL, tomar
  parciales).
- Gestión de la posición una vez abierta (trailing stop, múltiples TP).
- Multiusuario: un solo operador por instancia.
- Recolocar una entrada que venció sin ejecutarse (RF-19).

## Riesgos y Dependencias
- Riesgo: expiración de la sesión o autenticación de WhatsApp (whatsapp-web.js puede
  cerrar sesión o pedir un nuevo QR) → mitigación: detección de desconexión,
  reintento de reconexión automática y registro en el log (RNF-04), reautenticación
  manual vía QR (RF-06).
- Riesgo: automatizar una sesión de WhatsApp Web está fuera del uso previsto por
  WhatsApp y podría derivar en el bloqueo del número → mitigación: usar un número de
  teléfono dedicado, no crítico, para el puente.
- Riesgo: caída, rate limiting o cambios en la API de Binance/CCXT → mitigación:
  reintentos con backoff y registro de todo fallo (RNF-04, RF-05).
- Riesgo: el filtro de top 3 ganadores/perdedores depende de la copia local del
  ranking (RF-23); si el refresco falla, la copia queda desactualizada → mitigación:
  si la copia tiene más de 120 s, la alerta se rechaza por seguridad en lugar de
  operarse a ciegas (RF-21).
- Riesgo: cambio en el formato de las alertas del grupo (Tomy/Cris cambian cómo
  escriben) → mitigación: las alertas rechazadas quedan logueadas (RF-05/AC-09), lo
  que permite detectar rápido un cambio de formato y ajustar el parseo.
- Riesgo financiero: el sistema coloca operaciones reales y apalancadas en modo LIVE →
  mitigación: los límites de apalancamiento y tamaño de posición (RF-15) y una
  política manual de habilitación: antes de operar en LIVE, el operador corre el
  sistema al menos 7 días corridos y 20 alertas procesadas en DRY, con 0 errores de
  clasificación (LONG/SHORT/rechazo) contra revisión manual. El sistema no controla
  esta política.
- Riesgo: un ticker mapeado al contrato equivocado (por ejemplo, PEPEUSDT contra
  1000PEPEUSDT) operaría con precios desfasados ×1000 → mitigación: regla de mapeo
  explícita (RF-31) y rechazo de tickers inexistentes (RF-32).
- Riesgo: al ser un único proceso corriendo en una máquina sin redundancia, una caída
  del host detiene toda la ingesta → mitigación: reinicio automático del proceso
  (RNF-05).
- Riesgo: Binance/CCXT no ofrece una orden combinada nativa que garantice entrada, SL
  y TP como una sola transacción; son tres llamadas independientes a la API →
  mitigación: SL y TP se colocan apenas hay ejecución de la entrada (RF-34),
  verificación de las tres órdenes y cierre de emergencia de la posición si el SL o
  el TP no llegan a confirmarse (RF-10, RF-18, AC-16).
- Riesgo: reprocesar una alerta ya operada —por un reinicio que relee el historial del
  grupo, o por un reenvío del mensaje— generaría una segunda operación no deseada →
  mitigación: registro persistente de alertas ya procesadas por ID de mensaje y hash
  de contenido, consultado antes de operar cualquier alerta (RF-11, RF-29).
- Riesgo: con alertas llegando durante todo el día, la exposición total puede crecer
  sin control aunque cada operación individual esté acotada (RF-15) → mitigación:
  límite configurable de posiciones simultáneas (RF-12) y de capital total
  comprometido (RF-20).
- Dependencias:
  - API de Anthropic Claude (parseo de texto y de imagen).
  - API de Binance Futuros vía CCXT (órdenes, balance, datos de top
    ganadores/perdedores de las últimas 24 h, filtros de símbolo y velas de 1 h para
    el TP calculado).
  - Binance Demo Trading (demo.binance.com) (modo DRY).
  - whatsapp-web.js.
  - Cuenta de Binance con API key habilitada solo para trading (sin permiso de
    retiro).
  - Almacenamiento local persistente para el registro de alertas ya procesadas
    (idempotencia, RF-11/RF-29) y de posiciones abiertas (exposición total,
    RF-12/RF-20).
