# Mosaik

Junta automáticamente las métricas de aprendizaje de alemán de varias herramientas (Anki,
GameSentenceMiner, Deuchan) en una base local y las muestra en un dashboard que cruza los datos.
Todo corre en esta computadora: el servidor escucha solo en `127.0.0.1` y ningún dato sale de la máquina.

- Guía para agentes y reglas del proyecto: [`AGENTS.md`](AGENTS.md)
- Plan, investigación de cada fuente y fases: [`docs/plan.md`](docs/plan.md)
- Contrato de ingesta para fuentes que empujan datos (Deuchan): [`docs/ingest-api.md`](docs/ingest-api.md)

## Estado

**Fase 0 (esqueleto)**: hub con API de salud, migraciones, programador de conectores (todavía sin
conectores) y un dashboard mínimo. Los conectores llegan en las fases siguientes: Anki (1),
GameSentenceMiner (2), Deuchan (3).

## Requisitos

- Node.js 24 o más nuevo (trae `node:sqlite`, con FTS5).
- npm 11.

## Uso

```bash
npm install
npm run dev
```

- Dashboard (Vite, con recarga en caliente): <http://127.0.0.1:5173>
- Hub: <http://127.0.0.1:7300/api/health>

Vite le pasa al hub todo lo que va a `/api`, así que en desarrollo se usa el puerto 5173.
`Ctrl+C` corta los dos.

Para usarlo "en serio" (sin Vite, todo desde el hub):

```bash
npm run build
npm start
```

y abrir <http://127.0.0.1:7300>.

## Comandos

| Comando | Qué hace |
|---|---|
| `npm run dev` | Hub (se reinicia al guardar) + dashboard con Vite |
| `npm run build` | Compila `shared` y `hub` a `dist/` y arma el dashboard en `packages/web/dist` |
| `npm start` | Corre el hub compilado, que también sirve el dashboard |
| `npm test` | Tests (Vitest) |
| `npm run typecheck` | TypeScript del hub y de los tests, y `svelte-check` del dashboard |
| `npm run lint` | ESLint |
| `npm run format` / `npm run format:check` | Prettier (los `.md` quedan fuera) |

## Configuración

Por variables de entorno o un archivo `.env` en la raíz (copiar [`.env.example`](.env.example)).
Todas son opcionales:

| Variable | Por defecto | Para qué |
|---|---|---|
| `HUB_PORT` | `7300` | Puerto del hub (siempre en `127.0.0.1`) |
| `HUB_DB_PATH` | `%LOCALAPPDATA%\Mosaik\mosaik.db` | Base propia de Mosaik |
| `GSM_DB_PATH` | `%APPDATA%\GameSentenceMiner\gsm.db` | Base de GSM, que se abre solo para leer |
| `ANKICONNECT_URL` | `http://127.0.0.1:8765` | AnkiConnect |
| `DAY_CUTOFF_HOUR` | `4` | Hora local en la que empieza un día (como Anki) |
| `TZ_NAME` | `America/Buenos_Aires` | Zona horaria para calcular los días |
| `SYNC_INTERVAL_MINUTES` | `5` | Cada cuánto corren los conectores |
| `LOG_LEVEL` | `info` | `fatal` … `trace`, o `silent` |

## API (por ahora)

| Método y ruta | Respuesta |
|---|---|
| `GET /api/health` | `{ status, name: "mosaik", version, schemaVersion, now }` |
| `GET /api/sources` | Estado de cada conector: última corrida, último OK, último error, resumen |
| `POST /api/sync` | Corre todos los conectores ahora |
| `POST /api/sync/:source` | Corre uno; `404` si no existe |

El hub rechaza pedidos cuyo `Host` no sea esta computadora (contra DNS rebinding) y los cambios
(`POST`) que vengan de otras páginas web. No manda cabeceras CORS.

## Estructura

```
packages/
  shared/      tipos y esquemas compartidos (zod): API, eventos de ingesta, cálculo del día
  hub/         servidor Fastify, base SQLite, migraciones, programador, conectores
    migrations/  SQL numerado; se aplica al arrancar y nunca se edita lo ya aplicado
  web/         dashboard (Svelte 5 + Vite)
docs/
  plan.md
  ingest-api.md
```

En desarrollo, Node 24 corre el TypeScript del hub directo (sin compilar); por eso los imports
llevan extensión `.ts` y solo se usa sintaxis que se puede borrar (nada de `enum`).
