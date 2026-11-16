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

- **Estadísticas y exportación**: la página Estadísticas, con todo el historial, muestra destacados (lo que más
  tiempo, sesiones, caracteres y tarjetas tuvo, el mejor día y las rachas más largas), el ritmo de la semana
  (promedio y mediana por día) y una tabla por semana, mes o año con el cambio respecto del período anterior.
  En Fuentes se bajan los días, la biblioteca y las tarjetas como CSV, y una copia completa de la base.

## Servidor en internet (opcional)

Para usar Mosaik desde varias computadoras: el hub corre en un servidor (`MOSAIK_MODE=server`, por ejemplo en
Railway con el `Dockerfile` de este repo y un volumen en `/data`) y cada computadora corre un agente
(`MOSAIK_MODE=agent`) que le manda su Anki y su GSM. El plan y los detalles están en
[`docs/plan-servidor.md`](docs/plan-servidor.md). En resumen:

1. Servidor: variables `PUBLIC_URL` (su dirección https) y `SETUP_TOKEN` (un secreto largo); abrir la dirección y
   crear la cuenta con ese token. Una base que ya tengas se puede subir antes de crear la cuenta:
   `POST /api/admin/import` con `Authorization: Bearer <SETUP_TOKEN>` y el archivo de Fuentes → Exportar → Copia
   completa; toma su lugar al reiniciar el servidor.
2. En el servidor, Fuentes → Dispositivos: un token por computadora.
3. En cada computadora, en `.env`: `MOSAIK_MODE=agent`, `SERVER_URL` y `DEVICE_TOKEN`; después
   `npm run autostart:install`.

## Arranque con Windows

```bash
npm run autostart:install
```

Compila y crea la tarea programada "Mosaik" de tu usuario (no hace falta ser administrador): al iniciar sesión
arranca el hub sin ventana, con los logs en `%LOCALAPPDATA%\Mosaik\hub.log`. El dashboard queda en
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

## Capturas

`npm run screenshots` (con el dashboard corriendo) guarda una captura de cada página en `docs/screenshots/`.
Muestran tus datos reales, así que esa carpeta está en `.gitignore`.

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
| `YOUTUBE_THUMBNAILS` | apagado | `1` para pedirle a YouTube las miniaturas de los videos (una vez cada una) |
| `TARGET_LANGUAGE` | `de` | Idioma que se aprende: solo sus sesiones cuentan como inmersión |
| `LOG_LEVEL` | `info` | `fatal` … `trace`, o `silent` |
| `MOSAIK_MODE` | `local` | `server` para un servidor en internet (Railway): login, sin conectores propios |
| `PUBLIC_URL` | — | Modo servidor: la dirección que se abre (`https://…`); solo ese host recibe respuesta |
| `SETUP_TOKEN` | — | Modo servidor: secreto de un solo uso (16 caracteres o más) que crea la cuenta |
| `PORT` | — | Modo servidor: el puerto que da el hosting (si no, `HUB_PORT`) |
| `SERVER_URL` | — | Modo agente (`MOSAIK_MODE=agent`): el servidor al que manda (`https://…`) |
| `DEVICE_TOKEN` | — | Modo agente: el token de esta computadora (Fuentes → Dispositivos, en el servidor) |
| `AGENT_OUTBOX` | carpeta `outbox` junto a la base | Modo agente: donde esperan los lotes que no se pudieron mandar |

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
| `GET /api/stats` | Todos los días desde el primero con algo, y los destacados (récords y rachas) |
| `GET /api/export/days.csv` | Los días como CSV (también `contents.csv` y `cards.csv`) |
| `GET /api/export/backup` | Una copia completa de la base (SQLite), tomada sin parar el hub |
| `GET /api/auth/status` | Modo y sesión: `{ mode, authenticated, setupNeeded, username }` |
| `POST /api/auth/setup`, `/login`, `/logout` | Modo servidor: crear la cuenta (con `SETUP_TOKEN`), entrar y salir |
| `GET`/`POST /api/devices`, `DELETE /api/devices/:name` | Modo servidor: computadoras que mandan datos y sus tokens |
| `GET /api/agent/state?source=`, `POST /api/agent/batches`, `POST /api/agent/report` | Modo servidor, con token de dispositivo: lo que el agente necesita, sus lotes y las fuentes que no pudo leer |
| `GET /api/contents` | Juegos y videos con su tiempo, sesiones y tarjetas |
| `GET /api/contents/:id` | La ficha de un contenido |
| `PUT /api/contents/:id/cover` | Guarda la imagen enviada (PNG, JPEG, WebP o GIF, hasta 5 MB) como portada elegida |
| `DELETE /api/contents/:id/cover` | Quita la portada elegida y vuelve a la automática |
| `GET /api/covers/steam?q=` | Busca juegos en Steam para elegir portada (solo cuando se pide) |
| `POST /api/contents/:id/cover/steam` | Baja la portada del juego de Steam `{ appId }` y la guarda |
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
