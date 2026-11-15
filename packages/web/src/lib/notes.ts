/**
 * The explanations behind each number. Every design shows them the same way: in an (i) or a folded
 * "¿Cómo se calcula?" panel, never as text that fills the screen.
 */

export const NOTES = {
  day: (cutoff: number) =>
    `Los días de Mosaik van de las ${cutoff}:00 a las ${cutoff}:00, como en Anki. El tiempo de YouTube es el que muestra Deuchan, que cuenta de medianoche a medianoche.`,
  immersion:
    "Inmersión = tiempo de lectura en GameSentenceMiner (solo sesiones en alemán) + tiempo de YouTube que contó Deuchan.",
  gsmTime:
    "Calculado como GSM: cada línea suma el tiempo hasta la siguiente, con un tope según tu ritmo de esa sesión; un hueco de más de 30 minutos corta la sesión y no cuenta.",
  youtubeTime:
    "Lo que muestra el dashboard de Deuchan para cada día, con tus correcciones y el tiempo de otras computadoras sincronizadas.",
  videoTime:
    "Lo que Deuchan le acreditó a este video cada día, en esta computadora. Para un video no hay velocidad ni porcentaje: no aplican.",
  streak: "Días seguidos con algo de inmersión. Si hoy todavía no hiciste nada, cuenta desde ayer.",
  reviews:
    "Repasos como los cuenta Anki: aprendizaje, repaso, reaprendizaje y filtrado. Las reprogramaciones no cuentan.",
  mined: "Notas creadas ese día fuera del mazo de Refold.",
  origins:
    "De dónde salió cada tarjeta: la línea de GSM de la que se minó, el video de YouTube que estabas mirando (por el título que guarda Yomitan), el mazo de Refold, o «sin origen» si ninguna regla la reconoce.",
  retention: (few: number) =>
    `Retención: de las respuestas a tarjetas en repaso, cuántas no fueron «Otra vez». Jóvenes: intervalo previo menor a 21 días; maduras: 21 o más. Con menos de ${few} respuestas el porcentaje aparece atenuado: todavía no dice mucho.`,
  mature: "Maduras: tarjetas con un intervalo de 21 días o más.",
  matured: "Acumulado por semana: cada tarjeta cuenta la primera vez que su intervalo llegó a 21 días.",
  speed:
    "Caracteres por hora, contados como GSM: sin espacios ni puntuación. Sirve para compararte con vos mismo.",
  milestones:
    "Los hitos (10, 25, 50, 100, 250, 500, 1000 y 1500 horas) son marcas para ver el avance; no son parte del método.",
  year: "Suma de los últimos 365 días.",
} as const;

/** Below this many answers a retention rate says little; it is shown, but dimmed. */
export const FEW_ANSWERS = 30;
