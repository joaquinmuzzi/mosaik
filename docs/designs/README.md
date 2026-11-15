# Propuestas de diseño

Cinco variantes de la interfaz, con los mismos datos y los mismos números: solo cambia la presentación.
Se eligen con el menú **Diseño** (abajo a la derecha) o con `?design=<nombre>` en la dirección, y la última
elegida queda recordada en el navegador.

Las capturas se generan con tus datos reales y por eso no se suben al repo (`docs/designs/*.png` está en
`.gitignore`). Para regenerarlas, con el dashboard corriendo:

```bash
npm run screenshots
```

## Lado a lado

| | Inicio | Contenido | Anki |
|---|---|---|---|
| **Actual** | <img src="actual-inicio.png" width="260"> | <img src="actual-contenido.png" width="260"> | <img src="actual-anki.png" width="260"> |
| **Kechimochi** | <img src="kechimochi-inicio.png" width="260"> | <img src="kechimochi-contenido.png" width="260"> | <img src="kechimochi-anki.png" width="260"> |
| **Minimal** | <img src="minimal-inicio.png" width="260"> | <img src="minimal-contenido.png" width="260"> | <img src="minimal-anki.png" width="260"> |
| **Bento** | <img src="bento-inicio.png" width="260"> | <img src="bento-contenido.png" width="260"> | <img src="bento-anki.png" width="260"> |
| **Spielstand** | <img src="spielstand-inicio.png" width="260"> | <img src="spielstand-contenido.png" width="260"> | <img src="spielstand-anki.png" width="260"> |

## Las variantes

**Actual** (`?design=actual`). La interfaz de la fase 5, sin cambios, para comparar.
Bueno: todo está explicado en pantalla. Sacrifica: mucho texto, se ve plana.

**Kechimochi** (`?design=kechimochi`). Inspirada en Kechimochi:
- barra lateral y tarjetas compactas oscuras;
- mapa de calor del año, dona de los últimos 30 días y gráfico con interruptores (barras/líneas,
  día/semana, por fuente/por título);
- actividad reciente y biblioteca en grilla de portadas.

Bueno: es la más completa y se explora mucho sin cambiar de página. Sacrifica: es la más cargada; los
colores son vivos pero no neón, porque los neones no pasaban los chequeos de contraste y daltonismo.

**Minimal** (`?design=minimal`). Clara, mucho aire, un número enorme ("43 min") y pocos números secundarios.
Bueno: se lee de un vistazo. Sacrifica: muestra menos (sin mapa de calor ni actividad), y el acento único es la
tinta; el color queda solo para los datos, porque en grises las fuentes no se distinguían.

**Bento** (`?design=bento`). Grilla de bloques de distintos tamaños, cada uno responde una pregunta:
¿cuánto hice hoy?, ¿sigo en racha?, ¿cómo va mi retención?, ¿de dónde salen mis tarjetas?, ¿qué estoy jugando
o mirando?
Bueno: equilibra lo rápido de Minimal con la información de Kechimochi. Sacrifica: con pocos datos, algunos
bloques quedan con aire de sobra.

**Spielstand** (`?design=spielstand`, mi propuesta). La pantalla de estado de un juego, con rótulos en alemán
y su traducción:
- Inicio: tu tiempo como *Spielzeit*, con una barra hacia el próximo hito de horas;
- Anki: las tarjetas como gemas de un *Inventar* (zafiro GSM, fuego YouTube, esmeralda Refold), con la
  retención como *Treffsicherheit*;
- Inicio: la actividad como *Questlog*;
- Contenido: cada juego o video como una ranura de guardado.

Bueno: le da personalidad y repasa vocabulario de paso. Sacrifica: los hitos (10, 25, 50… h) son una marca de
presentación, no parte del método, y el estilo puede cansar si se lo mira todos los días.

## Lo que comparten

- Las notas y explicaciones no se borraron: están en el ícono **(i)** junto a cada número (cómo se calcula la
  retención, el corte de día a las 4:00, los porcentajes atenuados con menos de 30 respuestas, etc.).
- Un color fijo por fuente en todos los gráficos de una variante. Cada paleta pasó los chequeos de la guía de
  visualización (contraste, separación con daltonismo) para su fondo.
- Buscar, Fuentes, la página de un día y la ficha de un contenido usan las páginas de siempre con los colores
  de la variante.
- Portadas: si GSM tiene una imagen guardada para un juego, se usa (hoy ningún juego tiene). Las miniaturas
  de YouTube están apagadas: pedirlas le dice a YouTube qué videos miraste. Se prenden con
  `YOUTUBE_THUMBNAILS=1` en `.env`, y cada una se baja una sola vez y queda guardada. Sin portada se muestran
  las iniciales sobre el color de la fuente.
