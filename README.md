# zeia-ia-v2

Agente de atencion al cliente (ZeIA) que consulta la base de datos de energia (PostgreSQL) via OpenRouter.

## Setup

```bash
bun install
cp .env.example .env   # pega tu OPENROUTER_API_KEY
```

## Uso

Chat interactivo por terminal:

```bash
bun run chat
```

Servidor HTTP (POST `{"message": "...", "scope_enterprise_ids": [3]}` a `/chat`):

```bash
bun run server
```

Prueba de consultas a la BD sin LLM:

```bash
bun run db-test
```

## Arquitectura

- `src/config.ts` - variables de entorno
- `src/db.ts` - cliente Postgres (usuario solo lectura `zeia_agent`)
- `src/queries.ts` - consultas SQL reales
- `src/tools.ts` - herramientas del agente + filtro por empresa
- `src/agent.ts` - loop del agente (OpenRouter, OpenAI SDK)
- `src/main.ts` - CLI
- `src/server.ts` - API HTTP
