'use strict';
/* =====================================================================
 *  MAZO DE EVENTOS DE "LUNA NUEVA" — 36 cartas (31 distintas + 5 de Espiritismo)
 *  ---------------------------------------------------------------------
 *  Transcritas de las cartas físicas del juego y resumidas con palabras
 *  propias para la voz. Cada carta tiene:
 *    id, name  · nombre impreso en la carta
 *    type      · símbolo de luna: 'inmediato' (luna llena),
 *                'temporal' (creciente), 'permanente' (luna negra)
 *    level     · cuánto hace la app: 'auto' (aplica el efecto sola),
 *                'asistida' (pide decisiones en pantalla),
 *                'recordatorio' (solo lo anuncia y lo deja en el panel)
 *    summary   · texto que lee la voz
 *    run()     · efecto (async). Se ejecuta al amanecer, en modo día.
 *
 *  Banderas que usa el motor (app.js):
 *    G.dayFlags.*   → solo para el día en curso
 *    G.nightFlags.* → solo para la noche siguiente
 *    G.ev.*         → efectos permanentes
 *
 *  Este archivo se carga ANTES que app.js; las funciones de app.js
 *  (say, pickUI, kill…) solo se llaman al jugar, cuando ya existen.
 * ===================================================================== */

/** Las 5 cartas de Espiritismo: 4 preguntas de sí/no cada una. */
const SPIRIT_CARDS = [
  ['¿Están en el mismo bando los dos jugadores que señalo?', '¿Algún Hombre Lobo lleva gafas?', '¿La Bruja es un hombre?', '¿El Alguacil es Aldeano?'],
  ['¿Hay algún hombre entre los Hombres Lobo?', '¿Hay alguna mujer entre los Hombres Lobo?', '¿Alguno de los dos vecinos del jugador que señalo es Hombre Lobo?', '¿El jugador que señalo es Aldeano?'],
  ['¿Ha descubierto la Vidente al menos a un Hombre Lobo?', '¿Están los Hombres Lobo sentados cerca el uno del otro?', '¿Algún Hombre Lobo lleva alguna joya visible?', '¿Soy yo un Hombre Lobo?'],
  ['¿Soy yo Aldeano?', '¿El Alguacil es uno de los Hombres Lobo?', '¿Vive algún Hombre Lobo en el lugar donde estamos jugando?', '¿Fuma algún Hombre Lobo?'],
  ['¿Algún Hombre Lobo lleva vaqueros?', '¿Algún Hombre Lobo lleva ropa negra en el torso?', '¿Son hombres todos los Hombres Lobo?', '¿Son mujeres todos los Hombres Lobo?']
];

/* ---------- Ayudas comunes de los eventos ---------- */

/** Selección pública de un grupo (mujeres, jóvenes, veteranos…). */
async function evPickGroup(role, q) {
  const r = await pickUI({ mode: 'day', role, q, count: alive().length, min: 0, candidates: alive() });
  return Array.isArray(r) ? r : [];
}

/**
 * Un grupo abandona la aldea: no debate ni vota hoy y nadie puede votar
 * contra ellos. Si `night`, tampoco devoran ni son devorados esta noche.
 */
function evAbsent(ids, label, night) {
  G.dayFlags.absent = ids;
  G.dayFlags.absentLabel = label;
  if (night) G.nightFlags.untouchable = ids;
}

/** Sesión de Espiritismo (carta física o carta de la Gitana). */
async function evSpiritSession(cardIdx, medium, fixedQuestion) {
  // Espíritu: la primera víctima de los lobos (si sigue muerta) o el primer eliminado que siga muerto.
  const fw = P(G.firstWolfVictim);
  const spirit = fw && !fw.alive ? fw : firstStillDead();
  if (!medium || !spirit) { await say('Los espíritus guardan silencio: todavía no hay ninguna víctima a la que invocar.'); return; }
  await say(`Sesión de espiritismo. La aldea se coge de las manos. ${medium.name} es el médium e invoca al espíritu de ${spirit.name}.`);
  let q = fixedQuestion;
  if (!q) {
    q = await choiceUI({ mode: 'day', role: 'Espiritismo', q: `${esc(medium.name)}, elige UNA pregunta para el espíritu de ${esc(spirit.name)}:`, options: SPIRIT_CARDS[cardIdx].map((x) => ({ label: x, value: x, primary: true })) });
  }
  if (q) {
    await say(`El médium pregunta: ${q}`);
    await infoUI({ mode: 'day', role: 'Espiritismo', title: `${spirit.name}, responde solo "sí" o "no", con voz sepulcral.`, big: q, button: 'Ya ha respondido' });
    log(`Espiritismo: ${medium.name} pregunta "${q}" a ${spirit.name}.`);
  }
}

/** Fábrica de las 5 cartas de Espiritismo. */
const spiritCard = (k) => ({
  id: `espiritismo${k + 1}`, name: 'Espiritismo', type: 'inmediato', level: 'asistida', spirit: k,
  summary: 'La aldea organiza una sesión para invocar el espíritu de la primera víctima de los Hombres Lobo. El jugador a la izquierda de la última víctima será el médium y hará una de las cuatro preguntas de la carta. El espíritu solo puede responder sí o no.',
  async run() {
    const last = P(G.lastDeadId);
    await evSpiritSession(k, last ? aliveNeighbor(last, +1) : null);
  }
});

/* ---------- Las 36 cartas ---------- */
const EVENT_CARDS = [
  { id: 'granuja', name: 'El pequeño granuja', type: 'temporal', level: 'asistida',
    summary: 'El jugador más joven abandona la aldea en busca de ayuda: hoy no debate ni vota y esta noche no puede ser devorado. Vuelve mañana a su sitio y ese día su voto vale el triple. Los demás pueden contarle lo ocurrido.',
    async run() {
      const r = await pickUI({ mode: 'day', role: 'El pequeño granuja', q: '¿Quién es el jugador más joven?', candidates: alive() });
      if (!Array.isArray(r) || !r.length) return;
      evAbsent(r, 'el pequeño granuja', true);
      G.granuja = { id: r[0], day: G.day + 1 };
      await say(`${P(r[0]).name} se aleja de la mesa hasta mañana.`);
    } },

  { id: 'toqueMortal', name: 'Toque mortal', type: 'permanente', level: 'auto',
    summary: 'Desde ahora y hasta el final de la partida, la víctima de los Hombres Lobo no se señala: uno de ellos debe tocarla. Si no lo hacen, esa noche no hay víctima.',
    async run() { G.ev.toqueMortal = true; } },

  { id: 'caraCruz', name: 'Cara o cruz', type: 'inmediato', level: 'auto',
    summary: 'Homenaje a Hervé el tuerto: tras el veredicto de hoy, la suerte del acusado se decide lanzando una moneda. Cruz: queda absuelto. Cara: es condenado y eliminado.',
    async run() { G.dayFlags.coin = true; } },

  { id: 'ataqueFallido', name: 'Ataque fallido', type: 'temporal', level: 'auto',
    summary: 'La noche siguiente, si los Hombres Lobo eligen a un Aldeano, no muere: se transforma en Hombre Lobo. Si eligen a otro personaje, la víctima sobrevive y muere el primer Hombre Lobo a su izquierda.',
    async run() { G.nightFlags.failedAttack = true; } },

  { id: 'santosInocentes', name: 'Día de los Santos Inocentes', type: 'inmediato', level: 'auto',
    summary: 'Hasta mañana se intercambian los poderes: la Vidente con la Bruja, el Cazador con la Niña y el Protector con el Anciano. Los enamorados se odian: deben votarse entre ellos y, si uno muere, el otro sobrevive.',
    async run() {
      const pairs = [['vidente', 'bruja'], ['cazador', 'nina'], ['protector', 'anciano']];
      G.swap = [];
      for (const [x, y] of pairs) {
        const a = alive().find((p) => p.role === x);
        const b = alive().find((p) => p.role === y);
        if (!a || !b) continue;
        a.swapRole = y; b.swapRole = x;
        [a.lives, b.lives] = [b.lives, a.lives];
        G.swap.push([a.id, b.id]);
      }
      G.loversHate = true;
    } },

  { id: 'sanPhilippe', name: 'San Philippe', type: 'inmediato', level: 'asistida',
    summary: 'En memoria de Philippe el cojo, la aldea debe elegir a un líder carismático. Si ya hay Alguacil, es despedido por incompetente y se elige a otro. El nuevo Alguacil debe recitar en voz alta la plegaria de la carta.',
    async run() {
      const old = G.alguacil;
      if (old != null) await say(`${P(old).name} es despedido como Alguacil.`);
      const r = await pickUI({ mode: 'day', role: 'San Philippe', q: 'Votad: ¿quién es el nuevo Alguacil?', candidates: alive().filter((p) => p.id !== old && !p.tontoRevealed) });
      if (Array.isArray(r) && r.length) {
        G.alguacil = r[0]; G.alguacilLost = false;
        if (G.guardia === r[0]) G.guardia = null;
        await say(`${P(r[0]).name} es el nuevo Alguacil y recita la plegaria de San Philippe.`);
      }
    } },

  { id: 'granDesconfianza', name: 'Gran desconfianza', type: 'inmediato', level: 'asistida',
    summary: 'Hoy la votación cambia: cada jugador señala a la vez, con cada mano, a sus dos mejores amigos. Quien no reciba ningún voto será linchado.',
    async run() { G.dayFlags.voteMode = 'friends'; } },

  spiritCard(0),

  { id: 'milagro', name: 'Milagro', type: 'inmediato', level: 'auto',
    summary: 'La última víctima de los Hombres Lobo no estaba muerta: solo se quedó paralizada de miedo. Vuelve a la partida ahora mismo, pero como simple Aldeano.',
    async run() {
      const v = P(G.lastWolfVictim);
      if (!v || v.alive) { await say('No hay ninguna víctima de los lobos a la que salvar. El milagro no tiene efecto.'); return; }
      v.alive = true; v.role = 'aldeano'; v.cause = null; v.lives = 1; v.hiddenCard = false;
      v.infected = false; v.charmed = false; v.borrowed = null; v.swapRole = null;
      G.lastWolfVictim = null;
      log(`Milagro: ${v.name} vuelve a la partida como Aldeano.`);
      await say(`¡Milagro! ${v.name} vuelve a la partida como Aldeano.`);
    } },

  { id: 'almuerzo', name: 'Almuerzo de veteranos', type: 'inmediato', level: 'asistida',
    summary: 'Cada jugador dice su edad. La mitad de mayor edad se va a un banquete y no vuelve hasta el atardecer: hoy no debaten ni votan, y los jóvenes no pueden votar contra ellos.',
    async run() {
      const ids = await evPickGroup('Almuerzo de veteranos', 'Marcad a la mitad de MAYOR edad (los veteranos).');
      evAbsent(ids, 'los veteranos', false);
    } },

  { id: 'finCosecha', name: 'Fin de la cosecha', type: 'inmediato', level: 'recordatorio',
    summary: 'Todos están cansados por la cosecha. No ocurre nada en particular: será un turno normal.',
    async run() {} },

  { id: 'educacion', name: 'Ante todo educación', type: 'inmediato', level: 'recordatorio',
    summary: 'Hoy está prohibido interrumpir: cada jugador hablará por turno riguroso. Quien rompa la regla pierde su voto esta ronda.',
    async run() { G.dayFlags.reminder = 'Ante todo educación: se habla por turnos; quien interrumpa pierde su voto.'; } },

  { id: 'fiebre', name: 'Fiebre del sábado noche', type: 'inmediato', level: 'asistida',
    summary: 'Cada jugador dice su edad. La mitad más joven se va de verbena hasta el amanecer: hoy no debaten ni votan y los mayores no pueden votar contra ellos. Esta noche no pueden devorar ni ser devorados.',
    async run() {
      const ids = await evPickGroup('Fiebre del sábado noche', 'Marcad a la mitad de MENOR edad (los verbeneros).');
      evAbsent(ids, 'los verbeneros', true);
    } },

  spiritCard(1),

  { id: 'lunes', name: 'Lunes deprimente', type: 'inmediato', level: 'recordatorio',
    summary: 'Un día triste y aburrido. No ocurre nada en particular: será un turno normal.',
    async run() {} },

  { id: 'recoleccion', name: 'Recolección', type: 'inmediato', level: 'asistida',
    summary: 'Las mujeres van al bosque a recoger plantas para la Bruja y no vuelven hasta la puesta de sol: hoy no debaten ni votan y los hombres no pueden votar contra ellas. Antes de la noche, la Bruja recibe una poción extra.',
    async run() {
      const ids = await evPickGroup('Recolección', 'Marcad a las MUJERES de la mesa.');
      evAbsent(ids, 'las mujeres', false);
      G.potions.extra = (G.potions.extra || 0) + 1;
    } },

  { id: 'inundacion', name: 'Inundación', type: 'inmediato', level: 'asistida',
    summary: 'Una inundación: las mujeres se refugian en la iglesia y los hombres en la taberna. Hoy no hay votación. Esta noche, los Hombres Lobo deben comer en el edificio donde se refugiaron, así que puede haber dos víctimas.',
    async run() {
      if (alive().length < 6) { await say('Quedan menos de seis jugadores: la inundación no tiene efecto.'); return; }
      const ids = await evPickGroup('Inundación', 'Marcad a las MUJERES (se refugian en la iglesia).');
      G.dayFlags.noVote = true;
      G.nightFlags.flood = ids;
    } },

  { id: 'posesion', name: 'Posesión', type: 'temporal', level: 'auto',
    summary: 'La próxima víctima de los Hombres Lobo, avisada con un toque, abrirá los ojos: no muere, se transforma en Hombre Lobo y elige a uno de los antiguos lobos, que es eliminado de inmediato.',
    async run() { G.nightFlags.possession = true; } },

  { id: 'domingo', name: 'Domingo radiante', type: 'inmediato', level: 'recordatorio',
    summary: 'Todo el mundo disfruta de un sol radiante. No ocurre nada en particular: será un turno normal.',
    async run() {} },

  { id: 'pacto', name: 'Pacto con el diablo', type: 'inmediato', level: 'asistida',
    summary: 'Justo después del veredicto de hoy, el acusado puede hacer un pacto con el diablo y no ser eliminado. Pero si al final está en el bando ganador, quedará excluido de la siguiente partida.',
    async run() { G.dayFlags.devilPact = true; } },

  { id: 'pesadilla', name: 'Pesadilla', type: 'inmediato', level: 'asistida',
    summary: 'Pesadilla: todos despiertan y, sin hablar, empezando por el jugador a la izquierda de la última víctima, cada uno acusa a un aldeano. El más votado es eliminado. Sustituye a la votación del día.',
    async run() { G.dayFlags.voteMode = 'nightmare'; G.dayFlags.noDebate = true; } },

  spiritCard(2),

  { id: 'levante', name: 'Levante', type: 'inmediato', level: 'recordatorio',
    summary: 'Un viento desagradable pone a todos de mal humor: hoy debatís de espaldas, sin miraros. Quien incumpla la norma puede perder su voto. Al votar, volvéis a vuestra posición normal.',
    async run() { G.dayFlags.reminder = 'Levante: debatid de espaldas; volved a mirar al votar.'; } },

  { id: 'sonambulismo', name: 'Sonambulismo', type: 'permanente', level: 'auto',
    summary: 'La Vidente se ha vuelto sonámbula: desde ahora, cada noche se anunciará en voz alta la identidad del jugador que consulta, sin decir quién es la Vidente.',
    async run() { G.ev.sonambulismo = true; } },

  { id: 'influencias', name: 'Influencias', type: 'temporal', level: 'asistida',
    summary: 'La siguiente votación será en orden: el último eliminado elige quién vota primero, y luego vota cada jugador hacia su izquierda señalando con el dedo. Se resuelve de forma habitual.',
    async run() {
      const last = P(G.lastDeadId);
      const r = await pickUI({ mode: 'day', role: 'Influencias', q: `${last ? esc(last.name) + ', elige' : 'Elegid'} quién vota primero.`, candidates: alive() });
      if (Array.isArray(r) && r.length) G.dayFlags.firstVoter = r[0];
    } },

  { id: 'entusiasmo', name: 'Entusiasmo', type: 'temporal', level: 'auto',
    summary: 'Si el siguiente linchado es un Hombre Lobo, la aldea, enfervorecida, votará otra vez de inmediato y sin debate para eliminar a un segundo sospechoso.',
    async run() { G.lynchCheck = 'wolf'; } },

  { id: 'verdugo', name: 'Verdugo', type: 'permanente', level: 'asistida',
    summary: 'Los aldeanos eligen a un verdugo. Desde ahora, solo él conocerá la carta de los linchados: no se harán públicas. Puede revelarlas si quiere. Si muere, designa a su sucesor.',
    async run() {
      const r = await pickUI({ mode: 'day', role: 'Verdugo', q: 'Votad: ¿quién será el verdugo?', candidates: alive() });
      if (Array.isArray(r) && r.length) { G.ev.verdugo = r[0]; await say(`${P(r[0]).name} es el verdugo.`); }
    } },

  { id: 'castigo', name: 'Castigo', type: 'inmediato', level: 'asistida',
    summary: 'Para hacerle pagar su desaparición, el último eliminado elige a un jugador, que será eliminado salvo que dos personas defiendan su inocencia dándole un beso en la mejilla. El castigado puede suplicar esos besos.',
    async run() {
      const last = P(G.lastDeadId);
      const r = await pickUI({ mode: 'day', role: 'Castigo', q: `${last ? esc(last.name) + ', ¿a quién castigas?' : '¿A quién se castiga?'}`, candidates: alive() });
      if (!Array.isArray(r) || !r.length) return;
      const t = P(r[0]);
      const saved = await choiceUI({ mode: 'day', role: 'Castigo', q: `¿Han defendido dos personas a ${esc(t.name)} con un beso en la mejilla?`, options: [{ label: 'Sí, se salva', value: true }, { label: 'No, es eliminado', value: false, primary: true }] });
      if (saved) { await say(`${t.name} se salva gracias a sus defensores.`); return; }
      kill(t, 'castigo');
      await processTriggers();
    } },

  { id: 'enterramiento', name: 'Enterramiento', type: 'permanente', level: 'auto',
    summary: 'Los Hombres Lobo entierran los restos de sus víctimas: desde ahora, no se revelará la carta de las víctimas de sus ataques.',
    async run() { G.ev.enterramiento = true; } },

  spiritCard(3),

  { id: 'insatisfaccion', name: 'Insatisfacción', type: 'temporal', level: 'auto',
    summary: 'Si el siguiente linchado NO es un Hombre Lobo, la aldea, humillada, votará otra vez de inmediato y sin debate para eliminar a un segundo sospechoso.',
    async run() { G.lynchCheck = 'notWolf'; } },

  { id: 'casiLlena', name: 'Luna "casi" llena', type: 'temporal', level: 'auto',
    summary: 'La próxima noche los Hombres Lobo se vuelven Videntes: cada uno despierta por turnos para conocer la carta de un jugador. El Cazador, la Bruja y la Vidente se vuelven Hombres Lobo: despiertan a la vez y atacan a un jugador. A la mañana siguiente todo vuelve a la normalidad.',
    async run() { G.nightFlags.almostFull = true; } },

  { id: 'agenteDoble', name: 'Agente doble', type: 'permanente', level: 'auto',
    summary: 'Mientras la aldea duerma, el primer eliminado señalará a un jugador que no sea Hombre Lobo: abrirá los ojos, sabrá quiénes son los lobos y será su aliado secreto. Sigue siendo aldeano y no despierta de noche, pero gana con los lobos.',
    async run() { G.ev.agentePending = true; } },

  { id: 'partidaCaza', name: 'Partida de caza', type: 'inmediato', level: 'asistida',
    summary: 'Los hombres salen de caza hasta el amanecer: hoy no debaten ni votan y los demás no pueden votar contra ellos. Esta noche no pueden devorar ni ser devorados.',
    async run() {
      const ids = await evPickGroup('Partida de caza', 'Marcad a los HOMBRES de la mesa.');
      evAbsent(ids, 'los cazadores', true);
    } },

  spiritCard(4),

  { id: 'niYoNiLobo', name: 'Ni yo ni Lobo', type: 'inmediato', level: 'recordatorio',
    summary: 'Por superstición, nadie podrá volver a pronunciar las palabras "lobo" ni "yo". Quien lo haga pierde su próximo voto.',
    async run() { G.ev.niYoNiLobo = true; } }
];

/** Busca una carta por id. */
const eventById = (id) => EVENT_CARDS.find((e) => e.id === id);
/** Cartas distintas para el selector de mazo (las 5 de Espiritismo cuentan como una entrada ×5). */
const EVENT_KINDS = EVENT_CARDS.filter((e) => !e.id.startsWith('espiritismo')).concat([{ id: 'espiritismo', name: 'Espiritismo (×5)', type: 'inmediato' }]);
const TYPE_ICON = { inmediato: '🌕', temporal: '🌒', permanente: '🌑' };
