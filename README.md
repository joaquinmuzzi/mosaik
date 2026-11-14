# Mosaik

Junta automáticamente las métricas de aprendizaje de alemán de varias herramientas (Anki,
GameSentenceMiner, Deuchan) en una base local y las muestra en un dashboard que cruza los datos.
Todo corre en esta computadora: el servidor escucha solo en `127.0.0.1` y ningún dato sale de la máquina.

- Guía para agentes y reglas del proyecto: [`AGENTS.md`](AGENTS.md)
- Plan, investigación de cada fuente y fases: [`docs/plan.md`](docs/plan.md)
- Contrato de ingesta para fuentes que empujan datos (Deuchan): [`docs/ingest-api.md`](docs/ingest-api.md)

## Estado

- **Fase 0 (esqueleto)**: hub con API de salud, migraciones, programador de conectores y un dashboard mínimo.
- **Fase 1 (Anki)**: con Anki abierto, el hub copia notas, tarjetas y repasos de `German Mining` y
  `Refold Alemán-mil` al arrancar y cada 5 minutos, solo leyendo. Con Anki cerrado anota el error y
  reintenta. La fuente aparece en el dashboard con su resumen y un botón para sincronizar.

- **Fase 2 (GameSentenceMiner)**: el hub lee `gsm.db` sin escribir nada (ni crear archivos al lado),
  copia líneas, juegos y pausas, y calcula sesiones y tiempo de lectura con el mismo algoritmo que GSM
  (da exactamente lo mismo). Las líneas quedan indexadas para el buscador de oraciones, y las tarjetas
  minadas desde GSM quedan atribuidas a su juego y a su línea.

- **Fase 3 (Deuchan)**: el hub recibe los eventos de la extensión en `POST /api/ingest/events`: videos,
  sesiones y el total de cada día tal como lo muestra Deuchan. Las tarjetas minadas mientras se miraba un
  video quedan atribuidas a ese video. En Deuchan se prende con "Send to Mosaik", en su dashboard.

- **Fase 4 (dashboard v0)**: Inicio (hoy, 7 días, racha, inmersión y repasos por día), la página de cada día
  (cada número con su explicación y su detalle), Anki por origen de las tarjetas (retención y maduras) y Fuentes.

- **Fase 5 (contenido y buscador)**: la lista de juegos y videos, la ficha de cada uno (tiempo por día,
  tarjetas con su oración, sesiones, últimas oraciones) y el buscador de todo lo leído en GSM.

- **Fase 6 (validación y arranque)**: los números se comparan con los de Anki, GSM y Deuchan (ver
  `docs/plan.md`), y el hub puede arrancar solo al iniciar sesión en Windows.

## Arranque con Windows

```bash
npm run autostart:install
```

Compila y crea la tarea programada "Mosaik" de tu usuario (no hace falta ser administrador): al iniciar sesión
arranca el hub sin ventana, con los logs en `%LOCALAPPDATA%Mosaikhub.log`. El dashboard queda en
<http://127.0.0.1:7300>. Después de actualizar Mosaik, volvé a correr ese comando para recompilar.

- `npm run autostart:status`: si la tarea existe y si el hub responde.
- `npm run autostart:uninstall`: la para y la borra.

Para desarrollar con `npm run dev`, pará antes la tarea (los dos usan el puerto 7300), en PowerShell:
`Stop-ScheduledTask -TaskName Mosaik`.

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
| `npm run verify:anki` | Con Anki abierto: sincroniza y compara los repasos por día con las estadísticas de Anki (`-- --no-sync` para solo comparar) |
| `npm run autostart:install` / `:status` / `:uninstall` | Arranque automático con Windows (ver arriba) |
| `npm run verify:gsm` | Sincroniza con `gsm.db` y compara el tiempo de lectura con los totales diarios de GSM (`-- --no-sync` para solo comparar) |

## Configuración

Por variables de entorno o un archivo `.env` en la raíz (copiar [`.env.example`](.env.example)).
Todas son opcionales:

| Variable | Por defecto | Para qué |
|---|---|---|
| `HUB_PORT` | `7300` | Puerto del hub (siempre en `127.0.0.1`) |
| `HUB_DB_PATH` | `%LOCALAPPDATA%\Mosaik\mosaik.db` | Base propia de Mosaik |
| `GSM_DB_PATH` | la de GSM: `%APPDATA%\GameSentenceMiner\gsm.db`, o la carpeta de `data_dir.json` | Base de GSM, que se abre solo para leer; su `config.json` se lee de la misma carpeta |
| `ANKICONNECT_URL` | `http://127.0.0.1:8765` | AnkiConnect |
| `ANKI_DECKS` | `German Mining,Refold Alemán-mil` | Mazos que se leen (con sus submazos), separados por coma |
| `ANKI_REFOLD_DECKS` | `Refold Alemán-mil` | De esos, los mazos armados: sus tarjetas cuentan como `refold-1k` |
| `DAY_CUTOFF_HOUR` | `4` | Hora local en la que empieza un día (como Anki) |
| `TZ_NAME` | `America/Buenos_Aires` | Zona horaria para calcular los días |
| `SYNC_INTERVAL_MINUTES` | `5` | Cada cuánto corren los conectores |
| `TARGET_LANGUAGE` | `de` | Idioma que se aprende: solo sus sesiones cuentan como inmersión |
| `LOG_LEVEL` | `info` | `fatal` … `trace`, o `silent` |

## API (por ahora)

| Método y ruta | Respuesta |
|---|---|
| `GET /api/health` | `{ status, name: "mosaik", version, schemaVersion, now }` |
| `GET /api/sources` | Estado de cada conector: última corrida, último OK, último error, resumen |
| `POST /api/sync` | Corre todos los conectores ahora |
| `POST /api/sync/:source` | Corre uno; `404` si no existe |
| `POST /api/ingest/events` | Recibe eventos de fuentes que empujan (Deuchan); ver [`docs/ingest-api.md`](docs/ingest-api.md) |
| `GET /api/overview?days=30` | Un resumen por día (juegos, YouTube, repasos, tarjetas minadas) y la racha |
| `GET /api/days/:day` | El detalle de un día, fuente por fuente |
| `GET /api/anki` | Tarjetas y retención por origen, y la evolución por semana |
| `GET /api/contents` | Juegos y videos con su tiempo, sesiones y tarjetas |
| `GET /api/contents/:id` | La ficha de un contenido |
| `GET /api/search?q=` | Oraciones leídas que contienen el texto (3 letras como mínimo) |

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
