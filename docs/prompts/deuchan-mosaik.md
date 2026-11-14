# Tarea: que Deuchan mande sus datos a Mosaik (hub local)

Trabajás en **Deuchan**, una extensión de Chrome (Manifest V3) que cuenta el tiempo que el usuario mira
videos en alemán en YouTube. Repo: `github.com/joaquinmuzzi/Deuchan` (público, publicada en la Chrome Web
Store). El objetivo es agregarle una opción para que mande sus datos a **Mosaik**, una app local del
mismo usuario que junta métricas de aprendizaje de idiomas (Anki, juegos, YouTube) en un dashboard.
Mosaik vive en otro repo que no vas a ver: todo lo que necesitás de él está en este documento.

Hablá con el usuario en español. Código, comentarios, commits y textos de la interfaz, en inglés (como el
resto de Deuchan).

## Antes de empezar

1. Cloná el repo en una carpeta nueva y creá una rama desde `main` (por ejemplo `feat/mosaik-export`).
   `C:\Users\Joaquín Muzzi\Documents\Deuchan` es una copia suelta de la carpeta `extension/` (no es un repo
   git; probablemente es la que está cargada en Chrome): **no la toques**.
2. Leé `CONTRIBUTING.md` y seguilo: Conventional Commits, commits atómicos con sus tests, el trailer
   `Assisted-by: <herramienta>:<modelo>` en cada commit, `npm run lint`, `npm run format:check` y `npm test`.
3. Leé `extension/src/background.js`, `coverage.js`, `videos.js`, `log.js`, `corrections.js`,
   `sync-data.js`, `sync-runner.js`, `extension/dashboard/dashboard.js` y `sync-panel.js`, y
   `tests/manifest.test.js`. Lo que sigue lo verifiqué en `main` el 2026-11-14; si algo cambió, manda el
   código.

## Lo que hay hoy

- `content.js` manda cada ~2 s `{ type: "watched", intervals: [{ from, to }], video: { id, title } }`.
  `from` y `to` son **segundos epoch con decimales**.
- `background.js` es el único que escribe el log, con una cola de un solo escritor (`queue` / `enqueue`).
  `save()` filtra con `isValidInterval`, pasa cada intervalo por `addCoverage` (que devuelve `newSeconds`:
  la parte que no estaba contada, porque dos pestañas sonando a la vez cuentan una sola vez), y suma al log
  del día (`dayKey`, día local que corta a medianoche) y a `videos` (`addVideoSeconds`, ignora videos sin ID).
- Correcciones del usuario: `correct(day, seconds)` y `removeFromDay(day, videoId)`.
- Lo que muestra el dashboard para un día es `effectiveLog(migrate(log), others).days[day]` (incluye las
  correcciones y el tiempo de otras computadoras sincronizadas).
- `sync-runner.js` es el modelo a copiar: recibe `storage`, `alarms`, `fetchImpl` y `now` desde afuera, así
  se testea sin navegador; serializa sus rondas y usa alarmas de `chrome.alarms`.
- `manifest.json`: `permissions: ["storage", "alarms"]`, `host_permissions` solo con el servidor de sync.

## Qué hay que construir

Una opción **"Send to Mosaik"**, **apagada por defecto**. Prendida, la extensión manda al hub local:

1. **intervalos vistos** (`watch_interval`): el detalle de a qué hora se miró qué video;
2. **fotos del total del día** (`day_total`): lo que muestra el dashboard de Deuchan, con correcciones;
3. **videos quitados de un día** (`video_removed`);

y, a pedido, un **backfill** del historial. Nada sale de la computadora: solo se habla con
`http://127.0.0.1:<puerto>` o `http://localhost:<puerto>`.

## Contrato con Mosaik

No lo cambies por tu cuenta. Si algo no cierra, explicalo en el resumen final.

> El endpoint de ingesta todavía **no existe** (Mosaik lo implementa en su fase 3; hoy contesta `404`).
> Programá contra este contrato y probalo con un `fetch` falso o un servidor HTTP de prueba en los tests.
> `GET /api/health` sí existe.

**Descubrir el hub:** `GET {url}/api/health` → `200 { "status": "ok", "name": "mosaik", "version": "…", "schemaVersion": 1, "now": … }`.
Comprobá `name === "mosaik"`. URL por defecto: `http://127.0.0.1:7300`.

**Mandar:** `POST {url}/api/ingest/events`, `Content-Type: application/json`, cuerpo `{ "events": [...] }` con
**1 a 500** eventos. El hub acepta pedidos con `Origin: chrome-extension://…` (lo que manda el service
worker). No hay CORS; con permiso de host no hace falta.

**Reglas de todos los eventos:**
- `id` string único (≤ 200 caracteres) elegido por la extensión. El hub **ignora un id repetido**, así que
  reenviar es seguro, pero **un evento con un id dado no puede cambiar nunca**.
- Horas en **milisegundos epoch UTC, enteros**. Convertí los segundos de Deuchan con `Math.round(s * 1000)`.
- `language`: `"de"`.

**`watch_interval`** — un tramo continuo de un video:
`{ id, source: "deuchan", kind: "watch_interval", language, from, to, seconds, videoId, title?, channelId? }`
- `to > from`; `seconds` = tiempo acreditado (suma de `newSeconds`), `0 < seconds ≤ 21600` y nunca mayor
  que `(to - from) / 1000` (hay 1 s de tolerancia); `videoId` de 11 caracteres `[A-Za-z0-9_-]`;
  `title` ≤ 500.

**`day_total`** — foto del total de un día:
`{ id, source: "deuchan", kind: "day_total", language, day: "YYYY-MM-DD", at, seconds, videos?: [{ videoId, title, seconds }] }`
- `day` es el día de Deuchan (medianoche local). `at` = cuándo se sacó la foto. `seconds` entre 0 y 90000,
  igual a lo que muestra el dashboard ese día. `videos` ≤ 200 elementos (los de `dayVideos(videos, day)`).
- Por cada `day` el hub se queda con la foto de `at` más nuevo, así que **cada foto lleva un id nuevo**:
  `deuchan:day:<day>:<at>`.

**`video_removed`** — el usuario sacó un video de un día:
`{ id, source: "deuchan", kind: "video_removed", day, at, videoId }`, id `deuchan:rm:<day>:<videoId>:<at>`.

**Respuesta:** `200 { "accepted": n, "duplicates": n, "rejected": [{ "index", "id", "error" }] }`. Con un
`200`, **todos** los eventos del lote quedaron resueltos: salen de la cola (los `rejected` nunca se van a
aceptar; se descartan y se cuentan para mostrar el último error).

| Respuesta | Qué hacer |
|---|---|
| error de red / timeout (5 s) | conservar la cola, estado "Mosaik is not running", reintentar en la próxima alarma |
| `400` | bug de la extensión: conservar, mostrar el error |
| `403` | conservar, mostrar el error |
| `404` | conservar, avisar que Mosaik todavía no recibe datos (hay que actualizarlo) |
| `413` | reintentar con lotes de la mitad de tamaño |
| `5xx` | conservar, reintentar |

Ejemplo de lote válido:

```json
{
  "events": [
    { "id": "deuchan:iv:1b0e4c8e-7a51-4c52-9d0b-2f3c4a5b6c7d", "source": "deuchan", "kind": "watch_interval",
      "language": "de", "from": 1794670000000, "to": 1794670418000, "seconds": 417.6,
      "videoId": "dQw4w9WgXcQ", "title": "Easy German 500" },
    { "id": "deuchan:day:2026-11-14:1794670420000", "source": "deuchan", "kind": "day_total", "language": "de",
      "day": "2026-11-14", "at": 1794670420000, "seconds": 5430,
      "videos": [{ "videoId": "dQw4w9WgXcQ", "title": "Easy German 500", "seconds": 1200 }] }
  ]
}
```

## Diseño pedido

Seguí el estilo de Deuchan: la lógica en módulos sin APIs del navegador, testeados con `node:test`; las
dependencias (`storage`, `alarms`, `permissions`, `fetchImpl`, `now`, `randomUUID`) inyectadas. Nombres
orientativos; si encontrás una forma mejor que encaje con el código, usala y explicá por qué.

### 1. `extension/src/mosaik-events.js` (funciones puras)

**Juntar intervalos.** Mandar cada medición de 2 s sería un evento cada 2 s. La cola (`outbox`) tiene un
evento **abierto** y una lista de eventos **cerrados**:

- Para cada intervalo con `newSeconds > 0` y video con ID: si hay un abierto **del mismo video**, el
  intervalo empieza a **≤ 30 s** del `to` del abierto y el abierto dura **< 10 min**, se extiende
  (`to = max(to, nuevo to)`, `seconds += newSeconds`). Si no, el abierto se cierra (pasa a la lista) y se
  abre uno nuevo con `id = "deuchan:iv:" + randomUUID()`.
- El tope de 10 min hace que los eventos fluyan aunque se mire un video largo sin pausa.
- Un abierto sin intervalos nuevos hace más de 30 s se cierra al hacer flush. **Solo se mandan eventos
  cerrados**: así ninguno cambia después de enviado.
- Intervalos sin video o con `newSeconds <= 0` no generan evento (el total del día igual los incluye vía
  `day_total`).

Además: armar `day_total` y `video_removed`, armar el backfill (una foto por cada día que muestre el
dashboard, con `videos` cuando los haya: Deuchan guarda videos solo de los últimos 60 días), y tomar un lote
de la cola.

### 2. `extension/src/mosaik-client.js`

`checkHealth({ baseUrl, fetchImpl })` y `sendBatch({ baseUrl, events, fetchImpl, timeoutMs })`, que
clasifican la respuesta según la tabla de arriba (`ok` con contadores, `retry`, `outdated`, `forbidden`,
`too-large`, `bad-request`). Validar la URL: solo `http:` con host `127.0.0.1` o `localhost`; cualquier otra
cosa se rechaza al guardarla.

### 3. `extension/src/mosaik-runner.js` (como `sync-runner.js`)

Guarda en `chrome.storage.local`, por ejemplo:
- `mosaikSettings`: `{ enabled, url }` (apagado por defecto);
- `mosaikOutbox`: `{ open, queued }`;
- `mosaikSentDays`: `{ "<day>": seconds }`, el último total mandado de cada día;
- `mosaikState`: `{ status, lastSentAt, lastError, pending, rejected, hubVersion }` para el panel;
- `mosaikBackfilledAt`.

Alarma periódica (`deuchan-mosaik`, cada 1 min) solo mientras esté prendido. Cada flush, uno por vez:
1. cierra el abierto si está inactivo;
2. por cada día que cambió (hoy, ayer y los corregidos), si su total difiere de `mosaikSentDays`, encola una
   `day_total` nueva;
3. manda lotes de hasta 200 y procesa la respuesta.

**Cuidado con las carreras.** `save()` agrega intervalos mientras un flush espera la red. Todas las
escrituras de la cola pasan por la cola de un solo escritor de `background.js`: tomar el lote (en la cola)
→ `fetch` (fuera de la cola) → releer la cola y sacar lo enviado **por id** (en la cola). Nunca escribir una
copia vieja de la cola encima de una nueva. El service worker puede morir en cualquier momento: el evento
abierto también vive en `storage`, no en memoria.

Tope de la cola: unos 5000 eventos. Si se llena (hub apagado durante semanas), descartar primero los
`watch_interval` más viejos y avisarlo en el estado; las `day_total` mantienen bien los totales.

### 4. Integración en `background.js`

- En `save()`, dentro de la misma escritura (mismo `chrome.storage.local.get`/`set`), pasar cada intervalo
  con su `newSeconds` y el video por la cola de Mosaik, **solo si la opción está prendida**.
- En `correct()` marcar el día para mandar su foto nueva; en `removeFromDay()` encolar `video_removed` y
  marcar el día.
- Controles nuevos para la página del dashboard, con el mismo chequeo que `CONTROLS` (solo páginas de la
  extensión): `mosaik:enable` (con URL), `mosaik:disable`, `mosaik:test`, `mosaik:backfill`, `mosaik:send-now`.
- Apagar la opción para las alarmas, deja de encolar y vacía la cola.

### 5. Permisos

- `manifest.json`: `"optional_host_permissions": ["http://127.0.0.1/*", "http://localhost/*"]` (un patrón sin
  puerto vale para cualquier puerto). **No** lo agregues a `host_permissions`: la extensión está publicada y
  sumar un permiso obligatorio le muestra un aviso a todos los usuarios.
- Al prender la opción (click del usuario en el dashboard) pedir `chrome.permissions.request` para el
  origen de la URL. Si lo niega, la opción queda apagada. Antes de cada flush, `chrome.permissions.contains`;
  si falta, estado "permission missing" y no se manda nada.
- Averiguá si la versión actual de Chrome exige algo más para que el service worker de una extensión con
  permiso de host le hable a `127.0.0.1` (Local Network Access / Private Network Access). Lo esperable es que
  no, pero verificalo y contá lo que encontraste.

### 6. Panel en el dashboard

Un panel como el de sync (`sync-panel.js`), en inglés: interruptor, campo de URL (por defecto
`http://127.0.0.1:7300`), botón **Test connection** (muestra la versión del hub o el error), botón
**Send history** (backfill), y el estado: eventos pendientes, último envío, último error, rechazados.
Al prender la opción por primera vez, hacer el backfill solo (y guardar `mosaikBackfilledAt`).

### 7. Documentación

Actualizá `PRIVACY.md` y el `README.md`: la opción es local, está apagada por defecto, qué campos manda
(IDs y títulos de videos, horas, totales) y a dónde (solo a la propia computadora). Revisá si
`docs/store-listing.md` o el `CHANGELOG.md` piden un cambio.

## Tests (con `node:test`)

- Juntar intervalos: mismo video con hueco de 30 s (se junta) y de 31 s (no); cambio de video; tope de
  10 min; `newSeconds` 0; video sin ID; conversión a ms; `seconds ≤ (to - from) / 1000`.
- Fotos: solo se encola cuando el total cambió; una corrección encola la foto de ese día; ids distintos por
  foto; el total es el del dashboard.
- Backfill: una foto por día, en lotes de ≤ 500, con `videos` donde los haya.
- Runner con `storage`, `alarms`, `permissions` y `fetch` falsos: con el hub apagado los eventos esperan y
  se mandan al volver; los `duplicates` y `rejected` salen de la cola; `404` conserva y avisa; `413` parte el
  lote; apagado no encola ni manda; sin permiso no manda; un `save()` durante un flush no pierde eventos.
- Cliente: cada código de la tabla; URL que no es local, rechazada.
- Contrato: cada evento que genera la extensión cumple las reglas de arriba (podés escribir un validador
  chico en el test, sin dependencias nuevas), y el ejemplo de este documento como fixture.
- `tests/manifest.test.js`: `optional_host_permissions` y que `host_permissions` no cambió.

## Terminado cuando

- `npm run lint`, `npm run format:check` y `npm test` en verde.
- Con la opción apagada, la extensión se comporta exactamente como antes (sin pedidos de red nuevos).
- Con el hub apagado los eventos esperan, y se mandan solos cuando vuelve.
- Los `day_total` coinciden con lo que muestra el dashboard de Deuchan.
- Probaste a mano con la extensión cargada (`chrome://extensions` → *Load unpacked* → carpeta
  `extension`) contra un servidor de prueba en `127.0.0.1:7300` que imprima lo que recibe y conteste
  `{ accepted, duplicates, rejected }` (no lo commitees salvo como ayuda de los tests).

Al final mostrale al usuario: qué cambió, qué corriste, un lote de ejemplo real de los que manda la
extensión, y cualquier punto del contrato que no encajó. **No hagas push ni abras el PR sin que el usuario
lo confirme.**
