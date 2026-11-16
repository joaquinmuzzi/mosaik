# API de ingesta (push)

Contrato entre el hub de Mosaik y las fuentes que **empujan** datos (Deuchan, y las que vengan).
La fuente de verdad es el esquema zod de [`packages/shared/src/ingest.ts`](../packages/shared/src/ingest.ts);
este documento lo explica. Si cambian, cambian juntos.

> **Estado:** implementado en la fase 3 (`packages/hub/src/ingest.ts`). Deuchan lo usa desde
> [joaquinmuzzi/Deuchan#28](https://github.com/joaquinmuzzi/Deuchan/pull/28); su validador del contrato
> (`tests/mosaik-contract.js` en ese repo) es igual o más estricto que el de Mosaik en cada regla.
> El cuerpo puede pesar hasta **16 MB** (un backfill de 200 días con 200 videos cada uno pasa de 1 MB).

## Descubrir el hub

```
GET http://127.0.0.1:7300/api/health
→ 200 { "status": "ok", "name": "mosaik", "version": "0.0.0", "schemaVersion": 1, "now": 1794671424989 }
```

`name: "mosaik"` distingue al hub de otro programa en el mismo puerto. El puerto es configurable
(`HUB_PORT`); el cliente debe dejar cambiar la URL y aceptar `http://127.0.0.1:<puerto>`,
`http://localhost:<puerto>` o, para un Mosaik en un servidor (`MOSAIK_MODE=server`), una dirección `https://`.
Nunca `http://` a otra computadora: los datos y el token viajarían sin cifrar.

**Servidor:** cada pedido lleva `Authorization: Bearer <token>`, el token de dispositivo que se crea en Fuentes →
Dispositivos (`mkd_…`). Sin token o con uno revocado, la respuesta es `401 { "error": "invalid_device_token" }`.
`GET /api/agent/whoami` (con el token) contesta `{ "device": "<nombre>" }`, para probar la conexión. `/api/health`
no pide token. Desde Deuchan: [joaquinmuzzi/Deuchan#29](https://github.com/joaquinmuzzi/Deuchan/pull/29).

## Mandar eventos

```
POST http://127.0.0.1:7300/api/ingest/events
Content-Type: application/json

{ "events": [ <evento>, ... ] }      // entre 1 y 500 eventos
```

El hub acepta el pedido si no trae `Origin` (un programa), si viene de una extensión
(`chrome-extension://...`) o de una página de esta computadora (`http://127.0.0.1:*`, `http://localhost:*`).
Cualquier otra página web recibe `403`. No hay CORS: una extensión con permiso de host no lo necesita.

### Reglas comunes

- **`id`**: único, lo elige la fuente (hasta 200 caracteres). El hub ignora un `id` que ya tiene, así que
  reenviar un lote cuya respuesta no llegó es seguro. **Un evento con un `id` dado no cambia nunca.**
- **Horas:** enteros, milisegundos epoch UTC (`Date.now()`). Un valor posterior a 2100 se rechaza
  (suele ser un error de unidades).
- Cada evento se valida por separado: uno inválido se rechaza sin perder el resto del lote.

### `watch_interval`: un tramo visto de un video

| Campo | Tipo | Notas |
|---|---|---|
| `id` | string | p. ej. `deuchan:iv:<uuid>` |
| `source` | `"deuchan"` | |
| `kind` | `"watch_interval"` | |
| `language` | string | etiqueta de idioma: `"de"`, `"de-AT"` |
| `from`, `to` | int, ms | `to > from` |
| `seconds` | number > 0, ≤ 21600 | tiempo **acreditado**; puede ser menor que `(to - from) / 1000` si otra pestaña ya sonaba en parte de ese tramo, nunca mayor (+1 s de tolerancia) |
| `videoId` | string | ID de YouTube de 11 caracteres |
| `title` | string ≤ 500, opcional | |
| `channelId` | string ≤ 100, opcional | |

Un `watch_interval` es un tramo **continuo** del mismo video: la fuente junta sus mediciones chicas
(Deuchan mide cada ~2 s) en un evento por tramo. El hub agrupa los tramos en sesiones por video cuando el
hueco entre ellos es menor a 10 minutos.

### `day_total`: foto del total de un día

| Campo | Tipo | Notas |
|---|---|---|
| `id` | string | uno nuevo por foto, p. ej. `deuchan:day:<day>:<at>` |
| `source`, `kind` | `"deuchan"`, `"day_total"` | |
| `language` | string | |
| `day` | `YYYY-MM-DD` | el día **de la fuente** (Deuchan corta a medianoche; el hub, a las 4:00) |
| `at` | int, ms | cuándo se sacó la foto |
| `seconds` | number, 0 – 90000 | lo que la fuente muestra ese día, **con las correcciones del usuario** |
| `videos` | lista opcional, ≤ 200 | `{ videoId, title (≤ 500), seconds }` |

Por cada `day` el hub se queda con la foto de `at` más nuevo. Se manda en el backfill del historial y cada
vez que un día cambia (minutos nuevos o una corrección). Para el total diario manda `day_total`; los
intervalos dan el detalle (a qué hora, qué video). El total **nunca** se deriva de `videos`: Deuchan pone ahí
solo los videos de esta computadora, mientras que `seconds` incluye las otras computadoras sincronizadas. Si
dos computadoras mandan fotos del mismo día, las dos traen el total ya combinado y gana la más nueva.

### `video_removed`: el usuario sacó un video de un día

| Campo | Tipo | Notas |
|---|---|---|
| `id` | string | p. ej. `deuchan:rm:<day>:<videoId>:<at>` |
| `source`, `kind` | `"deuchan"`, `"video_removed"` | |
| `day` | `YYYY-MM-DD` | |
| `at` | int, ms | |
| `videoId` | string | |

El tiempo de ese video en ese día deja de contar en las sesiones del hub. La fuente manda además una
`day_total` nueva de ese día. Puede traer `language` (opcional; Deuchan lo manda como en todos los eventos).

## Qué hace el hub con los eventos

- Los guarda tal cual en `raw_events` y reconstruye las filas de Deuchan del modelo común.
- Cada video es un contenido `yt:<videoId>`, con el título más reciente que se vio.
- Los intervalos del mismo video separados por menos de **10 minutos** forman una sesión.
- El total de cada día va a `day_totals`, desde la foto más nueva.
- Las tarjetas cuyo `MiscInfo` (limpio) coincide con el título de un video que Deuchan vio ese día o el
  anterior quedan con origen `youtube` y ese video (regla 3 de `docs/plan.md`).

## Respuesta

```
200 { "accepted": 3, "duplicates": 1, "rejected": [ { "index": 4, "id": "deuchan:iv:…", "error": "to: to must be after from" } ] }
```

- `accepted`: eventos nuevos guardados.
- `duplicates`: `id` que el hub ya tenía. No hay que reenviarlos.
- `rejected`: nunca se van a aceptar así; reenviarlos no sirve. El cliente los descarta (y puede mostrar
  el último error para depurar).

Con un `200`, **todos** los eventos del lote quedaron resueltos y salen de la cola del cliente.

## Errores

| Código | Significa | Qué hace el cliente |
|---|---|---|
| sin respuesta / timeout | el hub está apagado | conserva la cola y reintenta más tarde |
| `400` | el cuerpo no es `{ events: [...] }` con 1–500 elementos | es un bug del cliente: conserva y muestra el error |
| `403` | origen no permitido | conserva y muestra el error |
| `404` | hub viejo, sin ingesta (antes de la fase 3) | conserva y avisa que hay que actualizar Mosaik |
| `413` | lote demasiado grande | reintenta con lotes más chicos |
| `5xx` | error del hub | conserva y reintenta |

## Ejemplo

```json
{
  "events": [
    {
      "id": "deuchan:iv:1b0e4c8e-7a51-4c52-9d0b-2f3c4a5b6c7d",
      "source": "deuchan",
      "kind": "watch_interval",
      "language": "de",
      "from": 1794670000000,
      "to": 1794670418000,
      "seconds": 417.6,
      "videoId": "dQw4w9WgXcQ",
      "title": "Easy German 500"
    },
    {
      "id": "deuchan:day:2026-11-14:1794670420000",
      "source": "deuchan",
      "kind": "day_total",
      "language": "de",
      "day": "2026-11-14",
      "at": 1794670420000,
      "seconds": 5430,
      "videos": [{ "videoId": "dQw4w9WgXcQ", "title": "Easy German 500", "seconds": 1200 }]
    }
  ]
}
```
