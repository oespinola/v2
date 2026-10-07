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

## Objetivos

Que una señal de trading que llega al grupo de WhatsApp se convierta, en segundos, en
una orden validada y cargada en Binance Futuros (long o short, con SL y TP correctos),
sin intervención manual del operador. Eliminar la demora y el margen de error de la
carga manual, validando cada señal contra reglas objetivas (dirección, señal completa,
exclusión de top 3 ganadores/perdedores) antes de operar, y dejando todo registrado
para poder auditar qué se ejecutó, qué se descartó, y por qué.

## Requerimientos Funcionales
- RF-01: El sistema debe clasificar una señal como LONG cuando el Stop Loss (SL) esté
  por debajo del precio de Entrada.
- RF-02: El sistema debe clasificar una señal como SHORT cuando el Stop Loss (SL) esté
  por encima del precio de Entrada.
- RF-03: El sistema debe ignorar, sin procesarlos ni loguearlos, los mensajes del grupo
  que no indiquen "Alerta de trading".
- RF-04: El sistema no debe operar alertas cuyo ticker esté, en las últimas 24 horas y
  sobre el universo completo de pares de Binance Futuros USDS-M, entre los 3 mayores
  ganadores o los 3 mayores perdedores al momento de recibir la alerta.
- RF-05: El sistema debe registrar en un log toda alerta procesada: las que pasan la
  validación y se cargan en Binance, y las que se rechazan, indicando el motivo del
  rechazo.
- RF-06: El sistema debe requerir autenticación para conectarse a WhatsApp, mediante
  un código QR que vincule la cuenta cuyo(s) grupo(s) de alertas se van a monitorear.
- RF-07: El sistema debe arrancar en modo DRY (`pnpm dev`) o LIVE (`pnpm start`)
  según el comando de inicio. En DRY, las órdenes y la consulta de balance deben ir
  contra Binance Futures Testnet/Demo, con credenciales distintas de las de LIVE; en
  LIVE, contra producción.
- RF-08: El sistema debe calcular la cantidad a operar dividiendo un riesgo fijo en
  USDT, configurado por el operador, por la distancia entre la Entrada y el Stop Loss.
  El nivel de riesgo de la alerta (Medio, Medio-Alto, Alto) se registra en el log
  pero no modifica la cantidad.
- RF-09: El sistema debe extraer de cada alerta la entrada, el objetivo, el stop loss,
  el nivel de riesgo y el ticker a partir del texto del mensaje. Si el objetivo trae
  un precio numérico, ese precio es el Take Profit.
- RF-10: El sistema debe considerar una operación completa solo cuando la entrada, el
  Stop Loss y el Take Profit estén colocados y confirmados por Binance.
- RF-11: El sistema debe asignar a cada alerta procesada (cargada o rechazada) un
  identificador único persistente y, si vuelve a recibir una alerta con un
  identificador ya registrado, no debe operarla y debe loguearla como duplicado
  descartado.
- RF-12: El sistema debe rechazar una alerta válida si abrirla superaría el máximo
  configurable de posiciones simultáneas abiertas.
- RF-13: El sistema debe rechazar una señal cuyo Take Profit no esté del lado correcto
  de la Entrada: por encima para LONG, por debajo para SHORT.
- RF-14: El sistema debe rechazar una señal cuyo Stop Loss sea igual a la Entrada.
- RF-15: El sistema debe rechazar una alerta cuya cantidad calculada (RF-08) exceda el
  apalancamiento máximo o el tamaño de posición máximo configurados por el operador.
- RF-16: El sistema debe analizar la imagen adjunta cuando el texto no contenga todos
  los datos de RF-09, para completar los que falten.
- RF-17: El sistema debe rechazar una alerta a la que le falte cualquiera de los datos
  de RF-09 después de analizar texto e imagen.
- RF-18: Si la orden de entrada se ejecutó y la colocación del SL o del TP falla, el
  sistema debe cerrar la posición con una orden a mercado.
- RF-19: Si la orden de entrada falla, el sistema debe cancelar el SL y el TP que sí
  haya llegado a colocar.
- RF-20: El sistema debe rechazar una alerta válida si abrirla superaría el máximo
  configurable de capital total comprometido en simultáneo.
- RF-21: El sistema debe rechazar una alerta si la copia local del ranking de top 3
  (RF-23) tiene más de 120 s de antigüedad al recibirla.
- RF-22: El sistema debe rechazar las alertas cuyo remitente no esté en una lista
  configurable de remitentes autorizados.
- RF-23: En ambos modos, el sistema debe refrescar cada 60 s una copia local del
  ranking de top 3 ganadores/perdedores (RF-04) desde el endpoint público de
  producción de Futuros USDS-M (24 h ticker), sin credenciales.
- RF-24: Si el objetivo de la alerta no trae un precio numérico, el sistema debe
  calcular el Take Profit como el más cercano a la Entrada entre ASL21 y EMA55,
  considerando solo los que estén del lado correcto de la Entrada (RF-13), donde
  ASL21 = (EMA(cierre, 20) + WMA(cierre, 21)) / 2 y EMA55 = EMA(cierre, 55), sobre
  las velas de 1 h de Binance Futuros USDS-M, incluyendo la vela en curso (endpoint
  público, sin credenciales).

## Requerimientos No Funcionales
- RNF-01: El tiempo desde que el mensaje llega al sistema hasta que la alerta queda
  clasificada (válida o rechazada) debe ser < 3 s (p95) si alcanza con el texto, y
  < 10 s (p95) si requiere analizar la imagen.
- RNF-02: Las API keys (ANTHROPIC_API_KEY y las credenciales de Binance) no deben
  estar en el código; se leen de variables de entorno. Las credenciales de
  Testnet/Demo también se leen de variables de entorno, separadas de las de LIVE. La
  API key de Binance debe tener permisos de trading únicamente, con el retiro de
  fondos deshabilitado.
- RNF-03: Los datos de sesión de WhatsApp deben guardarse cifrados en disco con una
  clave leída de una variable de entorno, en un directorio con permisos 0700, y estar
  excluidos del repositorio vía .gitignore.
- RNF-04: El sistema debe detectar la desconexión de WhatsApp o de la API de Binance
  en < 30 s y reintentar la reconexión con backoff exponencial (1 s, 2 s, 4 s… hasta
  un máximo de 60 s entre intentos); cada interrupción se registra en el log, y tras
  10 intentos fallidos consecutivos se registra como evento crítico.
- RNF-05: Si el proceso se cae, debe reiniciarse automáticamente y retomar la ingesta
  en < 60 s.
- RNF-06: El modo LIVE solo puede habilitarse después de al menos 7 días corridos y
  20 alertas procesadas en DRY, con 0 errores de clasificación (LONG/SHORT/rechazo)
  contra revisión manual.

## Criterios de Aceptación
- AC-01 (RF-01): Dado que el sistema recibe una señal con un Stop Loss (SL) menor que
  la Entrada, cuando calcula la dirección de la señal, entonces la clasifica como LONG.
- AC-02 (RF-13): Dada una señal LONG con TP menor o igual a la Entrada, cuando el
  sistema la valida, entonces la rechaza y loguea el motivo "TP inválido".
- AC-03 (RF-02): Dado que el sistema recibe una señal con un Stop Loss (SL) mayor que
  la Entrada, cuando calcula la dirección de la señal, entonces la clasifica como SHORT.
- AC-04 (RF-13): Dada una señal SHORT con TP mayor o igual a la Entrada, cuando el
  sistema la valida, entonces la rechaza y loguea el motivo "TP inválido".
- AC-05 (RF-03): Dado un mensaje del grupo que no indica "Alerta de trading", cuando
  llega al sistema, entonces no se procesa ni se registra en el log.
- AC-06 (RF-04): Dada una alerta válida (RF-03), cuando su ticker está, en las últimas
  24 horas sobre el universo completo de pares de Binance Futuros USDS-M, entre los 3
  mayores perdedores al momento de recibirla, entonces el sistema la rechaza.
- AC-07 (RF-04): Dada una alerta válida (RF-03), cuando su ticker está, en las últimas
  24 horas sobre el universo completo de pares de Binance Futuros USDS-M, entre los 3
  mayores ganadores al momento de recibirla, entonces el sistema la rechaza.
- AC-08 (RF-05): Dada una alerta válida que se transforma en una orden long o short en
  Binance, cuando la orden se coloca, entonces el sistema guarda un log de la alerta y
  la orden cargada.
- AC-09 (RF-05): Dada una alerta rechazada, cuando el sistema la descarta, entonces
  guarda un log con el motivo, que es uno de: incompleta, TP inválido, SL igual a la
  Entrada, top 3 ganadores/perdedores, ranking no disponible, excede máximos, límite
  de posiciones, límite de capital, remitente no autorizado, duplicado.
- AC-10 (RF-06): Dado que no hay una sesión de WhatsApp guardada, cuando se arranca el
  sistema, entonces muestra un código QR para vincular la cuenta.
- AC-11 (RF-07): Dado el sistema arrancado con `pnpm dev`, cuando llega una alerta
  válida, entonces las órdenes se envían a Testnet/Demo y ninguna a producción.
- AC-12 (RF-07): Dado el sistema arrancado con `pnpm start`, cuando llega una alerta
  válida, entonces las órdenes se envían a producción.
- AC-13 (RF-08): Dado un riesgo configurado R (USDT) y una alerta con Entrada E y
  Stop Loss S, cuando el sistema calcula la cantidad a operar, entonces la cantidad
  es R / |E − S|, sin importar el nivel de riesgo de la alerta.
- AC-14 (RF-16): Dado un mensaje cuyo texto no trae todos los datos y la imagen sí,
  cuando el sistema lo procesa, entonces extrae los valores faltantes desde la imagen.
- AC-15 (RF-10): Dada una alerta válida y ya dimensionada (RF-08), cuando el sistema
  coloca la operación, entonces la entrada, el SL y el TP quedan los tres colocados y
  confirmados antes de considerarla completa.
- AC-16 (RF-18): Dado que la orden de entrada ya se ejecutó, cuando la colocación del
  SL o del TP falla, entonces el sistema cierra la posición con una orden a mercado
  en < 5 s desde la falla y registra el evento como crítico en el log.
- AC-17 (RF-11): Dado que una alerta ya fue marcada como procesada, cuando el sistema
  la vuelve a recibir (por reinicio o reenvío), entonces no la opera y la loguea como
  "duplicado".
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
- AC-22 (RF-15): Dada una alerta cuya cantidad calculada excede el apalancamiento
  máximo o el tamaño de posición máximo, cuando el sistema la dimensiona, entonces la
  rechaza y loguea el motivo "excede máximos".
- AC-23 (RF-19): Dado que el SL o el TP ya se colocaron, cuando la orden de entrada
  falla, entonces el sistema cancela las órdenes colocadas y lo registra en el log.
- AC-24 (RF-20): Dado un capital comprometido C y un máximo M, cuando llega una alerta
  válida que requiere un capital X con C + X > M, entonces el sistema la rechaza y
  loguea el motivo "límite de capital".
- AC-25 (RF-21): Dada una copia local del ranking con más de 120 s de antigüedad,
  cuando llega una alerta válida, entonces el sistema la rechaza y loguea el motivo
  "ranking no disponible".
- AC-26 (RF-22): Dada una alerta completa enviada por un remitente que no está en la
  lista de autorizados, cuando llega al sistema, entonces la rechaza y loguea el
  motivo "remitente no autorizado".
- AC-27 (RNF-02): Dado el repositorio, cuando se buscan credenciales en el código,
  entonces no aparece ninguna API key de Anthropic ni de Binance.
- AC-28 (RNF-02): Dada la API key de Binance configurada, cuando se revisan sus
  permisos en Binance, entonces el retiro de fondos está deshabilitado.
- AC-29 (RNF-03): Dado el directorio de sesión de WhatsApp, cuando se revisan su
  contenido, sus permisos y el .gitignore, entonces los archivos están cifrados, el
  directorio tiene permisos 0700 y está excluido del repo.
- AC-30 (RF-23): Dado el sistema en DRY o LIVE, cuando pasan 60 s desde el último
  refresco, entonces actualiza la copia local desde el endpoint público de producción
  sin enviar credenciales.
- AC-31 (RNF-05): Dado el proceso corriendo, cuando se lo termina abruptamente,
  entonces vuelve a estar ingiriendo mensajes en < 60 s.
- AC-32 (RNF-06): Dado el registro de operación en DRY, cuando se quiere habilitar
  LIVE, entonces hay ≥ 7 días y ≥ 20 alertas procesadas con 0 errores de
  clasificación.
- AC-33 (RF-24): Dada una alerta cuyo objetivo es "ASL21, EMA55" sin precio, y un
  conjunto conocido de velas de 1 h, cuando el sistema calcula el TP, entonces es el
  valor de ASL21 o EMA55 del lado correcto que esté más cerca de la Entrada; si
  ninguno está del lado correcto, la rechaza con el motivo "TP inválido".
- AC-34 (RF-09): Dada una alerta cuyo objetivo es "ASL21, EMA55 y 0.002404 usd",
  cuando el sistema la procesa, entonces el TP es 0.002404 y no calcula indicadores.

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
- Riesgo: el filtro de top 3 ganadores/perdedores depende de una consulta a Binance en
  el momento de la alerta; si esa consulta falla o tarda → mitigación: si la copia
  local del ranking está desactualizada (falla de refresco), la alerta se rechaza por
  seguridad en lugar de operarse a ciegas (RF-21).
- Riesgo: cambio en el formato de las alertas del grupo (Tomy/Cris cambian cómo
  escriben) → mitigación: las alertas rechazadas quedan logueadas (RF-05/AC-09), lo
  que permite detectar rápido un cambio de formato y ajustar el parseo.
- Riesgo financiero: el sistema coloca operaciones reales y apalancadas en modo LIVE →
  mitigación: los límites de apalancamiento y tamaño de posición (RF-15) y una
  validación mínima en modo DRY antes de habilitar LIVE (RNF-06).
- Riesgo: al ser un único proceso corriendo en una máquina sin redundancia, una caída
  del host detiene toda la ingesta → mitigación: reinicio automático del proceso
  (RNF-05).
- Riesgo: Binance/CCXT no ofrece una orden combinada nativa que garantice entrada, SL
  y TP como una sola transacción; son tres llamadas independientes a la API →
  mitigación: verificación de las tres tras cada colocación y cierre de emergencia de
  la posición si el SL o el TP no llegan a confirmarse (RF-10, RF-18, AC-16).
- Riesgo: reprocesar una alerta ya operada —por un reinicio que relee el historial del
  grupo, o por un reenvío del mensaje— generaría una segunda operación no deseada →
  mitigación: registro persistente de alertas ya procesadas, consultado antes de
  operar cualquier alerta (RF-11).
- Riesgo: con alertas llegando durante todo el día, la exposición total puede crecer
  sin control aunque cada operación individual esté acotada (RF-15) → mitigación:
  límite configurable de posiciones simultáneas (RF-12) y de capital total
  comprometido (RF-20).
- Dependencias:
  - API de Anthropic Claude (parseo de texto y de imagen).
  - API de Binance Futuros vía CCXT (órdenes, datos de top ganadores/perdedores de
    las últimas 24 h y velas de 1 h para el TP calculado).
  - Binance Futures Testnet/Demo (modo DRY).
  - whatsapp-web.js.
  - Cuenta de Binance con API key habilitada solo para trading (sin permiso de
    retiro).
  - Almacenamiento local persistente para el registro de alertas ya procesadas
    (idempotencia, RF-11) y de posiciones abiertas (exposición total, RF-12/RF-20).

<!-- Comentario de prueba para verificar el push a git -->
