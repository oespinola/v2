# Arquitectura de SignalBridge

Estado: ingesta y validación de alertas ([PRD-001](prd/PRD-001-ingesta-validacion.md)) implementadas
y probadas en vivo en modo DRY. La carga de órdenes ([PRD-002](prd/PRD-002-carga-reversion.md)) y el
seguimiento ([PRD-003](prd/PRD-003-seguimiento-cierre.md)) todavía no están implementados.

## 1. Contexto

Un único proceso Node lee el grupo de WhatsApp, valida cada alerta y la deja válida o rechazada con
un motivo. Habla con tres servicios externos y guarda todo en disco local.

```mermaid
flowchart LR
  WA["WhatsApp<br/>grupo ALERTAS CRYPTO+"]
  subgraph SB["SignalBridge (1 proceso Node)"]
    direction LR
    W["whatsapp.ts<br/>adaptador wwebjs"] --> M["main.ts<br/>cola de a 1"] --> P["pipeline.ts<br/>orden de RF-38"]
    P --> C["claude-extractor.ts"]
    P --> MD["market-data.ts<br/>símbolos + ranking"]
    P --> S["store.ts<br/>SQLite + JSONL"]
  end
  WA -- "QR / sesión local" --> W
  C -- "solo si el regex no alcanza" --> AN["API de Anthropic<br/>Sonnet 5.5"]
  MD -- "públicos, sin credenciales" --> BN["Binance Futuros USDS-M<br/>exchangeInfo · ticker 24 h · velas 1 h"]
  S --> D[("data/<br/>signalbridge.db · alerts.log")]
```

Idea guía: todo lo que habla con el exterior (WhatsApp, Binance, Claude, disco) es un **adaptador**
chico, y las reglas del PRD viven en **funciones puras** que no saben de dónde viene el dato. Así los
tests cubren cada criterio de aceptación sin red ni cuentas, en pocos segundos.

## 2. Módulos

```mermaid
flowchart TB
  subgraph ORQ["Orquestación"]
    direction LR
    main["main.ts<br/>pnpm dev / start"]
    replay["replay.ts<br/>pnpm replay"]
  end
  subgraph DOM["Dominio (lógica pura)"]
    direction LR
    filter["filter.ts<br/>RF-03 · RF-22"]
    extract["extract.ts<br/>regex → Claude · RF-17"]
    parser["parser.ts<br/>RF-09"]
    symbols["symbols.ts<br/>RF-31/32 · RF-37"]
    indicators["indicators.ts<br/>RF-24 · RF-36"]
    ranking["market-data.ts<br/>RF-23 · RF-21 · RF-04"]
  end
  subgraph ADP["Adaptadores (I/O)"]
    direction LR
    wa["whatsapp.ts"]
    cl["claude-extractor.ts"]
    bn["binance-public.ts"]
    st["store.ts"]
  end
  main --> wa
  main --> pipeline
  replay --> pipeline
  pipeline["pipeline.ts<br/>orden de RF-38 · ediciones"]
  pipeline --> DOM
  extract --> parser
  extract --> cl
  ranking --> bn
  pipeline --> st
```

| Módulo | Responsabilidad |
|---|---|
| `filter.ts` | Disparador "alerta de trading" sin mayúsculas ni tildes (RF-03) y remitentes autorizados (RF-22). |
| `parser.ts` | Extrae ticker, Entrada, objetivo, SL y riesgo con regex (RF-09). Devuelve lo que pudo sacar. |
| `claude-extractor.ts` | Respaldo con Claude Sonnet 5.5 y salida estructurada; completa solo los datos que faltan (RF-16). |
| `extract.ts` | Orquesta regex → Claude y decide "incompleta" (RF-17). Lo que saca el regex siempre manda. |
| `symbols.ts` | `TICKERUSDT` o `1000TICKERUSDT` (RF-31/32) y redondeo al tickSize (RF-37). |
| `indicators.ts` | EMA y WMA como en TradingView; TP por ASL21/EMA55 (RF-24/36). |
| `market-data.ts` | Copia local de símbolos y ranking top 3, refrescada cada 60 s (RF-23/21/04). |
| `store.ts` | Duplicados (RF-11/29), log de alertas (RF-05) y ediciones. |
| `pipeline.ts` | Aplica las validaciones en el orden de RF-38 y registra solo el primer motivo. |
| `whatsapp.ts` | QR, búsqueda del grupo, mensajes nuevos y ediciones. |
| `replay.ts` | Pasa capturas reales por el mismo pipeline, sin WhatsApp y con base en memoria. |

`main.ts` y `replay.ts` usan **el mismo pipeline**; solo cambia de dónde vienen los mensajes. Por eso
el replay prueba lo mismo que corre en vivo.

## 3. Flujo de una alerta

```mermaid
flowchart TD
  A["Mensaje del grupo"] --> F{"¿Contiene<br/>'alerta de trading'?"}
  F -- no --> IG["Ignorada<br/>(no se loguea)"]
  F -- sí --> R1{"1. ¿Remitente<br/>autorizado?"}
  R1 -- no --> X1["remitente no autorizado"]
  R1 -- sí --> R2{"2. ¿ID de WhatsApp<br/>ya registrado?"}
  R2 -- sí --> X2["duplicado"]
  R2 -- no --> R3{"3. Regex, y Claude<br/>si falta algo:<br/>¿datos completos?"}
  R3 -- no --> X3["incompleta"]
  R3 -- sí --> R4{"4. ¿Mismo hash<br/>en las últimas 24 h?"}
  R4 -- sí --> X4["duplicado"]
  R4 -- no --> R5{"5. ¿Existe TICKERUSDT<br/>o 1000TICKERUSDT?"}
  R5 -- no --> X5["ticker inexistente"]
  R5 -- sí --> R6{"6. ¿SL = Entrada?"}
  R6 -- sí --> X6["SL igual a la Entrada"]
  R6 -- no --> R7{"7. ¿SL a más del 15 %<br/>de la Entrada?"}
  R7 -- sí --> X7["SL fuera de rango"]
  R7 -- no --> R8{"8. TP de la alerta o ASL21/EMA55,<br/>ajustado al tick:<br/>¿del lado correcto?"}
  R8 -- no --> X8["TP inválido"]
  R8 -- sí --> R9{"9. ¿Ranking con<br/>más de 120 s?"}
  R9 -- sí --> X9["ranking no disponible"]
  R9 -- no --> R10{"10. ¿Símbolo en el top 3<br/>ganadores o perdedores?"}
  R10 -- sí --> X10["top 3 ganadores/perdedores"]
  R10 -- no --> OK["VÁLIDA<br/>símbolo · LONG/SHORT · Entrada · SL · TP"]
  OK -.-> P2["PRD-002: carga de órdenes<br/>(pendiente)"]
```

Cada resultado, válido o rechazado con su primer motivo, queda en SQLite y en `data/alerts.log`.

## 4. Secuencia en vivo

```mermaid
sequenceDiagram
  participant WA as WhatsApp
  participant W as whatsapp.ts
  participant M as main.ts (cola)
  participant P as pipeline.ts
  participant C as Claude
  participant B as Binance (público)
  participant S as store.ts

  Note over M,B: Al arrancar: símbolos + ranking, y refresco cada 60 s
  WA->>W: message_create (incluye mensajes propios)
  W->>M: IncomingMessage (remitente sin sufijo :1)
  M->>P: processMessage (de a uno por vez)
  P->>S: ¿ID de WhatsApp ya registrado?
  P->>P: regex (RF-09)
  opt si el regex no saca los 5 datos
    P->>C: texto + imagen
    C-->>P: datos faltantes
  end
  P->>S: ¿mismo hash en 24 h?
  opt si el objetivo es por indicadores
    P->>B: velas de 1 h (incluye la vela en curso)
    B-->>P: cierres → ASL21 / EMA55
  end
  P->>S: guardar resultado (SQLite + JSONL)
  P-->>M: válida o rechazada + motivo
  M->>M: una línea en la consola

  WA->>W: message_edit
  W->>M: IncomingEdit
  M->>P: processEdit
  P->>S: si el original ya se procesó: registrar la edición, sin operar
```

## 5. Datos

```text
data/                      (0700)
├── signalbridge.db        (0600)  SQLite
│     alerts(alert_id, wa_message_id, content_hash, received_at, status, reason, record JSON)
│     edits (alert_id, wa_message_id, edited_at, record JSON)
└── alerts.log             (0600)  una línea JSON por alerta o edición (tail -f, jq)
```

- `alert_id` = `<ID de WhatsApp>:<hash de 16 hex>` (RF-11).
- El hash usa `(ticker, Entrada, SL, TP)` tal como vienen en la alerta. Si el objetivo es por
  indicadores, entra como `"indicadores"` y no como el TP calculado.

## 6. Decisiones

| Decisión | Por qué |
|---|---|
| Regex primero, Claude solo de respaldo | Las 33 alertas reales capturadas parsean con regex en ~1 ms, gratis y sin variabilidad. Claude es más lento, cuesta y necesita API key. |
| Funciones puras + adaptadores | Las reglas del PRD se prueban sin WhatsApp, Binance ni Claude; los adaptadores se reemplazan por fakes. |
| Endpoints públicos de Binance con `fetch` | PRD-001 solo lee datos públicos sin credenciales (AC-30). CCXT entra con PRD-002, para operar. |
| Copia local de símbolos y ranking cada 60 s | Validar no espera a Binance (RNF-01). Si un refresco falla se conserva la copia anterior; RF-21 controla la antigüedad. |
| Velas solo si el TP es por indicadores | RF-24 pide la vela en curso; si la alerta trae precio, no se piden (AC-34). |
| Hash con el TP de la alerta | El TP calculado cambia con cada vela y un reenvío no se detectaría como duplicado. |
| Cola de a un mensaje por vez | Dos reenvíos simultáneos no pueden pasar juntos el control de duplicados. |
| SQLite (`node:sqlite`) + JSONL | SQLite para consultar duplicados sin dependencias extra; JSONL para auditar a ojo. |
| `umask 077` y permisos 0700/0600 | RNF-10: todo lo que crea el proceso lo lee solo su usuario. |
| Solo mensajes nuevos, sin releer el historial | Al reiniciar no se operan alertas viejas; RF-29 cubre los reenvíos. |
| `message_create` y remitente sin `:1` | Permite probar con mensajes propios, y el ID es el mismo desde cualquier dispositivo. |
| Búsqueda del grupo con `evaluate` | `getChats()` y `getChatById()` fallan con "r: r" en este grupo (visto en la v1). |
| SL a más del 15 % se rechaza (RF-50) | Ataja typos como AXS (Entrada 1.246, SL 0.1222). La alerta legítima más lejana estaba a 5,88 %. |
| Ediciones: se registran, no se operan | Gestionar una alerta ya procesada está fuera de alcance (PRD-000); queda para revisión manual. |
| Ante la duda, rechazar | Si Claude falla o se niega, si fallan las velas o si el ranking es viejo, la alerta se rechaza con motivo. |

## 7. Pendientes

- Descarga de imágenes de WhatsApp: `downloadMedia` falla con "r", así que el respaldo por imagen
  (RF-16) todavía no recibe imagen. Después se evalúa llamar a Claude en dos pasos (primero texto,
  después imagen).
- Cifrado de la sesión de WhatsApp (RNF-03): requisito antes de habilitar LIVE.
- Reconexión con backoff (RNF-04) y reinicio automático con systemd (RNF-05).
- Carga de órdenes en Binance (PRD-002) y seguimiento y cierre (PRD-003).
