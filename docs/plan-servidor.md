# Plan: Mosaik en un servidor (Railway) con agentes en cada PC

Objetivo: hacer inmersión en varias computadoras y que todo quede registrado en un solo Mosaik, que se pueda
abrir con login desde cualquier compu o el celular. El plan general sigue en [`plan.md`](plan.md); esto lo
extiende con las fases 7 a 13.

## La idea en una línea

Un **servidor** en Railway guarda los datos y sirve el dashboard con login; un **agente** en cada PC lee Anki
y GSM (que solo existen en esa compu) y le manda lo nuevo; Deuchan le manda directo.

```
PC principal ─ agente (Anki + GSM) ─┐
Notebook ───── agente (Anki + GSM) ─┼──► Mosaik en Railway (base + dashboard) ◄── navegador / celular, con login
Deuchan (cualquier PC) ─────────────┘
```

Un solo código con tres modos, elegidos por `MOSAIK_MODE`:

| Modo | Qué hace | Para quién |
|---|---|---|
| `local` (el de hoy, por defecto) | Hub en `127.0.0.1`, conectores adentro, sin login | Quien quiera todo en su PC |
| `server` | Base, dashboard y API en internet, con login; no lee fuentes | Railway |
| `agent` | Lee Anki y GSM de esa PC y manda lotes al servidor; sin base ni dashboard | Cada PC donde se hace inmersión |

El modo `local` no se rompe: sigue siendo la forma por defecto y la que respeta "todo local" sin excepciones.

## Decisiones (antes de empezar)

1. **¿Suben las oraciones leídas?** El texto de cada línea de GSM es lo que alimenta el buscador y las tarjetas
   con su oración. **Decidido (2026-11-15): sí suben**, porque el servidor es privado y con login. Cada agente tiene
   `AGENT_SEND_TEXT` (por defecto `true`): en `false` solo manda tiempos, conteos y IDs, y en el servidor el
   buscador no encuentra lo leído en esa PC.
2. **¿Una cuenta o varias?** *Recomendado:* una sola (vos). Registro cerrado; la cuenta se crea una vez con un
   token de instalación. Si más adelante otra persona quiere usarlo, que despliegue su propia copia (un
   template de Railway), en vez de mezclar usuarios en una base: así no hay que aislar datos entre usuarios.
3. **Dominio:** alcanza con el subdominio que da Railway (`*.up.railway.app`, con HTTPS). Uno propio es opcional.
4. **Costo:** plan Hobby de Railway, ~5 USD/mes. Un servicio con un volumen para la base SQLite.

La regla 2 de `AGENTS.md` ("todo local") pasa a decir: en modo `local`, nada sale de la máquina; los modos
`server` y `agent` existen solo si el usuario los configura, y mandan datos únicamente a su propio servidor.

## Cosas que el diseño tiene que resolver

- **Anki es el mismo en todas las PC** (AnkiWeb sincroniza la colección), y los IDs de notas y repasos son los
  mismos en todas. Cualquier agente puede mandar Anki: el servidor descarta lo repetido por ID, como hoy.
- **GSM es distinto en cada PC.** Las líneas tienen IDs únicos, pero el mismo juego tiene un `game_id` distinto
  en cada compu. El servidor une contenidos por título normalizado (el mismo juego en dos PC es un solo
  contenido), y se puede separar a mano si une mal.
- **Cursores por PC.** Hoy `connector_state` tiene uno por fuente; pasa a tener uno por fuente y dispositivo,
  guardado en el servidor. El agente pregunta su cursor al arrancar, así no guarda estado propio que se pierda.
- **Sin conexión.** El agente guarda los lotes que no pudo mandar en una carpeta (`outbox`) y los reenvía en
  orden. Los lotes son idempotentes (IDs de origen), así que reenviar es seguro.
- **Días y zona horaria.** Los agentes mandan horas UTC en ms; el servidor calcula los días con la zona y el corte
  configurados, igual que hoy.
- **Qué PC.** Cada sesión de GSM guarda el dispositivo, para poder mostrar "leído en la notebook" si sirve.

## Fases

Cada fase termina con tests en verde y sus criterios cumplidos, como las anteriores.

**Fase 7 — Separar leer de aplicar**
- Cada conector se parte en `read(cursor) → lote` (habla con la fuente, no toca la base) y
  `apply(db, lote, dispositivo) → cursor` (escribe en la base). En modo `local` se llaman uno detrás del otro,
  así que nada cambia.
- Migración: columna `device` en `sessions` y en `connector_state` (por defecto `principal`).
- El lote es JSON con esquema zod en `shared` (como la ingesta de Deuchan).
- *Criterio:* los tests actuales pasan sin cambios; un lote serializado y aplicado da la misma base que la
  corrida directa; `verify:anki` y `verify:gsm` siguen dando lo mismo.
- *Resultado (2026-11-15):* `readGsm`/`applyGsm` y `readAnki`/`applyAnki`, con `knownGsm`/`knownAnki` (lo que la
  base ya tiene, así la lectura trae solo lo nuevo; las portadas viajan solo si cambiaron). Esquemas de los lotes
  en `packages/shared/src/batches.ts`; los de AnkiConnect se mudaron ahí. Migración 0007: `device` en las líneas,
  juegos, pausas y sesiones de GSM, y estado por fuente y dispositivo; las sesiones se cortan por computadora.
  Tests nuevos (`test/batches.test.ts`): lote por JSON = corrida directa (GSM y Anki), aplicar dos veces no cambia
  nada, y dos computadoras no se pisan. Sobre una copia de la base real: migrar y reconstruir GSM deja idénticos
  los días, la biblioteca, las sesiones (5, 6419 s), las portadas y el origen de las tarjetas; `verify:gsm` sigue
  en 0,0000 %. `verify:anki` no se pudo correr (Anki cerrado); el test con el Anki falso da el mismo resumen y
  cursor que antes.
- *Queda para la fase 9:* la configuración de GSM (hueco de sesión, puntuación) se aplica a todas las
  computadoras con la de la última que mandó; cada una debería usar la suya (guardada en su cursor).

**Fase 8 — Modo servidor con login**
- `MOSAIK_MODE=server`: escucha en `0.0.0.0:$PORT`, acepta solo el host de `PUBLIC_URL` (reemplaza el chequeo de
  127.0.0.1), no corre conectores.
- Cuenta única: se crea con `SETUP_TOKEN` (una vez; después el registro queda cerrado). Contraseña con `scrypt`
  (incluido en Node), sesión en cookie `HttpOnly; Secure; SameSite=Lax`, cerrar sesión, límite de intentos de
  login.
- Página de login en el dashboard; todo `/api` exige sesión, salvo `/api/health`.
- **Dispositivos:** en Fuentes, crear un token por PC (se muestra una vez, se guarda hasheado, se puede revocar).
- `POST /api/agent/batches` y `GET /api/agent/cursor`, con token de dispositivo.
- Cabeceras de seguridad (CSP, `X-Content-Type-Options`, etc.), sin CORS; las acciones con cookie exigen
  `Origin` igual a `PUBLIC_URL`.
- *Criterio:* tests de login (bien, mal, límite), de tokens (válido, revocado), de lotes (aplicar dos veces no
  duplica), y de que sin sesión no se lee nada.

- *Resultado (2026-11-15):* `MOSAIK_MODE=server` con `PUBLIC_URL`, `SETUP_TOKEN` y `PORT`
  (`config.ts`); migración 0008 (`account`, `auth_sessions`, `devices`); `src/auth.ts` (scrypt, tokens de
  sesión y de dispositivo guardados como SHA-256, límite de 5 intentos fallidos por dirección y 30 en total cada
  15 minutos, detrás del proxy confía solo en el primer salto); `src/api/agent.ts` (estado del agente y aplicar
  lotes como su dispositivo). En el dashboard: página de login (crea la cuenta la primera vez), "Cerrar sesión"
  y la sección **Dispositivos** en Fuentes (token visible una sola vez, revocar). Cabeceras: CSP, HSTS,
  `nosniff`, `X-Frame-Options`. Tests nuevos (`test/server-mode.test.ts`). Prueba real con un servidor en
  modo `server` sobre una copia de la base: crear la cuenta y un dispositivo desde el navegador (portadas y
  fuentes cargan con la CSP), y un agente de prueba que leyó el GSM y el Anki reales y los mandó dos veces.
  Esa prueba encontró un error: el mismo GSM mandado desde dos dispositivos (una base copiada) fallaba en los
  juegos. Ahora los juegos se guardan por dispositivo, y una línea queda con la primera computadora que la
  mandó (el agente sabe qué líneas ya están, de cualquier computadora, y no las reenvía).
- *Queda para la fase 9:* el cursor de Anki es por dispositivo, así que cada computadora nueva reenvía todos
  los repasos una vez (el servidor los descarta por ID); como la colección es la misma, podría ser uno solo.

**Fase 9 — Modo agente**
- `MOSAIK_MODE=agent` con `SERVER_URL`, `DEVICE_TOKEN`, `AGENT_SEND_TEXT`: corre los `read` de Anki y GSM cada
  5 minutos, manda los lotes, guarda los que fallan en `outbox` y reintenta con espera creciente.
- Unión de contenidos por título en el servidor (con test de dos PC leyendo el mismo juego).
- El arranque con Windows (`scripts/autostart.ps1`) aprende el modo agente.
- *Criterio:* tests con un servidor de prueba: lote mandado, servidor caído (queda en `outbox` y entra después),
  dos agentes con el mismo Anki (sin duplicados), dos PC con el mismo juego (un contenido).

**Fase 10 — Despliegue en Railway**
- Servicio con Node 24 (Dockerfile o Nixpacks), volumen en `/data` para la base, variables (`MOSAIK_MODE`,
  `PUBLIC_URL`, `SETUP_TOKEN`, `TZ_NAME`, …), healthcheck en `/api/health`, una sola réplica (SQLite).
- Crear la cuenta; subir la base actual (la copia de `/api/export/backup`) al volumen, así no se pierde nada.
- Pasar la PC principal de `local` a `agent`: sigue desde los cursores que ya están en la base.
- *Criterio:* el dashboard en Railway muestra lo mismo que el local antes del cambio (mismos totales por día),
  y lo nuevo de la PC principal entra en menos de 10 minutos.

**Fase 11 — Deuchan al servidor** (en el repo de Deuchan)
- Aceptar una URL `https://` con token (además de `127.0.0.1`), pedir permiso de host para ese dominio, mandar el
  token en una cabecera.
- El servidor acepta la ingesta con token de dispositivo.
- *Criterio:* el validador de contrato de Deuchan pasa; un día de prueba llega igual que hoy.

**Fase 12 — La otra PC**
- Instalar el agente en la otra compu (por SSH), con su token, y probar una sesión de lectura real.
- *Criterio:* lo leído en la otra PC aparece en el dashboard, en el mismo contenido si es el mismo juego.

**Fase 13 (opcional) — Agente como exe**
- Empaquetar el agente con Node SEA en un `.exe` (sin instalar Node), con opción "iniciar con Windows".
  Después, si hace falta, un ícono en la bandeja (estado, sincronizar, abrir el dashboard).

## Riesgos

- **Seguridad:** el servidor queda en internet. Mitigación: registro cerrado, límite de intentos, cookies
  seguras, tokens revocables, dependencias al día, copias de la base (el export que ya existe y los backups del
  volumen de Railway).
- **Privacidad:** las oraciones y el historial quedan en Railway. Mitigación: la decisión 1 y su opción por PC.
- **Anki cerrado en todas las PC:** como hoy, los repasos entran cuando alguna abre Anki y sincroniza.
- **SQLite en un volumen:** sirve para una réplica; si algún día hace falta más, se pasa a Postgres.
