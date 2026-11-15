# Plan: Mosaik

Documento de referencia del proyecto. Las reglas de trabajo están en [`AGENTS.md`](../AGENTS.md).
Investigación hecha el 2026-11-14 leyendo el código de GameSentenceMiner, Deuchan y AnkiConnect.

## 0. Objetivo

Juntar automáticamente lo que el usuario hace para aprender alemán (Anki, juegos con GSM, YouTube con
Deuchan + asbplayer + Yomitan, y más adelante lectura) en una base local, y mostrarlo en un dashboard que
cruce los datos: de dónde salen las tarjetas, cómo se retienen según su origen, cuánta inmersión hay detrás
del progreso y en qué contexto apareció cada palabra.

## 1. Qué expone cada fuente

### 1.1 GameSentenceMiner (GSM)

- **Base:** `%APPDATA%\GameSentenceMiner\gsm.db`. Si el usuario cambió la carpeta de datos, la ruta está en
  `~/.config/GameSentenceMiner/data_dir.json` (campo `dataDir`; hay un puntero viejo con el mismo nombre en la
  carpeta por defecto). SQLite en modo **WAL**; no copiar el `.db` sin el `-wal`.
- **Abrirla sin escribir (verificado en la fase 2):** `?mode=ro` (o `readOnly`) **no alcanza**: si no existen
  `gsm.db-wal` y `gsm.db-shm`, SQLite los crea igual en la carpeta de GSM. El conector:
  - si los dos existen (GSM abierto), abre en solo lectura y ve lo que GSM todavía no pasó al archivo
    principal. SQLite anota en el `-shm` qué está leyendo (por eso cambia su fecha); es necesario para leer
    de forma consistente mientras GSM escribe, y no toca la base;
  - si no existen (GSM cerrado, todo está en el archivo principal), abre con `?immutable=1`: no crea ni
    bloquea nada.
- **Tablas útiles:**

| Tabla | Columnas relevantes | Uso |
|---|---|---|
| `game_lines` | `id` (texto), `game_name`, `game_id`, `line_text`, `timestamp` (epoch en segundos, float), `language`, `note_ids` (JSON: lista de IDs de notas de Anki), `screenshot_in_anki`, `audio_in_anki`, `translation`, `original_game_name`, `last_modified`, `created_at` | Fuente principal: una fila por línea leída. Sesiones, tiempo, caracteres, buscador de oraciones y vínculo línea → tarjeta. |
| `games` | `id`, `title_original`, `title_english`, `type`, `character_count`, `completed`, `deck_id`, `genres`, `tags`, `image` (base64) | Ficha del contenido. `character_count` permite estimar % completado. |
| `game_daily_rollup` | `date`, `game_id`, `total_characters`, `total_lines`, `total_cards_mined`, `total_reading_time_seconds` | Totales diarios de GSM, para comparar con lo nuestro. |
| `daily_stats_rollup` | sesiones, tiempo activo, velocidad, juegos empezados/terminados por día | Igual, global. |
| `stats_reading_breaks` | pausas marcadas a mano (timestamps) | Respetarlas al calcular tiempo. |
| `third_party_stats` | `date`, `characters_read`, `time_read_seconds`, `source`, `label` | Lectura cargada por fuera (mokuro, manual). Útil para la fase de lectura. |
| `anki_notes`, `anki_cards`, `anki_reviews` | copia de Anki | **No usar**: leemos Anki directo. |
| `words`, `word_occurrences`, `kanji*` | tokenización japonesa (MeCab/Sudachi) | En GSM 2026.11 no existen. |
| `archived_game_days` | días archivados por GSM (eventos comprimidos por línea) | Si GSM archiva un día, sus líneas salen de `game_lines` pero siguen contando. |

- **Verificado en el `gsm.db` real (2026-11-14, GSM 2026.11.0):**
  - `timestamp` es REAL (segundos con decimales); `last_modified` y `created_at` son TEXT con segundos epoch.
    GSM **edita** líneas después de crearlas (llena `note_ids` al minar): el conector compara por
    `last_modified`, no por hora.
  - `note_ids` es un JSON de **strings** (`["1794636870987"]`) y se llena al minar desde TextFeed con Yomitan.
  - `language` es la configuración de GSM al leer la línea, no una detección: las primeras líneas de Ace Attorney
    quedaron en `ja` hasta que se cambió el idioma. Las del 2026-08-26 sí son japonés (una prueba).
  - Los "juegos" son escenas de OBS: también ventanas del navegador ("… - YouTube - Brave").
    `character_count` está en 0 (no hay % completado) y `type` vacío.
  - `config.json` (en la carpeta de datos) tiene la sección `stats` con `session_gap_seconds` (1800),
    `regex_out_repetitions`, `extra_punctuation_regex` y `day_rollover_hour` (4). El conector lee las tres
    primeras para contar igual que GSM.
- **Cálculo del tiempo de lectura de GSM** (`web/stats.py`, `calculate_actual_reading_time`, y
  `util/stats/stats_util.py`), portado a `packages/hub/src/connectors/gsm/reading-time.ts`:
  - ordena las líneas por `timestamp`; cada hueco se acredita a la línea anterior; un hueco mayor a
    `session_gap_seconds` corta la sesión y no suma; uno que cruza una pausa no suma (ni enseña el ritmo);
  - dentro de cada sesión, el ritmo es la **mediana** de caracteres/segundo de los huecos usables (línea de
    5+ caracteres, hueco entre 1 y 300 s); cada hueco suma como mucho `max(2 s, caracteres / ritmo × 2,5)`,
    con techo de 300 s (sin ritmo: 3 s por carácter); la última línea de cada sesión no suma;
  - los caracteres se cuentan **sin puntuación, símbolos ni separadores (espacios incluidos)**, en puntos de
    código (`clean_text_for_stats`).
- **Cómo arma GSM sus totales diarios** (`util/cron/daily_rollup.py`): días de **medianoche local** (no usa
  `day_rollover_hour`), solo hasta ayer; por cada día y juego recalcula el tiempo con las líneas de ese día;
  las líneas sin `game_id` no cuentan.
- **API HTTP** (solo con GSM abierto, puerto `7275`): `/api/daily-activity`, `/api/stats`,
  `/api/anki_stats_combined`, `/api/third-party-stats` (GET/POST), `/api/stats-export/*`. Es interna de su
  dashboard y puede cambiar: **no depender de ella** para el historial.
- **Integraciones de GSM que conviene conocer:** importa estadísticas de exSTATic y mokuro, y sincroniza su
  historial con **Kechimochi** mediante la API HTTP local de Kechimochi (`http://127.0.0.1:3031/api/...`,
  ver `GameSentenceMiner/util/kechimochi_client.py` y `kechimochi_sync.py`).
- **Limitación:** las métricas de GSM están en caracteres (pensadas para japonés). El tiempo sirve igual;
  la velocidad en caracteres por hora solo es comparable con uno mismo.

### 1.2 Anki (AnkiConnect)

- `http://127.0.0.1:8765`, POST con `{ "action", "version": 6, "params" }`. Solo responde con Anki abierto.
- **Mazos:** `German Mining` (tarjetas minadas) y `Refold Alemán-mil` (mazo armado, sin origen de inmersión →
  categoría propia `refold-1k`). Configurables con `ANKI_DECKS` y `ANKI_REFOLD_DECKS`.
- **Verificado en el Anki real (2026-11-14, fase 1):**
  - `German Mining` tiene notas de **dos** note types: `Kiku` (la mayoría, las más viejas) y `Kiku Deutsch`.
    Ninguno tiene `Word` ni `Source`: la palabra está en **`Expression`** y el origen en **`MiscInfo`**.
    `Refold Alemán-mil` usa el note type `Alemán-mil`, con la palabra en `Palabra`.
  - `MiscInfo` lo llena Yomitan con `{document-title}`: en YouTube trae el contador de notificaciones
    (`(15) …`), a veces el sufijo ` - YouTube`, entidades HTML (`&#x27;`, `&amp;`), marcas invisibles alrededor
    de `@nombres` y a veces un `<span data-group-id>`. También hay páginas que no son YouTube (textos web).
  - Las tarjetas minadas desde GSM tienen los tags `GSM` y `Game::<juego>` (y a veces `overlay`), y en
    `MiscInfo` el **nombre del juego** (no el título de la pestaña TextFeed).
  - Los `noteId` de `Refold Alemán-mil` son de 2022: la fecha en que se armó el mazo compartido, no la de cuando
    el usuario lo empezó. Para ese mazo, la "fecha de alta" útil es el primer repaso.
  - `mod` de notas y tarjetas está en **segundos**, no en ms.
  - El AnkiConnect instalado es una reescritura con una capa "legacy". Dos cosas importan:
    - `cardReviews` y `getLatestReviewID` **crean el mazo si no existe** (`decks.create`). El conector
      comprueba con `deckNamesAndIds` que el mazo exista antes de pedir sus repasos, y no usa `getLatestReviewID`.
    - `cardsInfo` acepta `fields: [...]` para devolver solo esas propiedades. Sin eso trae la pregunta, la
      respuesta y el CSS renderizados (varios KB por tarjeta), que no se guardan.
  - `type` de un repaso llega hasta **5**: 4 manual y 5 **reprogramado** (lo que escribe FSRS al reprogramar
    todo; hubo 440 en un día). Esos tienen `ease = 0` y no son repasos.
  - `getNumCardsReviewedByDay` cuenta **toda la colección** (incluso repasos de tarjetas borradas) con el corte de
    día de Anki, y solo los tipos 0–3 (aprendizaje, repaso, reaprendizaje, filtrado).
- **Acciones que usa el conector** (todas de lectura; el cliente rechaza cualquier otra):

| Acción | Devuelve | Uso |
|---|---|---|
| `deckNamesAndIds` | nombre → id | Comprobar que cada mazo exista (ver arriba). |
| `findNotes` / `findCards` (`query: "deck:\"German Mining\""`) | IDs | Listado completo en cada corrida (barato). |
| `notesModTime` / `cardsModTime` | `mod` por ID (segundos) | Pedir solo lo nuevo o cambiado. |
| `notesInfo` (`notes: [...]`) | `noteId` (= creación en ms), `modelName`, `fields`, `tags`, `cards`, `mod` | Cuándo y de dónde se minó cada palabra. |
| `cardsInfo` (`cards`, `fields`) | `deckName`, `interval`, `due`, `reps`, `lapses`, `type`, `queue`, `mod` | Estado actual (nuevas, jóvenes, maduras). |
| `cardReviews` (`deck`, `startID`) | filas `[id, cid, usn, ease, ivl, lastIvl, factor, time, type]` con `id > startID` | **Repasos incrementales.** `id` = hora en ms; `ease` 1–4 (0 en manuales/reprogramados); `time` = ms que tardó; `type` 0 aprendizaje, 1 repaso, 2 reaprendizaje, 3 filtrado, 4 manual, 5 reprogramado. Solo tarjetas que están hoy en el mazo. |
| `getNumCardsReviewedByDay` | `[día, cantidad]` | Solo para verificar (`npm run verify:anki`). |

- Cursor del conector: último `id` de `cardReviews` por mazo. Las notas y tarjetas se comparan por `mod`.
  Si aparece una tarjeta ya repasada que no estaba (se movió desde otro mazo), ese mazo se relee desde 0.
- Notas o tarjetas que ya no están en un mazo leído quedan marcadas (`removed_at`), no se borran; sus repasos
  se conservan. Si un mazo no aparece (por ejemplo, renombrado), sus notas no se marcan y se avisa.
- Alternativa para la carga inicial: leer `collection.anki2` directo. No hizo falta: la carga completa por
  AnkiConnect tarda unos 4 s.

### 1.3 Deuchan (YouTube)

- Hoy guarda en `chrome.storage.local`:
  - `log`: `{ version, days: { "YYYY-MM-DD": segundos }, adjust }` (totales por día + correcciones del usuario);
  - `videos`: `{ día: { idVideo: { title, seconds } } }` (últimos 60 días, hasta 100 videos por día);
  - `overrides`: videos marcados como alemán / no alemán;
  - `covered`: intervalos recientes para no contar dos veces dos pestañas.
- No guarda horas de inicio y fin persistentes ni nada sobre minado. El servidor de sync (Railway) solo tiene
  totales cifrados. Desde afuera del navegador no se puede leer nada.
- **Cambio a hacer en Deuchan** (su repo): en `extension/src/background.js`, `save()`, además de lo actual,
  encolar cada intervalo nuevo como evento y mandarlo a `POST http://127.0.0.1:<HUB_PORT>/api/ingest/events`.
  Cola persistente en `storage` (reintento con `chrome.alarms` si el hub está apagado), `id` único por
  evento para que el hub deduplique. Una acción de "backfill" que manda `log` y `videos` históricos.
  Configurable y apagado por defecto. El contrato completo está en [`docs/ingest-api.md`](ingest-api.md).
  Detalles que salieron al leer el código (2026-11-14):
  - El content script manda intervalos `{ from, to }` en **segundos** (float) cada ~2 s. Mandar cada uno
    sería un evento cada 2 s: la extensión los **junta** en un evento por tramo continuo del mismo video
    y convierte a **ms**.
  - Deuchan está publicada en la Chrome Web Store: el permiso va en `optional_host_permissions`
    (`http://127.0.0.1/*`) y se pide al activar la opción, así no le aparece un aviso nuevo a todos.
  - Además de intervalos, manda `day_total` (lo que muestra su dashboard ese día, con correcciones) cuando
    cambia un día reciente, y `video_removed` cuando el usuario saca un video de un día.
  - El prompt para el agente que lo implementa está en [`docs/prompts/deuchan-mosaik.md`](prompts/deuchan-mosaik.md).
  - **Hecho (2026-11-14):** [joaquinmuzzi/Deuchan#28](https://github.com/joaquinmuzzi/Deuchan/pull/28),
    mergeado. Opción "Send to Mosaik" apagada por defecto; envía cada minuto, en lotes de hasta 200 (parte el
    lote ante un 413), timeout 5 s, cola de hasta 5000 eventos. `day_total` va con segundos enteros (lo que
    muestra el dashboard) cada vez que un día cambia, y como backfill al prender la opción. Chrome 156 no pide
    nada por Local Network Access. No hay historial de intervalos anterior: Deuchan no lo guardaba.

### 1.4 asbplayer y Yomitan

- No guardan estadísticas. Su rastro es la nota de Anki: hora de creación y campos.
- Hoy Yomitan escribe `MiscInfo = {document-title}` (verificado en la fase 1; no hay campo `Source`). En
  YouTube es el título de la pestaña, con ruido (ver 1.2): frágil para unir.
- **Recomendación:** agregar a `Kiku` y `Kiku Deutsch` un campo `URL` y llenarlo con `{url}` en Yomitan y con el
  campo de URL de asbplayer (verificar ambos). Con el ID de video en la nota, la unión con Deuchan es exacta.
- Al minar desde la pestaña **GSM TextFeed** con Yomitan, GSM deja en `MiscInfo` el **nombre del juego** y agrega
  los tags `GSM` y `Game::<juego>` (verificado en la fase 1).

## 2. Cruces que la app tiene que poder responder

| Pregunta | Cómo |
|---|---|
| ¿De dónde salen mis tarjetas? | `cards` agrupadas por `content_id` (por `note_ids` de GSM, URL/`Source`, o hora de creación dentro de una sesión). |
| ¿Cuántas tarjetas mino por hora en cada fuente? | Tarjetas creadas durante sesiones de ese contenido ÷ horas de esas sesiones. |
| ¿Retengo mejor lo que viene de juegos o de videos? | `reviews` con `type = 1`; acierto = `ease > 1`; por origen de la nota; separado jóvenes (`lastIvl < 21`) y maduras. |
| ¿La inmersión mueve el vocabulario? | Horas acumuladas por semana vs. tarjetas maduras acumuladas (Refold y minadas por separado). |
| ¿Dónde vi esta palabra? | Búsqueda de texto completo (SQLite FTS5) sobre `lines` (GSM y, a futuro, subtítulos). |
| ¿Qué hice cada día? | Horas por día apiladas por fuente + repasos de Anki. |

## 3. Modelo de datos

Capas: `raw_*` (tal cual la fuente) → modelo común → métricas (consultas o vistas, no tablas).
Timestamps: enteros en **ms UTC**. Borrador de esquema. La fase 0 creó solo `connector_state`
(`packages/hub/migrations/0001_init.sql`, tabla `STRICT`); cada fase agrega su migración con sus tablas,
ajustando este borrador:

```sql
-- Estado de cada conector
CREATE TABLE connector_state (
  source TEXT PRIMARY KEY,          -- 'anki' | 'gsm' | 'deuchan'
  cursor TEXT,                      -- JSON con lo que necesite cada conector
  last_run_at INTEGER,
  last_ok_at INTEGER,
  last_error TEXT,
  last_summary TEXT                 -- JSON: qué hizo la última corrida buena (para la página Fuentes)
);

-- Crudo
CREATE TABLE raw_gsm_lines (id TEXT PRIMARY KEY, game_id TEXT, game_name TEXT, line_text TEXT,
  ts INTEGER NOT NULL, language TEXT, note_ids TEXT, payload TEXT NOT NULL);
CREATE TABLE raw_anki_notes (note_id INTEGER PRIMARY KEY, model TEXT, deck TEXT, fields TEXT NOT NULL,
  tags TEXT, mod INTEGER, payload TEXT NOT NULL);
CREATE TABLE raw_anki_reviews (review_id INTEGER PRIMARY KEY, card_id INTEGER NOT NULL, ease INTEGER,
  ivl INTEGER, last_ivl INTEGER, factor INTEGER, time_ms INTEGER, type INTEGER, deck TEXT);
CREATE TABLE raw_anki_cards (card_id INTEGER PRIMARY KEY, note_id INTEGER, deck TEXT, payload TEXT NOT NULL);
CREATE TABLE raw_events (id TEXT PRIMARY KEY, source TEXT NOT NULL, kind TEXT NOT NULL,
  received_at INTEGER NOT NULL, payload TEXT NOT NULL);   -- push (Deuchan y futuros)

-- Modelo común
CREATE TABLE contents (
  id TEXT PRIMARY KEY,              -- 'gsm:<game_id>', 'gsm-name:<escena>', 'yt:<videoId>', 'book:<...>'
  source TEXT NOT NULL,             -- cada fuente reconstruye sus filas
  kind TEXT NOT NULL,               -- 'game' | 'video' | 'book' | 'deck'
  title TEXT, external_id TEXT, parent_id TEXT, total_units INTEGER, unit TEXT, meta TEXT
);
CREATE TABLE sessions (
  id TEXT PRIMARY KEY, source TEXT NOT NULL, medium TEXT NOT NULL,  -- medium: 'game'|'video'|'reading'
  language TEXT NOT NULL, content_id TEXT REFERENCES contents(id),
  start_ts INTEGER NOT NULL, end_ts INTEGER NOT NULL, seconds REAL NOT NULL,
  units INTEGER, unit TEXT,         -- p. ej. caracteres leídos
  lines INTEGER
);
CREATE TABLE lines (                -- oraciones vistas, para el buscador
  id TEXT PRIMARY KEY, source TEXT NOT NULL, content_id TEXT, session_id TEXT, ts INTEGER NOT NULL,
  text TEXT NOT NULL, language TEXT,
  chars INTEGER NOT NULL,           -- caracteres como los cuenta la fuente
  seconds REAL NOT NULL,            -- tiempo de lectura acreditado a esta línea
  note_ids TEXT                     -- JSON con las notas de Anki minadas de esta línea
);
CREATE VIRTUAL TABLE lines_fts USING fts5(text, content='lines', content_rowid='rowid',
  tokenize='trigram remove_diacritics 1');  -- encuentra "wand" dentro de "Einwand"
CREATE TABLE cards (
  note_id INTEGER PRIMARY KEY, word TEXT, deck TEXT, model TEXT,
  origin TEXT NOT NULL,             -- 'gsm'|'youtube'|'refold-1k'|'unknown'
  content_id TEXT, line_id TEXT,
  source_title TEXT,                -- MiscInfo limpio (título de video/página, o nombre del juego)
  created_ts INTEGER NOT NULL
);
CREATE TABLE reviews (
  review_id INTEGER PRIMARY KEY, note_id INTEGER, card_id INTEGER, ts INTEGER NOT NULL,
  ease INTEGER, ivl INTEGER, last_ivl INTEGER, type INTEGER, time_ms INTEGER
);
```

La fase 1 creó `raw_anki_notes`, `raw_anki_cards`, `raw_anki_reviews`, `cards` y `reviews`
(`0002_anki.sql`): las tablas crudas llevan columnas propias (estado de la tarjeta, `synced_at`, `removed_at`) y
`cards`/`reviews` se reconstruyen enteras desde lo crudo después de cada sincronización. Para contar repasos
solo valen los tipos 0–3 (como Anki); los 4 y 5 se guardan pero no cuentan.

La fase 2 creó `raw_gsm_lines`, `raw_gsm_games` (sin la imagen de portada), `raw_gsm_breaks`, `contents`,
`sessions`, `lines` y `lines_fts` (`0003_gsm.sql`). Las sesiones de GSM son las del algoritmo de GSM por juego
(no se cortan a medianoche); el idioma de una sesión es el más frecuente entre sus líneas. **El tiempo de un
día es la suma de `lines.seconds` de las líneas de ese día**, con el corte de Mosaik (4:00): así una sesión que
cruza el corte reparte su tiempo entre los dos días sin estimar nada. Solo se reconstruye cuando cambió algo
(líneas, juegos, pausas o la configuración de GSM).

La fase 3 creó `raw_events` (cada evento empujado, tal cual) y `day_totals` (por fuente y día, la foto más
nueva) (`0004_ingest.sql`). Los videos de Deuchan son `contents` `yt:<videoId>` y sus sesiones juntan los
intervalos del mismo video separados por menos de 10 minutos. El tiempo diario de Deuchan es el de
`day_totals` (con correcciones, del día de Deuchan, que corta a medianoche); las sesiones dan el detalle.

Reglas de atribución del origen de una tarjeta, en orden (todas implementadas):
1. Su `note_id` aparece en `note_ids` de una línea de GSM → `gsm`, con `content_id` y `line_id`.
   1b. Si no, tiene el tag `GSM` (lo pone GSM al minar) → `gsm`; `content_id` del juego cuyo título coincide con
   `source_title`, si hay uno (las tarjetas de Katawa Shoujo no tienen líneas en el `gsm.db` actual).
2. Tiene campo `URL` con un video de YouTube → `youtube`, `content_id = yt:<videoId>`.
3. `source_title` (`MiscInfo` limpio: sin `(N) `, sin ` - YouTube`, sin HTML) coincide con el título de un video
   de Deuchan del mismo día → `youtube`.
4. Está en `Refold Alemán-mil` (o un submazo) → `refold-1k`.
5. Si no, `unknown` (y se muestra cuántas hay, para mejorar las reglas). Hoy son las 40 minadas.

Evento de ingesta (en `packages/shared/src/ingest.ts`, validado con zod; detalle en
[`docs/ingest-api.md`](ingest-api.md)). Horas en **ms UTC**:

```ts
type IngestEvent =
  | { id: string; source: "deuchan"; kind: "watch_interval"; language: string;
      from: number; to: number; seconds: number; videoId: string; title?: string; channelId?: string }
  | { id: string; source: "deuchan"; kind: "day_total"; language: string;   // backfill y días recientes
      day: string; at: number; seconds: number; videos?: { videoId: string; title: string; seconds: number }[] }
  | { id: string; source: "deuchan"; kind: "video_removed"; day: string; at: number; videoId: string };
```

`day_total` es una foto del día: por cada `day` vale la de `at` más nuevo. Para los totales por día manda
`day_total` (incluye las correcciones del usuario); los intervalos dan el detalle (horas, video, sesiones).

Los intervalos de Deuchan se agrupan en sesiones por video cuando el hueco entre intervalos es menor a 10 min.

## 4. Dashboard

Páginas (estructura inspirada en GSM):

- **Inicio:** hoy, esta semana, racha, metas; horas por día apiladas por fuente; repasos del día.
- **Contenido:** lista de juegos, videos/canales y (futuro) libros; ficha de cada uno con tiempo, sesiones,
  % completado, oraciones vistas y tarjetas minadas de ese contenido.
- **Buscar:** buscador de oraciones con contenido, fecha y hora; marca si de esa línea salió una tarjeta.
- **Anki:** tarjetas por origen, retención por origen (jóvenes/maduras), maduras acumuladas vs. horas.
- **Metas:** objetivo diario/semanal de horas por medio.
- **Fuentes:** estado de cada conector (última sincronización, errores) y botón de sincronizar.

Métricas según el medio (no mostrar lo que no aplica):

| Métrica | Juego (GSM) | Video (Deuchan) | Lectura (futuro) | Anki |
|---|---|---|---|---|
| Tiempo | sí | sí | sí | tiempo de repaso |
| Oraciones / caracteres | sí | solo con subtítulos | sí | — |
| Velocidad de lectura | sí | no | sí | — |
| % completado | si hay total | duración del video | páginas/caracteres | — |
| Tarjetas minadas | sí | sí | sí | — |
| Comprensión (nota propia) | opcional | sí | opcional | — |
| Retención | por origen | por origen | por origen | sí |

## 5. Fases

Cada fase termina con tests en verde y sus criterios cumplidos.

**Fase 0 — Esqueleto**
- Repo con npm workspaces (`shared`, `hub`, `web`), TypeScript strict, ESLint, Prettier, Vitest, `.gitignore`
  (bases, `.env`), `README.md`.
- Hub Fastify en `127.0.0.1:HUB_PORT` con `GET /api/health`, configuración por env, migraciones aplicadas
  al arrancar, `connector_state`.
- Programador que corre los conectores registrados (ninguno todavía).
- GitHub Actions: lint + test en Windows y Linux.
- *Criterio:* `npm run dev` levanta hub y web; `/api/health` responde; migraciones idempotentes con test.

**Fase 1 — Conector de Anki**
- Cliente AnkiConnect tipado con timeout y manejo de "Anki cerrado".
- Carga inicial: notas y tarjetas de los dos mazos; repasos desde `startID = 0`. Luego incremental.
- Llenar `raw_anki_*`, `cards` (reglas 4–5 de atribución por ahora) y `reviews`.
- *Criterio:* tests con respuestas grabadas; correr dos veces no duplica; con Anki cerrado registra error y no
  rompe; contra el Anki real, el total de repasos por día coincide con `getNumCardsReviewedByDay`.
- *Resultado (2026-11-14):* 1040 notas y 6851 repasos en ~4 s; la segunda corrida no trae nada. Con
  `npm run verify:anki`, 57 de 59 días coinciden exacto; en los otros 2 Anki cuenta 1 repaso más cada día, que
  son de tarjetas borradas (comprobado leyendo todos los mazos de la colección). Mosaik nunca cuenta de más.

**Fase 2 — Conector de GSM**
- Abrir `gsm.db` en solo lectura (ruta autodetectada o `GSM_DB_PATH`).
- Copiar `game_lines` nuevas a `raw_gsm_lines` (cursor por `timestamp`/`last_modified`), `games` a `contents`.
- Portar el algoritmo de tiempo de GSM a una función pura y generar `sessions`; llenar `lines` + FTS.
- Atribución regla 1 (`note_ids`).
- *Criterio:* tests con una `gsm.db` sintética creada en el test (incluye pausas y huecos > 30 min); contra la
  base real, el tiempo diario difiere menos de 5 % de `game_daily_rollup`.
- *Resultado (2026-11-14):* el port da exactamente lo mismo que GSM: contra `game_daily_rollup` (2 filas del
  2026-08-26) los caracteres coinciden y los segundos difieren 0,0000 %; con el propio código Python de GSM sobre
  las líneas de Ace Attorney del día, 2157,465339 s en los dos; y en un set sintético con todos los casos borde
  (`test/fixtures/gsm/parity.json`, resultado calculado por GSM), igual hasta el microsegundo. Los números propios
  de Mosaik (tiempo por línea sumado por día) también difieren 0,00 %. `npm run verify:gsm` lo repite. 463 líneas,
  4 sesiones; 5 tarjetas minadas quedan con origen `gsm` (3 por `note_ids`, 2 por el tag).

**Fase 3 — Ingesta y Deuchan**
- `POST /api/ingest/events` con validación zod, dedupe por `id`, respuesta con aceptados/rechazados.
- Agrupar intervalos en `sessions`, crear `contents` de videos. Atribución reglas 2–3.
- En el repo de Deuchan: cola de eventos, envío, backfill, permiso de host, opción en el dashboard de la
  extensión (apagada por defecto), tests.
- *Criterio:* tests de la API; con el hub apagado los eventos esperan y se mandan al volver; los totales por día
  coinciden con el dashboard de Deuchan.
- *Resultado (2026-11-14):* `POST /api/ingest/events` valida evento por evento, ignora ids repetidos, acepta hasta
  16 MB y solo pedidos de extensiones, programas o páginas de esta computadora. Acepta el lote real que mandó
  Deuchan desde Chrome 156. Lo de "los eventos esperan con el hub apagado" lo cubre la cola de Deuchan (tests en
  su repo). Los totales por día son exactamente los `seconds` de la foto más nueva, que es lo que muestra el
  dashboard de Deuchan. Las tarjetas suman las reglas 2 (campo `URL`) y 3 (título del video del día). Falta
  verlo con datos reales: la opción se prende desde el dashboard de Deuchan, con la extensión actualizada.

**Fase 4 — Dashboard v0**
- Páginas Inicio, Anki (retención por origen) y Fuentes, con datos reales vía la API.
- *Criterio:* el usuario puede ver un día cualquiera y entender de dónde sale cada número.
- *Resultado (2026-11-14):* API `GET /api/overview`, `GET /api/days/:day` y `GET /api/anki`; dashboard con Inicio
  (tarjetas de hoy, 7 días y racha; inmersión por día apilada por fuente y repasos por día, con tooltip y tabla;
  una barra lleva al día), Día (cada fuente con su número, de dónde sale y su detalle: sesiones de GSM, videos de
  Deuchan, repasos por tipo y tarjetas minadas con su origen), Anki (tarjetas, maduras y retención joven/madura por
  origen; inmersión por semana y tarjetas que llegaron a maduras, en gráficos separados) y Fuentes. Decisiones:
  - solo cuentan como inmersión las sesiones en el idioma objetivo (`TARGET_LANGUAGE`, `de`): la prueba en japonés
    de GSM del 2026-08-26 no suma;
  - el tiempo de Deuchan se muestra con el día de Deuchan (medianoche) sin recortar, para que coincida con su
    dashboard; GSM y Anki usan el día de Mosaik (corte 4:00). La página del día lo explica, y las horas de
    madrugada dicen de qué día calendario son;
  - "maduras" = intervalo de 21 días o más; "llegaron a maduras" = primera vez que un repaso dejó la tarjeta en 21+;
  - la retención con menos de 30 respuestas se muestra atenuada (hoy, todas las de origen minado).
  Con los datos reales: el 13/11 muestra 29 min de Ace Attorney (00:02–03:59 del 14), 2 min de YouTube y las 7
  tarjetas minadas, 4 atribuidas al Let's Play de Monkey Island #024 y 3 a Ace Attorney.

**Fase 5 — Contenido y buscador**
- Fichas por contenido y página Buscar sobre FTS5.
- *Resultado (2026-11-14):* `GET /api/contents`, `GET /api/contents/:id` y `GET /api/search?q=`. Página Contenido
  (juegos y videos con tiempo, tarjetas y última vez), ficha de cada uno (totales, tiempo por día, tarjetas con la
  oración de la que salieron, sesiones, últimas 200 oraciones marcando las minadas) y Buscar (la consulta vive en
  la dirección, `#/buscar?q=`). Decisiones:
  - el tiempo de un video es el que Deuchan le acreditó cada día (foto más nueva, esta computadora): el historial
    de Deuchan no tiene intervalos, así que las sesiones de video existen recién desde que se prendió el envío;
  - la velocidad (caracteres por hora, como GSM) solo para lectura, y el % leído solo si GSM conoce el largo
    (`character_count`, hoy 0 en todos los juegos): regla 7;
  - la búsqueda es por trigramas como frase: encuentra palabras dentro de compuestos, sin mayúsculas ni tildes,
    con 3 letras como mínimo; comillas u operadores escritos se buscan como texto;
  - el texto del OCR se muestra en una línea (los espacios japoneses U+3000 y saltos de línea se normalizan);
    no se deduplican las líneas que GSM capturó dos veces.

**Fase 6 — Validación y pulido**
- Comparar con las estadísticas propias de GSM, Deuchan y Anki; arranque automático con Windows (tarea
  programada al iniciar sesión).
- *Resultado (2026-11-14), con los datos reales:*
  - Anki (`npm run verify:anki`): 57 de 59 días exactos; los otros 2 difieren en 1 repaso de tarjetas borradas.
  - GSM (`npm run verify:gsm`): 0,0000 % contra `game_daily_rollup`.
  - Deuchan: cada día coincide con su dashboard (hoy 0:38 en los dos). Las sumas difieren unos segundos (7 días:
    43:48 contra 43:50; 30 días: 3:07:18 contra 3:07:25) porque `day_total` va en segundos enteros redondeados
    hacia abajo y el dashboard de Deuchan suma los valores con decimales. Se acepta: es menos de 1 s por día.
  - Arranque con Windows: `npm run autostart:install` compila y crea la tarea programada "Mosaik" del usuario (sin
    administrador), que al iniciar sesión corre el hub compilado sin ventana (`conhost --headless`), con los logs en
    `%LOCALAPPDATA%\Mosaik\hub.log` (`--log-file`), y lo reinicia hasta 3 veces si falla. Instalada y probada en esta
    computadora. Con la tarea corriendo, el dashboard está en `http://127.0.0.1:7300`; para desarrollar con
    `npm run dev`, parar antes la tarea (los dos usan el puerto 7300).

**Fases 7 a 13 — Servidor y varias PC:** Mosaik en Railway con login y un agente en cada PC que lee Anki y GSM.
Plan completo en [`plan-servidor.md`](plan-servidor.md).

Ideas para después: lectura (ttu u otros lectores web), subtítulos de YouTube en `lines`, nota de
comprensión por video en Deuchan, metas, API compatible con Kechimochi (evaluar). Exportar a CSV ya está hecho
(Fuentes → Exportar).

## 6. Pendiente de verificar

- ~~En la `gsm.db` real: valor de `language` para alemán; que `note_ids` se llene al minar desde GSM TextFeed
  con Yomitan; que las tablas de tokenización estén vacías.~~ Verificado en la fase 2: `de` (pero es la
  configuración de GSM al leer, no una detección); `note_ids` sí se llena; las tablas de tokenización no existen.
- ~~Qué queda en `Source` de las tarjetas de Ace Attorney.~~ Verificado en la fase 1: no hay `Source`; en
  `MiscInfo` queda el **nombre del juego** (`Phoenix Wright: Ace Attorney Trilogy`), con tags `GSM` y
  `Game::PhoenixWright:AceAttorneyTrilogy`.
- Que Yomitan (`{url}`) y asbplayer puedan llenar un campo `URL` en `Kiku` y `Kiku Deutsch` (hay que
  agregarlo a los dos note types, o pasar todo a uno).
- Corte de día preferido (por defecto 4:00).
- ~~Si `node:sqlite` alcanza (FTS5 incluido) o hace falta `better-sqlite3`.~~ Verificado en la fase 0:
  Node 24.19 trae SQLite 3.53 con FTS5 (hay un test que lo comprueba).

## 7. Referencias: herramientas existentes

Revisadas para tomar ideas (el ecosistema del japonés es el más completo):

| Herramienta | Qué hace | Qué tomar |
|---|---|---|
| GameSentenceMiner | Guarda cada línea con hora, juego y si se minó; muchos gráficos, metas, buscador de oraciones | Datos crudos primero, ficha por contenido, buscador, metas |
| exSTATic (KamWithK) | Estadísticas de lectura automáticas para novelas visuales y manga | Medición de lectura línea por línea |
| Kechimochi | App de escritorio de registro de inmersión con API HTTP local (medios + registros) | Modelo medio + registro; API local para que otras herramientas escriban |
| NihongoTracker / NihongoAutoTracker | Registros con cola local editable; YouTube, lectores web (ttu, Yatsu), texto seleccionado | Cola editable; integración con lectores web |
| Mikan, jp343, Japanese System, Arthur, Kitamersion | Tiempo en YouTube/streaming, mapa de calor, rachas; Arthur suma comprensión por video y export TSV/JSON | Comprensión por video, exportación |
| Learn Natively, Bookmeter | Registro de libros y velocidad de lectura | Fase de lectura |

Lo que ninguna hace: cruzar la inmersión con los repasos de Anki. Ese es el foco de este proyecto.
