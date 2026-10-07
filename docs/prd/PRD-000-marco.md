# PRD-000: SignalBridge — Marco general de alertas de trading de WhatsApp a Binance

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
- Alerta válida: alerta que superó todas las validaciones y rechazos de PRD-001 y
  PRD-002 y está lista para colocarse en Binance.
- Modo DRY: arranque con `pnpm dev`; opera contra Binance Demo Trading
  (demo.binance.com), sin dinero real.
- Modo LIVE: arranque con `pnpm start`; opera contra Binance Futuros USDS-M de
  producción, con dinero real.
- Nocional: cantidad × precio de Entrada, en USDT.

Ciclo de vida de una alerta (el estado final queda registrado en el log, RF-05):

```
mensaje ─┬─ ignorado (RF-03, no se loguea)
         └─ alerta ─┬─ rechazada (motivo, RF-38)                     ← PRD-001 / PRD-002
                    └─ válida ── entrada pendiente ─┬─ entrada no ejecutada (RF-19)
                                                    └─ con ejecución ─┬─ cerrada por emergencia (RF-18)
                                                                      └─ completa (RF-10)
                                                                           ├─ cerrada (TP, SL, manual) ← PRD-003
                                                                           └─ liquidada                ← PRD-003
```

Documentos de este PRD:
- PRD-000 (este documento): marco general — problema, personas, glosario, ciclo de
  vida de la alerta, modos DRY/LIVE, log y requisitos transversales de seguridad y
  resiliencia.
- [PRD-001](PRD-001-ingesta-validacion.md): ingesta y validación — desde que llega el
  mensaje hasta que la alerta queda válida o rechazada.
- [PRD-002](PRD-002-carga-reversion.md): carga y reversión — dimensionamiento, límites
  de exposición, colocación de entrada/SL/TP y reversión ante fallas.
- [PRD-003](PRD-003-seguimiento-cierre.md): seguimiento y cierre — detección del
  cierre de la posición, cancelación de órdenes huérfanas, liberación de cupo y
  reconciliación al arrancar.

Los identificadores RF/RNF/AC son globales y únicos entre todos los documentos.

## Objetivos

Que una señal de trading que llega al grupo de WhatsApp se convierta, en segundos
(RNF-09), en una orden validada y cargada en Binance Futuros (long o short, con SL y TP
correctos), sin intervención manual del operador. Eliminar la demora y el margen de
error de la carga manual, validando cada señal contra reglas objetivas (dirección,
señal completa, exclusión de top 3 ganadores/perdedores) antes de operar, y dejando
todo registrado para poder auditar qué se ejecutó, qué se descartó, y por qué.

## Requerimientos Funcionales
- RF-05: El sistema debe registrar en un log toda alerta procesada, cargada o
  rechazada, con los campos: identificador (RF-11), fecha/hora, remitente, modo
  (DRY/LIVE), ticker, símbolo, side, Entrada, SL, TP y origen del TP (alerta o
  calculado), cantidad, riesgo R configurado, nivel de riesgo, IDs de las órdenes de
  Binance, causa de cierre, fecha/hora de cierre, PnL realizado, comisiones y estado
  (completa, rechazada + motivo, cerrada por emergencia, entrada no ejecutada,
  cerrada, liquidada). Los campos que no apliquen quedan vacíos.
- RF-06: El sistema debe requerir autenticación para conectarse a WhatsApp, mediante
  un código QR que vincule la cuenta cuyo(s) grupo(s) de alertas se van a monitorear.
- RF-07: El sistema debe arrancar en modo DRY con `pnpm dev` y en modo LIVE con
  `pnpm start`.
- RF-25: En modo DRY, el sistema debe enviar todas las órdenes y consultas de balance a
  Binance Demo Trading (demo.binance.com).
- RF-26: En modo LIVE, el sistema debe enviar todas las órdenes y consultas de balance
  a Binance Futuros USDS-M de producción.

## Requerimientos No Funcionales
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
- RNF-10: El log y el almacenamiento local (alertas procesadas, posiciones abiertas)
  deben tener permisos 0600, legibles solo por el usuario del proceso.

## Criterios de Aceptación
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
- AC-27 (RNF-02): Dado el repositorio, cuando se corre gitleaks sobre el árbol de
  trabajo y todo el historial, entonces reporta 0 hallazgos.
- AC-28 (RNF-08): Dada la API key de Binance de producción configurada, cuando se
  revisan sus permisos en Binance, entonces el retiro de fondos está deshabilitado y
  solo está habilitado el trading.
- AC-29 (RNF-03): Dado el directorio de sesión de WhatsApp, cuando se revisan su
  contenido, sus permisos y el .gitignore, entonces ningún archivo contiene en texto
  plano el número de teléfono vinculado, el directorio tiene permisos 0700 y está
  excluido del repo.
- AC-31 (RNF-05): Dado el proceso corriendo, cuando se lo termina abruptamente,
  entonces vuelve a estar ingiriendo mensajes en < 60 s.
- AC-32: (Retirado junto con RNF-06.)
- AC-47 (RNF-04): Dada una conexión activa a WhatsApp o a Binance, cuando se corta,
  entonces el sistema registra la interrupción en < 30 s, reintenta con esperas de 1 s,
  2 s, 4 s… hasta 60 s, y al 10.º intento fallido consecutivo registra un evento
  crítico.
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
- Riesgo financiero: el sistema coloca operaciones reales y apalancadas en modo LIVE →
  mitigación: los límites de apalancamiento y tamaño de posición (RF-15) y una
  política manual de habilitación: antes de operar en LIVE, el operador corre el
  sistema al menos 7 días corridos y 20 alertas procesadas en DRY, con 0 errores de
  clasificación (LONG/SHORT/rechazo) contra revisión manual. El sistema no controla
  esta política.
- Riesgo: al ser un único proceso corriendo en una máquina sin redundancia, una caída
  del host detiene toda la ingesta → mitigación: reinicio automático del proceso
  (RNF-05).
- Dependencias:
  - whatsapp-web.js.
  - Binance Demo Trading (demo.binance.com) (modo DRY).
  - Cuenta de Binance con API key habilitada solo para trading (sin permiso de
    retiro).
