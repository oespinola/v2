# AGENTS.md

## Propósito
SignalBridge lee alertas de trading de un grupo de WhatsApp (texto + imagen), las valida
y carga automáticamente como órdenes long/short (entrada, SL, TP) en Binance Futuros.

## Stack
- Node.js 22 LTS
- pnpm (gestor de paquetes)
- Vitest (test runner)
- whatsapp-web.js (ingesta de WhatsApp) + CCXT (Binance Futuros) + API de Anthropic Claude (parseo texto/imagen)

## Cómo correr
```bash
pnpm install       # instalar dependencias
pnpm dev           # levantar en modo DRY (órdenes contra Binance Futures Testnet/Demo)
pnpm start         # levantar en modo LIVE (órdenes reales en Binance)
pnpm test          # correr tests
```

## Commits en el proyecto
- Es muy importante realizar commits a medida que vamos modificando cosas.
- Antes de realizar un commit es necesario validar que el software funcione o no
  deje de compilar.

## Qué NO hacer
- No commitear la sesión de WhatsApp (auth local) ni ninguna API key al repo: `ANTHROPIC_API_KEY`
  y las credenciales de Binance se leen solo de variables de entorno (RNF-02, RNF-03).
- No habilitar permiso de retiro de fondos en la API key de Binance: debe tener únicamente
  permiso de trading (RNF-02).
- No colocar la entrada sin garantizar SL y TP: si la entrada se ejecuta y falla la
  colocación de SL o TP, hay que cerrar la posición de inmediato en vez de dejarla
  desprotegida (RF-10, RF-18).
