# AGENTS.md

Guía para agentes de código (Claude Code y otros) que trabajen en este repositorio.
El plan completo, con la investigación de cada fuente, está en [`docs/plan.md`](docs/plan.md).
Leelo antes de empezar una fase nueva.

## Qué es este proyecto

Una app **local-first** que junta automáticamente las métricas de aprendizaje de idiomas de varias
herramientas y las muestra en un dashboard unificado, para no tener que anotar a mano lo que se hizo
cada día. El usuario aprende **alemán** con el método Refold, en **Windows**.

El valor no está solo en sumar horas sino en **cruzar datos**:

- de qué fuente (juego, video, libro) sale cada tarjeta de Anki;
- la retención de las tarjetas según de dónde vino la palabra;
- las horas de inmersión contra el progreso del vocabulario;
- en qué contexto real apareció una palabra (buscador de oraciones).

Nombre de trabajo del proyecto: `Mosaik`.

## Fuentes de datos (primer prototipo)

| Fuente | Cómo se lee | Datos clave |
|---|---|---|
| **Anki** | AnkiConnect, `http://127.0.0.1:8765`, solo con Anki abierto | Mazos `German Mining` (note types `Kiku` y `Kiku Deutsch`: palabra en `Expression`, origen en `MiscInfo`) y `Refold Alemán-mil`. Notas (`notesInfo`), estado de tarjetas (`cardsInfo`), repasos incrementales (`cardReviews(deck, startID)`). Ojo: `cardReviews` crea el mazo si no existe. |
| **GameSentenceMiner (GSM)** | SQLite `%APPDATA%\GameSentenceMiner\gsm.db`, **solo lectura** (ojo: `?mode=ro` igual crea `-wal`/`-shm`; ver `connectors/gsm/source.ts`) | `game_lines` (una fila por línea leída, con `timestamp`, `game_id`, `note_ids`, `last_modified`), `games`, `game_daily_rollup`, `stats_reading_breaks`. El tiempo se calcula con el algoritmo de GSM portado tal cual. |
| **Deuchan** (extensión de Chrome del usuario, repo `joaquinmuzzi/Deuchan`) | Push: la extensión manda eventos a `POST /api/ingest/events` (opción "Send to Mosaik", apagada por defecto) | `watch_interval`, `day_total` (lo de ese dispositivo ese día; el día suma los dispositivos) y `video_removed`, de YouTube o cualquier sitio (`itemId`, `url`), y lectura contada a mano. Cada Deuchan lee el total en `GET /api/agent/deuchan/days`. Contrato en `docs/ingest-api.md` y `packages/shared/src/ingest.ts`. |

Futuro: lectura (novelas, lectores web como ttu).

Los detalles (columnas, algoritmos, endpoints) están en `docs/plan.md`, sección 1.

## Reglas que no se rompen

1. **Nunca escribir en las fuentes.** `gsm.db` se abre en modo solo lectura (`file:...?mode=ro`, sin copiar el
   `.db` suelto: usa WAL). A Anki solo se le hacen acciones de lectura de AnkiConnect. Nada de `insertReviews`,
   `updateNoteFields`, etc.
2. **Todo local.** En modo `local` (el de siempre, por defecto) el servidor escucha solo en `127.0.0.1` y
   ningún dato sale de la máquina. Sin telemetría. Excepciones, siempre elegidas por el usuario:
   `YOUTUBE_THUMBNAILS=1` (apagado por defecto) pide las miniaturas de los videos a YouTube, una vez por video;
   `WEB_COVERS=1` (apagado por defecto) abre desde el hub la página de cada contenido que Deuchan contó fuera de
   YouTube para guardar su imagen; `STEAM_COVERS=1` (apagado por defecto) le manda a Steam el título de los juegos
   sin portada; el botón "Buscar en Steam" de la ficha de un contenido le manda a Steam el texto buscado, solo cuando se toca;
   y el modo `server` (`MOSAIK_MODE=server`, ver `docs/plan-servidor.md`), que existe solo si el usuario lo
   configura y recibe datos únicamente de sus propias computadoras, con login y tokens por dispositivo.
3. **Crudo primero.** Cada conector guarda los datos de su fuente tal como llegan (con sus IDs originales) en
   tablas `raw_*`. El modelo común y las métricas se derivan de ahí y se pueden recalcular.
4. **Idempotencia.** Correr un conector dos veces no duplica nada: upserts por ID de origen y un cursor por
   conector guardado en la base.
5. **Horas en UTC, un solo corte de día.** Se guardan timestamps UTC en ms. El "día" se calcula en la zona
   del usuario (America/Buenos_Aires) con un corte configurable, por defecto las 4:00 como Anki.
6. **Una fuente caída no rompe nada.** Si Anki está cerrado o GSM no existe, el conector registra el estado
   y reintenta en la próxima pasada; el dashboard muestra la última sincronización de cada fuente.
7. **No inventar datos.** Si una métrica no aplica a un medio (por ejemplo, velocidad de lectura en un video),
   no se muestra; no se estima.

## Stack

- **Node 24 + TypeScript** (ESM, `strict`). Mismo lenguaje que Deuchan, así los tipos de evento se comparten.
- **Servidor:** Fastify.
- **Base:** SQLite con `node:sqlite` (incluido en Node 24). Si da problemas, `better-sqlite3`.
  Migraciones SQL numeradas en `packages/hub/migrations/`.
- **Dashboard:** Vite + Svelte 5 + ECharts, servido como estático por el mismo hub.
- **Tests:** Vitest. **Lint/format:** ESLint + Prettier (como Deuchan).
- **Monorepo con npm workspaces:**

```
packages/
  shared/   tipos y esquemas compartidos (eventos de ingesta, modelo común); validación con zod
  hub/      servidor, conectores, programador, base, API
  web/      dashboard
docs/
  plan.md
```

## Arquitectura en una línea por pieza

- **Conectores pull** (el hub va a buscar): `anki`, `gsm`. Corren al arrancar, cada 5 minutos y a pedido
  (`POST /api/sync/:source`).
- **Conectores push** (la fuente avisa): `POST /api/ingest/events` recibe lotes de eventos validados con zod.
  Deuchan es el primero.
- **Capas en la base:** `raw_*` por fuente → modelo común (`contents`, `sessions`, `lines`, `cards`,
  `reviews`) → vistas o consultas de métricas. Ver `docs/plan.md`, sección 3.
- **API de lectura** para el dashboard bajo `/api/*`; el dashboard nunca lee la base directo.

## Comandos

```
npm install
npm run dev          # hub + web en modo desarrollo
npm run build
npm start            # hub compilado, que sirve el dashboard
npm test
npm run typecheck
npm run lint
npm run format
npm run verify:anki  # sincroniza con el Anki real y compara repasos por día (Anki abierto)
npm run verify:gsm   # sincroniza con el gsm.db real y compara con los totales diarios de GSM
npm run autostart:install  # compila y crea la tarea programada que arranca el hub al iniciar sesión
```

Variables de entorno (con valores por defecto razonables): `HUB_PORT` (7300), `HUB_DB_PATH`,
`GSM_DB_PATH`, `ANKICONNECT_URL`, `ANKI_DECKS`, `ANKI_REFOLD_DECKS`, `DAY_CUTOFF_HOUR` (4),
`TZ_NAME` (America/Buenos_Aires), `SYNC_INTERVAL_MINUTES` (5), `TARGET_LANGUAGE` (de), `LOG_LEVEL`. Ver `.env.example`.

## Convenciones

- Código, nombres, comentarios y mensajes de commit **en inglés** (como Deuchan). Con el usuario se habla
  **en español**.
- Funciones puras para la lógica (cálculo de sesiones, métricas, parseo) para poder testearlas sin red ni
  archivos; la E/S queda en los bordes.
- Cada conector tiene tests con fixtures: una `gsm.db` sintética creada en el test, respuestas de AnkiConnect
  grabadas en JSON, lotes de eventos de Deuchan.
- No commitear datos reales del usuario (bases, exports, capturas).
- Commits chicos y descriptivos. Una fase = una o varias PR/commits, no todo junto.

## Cómo trabajar

- Seguí las fases de `docs/plan.md`, sección 5, en orden. Cada fase tiene criterios de aceptación; no la des
  por terminada hasta cumplirlos y tener los tests en verde.
- Antes de suponer algo sobre una fuente, verificalo contra los datos reales del usuario (con su permiso) o
  contra el código de la herramienta. La sección 6 del plan lista lo que todavía no está verificado.
- Si algo del plan resulta falso al implementarlo, corregí `docs/plan.md` en el mismo commit.
- Cambios a Deuchan van en su propio repositorio (`joaquinmuzzi/Deuchan`), no acá.
