'use strict';
/* =====================================================================
 *  NARRADOR AUTOMÁTICO — Los Hombres Lobo de Castronegro: EL PACTO
 *  ---------------------------------------------------------------------
 *  PWA en Vanilla JS. Todo el juego es una MÁQUINA DE ESTADOS con estas
 *  fases (G.phase):
 *
 *    home → players → deck → reveal → public ─┬─→ day(0, solo con Ángel)
 *                                              └─→ night ⇄ dawn → day …
 *                                                              ↓
 *                                                          gameover
 *
 *  - Las fases de configuración (players/deck/reveal/public) son pantallas
 *    síncronas: cada botón cambia el estado y vuelve a pintar.
 *  - La NOCHE es un "secuenciador" asíncrono: recorre NIGHT_STEPS en el
 *    orden oficial del reglamento (pág. 24), habla con TTS y espera a que
 *    el jugador despierto toque la pantalla (promesas).
 *  - El AMANECER resuelve todas las acciones nocturnas a la vez (muertes
 *    simultáneas) y luego vacía la COLA DE TRIGGERS (Cazador, sucesión del
 *    Alguacil, Guardia…) antes de abrir el debate.
 *  - El DÍA es un "hub" con temporizador, votación y herramientas públicas
 *    (edificios de La Aldea, ajustes manuales).
 *
 *  Reglas extraídas del reglamento "El Pacto" (lui-même / Asmodee, 2014).
 * ===================================================================== */

/* ---------------------------------------------------------------------
 * 0. UTILIDADES
 * ------------------------------------------------------------------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const shuffle = (arr) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};
/** Escapa texto para insertarlo en innerHTML (los nombres los escribe la gente). */
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
/** Lista legible: "Ana, Luis y Marta". */
const joinNames = (arr) => (arr.length <= 1 ? arr.join('') : arr.slice(0, -1).join(', ') + ' y ' + arr[arr.length - 1]);

/** localStorage envuelto en try/catch (modo privado, almacenamiento bloqueado…). */
const store = {
  get(k, d = null) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* sin almacenamiento: seguimos */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* idem */ } }
};

/* ---------------------------------------------------------------------
 * 1. CATÁLOGO DE PERSONAJES (págs. 4-5, 7-15, 18-19, 23 del reglamento)
 *    team: lobo | aldeano | ambiguo | solitario   (bando inicial)
 *    max : copias físicas en la caja
 *    step: las Hermanas van de 2 en 2 y los Hermanos de 3 en 3
 *    w   : peso para el medidor de equilibrio (+ ayuda a la aldea, − a los lobos)
 *    needs: 'aldea' (requiere edificios) | 'luna' (requiere cartas de evento)
 *    min : nº mínimo de jugadores recomendado por el generador
 * ------------------------------------------------------------------- */
const ROLES = {
  // --- Los Hombres Lobo (pág. 8)
  lobo:       { name: 'Hombre Lobo Común', team: 'lobo', max: 4, w: -6, desc: 'Cada noche devora a un aldeano junto con la manada. Nunca puede devorar a otro Hombre Lobo.' },
  loboFeroz:  { name: 'Lobo Feroz', team: 'lobo', max: 1, w: -8, min: 8, desc: 'Ataca con la manada y, mientras no haya muerto ningún Hombre Lobo, Niño Salvaje o Perro Lobo, despierta otra vez para devorar a una segunda víctima él solo.' },
  infecto:    { name: 'Infecto Padre de todos los Lobos', team: 'lobo', max: 1, w: -9, min: 8, desc: 'Ataca con la manada. Una vez por partida puede infectar a la víctima en lugar de devorarla: se convierte en secreto en Hombre Lobo.' },
  // --- Los Aldeanos (págs. 9-12)
  aldeano:        { name: 'Aldeano Común', team: 'aldeano', max: 9, w: 1, desc: 'Sin poder especial. Sus armas: el análisis y la persuasión.' },
  aldeanoAldeano: { name: 'Aldeano-Aldeano', team: 'aldeano', max: 1, w: 2, desc: 'Su carta es Aldeano por ambas caras: todos saben que es inocente.' },
  vidente:    { name: 'Vidente', team: 'aldeano', max: 1, w: 7, desc: 'Cada noche descubre la carta de un jugador a su elección.' },
  cupido:     { name: 'Cupido', team: 'aldeano', max: 1, w: -1, desc: 'La primera noche enamora a 2 jugadores (puede incluirse). Si uno muere, el otro muere de pena.' },
  bruja:      { name: 'Bruja', team: 'aldeano', max: 1, w: 4, desc: 'Tiene una poción de vida (salva a la víctima de los lobos) y una de muerte. Cada una se usa una vez por partida.' },
  cazador:    { name: 'Cazador', team: 'aldeano', max: 1, w: 3, desc: 'Al morir, dispara y elimina inmediatamente a un jugador a su elección.' },
  nina:       { name: 'Niña Pequeña', team: 'aldeano', max: 1, w: 2, min: 6, desc: 'Puede espiar entreabriendo los ojos durante el turno de los lobos. Si la descubren, muere en lugar de la víctima.' },
  protector:  { name: 'Protector', team: 'aldeano', max: 1, w: 3, desc: 'Cada noche protege a un jugador del ataque de los lobos. Puede protegerse; no dos noches seguidas al mismo.' },
  anciano:    { name: 'Anciano', team: 'aldeano', max: 1, w: 2, desc: 'Resiste el primer ataque de los lobos. Si lo mata la aldea (voto, Bruja, Cazador, Barbero), todos los aldeanos pierden sus poderes.' },
  cabezaTurco:{ name: 'Cabeza de turco', team: 'aldeano', max: 1, w: 1, min: 6, desc: 'Si la votación empata, es él quien muere. Antes, decide quién podrá votar en el próximo linchamiento.' },
  tonto:      { name: 'Tonto de la aldea', team: 'aldeano', max: 1, w: 1, desc: 'Si la aldea lo vota, muestra su carta y lo indultan, pero pierde su voto para el resto de la partida.' },
  hermanas:   { name: 'Dos Hermanas', team: 'aldeano', max: 2, step: 2, w: 1.5, min: 10, desc: 'Se reconocen la primera noche.' },
  hermanos:   { name: 'Tres Hermanos', team: 'aldeano', max: 3, step: 3, w: 1, min: 12, desc: 'Se reconocen la primera noche.' },
  zorro:      { name: 'Zorro', team: 'aldeano', max: 1, w: 3, min: 6, desc: 'Cada noche señala a un jugador: sabrá si en ese grupo de 3 vecinos hay algún lobo. Si no lo hay, pierde su poder.' },
  domador:    { name: 'Domador de Osos', team: 'aldeano', max: 1, w: 3, min: 6, desc: 'Cada mañana el oso gruñe si alguno de sus vecinos vivos es un Hombre Lobo.' },
  juez:       { name: 'Juez Tartamudo', team: 'aldeano', max: 1, w: 3, min: 7, desc: 'Una vez por partida puede provocar dos votaciones consecutivas el mismo día.' },
  caballero:  { name: 'Caballero de la Espada Oxidada', team: 'aldeano', max: 1, w: 3, min: 7, desc: 'Si los lobos lo devoran, el lobo más cercano a su izquierda muere de herrumbre la noche siguiente.' },
  piromano:   { name: 'Pirómano', team: 'aldeano', max: 1, w: 2, needs: 'aldea', min: 7, desc: 'Una vez por partida incendia un edificio. Si era el de la víctima de los lobos, el lobo más cercano a su derecha muere carbonizado.' },
  cuervo:     { name: 'Cuervo', team: 'aldeano', max: 1, w: 2, needs: 'aldea', desc: 'Cada noche señala a un sospechoso: tendrá 2 votos más en contra en la siguiente votación. Nunca a un Vagabundo.' },
  gitana:     { name: 'Gitana', team: 'aldeano', max: 1, w: 2, needs: 'luna', desc: 'Cada noche puede designar a un médium que, por la mañana, hará una pregunta de Espiritismo al primer eliminado.' },
  // --- Los Ambiguos (págs. 13-14)
  ladron:     { name: 'Ladrón', team: 'ambiguo', max: 1, w: 0, min: 6, desc: 'La primera noche puede cambiar su carta por una de las 2 cartas sobrantes (obligado si ambas son lobos).' },
  sirvienta:  { name: 'Abnegada Sirvienta', team: 'ambiguo', max: 1, w: 1, min: 6, desc: 'Antes de revelar al linchado, puede revelarse y tomar en secreto su personaje.' },
  comediante: { name: 'Comediante', team: 'ambiguo', max: 1, w: 2, min: 7, desc: 'Cada noche puede usar el poder de una de las 3 cartas boca arriba hasta la noche siguiente (cada carta, una vez).' },
  ninoSalvaje:{ name: 'Niño Salvaje', team: 'ambiguo', max: 1, w: -1, min: 6, desc: 'La primera noche elige un modelo. Si su modelo muere, se convierte en Hombre Lobo.' },
  perroLobo:  { name: 'Perro Lobo', team: 'ambiguo', max: 1, w: -2, min: 7, desc: 'La primera noche decide si es Aldeano o Hombre Lobo. No puede cambiar.' },
  // --- Los Solitarios (pág. 15)
  albino:     { name: 'Hombre Lobo Albino', team: 'solitario', max: 1, w: -5, min: 10, desc: 'Ataca con la manada y, una noche de cada dos, puede devorar a un Hombre Lobo. Gana si es el único superviviente.' },
  angel:      { name: 'Ángel', team: 'solitario', max: 1, w: 0, min: 6, desc: 'Gana si es eliminado en la primera ronda (primera votación o primera noche). Si no, pasa a ser un Aldeano.' },
  flautista:  { name: 'Flautista', team: 'solitario', max: 1, w: -4, min: 9, desc: 'Cada noche hechiza a 2 jugadores. Gana cuando todos los vivos están hechizados.' },
  sectario:   { name: 'Abominable Sectario', team: 'solitario', max: 1, w: -2, min: 9, desc: 'La aldea se divide en 2 grupos. Gana si elimina a todo el grupo al que no pertenece.' }
};

/** Lobos "de nacimiento" (cuentan para el Barbero, pág. 17). */
const CORE_WOLVES = ['lobo', 'loboFeroz', 'infecto', 'albino'];
/** Aldeanos con poder que lo pierden si la aldea mata al Anciano (pág. 10). */
const VILLAGE_POWERS = ['vidente', 'bruja', 'cazador', 'protector', 'zorro', 'domador', 'juez', 'caballero', 'piromano', 'cuervo', 'gitana', 'cupido', 'nina'];
/** Cartas que el Comediante puede usar (sin lobos, pág. 14; poderes que la app puede gestionar). */
const COMEDIAN_OK = ['vidente', 'zorro', 'protector', 'cuervo', 'cazador', 'anciano', 'tonto', 'cabezaTurco', 'domador', 'caballero', 'nina', 'aldeanoAldeano'];

/* ---------------------------------------------------------------------
 * 2. EDIFICIOS DE "LA ALDEA" (págs. 16-18). Son PÚBLICOS.
 *    kind 'unico'      → el ocupante usa el poder una vez y entrega la ficha
 *    kind 'permanente' → poder toda la partida
 * ------------------------------------------------------------------- */
const BUILDINGS = {
  granja:       { name: 'Granja', occ: 'Granjero', token: 'Vaca', max: 6, kind: 'permanente', desc: 'Desde el 2.º turno, los Granjeros eligen entre ellos al Alguacil. Si muere, designa sucesor entre los Granjeros.' },
  iglesia:      { name: 'Iglesia', occ: 'Confesor', token: 'Rosario', max: 1, kind: 'unico', desc: 'En cualquier momento del día, obliga a un jugador a mostrarle su carta.' },
  choza:        { name: 'Choza', occ: 'Boticario', token: 'Mortero', max: 1, kind: 'unico', desc: 'En cualquier momento del día, restablece el poder único ya usado de otro edificio.' },
  escuela:      { name: 'Escuela', occ: 'Institutriz', token: 'Campana', max: 1, kind: 'permanente', desc: 'Antes de cada votación, prohíbe votar a 2 jugadores. Ella nunca vota.' },
  panaderia:    { name: 'Panadería', occ: 'Panadero', token: 'Pan', max: 1, kind: 'permanente', desc: 'Cada noche abre los ojos un instante justo después de que los lobos se duerman.' },
  barberia:     { name: 'Barbería', occ: 'Barbero', token: 'Navaja', max: 1, kind: 'unico', desc: 'De día degüella a un jugador. Si era lobo, lo felicitan; si no, también es ejecutado.' },
  taberna:      { name: 'Taberna', occ: 'Tabernero', token: 'Copa', max: 1, kind: 'permanente', desc: 'Los lobos no pueden devorarle ni la aldea votarle, hasta que vote contra un eliminado.' },
  ayuntamiento: { name: 'Ayuntamiento', occ: 'Alcalde', token: 'Llaves', max: 1, kind: 'permanente', desc: 'Aloja a Vagabundos en los edificios que quedan vacíos.' },
  palacete:     { name: 'Palacete', occ: 'Noble', token: 'Blasón', max: 1, kind: 'unico', desc: 'Tras una votación, puede indultar al condenado (una vez).' }
};

/** Cómo se describe cada causa de muerte en voz alta. */
const CAUSES = {
  lobos: 'ha sido devorado por los Hombres Lobo',
  feroz: 'ha sido devorado por el Lobo Feroz',
  bruja: 'ha sido envenenado durante la noche',
  albino: 'ha sido devorado por el Hombre Lobo Albino',
  fuego: 'ha muerto carbonizado en el incendio',
  oxido: 'ha muerto por la herrumbre de la espada oxidada',
  cazador: 'ha sido abatido por el Cazador',
  pena: 'muere de pena por la pérdida de su amor',
  linchamiento: 'ha sido linchado por la aldea',
  barbero: 'ha sido degollado por el Barbero',
  ejecucion: 'ha sido ejecutado por la aldea',
  evento: 'ha sido eliminado',
  castigo: 'ha sido castigado por la aldea',
  posesion: 'ha sido eliminado por el lobo que lo poseyó',
  fallido: 'ha muerto en un ataque fallido'
};

/* ---------------------------------------------------------------------
 * 3. EVENTOS DE "LUNA NUEVA": las 36 cartas oficiales están en eventos.js
 *    (EVENT_CARDS, SPIRIT_CARDS). Modos de juego (G.opts.eventMode):
 *      - 'fisico': el último eliminado roba y lee la carta real y se marca
 *        en la app cuál ha salido, para que la app aplique su efecto.
 *      - 'app'   : la app baraja el mazo, roba y lee la carta por voz.
 * ------------------------------------------------------------------- */

/* ---------------------------------------------------------------------
 * 4. VOZ DEL NARRADOR (Web Speech API · speechSynthesis)
 *    say() devuelve una promesa que se resuelve al terminar de hablar,
 *    lo que permite encadenar frases y pausas con await.
 * ------------------------------------------------------------------- */
const Settings = Object.assign(
  { voiceURI: null, rate: 0.95, muted: false, padding: 1.0, debateMin: 4 },
  store.get('narrador-settings', {})
);
const saveSettings = () => store.set('narrador-settings', Settings);

const Voice = {
  voices: [],
  init() {
    if (!('speechSynthesis' in window)) return;
    const load = () => { this.voices = speechSynthesis.getVoices().filter((v) => /^es/i.test(v.lang)); };
    load();
    speechSynthesis.onvoiceschanged = load; // Chrome carga las voces de forma asíncrona
  },
  /** Prioridad: voz elegida en ajustes → es-ES → cualquier español. */
  voice() {
    return this.voices.find((v) => v.voiceURI === Settings.voiceURI)
      || this.voices.find((v) => /es[-_]ES/i.test(v.lang))
      || this.voices[0] || null;
  },
  /** Habla un texto. Si no hay TTS o está silenciado, solo muestra el subtítulo y espera un tiempo proporcional. */
  say(text) {
    showCaption(text);
    if (Settings.muted || !('speechSynthesis' in window)) return sleep(Math.min(6000, 900 + text.length * 45));
    return new Promise((resolve) => {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'es-ES';
      const v = this.voice();
      if (v) u.voice = v;
      u.rate = Settings.rate;
      let done = false;
      const finish = () => { if (!done) { done = true; clearTimeout(guard); resolve(); } };
      u.onend = finish;
      u.onerror = finish;
      // Red de seguridad: algunos navegadores nunca disparan onend.
      const guard = setTimeout(finish, 3000 + text.length * 110);
      speechSynthesis.speak(u);
    });
  },
  stop() { if ('speechSynthesis' in window) speechSynthesis.cancel(); }
};
const say = (t) => Voice.say(t);
/** Pausa dramática, escalable desde ajustes. */
const pause = (ms) => sleep(ms * Settings.padding);

let captionTimer = null;
function showCaption(text) {
  const c = $('#caption');
  c.textContent = text;
  c.classList.add('show');
  clearTimeout(captionTimer);
  captionTimer = setTimeout(() => c.classList.remove('show'), 2500 + text.length * 60);
}

/* ---------------------------------------------------------------------
 * 5. ESTADO GLOBAL Y PERSISTENCIA
 * ------------------------------------------------------------------- */
const app = $('#app');
/** Estado de la partida en curso (serializable a JSON). */
let G = null;
/** Borrador de configuración antes de empezar la partida. */
let draft = store.get('narrador-draft', null) || { names: ['', '', '', '', ''], opts: { aldea: false, luna: false, eventMode: 'fisico', eventFreq: 1, eventsOff: [], guardCards: 3 }, deck: null, comedianCards: [] };
/** Contador de "flujos" asíncronos: si cambia, la noche en curso se aborta. */
let FLOW = 0;

const save = () => { if (G) store.set('narrador-game', G); };
const saveDraft = () => store.set('narrador-draft', draft);

/** Crea el estado inicial de una partida. */
function newGame() {
  const names = draft.names.map((n) => n.trim());
  G = {
    phase: 'reveal',
    opts: { ...draft.opts },
    deck: { ...draft.deck },
    comedianCards: [...draft.comedianCards],
    players: names.map((name, id) => ({
      id, name, card: null, role: null, alive: true, lives: 1,
      infected: false, charmed: false, tontoRevealed: false, canVote: true,
      dogWolf: false, wildModel: null, wildWolf: false, borrowed: null,
      building: null, group: null, hiddenCard: false, cause: null
    })),
    extraCards: [],          // cartas sobrantes (para el Ladrón)
    buildings: [],           // instancias de edificios (La Aldea)
    night: 0, day: 0,
    alguacil: null, guardia: null, alguacilLost: false,
    lovers: [],
    potions: { life: true, death: true, extra: 0 },
    infectUsed: false, foxActive: true, piromanoUsed: false, juezUsed: false, juezPending: false,
    lastProtect: {},         // por protector: id protegido la noche anterior
    wolfSideDied: false,     // apaga al Lobo Feroz
    villagersPowerless: false,
    angelWindow: true,
    rust: null,              // muerte diferida por el Caballero
    ravenMark: null,         // +2 votos del Cuervo
    medium: null,
    scapegoatVoters: null,
    sectarioCriterion: '',
    deaths: [], firstDeadId: null, lastDeadId: null,
    triggers: [],            // COLA DE TRIGGERS (Cazador, Alguacil, Guardia…)
    nightFlags: {}, dayFlags: {},
    nctx: null,              // acciones de la noche en curso
    votesLeft: 0, voted: false,
    events: [],              // eventos anunciados (Luna Nueva)
    eventBag: buildEventBag(draft.opts, draft.deck), // mazo de eventos barajado
    ev: { toqueMortal: false, sonambulismo: false, verdugo: null, enterramiento: false, niYoNiLobo: false, agentePending: false },
    guardHand: [], guardSince: null,                 // cartas confiadas al Guardia
    gitanaCards: draft.deck.gitana ? [0, 1, 2, 3, 4] : [], // Espiritismo en manos de la Gitana
    firstWolfVictim: null, lastWolfVictim: null,
    lynchCheck: null,        // Entusiasmo / Insatisfacción
    granuja: null, swap: null, loversHate: false,
    log: [],
    winner: null
  };
  save();
}

/**
 * Baraja el mazo de eventos con las cartas activadas. Si hay Gitana, el
 * narrador se queda las 5 de Espiritismo (pág. 23) y no entran en el mazo.
 */
function buildEventBag(opts, deck) {
  if (!opts.luna) return [];
  const off = opts.eventsOff || [];
  return shuffle(EVENT_CARDS.filter((e) => {
    if (e.id.startsWith('espiritismo')) return !off.includes('espiritismo') && !deck.gitana;
    return !off.includes(e.id);
  }).map((e) => e.id));
}

function log(msg) {
  const tag = G.phase === 'night' ? `Noche ${G.night}` : `Día ${G.day}`;
  G.log.push(`[${tag}] ${msg}`);
}

/* ---------------------------------------------------------------------
 * 6. CONSULTAS SOBRE JUGADORES
 *    El orden de los nombres = orden de asiento en el sentido de las agujas
 *    del reloj. Mirando al centro, el siguiente en ese sentido está a tu
 *    IZQUIERDA (+1) y el anterior a tu DERECHA (−1).
 * ------------------------------------------------------------------- */
const alive = () => G.players.filter((p) => p.alive);
const P = (id) => (id == null ? null : G.players[id]);
/** ¿Tiene el jugador este personaje (propio o prestado por el Comediante)? */
const is = (p, r) => !!p && (eff(p) === r || p.borrowed === r);
/** Personaje cuyo PODER usa hoy el jugador (Día de los Santos Inocentes los intercambia). */
const eff = (p) => p.swapRole || p.role;
/** El Anciano asesinado por la aldea apaga los poderes de los aldeanos. */
const powerless = (p) => G.villagersPowerless && VILLAGE_POWERS.includes(p.role);
/** ¿Juega con los lobos esta noche? (lobos, infectados, Perro Lobo/Niño Salvaje convertidos). */
const isWolfSide = (p) => CORE_WOLVES.includes(p.role) || p.infected
  || (p.role === 'perroLobo' && p.dogWolf) || (p.role === 'ninoSalvaje' && p.wildWolf);
const wolfPack = () => alive().filter(isWolfSide);
/** Jugador vivo con ese personaje y con su poder activo, o null. */
const actor = (role) => alive().find((p) => eff(p) === role && !powerless(p)) || null;
/** Jugadores que esta noche no pueden devorar ni ser devorados (eventos). */
const untouchable = (p) => (G.nightFlags.untouchable || []).includes(p.id);
const roleName = (r) => ROLES[r]?.name || r;
/** Primer eliminado que sigue muerto (el evento "Milagro" puede devolver a alguien a la partida). */
const firstStillDead = () => { const d = G.deaths.find((x) => !P(x.id).alive); return d ? P(d.id) : null; };
const inDeck = (r) => (G ? G.deck[r] || 0 : 0) > 0;

/** Vecino vivo más cercano en una dirección (+1 izquierda, −1 derecha). */
function aliveNeighbor(p, dir) {
  const n = G.players.length;
  for (let k = 1; k < n; k++) {
    const q = G.players[(p.id + dir * k + n * k) % n];
    if (q.alive && q.id !== p.id) return q;
  }
  return null;
}
/** Hombre Lobo vivo más cercano en una dirección (Caballero, Pirómano). */
function nearestWolf(p, dir) {
  const n = G.players.length;
  for (let k = 1; k < n; k++) {
    const q = G.players[(p.id + dir * k + n * k) % n];
    if (q.alive && isWolfSide(q)) return q;
  }
  return null;
}

/* Edificios ------------------------------------------------------------ */
const bOf = (p) => G.buildings.find((b) => b.occupant === p.id && !b.destroyed) || null;
const bByType = (t) => G.buildings.filter((b) => b.type === t && !b.destroyed);
/** Ocupante vivo de un edificio único (Barbería, Palacete…), o null. */
function occupant(type) {
  const b = bByType(type).find((x) => x.occupant != null && P(x.occupant).alive);
  return b ? P(b.occupant) : null;
}
const isVagabond = (p) => G.opts.aldea && !bOf(p);
const bLabel = (b) => `${BUILDINGS[b.type].name}${bByType(b.type).length > 1 || b.type === 'granja' ? ' ' + b.uid.replace(/\D/g, '') : ''}`;
/** Tabernero con inmunidad intacta (los lobos no pueden elegirle). */
const tavernImmune = (p) => { const b = bOf(p); return !!b && b.type === 'taberna' && !b.used; };

/* ---------------------------------------------------------------------
 * 7. GENERADOR DINÁMICO DE MAZOS (5+ jugadores)
 *    1) Lobos según tamaño: 5-6 → 1, 7-9 → 2, 10-13 → 3, 14-17 → 4, 18+ → 5.
 *       A partir de 8 jugadores algún lobo es "especial" (Feroz/Infecto/Albino).
 *    2) Información garantizada: Vidente siempre; Bruja/Protector desde 6;
 *       Zorro/Domador desde 8.
 *    3) Caos aleatorio: ~60 % de los huecos restantes con personajes
 *       distintos cada vez (respetando expansiones y mínimos).
 *    4) Relleno con Aldeanos Comunes. El Ladrón añade +2 Aldeanos (pág. 13).
 * ------------------------------------------------------------------- */
function suggestDeck(n, opts) {
  const d = {};
  const add = (id, k = 1) => { d[id] = (d[id] || 0) + k; };
  const count = () => Object.values(d).reduce((a, b) => a + b, 0);
  const allowed = (r) => !ROLES[r].needs || (ROLES[r].needs === 'aldea' ? opts.aldea : opts.luna);

  // 1) Manada
  const wolves = n <= 6 ? 1 : n <= 9 ? 2 : n <= 13 ? 3 : n <= 17 ? 4 : 5;
  const specials = [];
  if (n >= 8) specials.push(pick(['loboFeroz', 'infecto']));
  if (n >= 13) specials.push(specials[0] === 'loboFeroz' ? 'infecto' : 'loboFeroz');
  if (n >= 10 && Math.random() < 0.45) specials.push('albino');
  const sp = specials.slice(0, Math.max(0, wolves - 1)); // siempre queda ≥1 lobo común
  sp.forEach((r) => add(r));
  add('lobo', Math.min(4, wolves - sp.length));

  // 2) Información garantizada
  add('vidente');
  const healers = shuffle(['bruja', 'protector']);
  if (n >= 6) add(healers[0]);
  if (n >= 10) add(healers[1]);
  if (n >= 8) add(pick(['zorro', 'domador']));

  // 3) Caos: personajes distintos en cada partida
  const pool = shuffle(Object.keys(ROLES).filter((r) => !['lobo', 'loboFeroz', 'infecto', 'albino', 'aldeano', 'vidente', 'bruja', 'protector'].includes(r)
    && !d[r] && allowed(r) && (ROLES[r].min || 5) <= n));
  let slots = Math.max(1, Math.round((n - count()) * 0.6));
  for (const r of pool) {
    if (slots <= 0) break;
    const k = ROLES[r].step || 1;
    if (k > slots || count() + k > n) continue;
    add(r, k);
    slots -= k;
  }

  // 4) Relleno
  while (count() < n) {
    if ((d.aldeano || 0) < ROLES.aldeano.max) add('aldeano');
    else if (!d.aldeanoAldeano) add('aldeanoAldeano');
    else add('aldeano'); // más jugadores que cartas: se avisa en el editor
  }
  if (d.ladron) add('aldeano', 2); // las 2 cartas extra del Ladrón
  return d;
}

/** Sugiere 3 cartas boca arriba para el Comediante (que no estén en el mazo). */
function autoComedian(deck, opts) {
  if (!deck.comediante) return [];
  const ok = COMEDIAN_OK.filter((r) => !deck[r] && (!ROLES[r].needs || (ROLES[r].needs === 'aldea' ? opts.aldea : opts.luna)));
  return shuffle(ok).slice(0, 3);
}

/** Cartas que debe tener el mazo: jugadores + 2 si hay Ladrón. */
const requiredCards = (deck, n) => n + (deck.ladron ? 2 : 0);
const deckTotal = (deck) => Object.values(deck).reduce((a, b) => a + b, 0);
/** Índice de equilibrio: suma de pesos (positivo → favorece a la aldea). */
const deckBalance = (deck) => Object.entries(deck).reduce((s, [r, k]) => s + (ROLES[r]?.w || 0) * k, 0);

/* ---------------------------------------------------------------------
 * 8. RENDER BÁSICO Y MODO DÍA/NOCHE
 * ------------------------------------------------------------------- */
function setMode(mode) {
  document.body.classList.toggle('mode-night', mode === 'night');
  document.body.classList.toggle('mode-day', mode !== 'night');
  $('meta[name=theme-color]').setAttribute('content', mode === 'night' ? '#000000' : '#f4ecdc');
}
function render(html) {
  app.innerHTML = html;
  window.scrollTo(0, 0);
}

/* =====================================================================
 * 9. FASE: INICIO
 * =================================================================== */
function screenHome() {
  FLOW++;
  setMode('day');
  const saved = store.get('narrador-game', null);
  const canResume = saved && saved.phase && !['reveal', 'gameover'].includes(saved.phase);
  render(`
    <section class="stack">
      <div class="card center">
        <h1>Los Hombres Lobo de Castronegro</h1>
        <p class="muted">El Pacto · Narrador automático por voz</p>
        <p>Pon el dispositivo en el centro de la mesa. La app reparte el juego, llama a cada personaje por la noche
        y resuelve las muertes al amanecer. Todos los jugadores juegan: no hace falta narrador humano.</p>
      </div>
      <button class="btn primary xl block" data-a="new">Nueva partida</button>
      ${canResume ? `<button class="btn xl block" data-a="resume">Continuar partida guardada</button>` : ''}
      <div class="card small muted">
        Consejo: sube el volumen y prueba la voz en ☰ → Ajustes. En iPhone/iPad, desactiva el modo silencio.
      </div>
    </section>`);
  $('[data-a=new]').onclick = () => screenPlayers();
  const r = $('[data-a=resume]');
  if (r) r.onclick = () => { G = saved; resumeGame(); };
}

/** Retoma una partida guardada en el inicio de su fase. */
function resumeGame() {
  if (G.phase === 'public') return screenPublic();
  if (G.phase === 'night') return beginNightFromButton();
  if (G.phase === 'day') return renderDay();
  return screenHome();
}

/* =====================================================================
 * 10. FASE: JUGADORES Y EXPANSIONES
 * =================================================================== */
function screenPlayers() {
  G = null;
  const rows = draft.names.map((n, i) => `
    <div class="name-row">
      <span class="seat">${i + 1}</span>
      <input type="text" maxlength="18" value="${esc(n)}" data-i="${i}" placeholder="Nombre del jugador ${i + 1}" autocomplete="off">
      <button class="btn ghost" data-del="${i}" aria-label="Quitar" ${draft.names.length <= 5 ? 'disabled' : ''}>✕</button>
    </div>`).join('');
  render(`
    <section class="stack">
      <h2>¿Quién juega?</h2>
      <p class="muted">Escribid los nombres <b>en el orden en que estáis sentados</b>, siguiendo las agujas del reloj
      (importa para el Zorro, el Domador, el Caballero y el Pirómano). Mínimo 5.</p>
      <div class="card names">${rows}
        <button class="btn block" data-a="add">+ Añadir jugador</button>
      </div>
      <div class="card">
        <h3>Expansiones</h3>
        <label class="toggle"><input type="checkbox" id="opt-aldea" ${draft.opts.aldea ? 'checked' : ''}> La Aldea (edificios y oficios públicos)</label>
        <label class="toggle"><input type="checkbox" id="opt-luna" ${draft.opts.luna ? 'checked' : ''}> Luna Nueva (cartas de evento al amanecer)</label>
        <div id="luna-opts" ${draft.opts.luna ? '' : 'hidden'} class="stack">
          <div>
            <label for="opt-mode">Mazo de eventos</label>
            <select id="opt-mode">
              <option value="fisico" ${draft.opts.eventMode === 'fisico' ? 'selected' : ''}>Cartas físicas: se roba y lee la carta real, y se marca en la app</option>
              <option value="app" ${draft.opts.eventMode === 'app' ? 'selected' : ''}>Mazo de la app: la app roba y lee la carta</option>
            </select>
          </div>
          <div>
            <label for="opt-freq">Frecuencia</label>
            <select id="opt-freq">
              ${[1, 2, 3].map((f) => `<option value="${f}" ${+draft.opts.eventFreq === f ? 'selected' : ''}>${f === 1 ? 'Cada mañana (excepto la primera)' : `Cada ${f} mañanas (recomendado al empezar)`}</option>`).join('')}
            </select>
          </div>
          <div>
            <label for="opt-guard">Cartas que se confían al Guardia</label>
            <select id="opt-guard">${[0, 1, 2, 3, 4, 5].map((k) => `<option value="${k}" ${+(draft.opts.guardCards ?? 3) === k ? 'selected' : ''}>${k}${k === 5 ? ' (máximo recomendado)' : ''}</option>`).join('')}</select>
          </div>
          <details>
            <summary><b>Cartas del mazo de eventos</b> <span class="small muted">(desmarca las que no quieras usar)</span></summary>
            <p class="small muted">🌕 inmediato · 🌒 temporal · 🌑 permanente. Si hay Gitana, las 5 de Espiritismo son suyas y no entran en el mazo.</p>
            <div class="stack">${EVENT_KINDS.map((e) => `
              <label class="toggle"><input type="checkbox" data-ev="${e.id}" ${(draft.opts.eventsOff || []).includes(e.id) ? '' : 'checked'}> ${TYPE_ICON[e.type]} ${esc(e.name)}</label>`).join('')}
            </div>
          </details>
        </div>
      </div>
      <div class="status-bar row spread">
        <button class="btn" data-a="back">Volver</button>
        <button class="btn primary" data-a="next">Siguiente: mazo →</button>
      </div>
    </section>`);

  $$('input[data-i]').forEach((inp) => { inp.oninput = () => { draft.names[+inp.dataset.i] = inp.value; saveDraft(); }; });
  $$('[data-del]').forEach((b) => { b.onclick = () => { draft.names.splice(+b.dataset.del, 1); saveDraft(); screenPlayers(); }; });
  $('[data-a=add]').onclick = () => { draft.names.push(''); saveDraft(); screenPlayers(); $$('input[data-i]').pop().focus(); };
  $('#opt-aldea').onchange = (e) => { draft.opts.aldea = e.target.checked; draft.deck = null; saveDraft(); };
  $('#opt-luna').onchange = (e) => { draft.opts.luna = e.target.checked; draft.deck = null; $('#luna-opts').hidden = !e.target.checked; saveDraft(); };
  $('#opt-mode').onchange = (e) => { draft.opts.eventMode = e.target.value; saveDraft(); };
  $('#opt-freq').onchange = (e) => { draft.opts.eventFreq = +e.target.value; saveDraft(); };
  $('#opt-guard').onchange = (e) => { draft.opts.guardCards = +e.target.value; saveDraft(); };
  $$('[data-ev]').forEach((c) => {
    c.onchange = () => {
      const off = new Set(draft.opts.eventsOff || []);
      if (c.checked) off.delete(c.dataset.ev); else off.add(c.dataset.ev);
      draft.opts.eventsOff = [...off];
      saveDraft();
    };
  });
  $('[data-a=back]').onclick = screenHome;
  $('[data-a=next]').onclick = () => {
    const names = draft.names.map((n) => n.trim());
    if (names.length < 5 || names.some((n) => !n)) return alert('Hacen falta al menos 5 jugadores, todos con nombre.');
    if (new Set(names.map((n) => n.toLowerCase())).size !== names.length) return alert('Hay nombres repetidos: añadid una inicial para distinguirlos.');
    if (!draft.deck || draft.deckFor !== names.length) { draft.deck = suggestDeck(names.length, draft.opts); draft.deckFor = names.length; draft.comedianCards = autoComedian(draft.deck, draft.opts); }
    saveDraft();
    screenDeck();
  };
}

/* =====================================================================
 * 11. FASE: MAZO (sugerencia editable)
 * =================================================================== */
function screenDeck() {
  const n = draft.names.length;
  const deck = draft.deck;
  const total = deckTotal(deck);
  const need = requiredCards(deck, n);
  const bal = deckBalance(deck);
  const wolvesIn = ['lobo', 'loboFeroz', 'infecto', 'albino'].reduce((s, r) => s + (deck[r] || 0), 0);
  const allowed = (r) => !ROLES[r].needs || (ROLES[r].needs === 'aldea' ? draft.opts.aldea : draft.opts.luna);
  const groups = [['lobo', 'Los Hombres Lobo'], ['aldeano', 'Los Aldeanos'], ['ambiguo', 'Los Ambiguos'], ['solitario', 'Los Solitarios']];

  // Las 3 cartas del Comediante (boca arriba, fuera del reparto).
  const comOk = !deck.comediante || draft.comedianCards.length === 3;
  const comedianBlock = deck.comediante ? `
    <div class="card">
      <h3>Cartas del Comediante (elige 3, boca arriba en el centro)</h3>
      <p class="small muted">Tienen que ser cartas físicas que no estén en el reparto. Nunca lobos.</p>
      <div class="row">${COMEDIAN_OK.filter(allowed).map((r) => `
        <label class="toggle"><input type="checkbox" data-com="${r}" ${draft.comedianCards.includes(r) ? 'checked' : ''}> ${roleName(r)}</label>`).join('')}
      </div>
    </div>` : '';

  const pct = Math.max(0, Math.min(100, 50 + bal * 2.2));
  const balTxt = bal > 6 ? 'favorece a la aldea' : bal < -6 ? 'favorece a los lobos' : 'equilibrado';

  render(`
    <section class="stack">
      <h2>Mazo para ${n} jugadores</h2>
      <p class="muted">Sugerencia automática: ajústala con − / + para que coincida con las cartas físicas que vais a repartir.</p>
      <div class="card">
        <div class="row spread"><b>Equilibrio:</b><span class="pill">${balTxt} (${bal > 0 ? '+' : ''}${bal.toFixed(1)})</span></div>
        <div class="meter" style="margin-top:10px"><span class="needle" style="left:${pct}%"></span></div>
        <div class="row spread small muted" style="margin-top:4px"><span>Lobos</span><span>Aldea</span></div>
      </div>
      ${groups.map(([team, title]) => `
        <div class="card deck-group">
          <h3 class="team-${team}">${title}</h3>
          ${Object.entries(ROLES).filter(([, r]) => r.team === team).filter(([id]) => allowed(id)).map(([id, r]) => `
            <div class="deck-row">
              <div><div class="name">${r.name}</div><div class="desc">${r.desc}</div></div>
              <div class="stepper">
                <button data-dec="${id}" aria-label="Quitar ${r.name}">−</button>
                <output>${deck[id] || 0}</output>
                <button data-inc="${id}" aria-label="Añadir ${r.name}">+</button>
              </div>
            </div>`).join('')}
        </div>`).join('')}
      ${comedianBlock}
      <div class="status-bar">
        <p class="center"><b>${total}</b> cartas de <b>${need}</b> necesarias
          ${deck.ladron ? '<span class="small muted">(jugadores + 2 sobrantes para el Ladrón)</span>' : ''}</p>
        ${wolvesIn === 0 ? '<p class="center team-lobo">Falta al menos un Hombre Lobo.</p>' : ''}
        <div class="row spread">
          <button class="btn" data-a="back">← Jugadores</button>
          <button class="btn" data-a="again">🎲 Otra sugerencia</button>
          <button class="btn primary" data-a="next" ${total !== need || !wolvesIn || !comOk ? 'disabled' : ''}>Repartir →</button>
        </div>
      </div>
    </section>`);

  const bump = (id, delta) => {
    const r = ROLES[id];
    const k = (r.step || 1) * delta;
    const v = (deck[id] || 0) + k;
    if (v < 0 || v > Math.max(r.max, id === 'aldeano' ? 30 : r.max)) return;
    // El Ladrón trae consigo sus 2 Aldeanos extra (pág. 13).
    if (id === 'ladron') deck.aldeano = Math.max(0, (deck.aldeano || 0) + 2 * delta);
    deck[id] = v;
    if (!deck[id]) delete deck[id];
    if (id === 'comediante' && !deck.comediante) draft.comedianCards = [];
    saveDraft();
    const y = window.scrollY;
    screenDeck();
    window.scrollTo(0, y);
  };
  $$('[data-inc]').forEach((b) => { b.onclick = () => bump(b.dataset.inc, +1); });
  $$('[data-dec]').forEach((b) => { b.onclick = () => bump(b.dataset.dec, -1); });
  $$('[data-com]').forEach((c) => {
    c.onchange = () => {
      const r = c.dataset.com;
      draft.comedianCards = c.checked ? [...draft.comedianCards, r] : draft.comedianCards.filter((x) => x !== r);
      if (draft.comedianCards.length > 3) draft.comedianCards.shift();
      saveDraft();
      const y = window.scrollY; screenDeck(); window.scrollTo(0, y);
    };
  });
  $('[data-a=back]').onclick = screenPlayers;
  $('[data-a=again]').onclick = () => { draft.deck = suggestDeck(n, draft.opts); draft.comedianCards = autoComedian(draft.deck, draft.opts); saveDraft(); screenDeck(); };
  $('[data-a=next]').onclick = () => { newGame(); screenReveal(0, 'handoff'); };
}

/* =====================================================================
 * 12. FASE: REPARTO SECRETO "PASS & PLAY"
 *     handoff → pick → confirm → (oculto) → handoff del siguiente
 *     Ningún botón se desactiva según lo que eligieron otros, para no
 *     filtrar información; la comprobación de cartas es global al final.
 * =================================================================== */
function screenReveal(i, stage, chosen = null) {
  setMode('day');
  const p = G.players[i];
  if (!p) return finishReveal();
  if (stage === 'handoff') {
    render(`
      <section class="handoff">
        <p class="muted">Reparto secreto · ${i + 1} de ${G.players.length}</p>
        <p>Pasa el dispositivo a</p>
        <div class="who">${esc(p.name)}</div>
        <p class="muted small">Mira tu carta física sin que nadie la vea.</p>
        <button class="btn primary xl" data-a="go">Soy ${esc(p.name)}: continuar</button>
      </section>`);
    $('[data-a=go]').onclick = () => screenReveal(i, 'pick');
  } else if (stage === 'pick') {
    const roles = Object.keys(G.deck).filter((r) => G.deck[r] > 0);
    render(`
      <section class="stack">
        <h2>${esc(p.name)}, ¿qué carta te ha tocado?</h2>
        <div class="grid">${roles.map((r) => `<button class="btn" data-r="${r}">${roleName(r)}</button>`).join('')}</div>
      </section>`);
    $$('[data-r]').forEach((b) => { b.onclick = () => screenReveal(i, 'confirm', b.dataset.r); });
  } else if (stage === 'confirm') {
    const r = ROLES[chosen];
    render(`
      <section class="handoff">
        <p>${esc(p.name)}, eres</p>
        <div class="secret">${r.name}</div>
        <p class="card" style="max-width:560px">${r.desc}</p>
        <div class="row">
          <button class="btn" data-a="back">← Cambiar</button>
          <button class="btn primary xl" data-a="ok">Confirmar y ocultar</button>
        </div>
      </section>`);
    $('[data-a=back]').onclick = () => screenReveal(i, 'pick');
    $('[data-a=ok]').onclick = () => {
      p.card = p.role = chosen;
      p.lives = chosen === 'anciano' ? 2 : 1;
      save();
      screenReveal(i + 1, 'handoff');
    };
  }
}

/** Comprueba el reparto y calcula las cartas sobrantes (Ladrón). */
function finishReveal() {
  const used = {};
  G.players.forEach((p) => { used[p.role] = (used[p.role] || 0) + 1; });
  const over = Object.keys(used).some((r) => used[r] > (G.deck[r] || 0));
  G.extraCards = [];
  Object.entries(G.deck).forEach(([r, k]) => { for (let j = 0; j < k - (used[r] || 0); j++) G.extraCards.push(r); });
  if (over) {
    render(`
      <section class="handoff">
        <h2>El reparto no cuadra</h2>
        <p>Alguien ha marcado una carta que no está en el mazo (o hay más copias de las que hay).
        No se dice cuál para no desvelar nada.</p>
        <div class="row">
          <button class="btn" data-a="redo">Repetir el reparto</button>
          <button class="btn primary" data-a="go">Seguir igualmente</button>
        </div>
      </section>`);
    $('[data-a=redo]').onclick = () => screenReveal(0, 'handoff');
    $('[data-a=go]').onclick = screenPublic;
    return;
  }
  screenPublic();
}

/* =====================================================================
 * 13. FASE PÚBLICA: edificios, Alguacil, grupos del Sectario
 * =================================================================== */
function screenPublic() {
  G.phase = 'public';
  setMode('day');
  save();
  const pubAssign = G._pub || (G._pub = { buildings: {}, alguacil: '', guardia: '', groups: {} });
  const opts = Object.keys(BUILDINGS).map((t) => `<option value="${t}">${BUILDINGS[t].name} (${BUILDINGS[t].occ})</option>`).join('');
  const sectario = inDeck('sectario');

  render(`
    <section class="stack">
      <h2>Fase pública</h2>
      <p class="muted">Todo lo de esta pantalla se hace a la vista de todos. Dejad las cartas de personaje boca abajo delante de cada uno.</p>
      ${G.opts.aldea ? `
      <div class="card">
        <h3>La Aldea: ¿quién ocupa cada edificio?</h3>
        <p class="small muted">Quien no tenga edificio es Vagabundo. Hay 6 granjas y 1 de cada edificio restante.</p>
        <div class="stack">${G.players.map((p) => `
          <div class="row"><b class="grow">${esc(p.name)}</b>
            <select data-b="${p.id}" style="max-width:260px"><option value="">Vagabundo</option>${opts}</select></div>`).join('')}
        </div>
        <button class="btn block" data-a="randb" style="margin-top:10px">🎲 Repartir al azar</button>
      </div>` : ''}
      <div class="card">
        <h3>Alguacil (su voto cuenta doble)</h3>
        <select id="alg"><option value="">Elegir más tarde</option>${G.players.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select>
        ${G.opts.luna ? `<h3 style="margin-top:12px">Guardia (lo nombra el Alguacil)</h3>
        <select id="grd"><option value="">Ninguno por ahora</option>${G.players.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select>` : ''}
      </div>
      ${sectario ? `
      <div class="card">
        <h3>Abominable Sectario: dos grupos</h3>
        <label for="crit">Criterio (gafas, edad, altura…)</label>
        <input type="text" id="crit" value="${esc(G.sectarioCriterion)}" placeholder="Ej.: llevan gafas / no llevan gafas">
        <div class="stack" style="margin-top:10px">${G.players.map((p) => `
          <div class="row"><b class="grow">${esc(p.name)}</b>
            <button class="btn ${pubAssign.groups[p.id] === 'A' ? 'primary' : ''}" data-g="${p.id}" data-v="A">Grupo A</button>
            <button class="btn ${pubAssign.groups[p.id] === 'B' ? 'primary' : ''}" data-g="${p.id}" data-v="B">Grupo B</button></div>`).join('')}
        </div>
      </div>` : ''}
      ${inDeck('angel') ? `<div class="card"><b>Hay un Ángel en juego:</b> la partida empieza con un debate y una votación antes de la primera noche.</div>` : ''}
      <div class="status-bar">
        <button class="btn primary xl block" data-a="start">${inDeck('angel') ? 'Empezar: primer debate' : 'Empezar la primera noche'}</button>
      </div>
    </section>`);

  // Restaurar selecciones previas
  $$('select[data-b]').forEach((s) => { s.value = pubAssign.buildings[s.dataset.b] || ''; s.onchange = () => { pubAssign.buildings[s.dataset.b] = s.value; }; });
  const alg = $('#alg'); alg.value = pubAssign.alguacil; alg.onchange = () => { pubAssign.alguacil = alg.value; };
  const grd = $('#grd'); if (grd) { grd.value = pubAssign.guardia; grd.onchange = () => { pubAssign.guardia = grd.value; }; }
  const crit = $('#crit'); if (crit) crit.oninput = () => { G.sectarioCriterion = crit.value; };
  $$('[data-g]').forEach((b) => { b.onclick = () => { pubAssign.groups[b.dataset.g] = b.dataset.v; screenPublic(); }; });
  const rb = $('[data-a=randb]');
  if (rb) rb.onclick = () => {
    const pool = shuffle([...Array(6).fill('granja'), ...Object.keys(BUILDINGS).filter((t) => t !== 'granja')]);
    shuffle(G.players).forEach((p, k) => { pubAssign.buildings[p.id] = pool[k] || ''; });
    screenPublic();
  };

  $('[data-a=start]').onclick = () => {
    // Validar edificios: no más copias de las que existen.
    if (G.opts.aldea) {
      const cnt = {};
      Object.values(pubAssign.buildings).filter(Boolean).forEach((t) => { cnt[t] = (cnt[t] || 0) + 1; });
      const bad = Object.keys(cnt).find((t) => cnt[t] > BUILDINGS[t].max);
      if (bad) return alert(`Solo hay ${BUILDINGS[bad].max} ${BUILDINGS[bad].name}(s).`);
      // Crear instancias (también las de edificios vacíos: el Alcalde puede realojar).
      G.buildings = [];
      Object.keys(BUILDINGS).forEach((t) => {
        for (let k = 1; k <= BUILDINGS[t].max; k++) G.buildings.push({ uid: `${t}${k}`, type: t, occupant: null, used: false, destroyed: false });
      });
      G.players.forEach((p) => {
        const t = pubAssign.buildings[p.id];
        if (!t) return;
        const b = G.buildings.find((x) => x.type === t && x.occupant == null);
        b.occupant = p.id;
      });
      // Los edificios no asignados al empezar no existen en la mesa.
      G.buildings = G.buildings.filter((b) => b.occupant != null);
    }
    if (sectario) {
      if (G.players.some((p) => !pubAssign.groups[p.id])) return alert('Asigna un grupo (A o B) a cada jugador.');
      G.players.forEach((p) => { p.group = pubAssign.groups[p.id]; });
    }
    G.alguacil = pubAssign.alguacil === '' ? null : +pubAssign.alguacil;
    setGuardia(grd && pubAssign.guardia !== '' ? +pubAssign.guardia : null);
    delete G._pub;
    if (inDeck('angel')) {
      // Ronda 0 del Ángel: debate + votación antes de la primera noche (pág. 15).
      G.day = 0;
      G.votesLeft = 1;
      G.voted = false;
      G.dayFlags = {};
      say('Hay un Ángel entre vosotros. La partida empieza con un debate y una votación antes de la primera noche.');
      renderDay();
    } else {
      beginNightFromButton();
    }
  };
}

/* =====================================================================
 * 14. PRIMITIVAS DE INTERFAZ ASÍNCRONAS (noche y triggers)
 *     Cada una pinta una pantalla y devuelve una PROMESA que se resuelve
 *     con lo que toque el jugador. Así la noche se escribe de forma lineal:
 *        const t = await pickUI({...});
 * =================================================================== */
let pendingResolve = null; // para el botón "Saltar paso"

/** Herramientas discretas de noche (saltar / menú). */
const nightTools = () => `<div class="night-tools"><button class="btn small" data-skip>Saltar paso</button></div>`;
function bindNightTools() {
  const s = $('[data-skip]');
  if (s) s.onclick = () => { if (pendingResolve) { const r = pendingResolve; pendingResolve = null; r(null); } };
}

/** Pantalla de "todos duermen" entre llamadas. */
function showSleeping(text = 'La aldea duerme…') {
  setMode('night');
  render(`<div class="sleeping"><div><div class="moon"></div>${esc(text)}</div></div>`);
}

/**
 * Selector de jugadores.
 * @returns {Promise<number[]|string|null>} ids elegidos, valor de un botón extra, o null si se saltó.
 */
function pickUI({ mode = 'night', role = '', q = '', count = 1, min = count, candidates, allowNone = false, noneLabel = 'No hacer nada', extra = [] }) {
  return new Promise((resolve) => {
    if (!candidates.length) return resolve([]); // nadie elegible: no bloquear el flujo
    pendingResolve = resolve;
    setMode(mode);
    const sel = new Set();
    const done = (v) => { pendingResolve = null; resolve(v); };
    const draw = () => {
      render(`
        <section>
          ${role ? `<div class="night-role">${esc(role)}</div>` : ''}
          <div class="night-q">${q}</div>
          <div class="grid">${candidates.map((p) => `<button class="btn ${sel.has(p.id) ? 'selected' : ''}" data-p="${p.id}">${esc(p.name)}</button>`).join('')}</div>
          <div class="row" style="margin-top:18px">
            ${count > 1 ? `<button class="btn primary grow" data-ok ${sel.size < Math.min(min, candidates.length) ? 'disabled' : ''}>Confirmar (${sel.size}/${count})</button>` : ''}
            ${allowNone ? `<button class="btn grow" data-none>${esc(noneLabel)}</button>` : ''}
            ${extra.map((x, k) => `<button class="btn grow" data-x="${k}">${esc(x.label)}</button>`).join('')}
          </div>
        </section>${mode === 'night' ? nightTools() : ''}`);
      $$('[data-p]').forEach((b) => {
        b.onclick = () => {
          const id = +b.dataset.p;
          if (count === 1) return done([id]);
          if (sel.has(id)) sel.delete(id); else if (sel.size < count) sel.add(id);
          draw();
        };
      });
      const ok = $('[data-ok]'); if (ok) ok.onclick = () => done([...sel]);
      const no = $('[data-none]'); if (no) no.onclick = () => done([]);
      $$('[data-x]').forEach((b) => { b.onclick = () => done(extra[+b.dataset.x].value); });
      if (mode === 'night') bindNightTools();
    };
    draw();
  });
}

/** Elección entre opciones. @returns {Promise<any>} el value elegido (o null si se saltó). */
function choiceUI({ mode = 'night', role = '', q = '', body = '', options }) {
  return new Promise((resolve) => {
    pendingResolve = resolve;
    setMode(mode);
    render(`
      <section>
        ${role ? `<div class="night-role">${esc(role)}</div>` : ''}
        <div class="night-q">${q}</div>
        ${body ? `<div class="card" style="margin-bottom:14px">${body}</div>` : ''}
        <div class="stack">${options.map((o, k) => `<button class="btn xl block ${o.primary ? 'primary' : ''}" data-o="${k}">${esc(o.label)}</button>`).join('')}</div>
      </section>${mode === 'night' ? nightTools() : ''}`);
    $$('[data-o]').forEach((b) => { b.onclick = () => { pendingResolve = null; resolve(options[+b.dataset.o].value); }; });
    if (mode === 'night') bindNightTools();
  });
}

/** Mensaje con un único botón. */
function infoUI({ mode = 'night', role = '', title = '', big = '', body = '', button = 'Listo' }) {
  return choiceUI({ mode, role, q: esc(title), body: (big ? `<div class="night-big">${esc(big)}</div>` : '') + body, options: [{ label: button, value: true, primary: true }] });
}

/* =====================================================================
 * 15. LA NOCHE: ORDEN DE LLAMADA (reglamento, pág. 24)
 *
 *   Primera noche:  Ladrón · Comediante · Cupido · Vidente · Zorro ·
 *     Enamorados · Juez · Dos Hermanas · Tres Hermanos · Niño Salvaje ·
 *     (Domador: la app ya lo conoce) · Cuervo · Pirómano · Protector ·
 *     [Perro Lobo decide] · Hombres Lobo · (Niña espía) · Panadero ·
 *     Infecto Padre · Lobo Feroz · Bruja · Gitana · Flautista · Hechizados
 *
 *   Cada noche: Comediante · Vidente · Zorro · Cuervo · Pirómano ·
 *     Protector · Hombres Lobo · (Niña) · Panadero · Albino (1 de cada 2) ·
 *     Infecto Padre · Lobo Feroz · Bruja · Gitana · Flautista · Hechizados
 *
 *   Cada paso: { id, when(): ¿se llama esta noche?, run(): acción async }.
 *   `when` se evalúa justo antes de llamar al paso, así que puede depender
 *   de lo ocurrido antes esa misma noche (p. ej. el Infecto necesita víctima).
 * =================================================================== */
const N1 = () => G.night === 1;
const NIGHT_STEPS = [
  { id: 'ladron', when: () => N1() && actor('ladron') && G.extraCards.length >= 2, run: stepLadron },
  { id: 'comediante', when: () => actor('comediante') && G.comedianCards.length > 0, run: stepComediante },
  { id: 'cupido', when: () => N1() && actor('cupido'), run: stepCupido },
  { id: 'vidente', when: () => actor('vidente'), run: () => powerVidente(actor('vidente'), 'La Vidente') },
  { id: 'zorro', when: () => actor('zorro') && G.foxActive, run: () => powerZorro(actor('zorro'), 'El Zorro', true) },
  { id: 'enamorados', when: () => N1() && G.lovers.length === 2, run: stepEnamorados },
  { id: 'juez', when: () => actor('juez') && !G.juezUsed, run: stepJuez },
  { id: 'hermanas', when: () => N1() && alive().filter((p) => p.role === 'hermanas').length > 1, run: () => stepRecognize('Las Dos Hermanas se despiertan', 'Las Dos Hermanas') },
  { id: 'hermanos', when: () => N1() && alive().filter((p) => p.role === 'hermanos').length > 1, run: () => stepRecognize('Los Tres Hermanos se despiertan', 'Los Tres Hermanos') },
  { id: 'ninoSalvaje', when: () => N1() && actor('ninoSalvaje'), run: stepNinoSalvaje },
  { id: 'cuervo', when: () => G.opts.aldea && actor('cuervo'), run: () => powerCuervo(actor('cuervo'), 'El Cuervo') },
  { id: 'piromano', when: () => G.opts.aldea && actor('piromano') && !G.piromanoUsed, run: stepPiromano },
  { id: 'protector', when: () => actor('protector'), run: () => powerProtector(actor('protector'), 'El Protector') },
  { id: 'perroLobo', when: () => N1() && actor('perroLobo'), run: stepPerroLobo },
  { id: 'casiLlena', when: () => !!G.nightFlags.almostFull, run: stepCasiLlena },
  { id: 'lobos', when: () => wolfPack().length > 0, run: stepLobos },
  { id: 'panadero', when: () => G.opts.aldea && occupant('panaderia') && wolfPack().length > 0, run: stepPanadero },
  { id: 'albino', when: () => actor('albino') && !untouchable(actor('albino')) && G.night >= 2 && G.night % 2 === 0, run: stepAlbino },
  { id: 'infecto', when: () => actor('infecto') && !G.infectUsed && G.nctx.wolfTargets.length > 0, run: stepInfecto },
  { id: 'loboFeroz', when: () => actor('loboFeroz') && !untouchable(actor('loboFeroz')) && !G.wolfSideDied && !G.nightFlags.flood && !G.nightFlags.possession && !G.nightFlags.failedAttack, run: stepLoboFeroz },
  { id: 'bruja', when: () => actor('bruja') && (G.potions.life || G.potions.death || G.potions.extra > 0), run: stepBruja },
  { id: 'gitana', when: () => G.opts.luna && actor('gitana') && G.gitanaCards.length > 0, run: stepGitana },
  { id: 'flautista', when: () => actor('flautista') && !isWolfSide(actor('flautista')), run: stepFlautista },
  { id: 'hechizados', when: () => alive().some((p) => p.charmed), run: stepHechizados },
  // Evento "Agente doble": una sola vez, cuando ya hay un primer eliminado.
  { id: 'agenteDoble', when: () => G.ev.agentePending && firstStillDead() && wolfPack().length > 0 && alive().some((p) => !isWolfSide(p)), run: stepAgenteDoble }
];
/** Luna "casi" llena: estos pasos se sustituyen esa noche por stepCasiLlena. */
const ALMOST_FULL_SKIP = ['vidente', 'lobos', 'infecto', 'loboFeroz', 'albino', 'bruja'];

/** Arranca la noche desde un toque del usuario (necesario para que el navegador permita hablar). */
function beginNightFromButton() {
  G.phase = 'night';
  save();
  setMode('night');
  render(`
    <section class="handoff">
      <div class="moon"></div>
      <h2>Noche ${G.night + 1}</h2>
      <p>Colocad el dispositivo en el centro. Cuando la voz llame a vuestro personaje, abrid los ojos y tocad la pantalla en silencio.</p>
      <button class="btn primary xl" data-a="go">Comenzar la noche</button>
    </section>`);
  $('[data-a=go]').onclick = runNight;
}

/** SECUENCIADOR NOCTURNO: recorre NIGHT_STEPS y al final resuelve el amanecer. */
async function runNight() {
  const flow = ++FLOW;
  requestWakeLock();
  G.night += 1;
  G.phase = 'night';
  // Acciones registradas esta noche (se resuelven todas juntas al amanecer).
  G.nctx = { wolfTargets: [], ninaCaught: false, infect: false, ferozTarget: null, protected: [], heal: [], poison: null, albinoKill: null, fire: null, raven: null, medium: null, mediumQ: null, possessionKill: null, failedKillWolf: null };
  // El poder prestado del Comediante dura "hasta la noche siguiente".
  G.players.forEach((p) => { if (p.borrowed) { if (p.borrowed === 'anciano' && p.role !== 'anciano') p.lives = 1; p.borrowed = null; } });
  log('Cae la noche.');

  showSleeping();
  await say('Se hace de noche. La aldea duerme. Los jugadores cierran los ojos.');
  await pause(2500);

  for (const st of NIGHT_STEPS) {
    if (flow !== FLOW) return; // la partida se abandonó
    if ((G.nightFlags.skip || []).includes(st.id)) continue;
    if (G.nightFlags.almostFull && ALMOST_FULL_SKIP.includes(st.id)) continue;
    let ok = false;
    try { ok = !!st.when(); } catch { ok = false; }
    if (!ok) continue;
    await st.run();
    if (flow !== FLOW) return;
    showSleeping();
    // Pausa aleatoria entre llamadas: nadie puede deducir nada por los tiempos.
    await pause(rand(1200, 2600));
  }
  if (flow !== FLOW) return;
  G.nightFlags = {};
  await resolveDawn();
}

/* ---------- Pasos de la noche (cada uno habla, espera la acción y duerme) ---------- */

async function stepLadron() {
  const p = actor('ladron');
  const [a, b] = G.extraCards;
  const bothWolves = CORE_WOLVES.includes(a) && CORE_WOLVES.includes(b);
  await say('El Ladrón se despierta. Puede mirar las dos cartas del centro y cambiar la suya por una de ellas.');
  const opts = [];
  if (!bothWolves) opts.push({ label: 'Quedarme como Ladrón', value: null });
  opts.push({ label: `Tomar: ${roleName(a)}`, value: 0, primary: true });
  if (b !== a) opts.push({ label: `Tomar: ${roleName(b)}`, value: 1, primary: true });
  const r = await choiceUI({ role: 'Ladrón', q: `Cartas del centro: <b>${roleName(a)}</b> y <b>${roleName(b)}</b>${bothWolves ? '<br>Ambas son lobos: estás obligado a cambiar.' : ''}`, options: opts });
  if (r === 0 || r === 1) {
    const newRole = G.extraCards[r];
    G.extraCards[r] = 'ladron';
    p.role = newRole;
    p.lives = newRole === 'anciano' ? 2 : 1;
    log(`${p.name} (Ladrón) se convierte en ${roleName(newRole)}.`);
  }
  await say('Cambia tu carta en la mesa si lo has decidido. El Ladrón se vuelve a dormir.');
}

async function stepComediante() {
  const p = actor('comediante');
  await say('El Comediante se despierta y puede elegir una de las cartas del centro para usar su poder hasta la próxima noche.');
  const r = await choiceUI({
    role: 'Comediante', q: '¿Qué personaje interpretas? (cada carta se usa una sola vez)',
    options: [...G.comedianCards.map((c) => ({ label: roleName(c), value: c, primary: true })), { label: 'No usar ninguna', value: null }]
  });
  if (r) {
    G.comedianCards = G.comedianCards.filter((c, k) => k !== G.comedianCards.indexOf(r));
    p.borrowed = r;
    if (r === 'anciano') p.lives = 2;
    log(`${p.name} (Comediante) interpreta a ${roleName(r)}.`);
    // Poderes nocturnos prestados: se ejecutan ya, con el Comediante despierto.
    if (r === 'vidente') await powerVidente(p, 'El Comediante', true);
    if (r === 'zorro') await powerZorro(p, 'El Comediante', false, true);
    if (r === 'protector') await powerProtector(p, 'El Comediante', true);
    if (r === 'cuervo' && G.opts.aldea) await powerCuervo(p, 'El Comediante', true);
  }
  await say('Retira esa carta del centro. El Comediante se vuelve a dormir.');
}

async function stepCupido() {
  const p = actor('cupido');
  await say('Cupido se despierta y señala a los dos jugadores que quedarán enamorados para siempre.');
  const r = await pickUI({ role: 'Cupido', q: 'Elige a 2 enamorados (puedes incluirte).', count: 2, candidates: alive() });
  if (Array.isArray(r) && r.length === 2) {
    G.lovers = r;
    log(`Cupido (${p.name}) enamora a ${joinNames(r.map((id) => P(id).name))}.`);
    await infoUI({ role: 'Cupido', title: 'Ahora, en silencio, toca la cabeza de los dos enamorados.', big: joinNames(r.map((id) => P(id).name)), button: 'Hecho' });
  }
  await say('Cupido toca discretamente a los dos enamorados y vuelve a dormirse.');
}

async function stepEnamorados() {
  await say('Los enamorados se despiertan, se reconocen y se miran a los ojos.');
  showSleeping('Los enamorados se reconocen…');
  await pause(6000);
  await say('Los enamorados vuelven a dormirse.');
}

async function stepJuez() {
  // Adaptación: sin narrador humano al que hacer la señal, el Juez decide de noche.
  await say('El Juez Tartamudo se despierta.');
  const r = await choiceUI({ role: 'Juez Tartamudo', q: '¿Quieres que mañana haya dos votaciones consecutivas? (una vez por partida)', options: [{ label: 'No, todavía no', value: false }, { label: 'Sí, doble votación mañana', value: true, primary: true }] });
  if (r) { G.juezUsed = true; G.juezPending = true; log('El Juez Tartamudo activa la doble votación.'); }
  await say('El Juez Tartamudo se vuelve a dormir.');
}

async function stepRecognize(wakeText, label) {
  await say(`${wakeText} y se reconocen.`);
  showSleeping(`${label} se reconocen…`);
  await pause(5000);
  await say(`${label} vuelven a dormirse.`);
}

async function stepNinoSalvaje() {
  const p = actor('ninoSalvaje');
  await say('El Niño Salvaje se despierta y elige a su modelo a seguir.');
  const r = await pickUI({ role: 'Niño Salvaje', q: 'Elige a tu modelo. Si muere, te convertirás en Hombre Lobo.', candidates: alive().filter((x) => x.id !== p.id) });
  if (Array.isArray(r) && r.length) { p.wildModel = r[0]; log(`El Niño Salvaje (${p.name}) elige como modelo a ${P(r[0]).name}.`); }
  await say('El Niño Salvaje se vuelve a dormir.');
}

async function stepPiromano() {
  await say('El Pirómano se despierta. Puede, una sola vez, prender fuego a un edificio.');
  const bs = G.buildings.filter((b) => !b.destroyed && b.occupant != null);
  const r = await choiceUI({ role: 'Pirómano', q: '¿Qué edificio quemas?', options: [{ label: 'Esta noche no', value: null }, ...bs.map((b) => ({ label: `${bLabel(b)} (${P(b.occupant).name})`, value: b.uid, primary: true }))] });
  if (r) { G.nctx.fire = r; G.piromanoUsed = true; log(`El Pirómano incendia ${r}.`); }
  await say('El Pirómano se vuelve a dormir.');
}

async function stepPerroLobo() {
  const p = actor('perroLobo');
  await say('El Perro Lobo se despierta y decide, para siempre, si será Aldeano o Hombre Lobo.');
  const r = await choiceUI({ role: 'Perro Lobo', q: '¿Qué llamada escuchas?', options: [{ label: 'Seré Aldeano', value: false }, { label: 'Seré Hombre Lobo', value: true, primary: true }] });
  p.dogWolf = !!r;
  log(`El Perro Lobo (${p.name}) elige ser ${r ? 'Hombre Lobo' : 'Aldeano'}.`);
  await say('El Perro Lobo se vuelve a dormir.');
}

async function stepLobos() {
  const N = G.nctx;
  const nf = G.nightFlags;
  // Lobos fuera de la aldea por un evento (Fiebre del sábado noche, Partida de caza…).
  const pack = wolfPack().filter((p) => !untouchable(p));
  if (!pack.length) {
    await say('Esta noche los Hombres Lobo están lejos de la aldea. No habrá ataque.');
    return;
  }
  await say('Los Hombres Lobo se despiertan, se reconocen y eligen a su víctima.');
  const packTxt = `Manada: <b>${esc(joinNames(pack.map((p) => p.name)))}</b>`;
  const prey = (p) => !isWolfSide(p) && !tavernImmune(p) && !untouchable(p);
  // Evento permanente "Toque mortal": hay que tocar a la víctima o no hay víctima.
  const touchTxt = G.ev.toqueMortal ? '<br><b>Toque mortal:</b> uno de vosotros debe TOCAR a la víctima; si no, no hay víctima.' : '';
  const noTouch = G.ev.toqueMortal ? [{ label: 'No la hemos tocado: sin víctima', value: 'none' }] : [];

  if (nf.flood) {
    // Inundación: cada lobo come en su refugio (iglesia = mujeres, taberna = hombres).
    const groups = [['la iglesia', alive().filter((p) => nf.flood.includes(p.id))], ['la taberna', alive().filter((p) => !nf.flood.includes(p.id))]];
    for (const [place, members] of groups) {
      const here = members.filter((p) => pack.includes(p));
      if (!here.length) continue;
      const r = await pickUI({ role: 'Hombres Lobo', q: `${packTxt}<br>Lobos refugiados en ${place} (${esc(joinNames(here.map((p) => p.name)))}): elegid a vuestra víctima allí dentro.${touchTxt}`, candidates: members.filter(prey), extra: noTouch });
      if (Array.isArray(r) && r.length) N.wolfTargets.push(r[0]);
    }
  } else {
    const r = await pickUI({
      role: 'Hombres Lobo',
      q: `${packTxt}<br>Poneos de acuerdo en silencio y ${G.ev.toqueMortal ? 'tocad' : 'señalad'} a vuestra víctima.${touchTxt}`,
      candidates: alive().filter(prey), extra: noTouch
    });
    if (Array.isArray(r)) N.wolfTargets = r;
  }

  // La Niña Pequeña: si la sorprenden espiando, muere en su lugar (pág. 10).
  // Se pregunta SIEMPRE que haya Niña en el mazo, para no revelar nada.
  if (inDeck('nina') && N.wolfTargets.length && !nf.possession && !nf.failedAttack) {
    const c = await pickUI({ role: 'Hombres Lobo', q: '¿Habéis sorprendido a la Niña Pequeña espiando? Tocad a quien la haya hecho.', candidates: alive().filter((p) => !isWolfSide(p)), allowNone: true, noneLabel: 'No' });
    if (Array.isArray(c) && c.length && P(c[0]).role === 'nina') { N.wolfTargets[0] = c[0]; N.ninaCaught = true; }
  }

  // Evento "Posesión": la víctima despierta, se vuelve lobo y elimina a un lobo antiguo.
  if (nf.possession && N.wolfTargets.length) {
    const t = P(N.wolfTargets[0]);
    N.wolfTargets = [];
    await say('Lobos: tocad discretamente a vuestra víctima para que abra los ojos. Vosotros también mantenéis los ojos abiertos.');
    const r = await pickUI({ role: 'Posesión', q: `${esc(t.name)}: ahora eres un Hombre Lobo. Elige a uno de los antiguos lobos: será eliminado.`, candidates: pack });
    t.infected = true;
    if (Array.isArray(r) && r.length) N.possessionKill = r[0];
    log(`Posesión: ${t.name} se transforma en Hombre Lobo${N.possessionKill != null ? ` y elimina a ${P(N.possessionKill).name}` : ''}.`);
  }

  // Evento "Ataque fallido": Aldeano → se vuelve lobo; otro personaje → muere el lobo a su izquierda.
  if (nf.failedAttack && N.wolfTargets.length) {
    const t = P(N.wolfTargets[0]);
    N.wolfTargets = [];
    if (['aldeano', 'aldeanoAldeano'].includes(t.role)) {
      t.infected = true;
      log(`Ataque fallido: ${t.name} se transforma en Hombre Lobo.`);
      await infoUI({ role: 'Ataque fallido', title: `${t.name} no muere: se transforma en Hombre Lobo.`, body: 'Tocadle discretamente para que lo sepa.', button: 'Hecho' });
    } else {
      const w = nearestWolf(t, +1);
      if (w) N.failedKillWolf = w.id;
      log(`Ataque fallido: ${t.name} sobrevive${w ? ` y muere ${w.name}` : ''}.`);
      await infoUI({ role: 'Ataque fallido', title: 'El ataque ha fallado.', body: `${esc(t.name)} sobrevive.`, button: 'Entendido' });
    }
    // Frase idéntica en ambos casos para no dar pistas al resto de la mesa.
    await say('Lobos: si la pantalla os lo ha pedido, tocad discretamente a vuestra víctima.');
  }

  log(`Los lobos atacan a ${joinNames(N.wolfTargets.map((id) => P(id).name)) || 'nadie'}.`);
  await say('Los Hombres Lobo vuelven a dormirse.');
}

/** Evento "Luna casi llena": los lobos son Videntes; Cazador, Bruja y Vidente atacan. */
async function stepCasiLlena() {
  const pack = wolfPack().filter((p) => !untouchable(p));
  await say('Esta noche la luna está casi llena. Los Hombres Lobo se han vuelto Videntes.');
  for (let k = 0; k < pack.length; k++) {
    await say(k === 0 ? 'Que despierte uno de los Hombres Lobo y pregunte por un jugador.' : 'Que despierte otro Hombre Lobo que aún no haya preguntado.');
    const r = await pickUI({ role: 'Lobo vidente', q: '¿De quién quieres ver la carta?', candidates: alive() });
    if (Array.isArray(r) && r.length) {
      const t = P(r[0]);
      log(`Luna casi llena: un lobo ve que ${t.name} es ${roleName(t.role)}.`);
      await infoUI({ role: 'Lobo vidente', title: `La carta de ${t.name} es…`, big: roleName(t.role), button: 'Entendido' });
    }
    await say('Vuelve a dormirte.');
    showSleeping();
    await pause(rand(800, 1600));
  }
  const hunters = alive().filter((p) => ['cazador', 'bruja', 'vidente'].includes(p.role));
  if (!hunters.length) return;
  await say('El Cazador, la Bruja y la Vidente se han vuelto Hombres Lobo. Se despiertan a la vez, se reconocen y atacan a un jugador.');
  const r = await pickUI({ role: 'Lobos por una noche', q: `${esc(joinNames(hunters.map((p) => p.name)))}: elegid a vuestra víctima.`, candidates: alive().filter((p) => !hunters.includes(p) && !untouchable(p)) });
  if (Array.isArray(r) && r.length) { G.nctx.wolfTargets = [r[0]]; log(`Luna casi llena: atacan a ${P(r[0]).name}.`); }
  await say('Vuelven a dormirse.');
}

/** Evento "Agente doble": el primer eliminado elige a un aliado secreto de los lobos. */
async function stepAgenteDoble() {
  const fd = firstStillDead();
  await say(`Mientras la aldea duerme, ${fd.name}, el primer eliminado, se levanta y toca a un jugador que no sea Hombre Lobo. Ese jugador abrirá los ojos.`);
  const r = await pickUI({ role: 'Agente doble', q: `${esc(fd.name)}: elige al futuro aliado de los lobos. Después tócale para que abra los ojos.`, candidates: alive().filter((p) => !isWolfSide(p)) });
  if (Array.isArray(r) && r.length) {
    const a = P(r[0]);
    a.ally = true;
    G.ev.agentePending = false;
    log(`Agente doble: ${a.name} es el aliado secreto de los lobos.`);
    await infoUI({ role: 'Aliado secreto', title: 'Los Hombres Lobo son:', big: joinNames(wolfPack().map((p) => p.name)), body: 'Sigues siendo aldeano y no despiertas de noche, pero ganarás con los Hombres Lobo.', button: 'Entendido' });
  }
  await say('El aliado secreto cierra los ojos.');
}

async function stepPanadero() {
  await say('El Panadero abre los ojos un instante…');
  showSleeping('El Panadero mira…');
  await pause(2500);
  await say('…y los cierra rápidamente.');
}

async function stepAlbino() {
  const p = actor('albino');
  await say('El Hombre Lobo Albino se despierta. Puede devorar a un Hombre Lobo.');
  const r = await pickUI({ role: 'Hombre Lobo Albino', q: '¿Devoras a un Hombre Lobo?', candidates: wolfPack().filter((x) => x.id !== p.id && !untouchable(x)), allowNone: true, noneLabel: 'Esta noche no' });
  if (Array.isArray(r) && r.length) { G.nctx.albinoKill = r[0]; log(`El Albino ataca a ${P(r[0]).name}.`); }
  await say('El Hombre Lobo Albino se vuelve a dormir.');
}

async function stepInfecto() {
  const victim = P(G.nctx.wolfTargets[0]);
  await say('El Infecto Padre de todos los Lobos se despierta y decide si infecta a la víctima.');
  const r = await choiceUI({ role: 'Infecto Padre', q: `La víctima de la manada es <b>${esc(victim.name)}</b>. ¿La infectas? (una vez por partida)`, options: [{ label: 'No, que sea devorada', value: false }, { label: 'Sí, infectarla', value: true, primary: true }] });
  if (r) {
    G.nctx.infect = true;
    G.infectUsed = true;
    log(`El Infecto Padre infecta a ${victim.name}.`);
  }
  // La frase es la misma infecte o no, para no desvelar nada.
  await say('Infecto Padre: si has infectado a la víctima, tócala discretamente. Después, vuelve a dormirte.');
  await pause(3000);
}

async function stepLoboFeroz() {
  await say('El Lobo Feroz se despierta de nuevo y elige a una segunda víctima él solo.');
  const r = await pickUI({ role: 'Lobo Feroz', q: 'Elige a tu segunda víctima.', candidates: alive().filter((p) => !isWolfSide(p) && !tavernImmune(p) && !untouchable(p) && !G.nctx.wolfTargets.includes(p.id)), allowNone: true, noneLabel: 'Ninguna' });
  if (Array.isArray(r) && r.length) { G.nctx.ferozTarget = r[0]; log(`El Lobo Feroz ataca a ${P(r[0]).name}.`); }
  await say('El Lobo Feroz se vuelve a dormir.');
}

async function stepBruja() {
  const p = actor('bruja');
  const pot = G.potions;
  await say('La Bruja se despierta. Puede usar su poción de vida y su poción de muerte.');
  const attacked = [...G.nctx.wolfTargets, G.nctx.ferozTarget].filter((x) => x != null);
  // La poción extra del evento "Recolección" sirve como vida o como muerte.
  const canLife = () => pot.life || pot.extra > 0;
  const canDeath = () => pot.death || pot.extra > 0;
  const spend = (kind) => { if (pot[kind]) pot[kind] = false; else pot.extra -= 1; };
  // Bucle: puede usar varias pociones la misma noche (pág. 9).
  for (;;) {
    const opts = [];
    if (canLife()) attacked.filter((id) => !G.nctx.heal.includes(id)).forEach((id) => opts.push({ label: `Poción de vida: salvar a ${P(id).name}`, value: { heal: id }, primary: true }));
    if (canDeath() && G.nctx.poison == null) opts.push({ label: 'Poción de muerte: envenenar…', value: { poison: true } });
    opts.push({ label: 'Terminar', value: null });
    const r = await choiceUI({
      role: 'Bruja',
      q: attacked.length ? `Esta noche han atacado a <b>${esc(joinNames(attacked.map((id) => P(id).name)))}</b>.` : 'Esta noche nadie ha sido atacado.',
      body: `Pociones: vida ${pot.life ? '✔' : '✘'} · muerte ${pot.death ? '✔' : '✘'}${pot.extra > 0 ? ` · extra ×${pot.extra}` : ''}`,
      options: opts
    });
    if (!r) break;
    if (r.heal != null) { G.nctx.heal.push(r.heal); spend('life'); log(`La Bruja (${p.name}) salva a ${P(r.heal).name}.`); }
    if (r.poison) {
      const t = await pickUI({ role: 'Bruja', q: '¿A quién envenenas?', candidates: alive(), allowNone: true, noneLabel: 'Cancelar' });
      if (Array.isArray(t) && t.length) { G.nctx.poison = t[0]; spend('death'); log(`La Bruja envenena a ${P(t[0]).name}.`); }
    }
    if (!canLife() && !canDeath()) break;
  }
  await say('La Bruja se vuelve a dormir.');
}

async function stepGitana() {
  const p = actor('gitana');
  await say('La Gitana se despierta. ¿Quiere comunicarse con el más allá?');
  const r = await pickUI({ role: 'Gitana', q: 'Elige al médium que mañana hará la pregunta al espíritu de la primera víctima.', candidates: alive(), allowNone: true, noneLabel: 'Esta noche no' });
  if (Array.isArray(r) && r.length) {
    // La Gitana valida UNA pregunta de sus cartas de Espiritismo (pág. 23); esa carta se retira.
    const opts = [];
    G.gitanaCards.forEach((k) => SPIRIT_CARDS[k].forEach((q) => opts.push({ label: `Carta ${k + 1} · ${q}`, value: { card: k, q } })));
    const q = await choiceUI({ role: 'Gitana', q: 'Elige la pregunta que hará el médium:', options: opts });
    G.nctx.medium = r[0];
    G.nctx.mediumQ = q || null;
    log(`La Gitana (${p.name}) designa médium a ${P(r[0]).name}.`);
  }
  await say('La Gitana se vuelve a dormir.');
}

async function stepFlautista() {
  const p = actor('flautista');
  await say('El Flautista se despierta y elige a dos jugadores a los que hechizar.');
  const cands = alive().filter((x) => x.id !== p.id && !x.charmed);
  const r = !cands.length ? [] : await pickUI({ role: 'Flautista', q: 'Elige a 2 jugadores para hechizar.', count: Math.min(2, cands.length), candidates: cands });
  if (Array.isArray(r) && r.length) {
    r.forEach((id) => { P(id).charmed = true; });
    log(`El Flautista hechiza a ${joinNames(r.map((id) => P(id).name))}.`);
    await infoUI({ role: 'Flautista', title: 'Toca en silencio a los hechizados:', big: joinNames(r.map((id) => P(id).name)), button: 'Hecho' });
  }
  await say('El Flautista toca discretamente a los jugadores hechizados y vuelve a dormirse.');
}

async function stepHechizados() {
  await say('Todos los jugadores hechizados se despiertan y se reconocen.');
  showSleeping('Los hechizados se reconocen…');
  await pause(5000);
  await say('Los hechizados vuelven a dormirse.');
}

/* ---------- Poderes reutilizables (los usa el personaje o el Comediante) ---------- */

async function powerVidente(p, label, inline = false) {
  if (!inline) await say(`${label} se despierta y señala al jugador cuya identidad quiere conocer.`);
  const r = await pickUI({ role: label === 'La Vidente' ? 'Vidente' : `${label} (Vidente)`, q: '¿De quién quieres ver la carta?', candidates: alive().filter((x) => x.id !== p.id) });
  if (Array.isArray(r) && r.length) {
    const t = P(r[0]);
    log(`${label} (${p.name}) ve que ${t.name} es ${roleName(t.role)}.`);
    await infoUI({ role: 'Vidente', title: `La carta de ${t.name} es…`, big: roleName(t.role), button: 'Entendido' });
    // Evento permanente "Sonambulismo": la identidad consultada se anuncia en voz alta.
    if (G.ev.sonambulismo && !inline) {
      await say(`${label} se vuelve a dormir.`);
      await say(`Pero la Vidente es sonámbula y habla en sueños: ${t.name} es ${roleName(t.role)}.`);
      return;
    }
  }
  if (!inline) await say(`${label} se vuelve a dormir.`);
}

async function powerZorro(p, label, persistent, inline = false) {
  if (!inline) await say(`${label} se despierta. Puede olfatear a un grupo de tres vecinos.`);
  const r = await pickUI({ role: 'Zorro', q: 'Toca al jugador central del grupo que quieres olfatear.', candidates: alive(), allowNone: true, noneLabel: 'Esta noche no' });
  if (Array.isArray(r) && r.length) {
    const c = P(r[0]);
    const group = [aliveNeighbor(c, -1), c, aliveNeighbor(c, +1)].filter((x, k, a) => x && a.indexOf(x) === k);
    const has = group.some(isWolfSide);
    if (!has && persistent) G.foxActive = false;
    log(`${label} olfatea a ${joinNames(group.map((x) => x.name))}: ${has ? 'hay lobo' : 'no hay lobo'}.`);
    await infoUI({ role: 'Zorro', title: joinNames(group.map((x) => x.name)), big: has ? '¡Sí! Hay al menos un Hombre Lobo' : 'No hay ningún Hombre Lobo', body: !has && persistent ? 'Pierdes tu poder, pero has ganado información.' : '', button: 'Entendido' });
  }
  if (!inline) await say(`${label} se vuelve a dormir.`);
}

async function powerProtector(p, label, inline = false) {
  if (!inline) await say(`${label} se despierta y elige a quién proteger esta noche.`);
  const last = G.lastProtect[p.id];
  const r = await pickUI({ role: 'Protector', q: 'Elige a quién proteges (puedes ser tú; no el mismo que la noche anterior).', candidates: alive().filter((x) => x.id !== last) });
  if (Array.isArray(r) && r.length) { G.nctx.protected.push(r[0]); G.lastProtect[p.id] = r[0]; log(`${label} protege a ${P(r[0]).name}.`); }
  if (!inline) await say(`${label} se vuelve a dormir.`);
}

async function powerCuervo(p, label, inline = false) {
  if (!inline) await say(`${label} se despierta y puede señalar a un sospechoso.`);
  const r = await pickUI({ role: 'Cuervo', q: 'Señala a un sospechoso: tendrá 2 votos más en su contra (no a un Vagabundo).', candidates: alive().filter((x) => !isVagabond(x)), allowNone: true, noneLabel: 'Esta noche no' });
  if (Array.isArray(r) && r.length) { G.nctx.raven = r[0]; log(`${label} señala a ${P(r[0]).name}.`); }
  if (!inline) await say(`${label} se vuelve a dormir.`);
}

/* =====================================================================
 * 16. MUERTES Y COLA DE TRIGGERS
 *     kill() aplica todos los efectos "en cadena" de una muerte y encola
 *     los triggers que necesitan una decisión en pantalla. Las muertes por
 *     pena (enamorados) se aplican de inmediato y recursivamente.
 * =================================================================== */
function kill(p, cause) {
  if (!p || !p.alive) return false;
  p.alive = false;
  p.cause = cause;
  G.deaths.push({ id: p.id, cause, day: G.day, night: G.night, announced: false });
  if (G.firstDeadId == null) G.firstDeadId = p.id;
  G.lastDeadId = p.id;
  log(`${p.name} (${roleName(p.role)}) ${CAUSES[cause]}.`);

  // Víctimas de los lobos (para Milagro y Espiritismo).
  if (['lobos', 'feroz'].includes(cause)) {
    if (G.firstWolfVictim == null) G.firstWolfVictim = p.id;
    G.lastWolfVictim = p.id;
    // Evento permanente "Enterramiento": su carta no se revela.
    if (G.ev.enterramiento) p.hiddenCard = true;
  }
  // Evento permanente "Verdugo": solo él conoce la carta de los linchados.
  if (cause === 'linchamiento' && G.ev.verdugo != null && G.ev.verdugo !== p.id && P(G.ev.verdugo).alive) {
    p.hiddenCard = true;
    p.verdugoOnly = true;
  }
  if (G.ev.verdugo === p.id) G.triggers.push({ type: 'verdugo', pid: p.id });

  // Muere un lobo, un Niño Salvaje o un Perro Lobo → el Lobo Feroz pierde su 2.ª víctima.
  if (isWolfSide(p) || p.role === 'ninoSalvaje' || p.role === 'perroLobo') G.wolfSideDied = true;
  // Ángel eliminado en la primera ronda → gana (pág. 15).
  if (p.role === 'angel' && G.angelWindow && ['linchamiento', 'lobos', 'feroz'].includes(cause)) G.winner = G.winner || { key: 'angel', ids: [p.id] };
  // Anciano matado por la aldea → los aldeanos pierden sus poderes (pág. 10).
  if (is(p, 'anciano') && ['linchamiento', 'bruja', 'cazador', 'barbero', 'ejecucion'].includes(cause)) {
    G.villagersPowerless = true;
    log('La aldea ha matado al Anciano: los aldeanos pierden sus poderes.');
  }
  // Caballero devorado → el lobo más cercano a su izquierda muere la noche siguiente.
  if (is(p, 'caballero') && ['lobos', 'feroz'].includes(cause) && !powerless(p)) {
    const w = nearestWolf(p, +1);
    if (w) G.rust = { wolfId: w.id, night: G.night + 1 };
  }
  // TRIGGERS que requieren decisión
  if (is(p, 'cazador') && !powerless(p)) G.triggers.push({ type: 'cazador', pid: p.id });
  if (G.alguacil === p.id) G.triggers.push({ type: 'alguacil', pid: p.id });
  if (G.guardia === p.id) { G.guardia = null; G.triggers.push({ type: 'guardia', pid: p.id }); }
  // Su edificio queda vacío (el Alcalde puede realojar a un Vagabundo).
  const b = bOf(p);
  if (b) b.occupant = null;
  // Niño Salvaje: si muere su modelo, se convierte en lobo.
  G.players.forEach((c) => {
    if (c.alive && c.role === 'ninoSalvaje' && c.wildModel === p.id && !c.wildWolf) {
      c.wildWolf = true;
      log(`El modelo del Niño Salvaje (${c.name}) ha muerto: ahora es Hombre Lobo.`);
    }
  });
  // Enamorados: el otro muere de pena inmediatamente
  // (salvo el Día de los Santos Inocentes, en que se odian).
  if (G.lovers.includes(p.id) && !G.loversHate) {
    const other = P(G.lovers.find((id) => id !== p.id));
    if (other && other.alive) kill(other, 'pena');
  }
  return true;
}

/** Anuncia en voz alta las muertes aún no anunciadas, revelando la carta. */
async function announceDeaths() {
  for (const d of G.deaths.filter((x) => !x.announced)) {
    d.announced = true;
    const p = P(d.id);
    const card = p.hiddenCard ? 'Su carta no se revela.' : `Era ${roleName(p.role)}.`;
    await say(`${p.name} ${CAUSES[d.cause]}. ${card}`);
    await pause(500);
  }
}

/**
 * Vacía la cola de triggers (interrumpe el flujo normal del día).
 * Cada trigger puede provocar nuevas muertes → nuevos triggers.
 */
async function processTriggers() {
  await announceDeaths();
  while (G.triggers.length) {
    const t = G.triggers.shift();
    const p = P(t.pid);
    if (t.type === 'cazador') {
      await say(`${p.name} ${p.role === 'cazador' ? 'era el Cazador' : 'tenía el poder del Cazador'}. Antes de morir, dispara a un jugador.`);
      const cands = alive();
      if (cands.length) {
        const r = await pickUI({ mode: 'day', role: `Disparo del Cazador`, q: `${esc(p.name)}, ¿a quién te llevas contigo?`, candidates: cands });
        if (Array.isArray(r) && r.length) { await say(`El Cazador dispara a ${P(r[0]).name}.`); kill(P(r[0]), 'cazador'); }
      }
    } else if (t.type === 'alguacil') {
      // Con La Aldea, el sucesor sale de los Granjeros vivos (pág. 16).
      const farmers = G.opts.aldea && G.buildings.some((b) => b.type === 'granja') ? alive().filter((x) => bOf(x)?.type === 'granja') : null;
      const cands = farmers || alive();
      if (farmers && !farmers.length) { G.alguacil = null; await say('No quedan Granjeros: la aldea se queda sin Alguacil.'); continue; }
      if (!cands.length) { G.alguacil = null; continue; }
      await say(`${p.name} era el Alguacil. En su último suspiro, designa a su sucesor.`);
      const r = await pickUI({ mode: 'day', role: 'Sucesión del Alguacil', q: `${esc(p.name)}, elige al nuevo Alguacil${farmers ? ' (entre los Granjeros)' : ''}.`, candidates: cands });
      G.alguacil = Array.isArray(r) && r.length ? r[0] : null;
      if (G.alguacil != null) await say(`${P(G.alguacil).name} es el nuevo Alguacil.`);
    } else if (t.type === 'guardia') {
      if (G.alguacil == null || !P(G.alguacil).alive) continue;
      await say(`El Guardia ha muerto. El Alguacil, ${P(G.alguacil).name}, nombra a su sucesor.`);
      const r = await pickUI({ mode: 'day', role: 'Nuevo Guardia', q: 'Alguacil: ¿quién será el nuevo Guardia?', candidates: alive().filter((x) => x.id !== G.alguacil), allowNone: true, noneLabel: 'Nadie' });
      setGuardia(Array.isArray(r) && r.length ? r[0] : null);
    } else if (t.type === 'verdugo') {
      const cands = alive();
      G.ev.verdugo = null;
      if (!cands.length) continue;
      await say(`${p.name} era el verdugo. Antes de morir, designa a su sucesor.`);
      const r = await pickUI({ mode: 'day', role: 'Nuevo verdugo', q: `${esc(p.name)}, ¿quién será el nuevo verdugo?`, candidates: cands });
      if (Array.isArray(r) && r.length) { G.ev.verdugo = r[0]; await say(`${P(r[0]).name} es el nuevo verdugo.`); }
    }
    await announceDeaths();
  }
}

/* =====================================================================
 * 17. AMANECER: RESOLUCIÓN SIMULTÁNEA
 *     1) Incendio del Pirómano (puede anular el ataque lobuno)
 *     2) Ataques lobunos: infección > protección > poción de vida >
 *        inmunidad del Tabernero > vidas del Anciano
 *     3) Veneno, Albino, herrumbre del Caballero (diferida)
 *     4) Se aplican TODAS las muertes a la vez y se anuncian
 *     5) Cola de triggers → victoria → evento → oso → médium → debate
 * =================================================================== */
async function resolveDawn() {
  const N = G.nctx;
  const pending = [];          // [jugador, causa]
  const notes = [];            // frases extra para el anuncio
  let cancelWolves = false;

  // 1) Fuego
  if (N.fire) {
    const b = G.buildings.find((x) => x.uid === N.fire);
    if (b && !b.destroyed) {
      const occ = P(b.occupant);
      b.destroyed = true;
      b.occupant = null;
      notes.push(`¡Un incendio ha destruido ${bLabel(b)}!${occ ? ` ${occ.name} se convierte en Vagabundo.` : ''}`);
      const victims = [...N.wolfTargets, N.ferozTarget].filter((x) => x != null);
      if (occ && victims.includes(occ.id)) {
        const w = nearestWolf(occ, -1); // el lobo más cercano a la DERECHA de la víctima
        if (w) pending.push([w, 'fuego']);
        cancelWolves = true;
        notes.push('Los lobos huyen aterrados de las llamas sin culminar su ataque.');
      }
    }
  }

  // 2) Ataques de los lobos
  if (!cancelWolves) {
    const attacks = N.wolfTargets.map((id, k) => [id, 'lobos', k === 0]).concat(N.ferozTarget != null ? [[N.ferozTarget, 'feroz', false]] : []);
    for (const [id, cause, first] of attacks) {
      const t = P(id);
      if (!t || !t.alive) continue;
      // El Anciano no se infecta la primera vez que le muerden (pág. 10).
      if (first && N.infect) {
        if (!(is(t, 'anciano') && t.lives > 1)) { t.infected = true; log(`${t.name} queda infectado.`); continue; }
        G.infectUsed = false; // la infección no surte efecto: el Infecto la conserva
      }
      if (N.protected.includes(id) && !(N.ninaCaught && first)) continue; // el Protector no salva a la Niña
      if (N.heal.includes(id)) continue;
      if (tavernImmune(t)) continue;
      if (is(t, 'anciano') && t.lives > 1) { t.lives -= 1; log(`${t.name} (Anciano) resiste el ataque.`); continue; }
      pending.push([t, cause]);
    }
  }
  // 3) Otras muertes nocturnas
  if (N.poison != null) pending.push([P(N.poison), 'bruja']);
  if (N.albinoKill != null) pending.push([P(N.albinoKill), 'albino']);
  if (G.rust && G.rust.night === G.night) { pending.push([P(G.rust.wolfId), 'oxido']); G.rust = null; }
  if (N.possessionKill != null) pending.push([P(N.possessionKill), 'posesion']);
  if (N.failedKillWolf != null) pending.push([P(N.failedKillWolf), 'fallido']);
  // Cuervo y Gitana: efectos para el día
  G.ravenMark = N.raven;
  G.medium = N.medium;
  G.mediumQ = N.mediumQ;

  // 4) Amanece
  G.day += 1;
  G.phase = 'dawn';
  G.dayFlags = {};
  G.voted = false;
  setMode('day');
  render(`<section class="handoff"><h1>☀️ Día ${G.day}</h1><p>La aldea despierta…</p></section>`);
  await say('¡Amanece en la aldea! Todo el mundo despierta y abre los ojos.');
  for (const n of notes) await say(n);
  const realDeaths = pending.filter(([p]) => p && p.alive);
  if (!realDeaths.length) await say('Esta noche no ha muerto nadie.');
  else await say('Todos, excepto…');
  // Muertes simultáneas: primero se aplican todas, luego se anuncian.
  realDeaths.forEach(([p, c]) => kill(p, c));

  // 5) Triggers (Cazador, Alguacil, Guardia…) antes del debate.
  await processTriggers();
  if (G.day === 1) G.angelWindow = false;
  // Fin del "Día de los Santos Inocentes": se devuelven los poderes.
  if (G.swap) {
    G.swap.forEach(([a, b]) => { const x = P(a); const y = P(b); x.swapRole = null; y.swapRole = null; [x.lives, y.lives] = [y.lives, x.lives]; });
    G.swap = null;
  }
  G.loversHate = false;
  if (checkVictory()) return screenGameOver();

  // Vuelve el pequeño granuja: hoy su voto vale el triple.
  if (G.granuja && G.granuja.day === G.day) {
    const g = P(G.granuja.id);
    if (g.alive) { G.dayFlags.triple = g.id; await say(`${g.name}, el pequeño granuja, vuelve a la aldea. Hoy su voto vale el triple.`); }
    G.granuja = null;
  }
  // Luna Nueva: evento (cada mañana excepto la primera, según frecuencia).
  if (G.opts.luna && G.day >= 2 && (G.day - 2) % (G.opts.eventFreq || 1) === 0) {
    await runEvent();
    if (checkVictory()) return screenGameOver();
  }
  // El Guardia puede leer una de sus cartas como anuncio público (pág. 23).
  if (G.opts.luna && G.guardia != null && P(G.guardia).alive && G.guardSince != null && G.day > G.guardSince) {
    await guardAnnouncement();
    if (checkVictory()) return screenGameOver();
  }
  // El oso del Domador gruñe (pág. 12).
  const dom = alive().find((p) => is(p, 'domador') && !powerless(p));
  if (dom) {
    const growl = dom.infected || [aliveNeighbor(dom, -1), aliveNeighbor(dom, +1)].some((x) => x && isWolfSide(x));
    await say(growl ? 'Grrrrr… ¡El oso del Domador gruñe! Ha olido el peligro.' : 'El oso del Domador duerme tranquilo.');
  }
  // Médium de la Gitana (pág. 23): hace la pregunta validada por la Gitana; la carta se retira.
  if (G.medium != null && P(G.medium).alive) {
    const mq = G.mediumQ;
    if (mq) G.gitanaCards = G.gitanaCards.filter((k) => k !== mq.card);
    await evSpiritSession(mq ? mq.card : 0, P(G.medium), mq ? mq.q : null);
    G.medium = null;
    G.mediumQ = null;
  }
  // Votaciones del día
  G.votesLeft = G.dayFlags.noVote ? 0 : 1 + (G.juezPending ? 1 : 0);
  G.juezPending = false;
  await say(G.dayFlags.noVote ? 'Hoy no habrá votación. Podéis debatir.' : G.dayFlags.noDebate ? 'Pasamos directamente a la votación.' : 'Que empiece el debate.');
  renderDay();
}

/* =====================================================================
 * 18. EVENTOS DE LUNA NUEVA
 * =================================================================== */
/** Etiqueta de una carta para listas (las de Espiritismo se distinguen por su 1.ª pregunta). */
const eventLabel = (e) => (e.spirit != null ? `🌕 Espiritismo — ${SPIRIT_CARDS[e.spirit][0]}` : `${TYPE_ICON[e.type]} ${e.name}`);

/** Muestra la carta en pantalla, la lee y aplica su efecto. */
async function playEventCard(ev, { read = true } = {}) {
  G.events.push({ day: G.day, id: ev.id, name: ev.name, type: ev.type });
  log(`Evento: ${ev.name}.`);
  render(`<section class="handoff">
    <p class="muted">Luna Nueva · ${TYPE_ICON[ev.type]} ${ev.type}</p>
    <h1>${esc(ev.name)}</h1>
    <p class="card" style="max-width:620px">${esc(ev.summary)}</p></section>`);
  await say(read ? `Luna Nueva. ${ev.name}. ${ev.summary}` : `${ev.name}.`);
  await pause(1200);
  await ev.run();
}

/**
 * Evento del amanecer (pág. 22): el último eliminado roba y lee la carta.
 *  - Modo 'fisico': se roba la carta real y se marca en la app cuál ha salido.
 *  - Modo 'app'   : la app roba del mazo barajado y la lee en voz alta.
 */
async function runEvent() {
  const reader = G.lastDeadId != null ? P(G.lastDeadId).name : 'El Alguacil';
  if (!G.eventBag.length) { await say('El mazo de eventos se ha agotado.'); return; }
  if (G.opts.eventMode === 'fisico') {
    await say(`Luna Nueva: ${reader} roba la primera carta del mazo de eventos y la lee en voz alta.`);
    const opts = G.eventBag.map(eventById).sort((a, b) => a.name.localeCompare(b.name)).map((e) => ({ label: eventLabel(e), value: e.id }));
    const id = await choiceUI({ mode: 'day', role: 'Evento de Luna Nueva', q: `${esc(reader)}: ¿qué carta ha salido?`, options: [...opts, { label: 'No está en la lista', value: null }] });
    if (!id) return;
    G.eventBag = G.eventBag.filter((x) => x !== id);
    await playEventCard(eventById(id), { read: false });
    return;
  }
  await playEventCard(eventById(G.eventBag.shift()));
}

/** Nombra Guardia y le confía cartas de evento (nunca de Espiritismo, pág. 23). */
function setGuardia(id) {
  G.guardia = id;
  if (id == null || !G.opts.luna) return;
  G.guardSince = G.day;
  if (!G.guardHand.length) {
    const n = G.opts.guardCards ?? 3;
    const pickable = G.eventBag.filter((x) => !x.startsWith('espiritismo')).slice(0, n);
    G.guardHand = pickable;
    G.eventBag = G.eventBag.filter((x) => !pickable.includes(x));
  }
}

/** Cada mañana, el Guardia puede leer una de sus cartas como anuncio público. */
async function guardAnnouncement() {
  if (!G.guardHand.length) return;
  const g = P(G.guardia);
  await say(`${g.name}, Guardia de la aldea: ¿tienes algo que anunciar?`);
  const cards = G.guardHand.map(eventById);
  const id = await choiceUI({
    mode: 'day', role: `Guardia: ${g.name}`, q: 'Pasad el dispositivo al Guardia. Sus cartas son secretas hasta que las anuncie.',
    options: [{ label: 'Nada que anunciar', value: null, primary: true }, ...cards.map((e) => ({ label: eventLabel(e), value: e.id }))]
  });
  if (!id) return;
  G.guardHand = G.guardHand.filter((x) => x !== id);
  await say(`El Guardia anuncia con voz poderosa:`);
  await playEventCard(eventById(id));
}

/* =====================================================================
 * 19. EL DÍA: hub con debate, votación y herramientas públicas
 * =================================================================== */
const timer = { left: 0, total: 0, running: false, iv: null, day: null };

function renderDay() {
  G.phase = 'day';
  setMode('day');
  save();
  const lastDeaths = G.deaths.filter((d) => d.day === G.day);
  const chips = [];
  if (G.alguacil != null) chips.push(`🎖️ Alguacil: <b>${esc(P(G.alguacil).name)}</b> (voto doble)`);
  else if (!G.alguacilLost) chips.push('🎖️ Sin Alguacil');
  if (G.guardia != null) chips.push(`🥁 Guardia: <b>${esc(P(G.guardia).name)}</b>`);
  if (G.ravenMark != null && P(G.ravenMark).alive) chips.push(`🐦 ${esc(P(G.ravenMark).name)}: +2 votos (Cuervo)`);
  if (G.scapegoatVoters) chips.push(`🐐 Solo votan: ${esc(joinNames(G.scapegoatVoters.map((id) => P(id).name)))}`);
  alive().filter((p) => p.tontoRevealed).forEach((p) => chips.push(`🤡 ${esc(p.name)} no vota`));
  if (G.lovers.length && G.lovers.every((id) => P(id).alive)) chips.push('💘 Hay enamorados');
  if (G.villagersPowerless) chips.push('🌳 Los aldeanos han perdido sus poderes');
  // Efectos de los eventos de Luna Nueva visibles para toda la mesa.
  const df = G.dayFlags;
  const names = (ids) => esc(joinNames(ids.map((id) => P(id).name)));
  if (df.absent && df.absent.length) chips.push(`🚶 Fuera hoy (${esc(df.absentLabel)}): ${names(df.absent)} — no debaten ni votan, y nadie puede votar contra ellos`);
  if (df.triple != null) chips.push(`✖️3 Voto triple: <b>${esc(P(df.triple).name)}</b>`);
  if (df.firstVoter != null) chips.push(`👉 Votación en orden: empieza ${esc(P(df.firstVoter).name)}`);
  if (df.voteMode === 'friends') chips.push('🤝 Gran desconfianza: votad a vuestros 2 amigos');
  if (df.voteMode === 'nightmare') chips.push('😱 Pesadilla: votación inmediata y en silencio');
  if (df.coin) chips.push('🪙 Cara o cruz tras el veredicto');
  if (df.devilPact) chips.push('😈 El acusado puede pactar con el diablo');
  if (df.reminder) chips.push(`📜 ${esc(df.reminder)}`);
  if (G.loversHate && G.lovers.length === 2 && G.lovers.every((id) => P(id).alive)) chips.push('💔 Los enamorados se odian: deben votarse entre ellos');
  if (G.lynchCheck) chips.push(G.lynchCheck === 'wolf' ? '🔥 Entusiasmo: si el próximo linchado es lobo, se vota otra vez' : '😤 Insatisfacción: si el próximo linchado NO es lobo, se vota otra vez');
  if (G.ev.toqueMortal) chips.push('🌑 Toque mortal');
  if (G.ev.sonambulismo) chips.push('🌑 Vidente sonámbula');
  if (G.ev.enterramiento) chips.push('🌑 Enterramiento: no se revelan las víctimas de los lobos');
  if (G.ev.verdugo != null && P(G.ev.verdugo).alive) chips.push(`🌑 Verdugo: <b>${esc(P(G.ev.verdugo).name)}</b>`);
  if (G.ev.agentePending) chips.push('🌑 Agente doble pendiente');
  if (G.ev.niYoNiLobo) chips.push('🤐 Prohibido decir "lobo" y "yo"');
  if (G.guardia != null && G.guardHand.length) chips.push(`🥁 El Guardia guarda ${G.guardHand.length} carta(s)`);

  const debateMin = Settings.debateMin;
  if (timer.day !== G.day || (!timer.running && timer.total !== debateMin * 60 && timer.left === timer.total)) {
    stopTimer();
    timer.day = G.day;
    timer.total = debateMin * 60;
    timer.left = timer.total;
  }

  const canVote = G.votesLeft > 0;
  const aldeaTools = G.opts.aldea ? buildingToolsHTML() : '';

  render(`
    <section class="stack">
      <div class="row spread"><h1>☀️ Día ${G.day}</h1><span class="pill">${alive().length} vivos</span></div>
      ${G.day > 0 ? `<div class="card">
        <h3>Bajas del día</h3>
        ${lastDeaths.length ? `<ul class="deaths">${lastDeaths.map((d) => `<li><b>${esc(P(d.id).name)}</b> — ${CAUSES[d.cause]}. ${P(d.id).hiddenCard ? '' : `<span class="pill">${roleName(P(d.id).role)}</span>`}</li>`).join('')}</ul>` : '<p>No ha muerto nadie.</p>'}
      </div>` : `<div class="card"><b>Ronda del Ángel:</b> debate y votación antes de la primera noche.</div>`}
      ${chips.length ? `<div class="chips">${chips.map((c) => `<span class="pill">${c}</span>`).join('')}</div>` : ''}
      ${G.alguacil == null && !G.alguacilLost ? `<button class="btn block" data-a="alg">🎖️ Elegir Alguacil por votación</button>` : ''}
      ${G.dayFlags.noDebate ? '' : `
      <div class="card">
        <div class="row spread"><h3>Debate</h3><span class="small muted">${debateMin} min</span></div>
        <div class="timer ${timer.left <= 30 ? 'low' : ''}" id="timer">${fmt(timer.left)}</div>
        <div class="row"><button class="btn grow" data-a="t-toggle">${timer.running ? '⏸ Pausa' : '▶ Empezar'}</button><button class="btn" data-a="t-reset">↺</button><button class="btn" data-a="t-plus">+1 min</button></div>
      </div>`}
      ${canVote ? `<button class="btn primary xl block" data-a="vote">🗳️ Votación${G.votesLeft > 1 ? ` (quedan ${G.votesLeft})` : ''}</button>`
        : `<p class="center muted">${G.dayFlags.noVote && !G.voted ? 'Hoy no hay votación.' : 'La votación de hoy ha terminado.'}</p>`}
      <button class="btn ${canVote ? '' : 'primary'} xl block" data-a="night">🌙 Que caiga la noche</button>
      <details class="tools card">
        <summary>Herramientas públicas</summary>
        <div class="stack" style="margin-top:10px">
          ${aldeaTools}
          <div class="row">
            <button class="btn" data-a="alg">Cambiar Alguacil</button>
            ${G.opts.luna ? '<button class="btn" data-a="grd">Nombrar Guardia</button>' : ''}
            <button class="btn" data-a="manual">Eliminar a un jugador</button>
            <button class="btn" data-a="log">Registro público</button>
          </div>
        </div>
      </details>
    </section>`);

  const bind = (a, fn) => { const el = $(`[data-a=${a}]`); if (el) el.onclick = fn; };
  bind('t-toggle', toggleTimer);
  bind('t-reset', () => { stopTimer(); timer.left = timer.total; renderDay(); });
  bind('t-plus', () => { timer.left += 60; updateTimer(); });
  bind('vote', () => { stopTimer(); startVote(); });
  bind('night', async () => {
    if (canVote && !confirm('Aún no habéis votado hoy. ¿Pasar a la noche igualmente?')) return;
    stopTimer();
    beginNightFromButton();
  });
  $$('[data-a=alg]').forEach((b) => { b.onclick = toolAlguacil; });
  bind('grd', toolGuardia);
  bind('manual', toolManualKill);
  bind('log', () => modal(`<h3>Registro público</h3><ol class="log">${G.deaths.map((d) => `<li>Día ${d.day}: ${esc(P(d.id).name)} ${CAUSES[d.cause]}${P(d.id).hiddenCard ? '' : ` (${roleName(P(d.id).role)})`}.</li>`).join('') || '<li>Sin muertes todavía.</li>'}</ol>${G.events.length ? `<h3>Eventos</h3><ul class="log">${G.events.map((e) => `<li>Día ${e.day}: ${esc(e.name)} (${e.type})${e.text ? ` — ${esc(e.text)}` : ''}</li>`).join('')}</ul>` : ''}`));
  $$('[data-tool]').forEach((b) => { b.onclick = () => BUILDING_TOOLS[b.dataset.tool](); });
}

/* ---------- Temporizador de debate ---------- */
const fmt = (s) => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.max(0, s) % 60).padStart(2, '0')}`;
function updateTimer() { const el = $('#timer'); if (el) { el.textContent = fmt(timer.left); el.classList.toggle('low', timer.left <= 30); } }
function stopTimer() { clearInterval(timer.iv); timer.running = false; }
function toggleTimer() {
  if (timer.running) { stopTimer(); return renderDay(); }
  timer.running = true;
  timer.iv = setInterval(() => {
    timer.left -= 1;
    updateTimer();
    if (timer.left === 30) say('Quedan treinta segundos de debate.');
    if (timer.left <= 0) { stopTimer(); say('Se acabó el tiempo. Es la hora de votar.'); renderDay(); }
  }, 1000);
  renderDay();
}

/* =====================================================================
 * 20. VOTACIÓN Y SU RESOLUCIÓN
 *     voto → (Empate: Cabeza de turco) → Noble indulta? → Tonto →
 *     Abnegada Sirvienta → revelación + muerte → triggers → victoria →
 *     ¿otra votación (Juez/evento)? → noche
 * =================================================================== */
async function startVote() {
  const df = G.dayFlags;
  const absent = df.absent || [];
  const names = (ids) => esc(joinNames(ids.map((id) => P(id).name)));
  const reminders = [
    G.alguacil != null ? `El voto de ${esc(P(G.alguacil).name)} (Alguacil) cuenta doble.` : '',
    df.triple != null && P(df.triple).alive ? `El voto de ${esc(P(df.triple).name)} vale el triple (pequeño granuja).` : '',
    G.ravenMark != null && P(G.ravenMark).alive ? `${esc(P(G.ravenMark).name)} tiene 2 votos extra en contra (Cuervo).` : '',
    G.scapegoatVoters ? `Solo pueden votar: ${names(G.scapegoatVoters)}.` : '',
    absent.length ? `No votan ni pueden ser votados: ${names(absent)}.` : '',
    G.loversHate && G.lovers.length === 2 && G.lovers.every((id) => P(id).alive) ? 'Los enamorados deben votarse entre ellos.' : '',
    df.reminder ? esc(df.reminder) : '',
    G.opts.aldea && occupant('escuela') ? 'La Institutriz puede prohibir votar a 2 jugadores antes de empezar.' : '',
    G.opts.aldea && occupant('taberna') ? 'El Tabernero vota primero.' : ''
  ].filter(Boolean).join('<br>');

  if (df.voteMode === 'friends') {
    // Gran desconfianza: se linchan TODOS los que no reciben ningún voto de amistad.
    df.voteMode = null;
    await say('Gran desconfianza. A la vez, cada jugador señala con cada mano a sus dos mejores amigos.');
    const r = await pickUI({ mode: 'day', role: 'Gran desconfianza', q: `Marcad a quienes NO han recibido ningún voto: serán linchados.${reminders ? `<br><span class="small">${reminders}</span>` : ''}`, count: alive().length, min: 0, candidates: alive() });
    const ids = Array.isArray(r) ? r : [];
    if (!ids.length) await say('Todos tienen al menos un amigo. Nadie es linchado.');
    for (const id of ids) { if (G.winner) break; if (P(id).alive) await resolveVote([id]); }
  } else {
    if (df.voteMode === 'nightmare') {
      df.voteMode = null;
      const last = P(G.lastDeadId);
      const first = last ? aliveNeighbor(last, +1) : null;
      await say(`Pesadilla. Sin mediar palabra, empezando por ${first ? first.name : 'cualquiera'} y siguiendo hacia la izquierda, cada uno acusa a un aldeano.`);
    } else if (df.firstVoter != null) {
      await say(`Votación en orden: empieza ${P(df.firstVoter).name} y sigue cada jugador hacia su izquierda, señalando con el dedo.`);
      df.firstVoter = null;
    } else {
      await say('Cada jugador señala con el dedo a su sospechoso.');
    }
    const r = await pickUI({
      mode: 'day', role: 'Votación', q: `¿A quién ha eliminado la aldea?${reminders ? `<br><span class="small">${reminders}</span>` : ''}`,
      candidates: alive().filter((p) => !tavernImmune(p) && !absent.includes(p.id)),
      extra: [{ label: 'Empate', value: 'tie' }, { label: 'Nadie', value: 'none' }]
    });
    const lynched = await resolveVote(r);
    // Entusiasmo / Insatisfacción: según el bando del linchado, se vuelve a votar.
    if (lynched && G.lynchCheck) {
      const wolf = isWolfSide(lynched);
      if ((G.lynchCheck === 'wolf') === wolf) {
        G.votesLeft += 1;
        await say(wolf ? '¡Era un Hombre Lobo! Enardecida, la aldea votará otra vez.' : 'No era un Hombre Lobo. Humillada, la aldea votará otra vez.');
      }
      G.lynchCheck = null;
    }
  }
  G.voted = true;
  G.votesLeft = Math.max(0, G.votesLeft - 1);
  G.ravenMark = null;
  if (checkVictory()) return screenGameOver();
  if (G.votesLeft > 0 && alive().length > 1) {
    await say('Se procede inmediatamente a una segunda votación, sin debate.');
    return startVote();
  }
  renderDay();
}

async function resolveVote(choice) {
  let victim = null;
  let byTie = false;
  if (choice === 'tie') {
    const cab = alive().find((p) => is(p, 'cabezaTurco'));
    if (!cab) { await say('Empate. Hoy nadie es eliminado.'); return; }
    await say(`Empate. Como siempre, paga el Cabeza de turco: ${cab.name}.`);
    victim = cab;
    byTie = true;
  } else if (!Array.isArray(choice) || !choice.length) {
    await say('La aldea decide no eliminar a nadie hoy.');
    return;
  } else {
    victim = P(choice[0]);
  }
  G.scapegoatVoters = null; // la restricción del Cabeza de turco valía para esta votación

  // Evento "Cara o cruz": una moneda decide la suerte del acusado.
  if (G.dayFlags.coin) {
    G.dayFlags.coin = false;
    await say('En honor a Hervé el tuerto, la suerte del acusado se decide con una moneda…');
    await pause(1500);
    if (Math.random() < 0.5) {
      log(`Cara o cruz: ${victim.name} sale absuelto.`);
      await say(`¡Cruz! ${victim.name} queda absuelto y debe gritar la frase de la carta.`);
      return null;
    }
    await say(`¡Cara! ${victim.name} es condenado y grita la frase de la carta.`);
  }
  // Evento "Pacto con el diablo": justo después del veredicto.
  if (G.dayFlags.devilPact) {
    G.dayFlags.devilPact = false;
    const r = await choiceUI({ mode: 'day', role: 'Pacto con el diablo', q: `${esc(victim.name)}, ¿haces un pacto con el diablo? No serás eliminado, pero si acabas en el bando ganador quedarás fuera de la siguiente partida.`, options: [{ label: 'No', value: false }, { label: 'Sí, pacto', value: true, primary: true }] });
    if (r) {
      victim.devilPact = true;
      log(`${victim.name} hace un pacto con el diablo.`);
      await say(`${victim.name} ha pactado con el diablo y se salva… por ahora.`);
      return null;
    }
  }

  // Noble (La Aldea): indulto único tras la votación.
  if (G.opts.aldea) {
    const noble = occupant('palacete');
    const b = noble && bOf(noble);
    if (noble && b && !b.used) {
      const r = await choiceUI({ mode: 'day', role: 'El Noble', q: `¿Indulta el Noble (${esc(noble.name)}) a ${esc(victim.name)}? Solo a petición de la víctima; una vez por partida.`, options: [{ label: 'No', value: false }, { label: 'Sí, indultar', value: true, primary: true }] });
      if (r) { b.used = true; log(`El Noble indulta a ${victim.name}.`); await say(`El Noble indulta a ${victim.name}. No será eliminado y su carta no se muestra.`); return; }
    }
  }
  // Tonto de la aldea: se revela y se salva, pero pierde su voto (pág. 11).
  if (is(victim, 'tonto') && !victim.tontoRevealed) {
    victim.tontoRevealed = true;
    victim.canVote = false;
    if (G.alguacil === victim.id) { G.alguacil = null; G.alguacilLost = true; }
    G.votesLeft = 1; // "No habrá ninguna otra votación en este turno"
    log(`${victim.name} es el Tonto de la aldea: indultado.`);
    await say(`${victim.name} muestra su carta: ¡es el Tonto de la aldea! Avergonzados, le indultan. Desde ahora no puede votar.`);
    return;
  }
  // Abnegada Sirvienta: se le pregunta SIEMPRE que esté en el mazo (no revela si vive).
  if (inDeck('sirvienta')) {
    await say('Antes de revelar la carta, ¿quiere la Abnegada Sirvienta ocupar su lugar?');
    const serv = alive().find((p) => p.role === 'sirvienta' && p.id !== victim.id);
    const r = await choiceUI({ mode: 'day', role: 'Abnegada Sirvienta', q: `¿Se revela la Abnegada Sirvienta para tomar el personaje de ${esc(victim.name)}?`, options: [{ label: 'Nadie se revela', value: false, primary: true }, { label: 'La Sirvienta se revela', value: true }] });
    if (r && serv && !G.lovers.includes(serv.id)) {
      const newRole = victim.role;
      serv.role = newRole;
      serv.card = 'sirvienta';
      serv.lives = newRole === 'anciano' ? 2 : 1;
      serv.charmed = false; // deja de estar hechizada; si estaba infectada, sigue estándolo
      if (G.alguacil === serv.id) G.alguacil = null;
      if (G.guardia === serv.id) G.guardia = null;
      resetRoleState(newRole);
      victim.hiddenCard = true;
      log(`${serv.name} (Abnegada Sirvienta) asume en secreto el personaje de ${victim.name}.`);
      await say(`${serv.name} era la Abnegada Sirvienta. Toma en secreto la carta de ${victim.name}, que no se revela.`);
    } else if (r && serv) {
      await say('La Sirvienta está enamorada: su amor es más fuerte que su voluntad. No puede cambiar.');
    }
  }
  kill(victim, 'linchamiento');
  // Evento "Verdugo": solo él ve la carta del linchado.
  if (victim.verdugoOnly) await verdugoReveal(victim);
  await processTriggers();
  // Cabeza de turco linchado por empate: decide quién vota mañana.
  if (byTie && !victim.alive) {
    const r = await pickUI({ mode: 'day', role: 'Última voluntad del Cabeza de turco', q: `${esc(victim.name)}, elige qué jugadores podrán votar en el próximo linchamiento.`, count: alive().length, min: 0, candidates: alive() });
    if (Array.isArray(r)) G.scapegoatVoters = r;
  }
  return victim.alive ? null : victim;
}

/** Muestra en privado al verdugo la carta del linchado (pantalla de pasar el dispositivo). */
async function verdugoReveal(victim) {
  const v = P(G.ev.verdugo);
  await say(`Solo el verdugo, ${v.name}, conocerá la carta de ${victim.name}.`);
  await infoUI({ mode: 'day', role: 'Verdugo', title: `Pasad el dispositivo a ${v.name}.`, button: `Soy ${v.name}: ver la carta` });
  await infoUI({ mode: 'day', role: 'Solo para el verdugo', title: `${victim.name} era…`, big: roleName(victim.role), button: 'Ocultar' });
}

/** Restablece el estado de un poder cuando la Sirvienta hereda el personaje (pág. 13). */
function resetRoleState(role) {
  if (role === 'bruja') G.potions = { life: true, death: true, extra: G.potions.extra || 0 };
  if (role === 'infecto') G.infectUsed = false;
  if (role === 'zorro') G.foxActive = true;
  if (role === 'piromano') G.piromanoUsed = false;
  if (role === 'juez') G.juezUsed = false;
}

/* =====================================================================
 * 21. HERRAMIENTAS DE DÍA (públicas)
 * =================================================================== */
/** Diálogo genérico. */
function modal(html) {
  const d = $('#modal');
  $('#modal-body').innerHTML = `${html}<button class="btn block" data-close style="margin-top:14px">Cerrar</button>`;
  $('[data-close]', d).onclick = () => d.close();
  if (!d.open) d.showModal();
  return d;
}

/** Botones de los oficios de La Aldea disponibles ahora. */
function buildingToolsHTML() {
  const t = [];
  const unused = (type) => { const o = occupant(type); return o && !bOf(o).used ? o : null; };
  if (unused('barberia')) t.push(['barbero', `💈 Barbero (${occupant('barberia').name})`]);
  if (unused('iglesia')) t.push(['confesor', `📿 Confesor (${occupant('iglesia').name})`]);
  if (unused('choza')) t.push(['boticario', `⚗️ Boticario (${occupant('choza').name})`]);
  if (occupant('ayuntamiento') && G.buildings.some((b) => !b.destroyed && b.occupant == null)) t.push(['alcalde', `🔑 Alcalde: realojar`]);
  if (unused('taberna')) t.push(['tabernero', `🍺 Tabernero pierde inmunidad`]);
  const list = G.buildings.filter((b) => !b.destroyed).map((b) => `<li>${bLabel(b)}: ${b.occupant != null ? esc(P(b.occupant).name) : '<i>vacío</i>'}${BUILDINGS[b.type].kind === 'unico' || b.type === 'taberna' ? (b.used ? ' · ficha usada' : ' · ficha disponible') : ''}</li>`).join('');
  return `<div><b>La Aldea</b><ul class="small">${list}</ul></div>
    ${t.length ? `<div class="row">${t.map(([k, l]) => `<button class="btn" data-tool="${k}">${esc(l)}</button>`).join('')}</div>` : ''}`;
}

const BUILDING_TOOLS = {
  async barbero() {
    const bar = occupant('barberia');
    const r = await pickUI({ mode: 'day', role: 'Barbero', q: `${esc(bar.name)}, ¿a quién degüellas? (no a un Vagabundo)`, candidates: alive().filter((p) => p.id !== bar.id && !isVagabond(p)), allowNone: true, noneLabel: 'Cancelar' });
    if (!Array.isArray(r) || !r.length) return renderDay();
    const t = P(r[0]);
    bOf(bar).used = true;
    await say(`¡El Barbero degüella a ${t.name}!`);
    kill(t, 'barbero');
    if (CORE_WOLVES.includes(t.role)) await say('¡Era un Hombre Lobo! La aldea felicita al Barbero.');
    else { await say('No era un Hombre Lobo. El Barbero también es ejecutado.'); kill(bar, 'ejecucion'); }
    await processTriggers();
    if (checkVictory()) return screenGameOver();
    renderDay();
  },
  async confesor() {
    const c = occupant('iglesia');
    const r = await pickUI({ mode: 'day', role: 'Confesor', q: `${esc(c.name)}, ¿a quién confiesas? Te mostrará su carta en privado.`, candidates: alive().filter((p) => p.id !== c.id), allowNone: true, noneLabel: 'Cancelar' });
    if (Array.isArray(r) && r.length) { bOf(c).used = true; await say(`${P(r[0]).name} debe mostrar su carta al Confesor en privado.`); }
    renderDay();
  },
  async boticario() {
    const bot = occupant('choza');
    const used = G.buildings.filter((b) => !b.destroyed && b.used && b.occupant != null && b.type !== 'choza');
    if (!used.length) { await infoUI({ mode: 'day', title: 'No hay ninguna ficha usada que restablecer.' }); return renderDay(); }
    const r = await choiceUI({ mode: 'day', role: 'Boticario', q: `${esc(bot.name)}, ¿qué poder restableces?`, options: [...used.map((b) => ({ label: `${bLabel(b)} (${P(b.occupant).name})`, value: b.uid, primary: true })), { label: 'Cancelar', value: null }] });
    if (r) { G.buildings.find((b) => b.uid === r).used = false; bOf(bot).used = true; await say('El Boticario restablece un poder.'); }
    renderDay();
  },
  async alcalde() {
    const empty = G.buildings.filter((b) => !b.destroyed && b.occupant == null);
    const vags = alive().filter(isVagabond);
    if (!vags.length) { await infoUI({ mode: 'day', title: 'No hay Vagabundos vivos.' }); return renderDay(); }
    const bu = await choiceUI({ mode: 'day', role: 'Alcalde', q: '¿Qué edificio vacío asignas?', options: [...empty.map((b) => ({ label: bLabel(b), value: b.uid, primary: true })), { label: 'Cancelar', value: null }] });
    if (!bu) return renderDay();
    const r = await pickUI({ mode: 'day', role: 'Alcalde', q: '¿A qué Vagabundo alojas? (puede rechazarlo)', candidates: vags, allowNone: true, noneLabel: 'Cancelar' });
    if (Array.isArray(r) && r.length) {
      const b = G.buildings.find((x) => x.uid === bu);
      b.occupant = r[0];
      b.used = false; // recupera la ficha aunque se hubiera usado
      await say(`${P(r[0]).name} se instala en ${bLabel(b)}.`);
    }
    renderDay();
  },
  async tabernero() {
    const t = occupant('taberna');
    if (confirm(`¿${t.name} votó contra un jugador eliminado? Perderá su inmunidad y su ficha.`)) { bOf(t).used = true; await say('El Tabernero pierde su inmunidad.'); }
    renderDay();
  }
};

async function toolAlguacil() {
  const farmers = G.opts.aldea && G.day >= 2 ? alive().filter((x) => bOf(x)?.type === 'granja') : [];
  const cands = farmers.length ? farmers : alive().filter((p) => !p.tontoRevealed);
  const r = await pickUI({ mode: 'day', role: 'Alguacil', q: `¿Quién es el nuevo Alguacil?${farmers.length ? ' (desde el 2.º turno lo eligen los Granjeros entre ellos)' : ' Votad: el cargo no se puede rechazar.'}`, candidates: cands, allowNone: true, noneLabel: 'Cancelar' });
  if (Array.isArray(r) && r.length) {
    G.alguacil = r[0];
    if (G.guardia === r[0]) G.guardia = null; // no se acumulan cargos
    await say(`${P(r[0]).name} es el nuevo Alguacil.`);
  }
  renderDay();
}

async function toolGuardia() {
  if (G.alguacil == null) { await infoUI({ mode: 'day', title: 'Primero tiene que haber un Alguacil: es quien nombra al Guardia.' }); return renderDay(); }
  const r = await pickUI({ mode: 'day', role: 'Guardia', q: `${esc(P(G.alguacil).name)}, ¿a quién nombras Guardia? (no a ti mismo)`, candidates: alive().filter((p) => p.id !== G.alguacil), allowNone: true, noneLabel: 'Cancelar' });
  if (Array.isArray(r) && r.length) { setGuardia(r[0]); await say(`${P(r[0]).name} es el nuevo Guardia.`); }
  renderDay();
}

/** Para eventos físicos o correcciones: elimina a un jugador con todos sus triggers. */
async function toolManualKill() {
  const r = await pickUI({ mode: 'day', role: 'Eliminar jugador', q: 'Para eventos de cartas físicas o para corregir un error.', candidates: alive(), allowNone: true, noneLabel: 'Cancelar' });
  if (Array.isArray(r) && r.length) {
    kill(P(r[0]), 'evento');
    await processTriggers();
    if (checkVictory()) return screenGameOver();
  }
  renderDay();
}

/* =====================================================================
 * 22. CONDICIONES DE VICTORIA (págs. 7-9, 15)
 * =================================================================== */
const WINNERS = {
  angel: '¡Gana el Ángel!',
  albino: '¡Gana el Hombre Lobo Albino!',
  flautista: '¡Gana el Flautista!',
  sectario: '¡Gana el Abominable Sectario!',
  enamorados: '¡Ganan los Enamorados!',
  aldea: '¡Gana la Aldea!',
  lobos: '¡Ganan los Hombres Lobo!',
  nadie: 'Nadie gana: la aldea ha quedado desierta.'
};

function checkVictory() {
  if (G.winner) return true;
  const a = alive();
  const set = (key, ids = []) => { G.winner = { key, ids }; return true; };
  if (!a.length) return set('nadie');
  // Albino: único superviviente.
  if (a.length === 1 && a[0].role === 'albino') return set('albino', [a[0].id]);
  // Flautista: todos los demás vivos hechizados.
  const fl = a.find((p) => p.role === 'flautista' && !isWolfSide(p));
  if (fl && a.filter((p) => p.id !== fl.id).every((p) => p.charmed)) return set('flautista', [fl.id]);
  // Sectario: todo el otro grupo eliminado.
  const sec = a.find((p) => p.role === 'sectario' && !isWolfSide(p));
  if (sec && sec.group && G.players.filter((p) => p.group && p.group !== sec.group).every((p) => !p.alive)) return set('sectario', [sec.id]);
  // Enamorados mixtos (lobo + aldeano): ganan si solo quedan ellos.
  const [l1, l2] = G.lovers.map(P);
  const mixed = l1 && l2 && (isWolfSide(l1) !== isWolfSide(l2) || l1.role === 'flautista' || l2.role === 'flautista');
  if (mixed && l1.alive && l2.alive) return a.length === 2 ? set('enamorados', G.lovers) : false;
  const wolves = a.filter(isWolfSide);
  // El aliado secreto del "Agente doble" gana (y pierde) con los lobos.
  const wolfTeam = (p) => isWolfSide(p) || p.ally;
  if (!wolves.length) return set('aldea', a.filter((p) => !p.ally).map((p) => p.id));
  if (a.every(wolfTeam) && !a.some((p) => p.role === 'albino')) return set('lobos', G.players.filter((p) => isWolfSide(p) || p.ally).filter((p) => p.alive).map((p) => p.id));
  return false;
}

function screenGameOver() {
  FLOW++;
  G.phase = 'gameover';
  save();
  setMode('day');
  stopTimer();
  releaseWakeLock();
  const w = G.winner || { key: 'nadie', ids: [] };
  say(`${WINNERS[w.key]} Fin de la partida.`);
  render(`
    <section class="stack">
      <div class="card center">
        <div class="winner">${WINNERS[w.key]}</div>
        ${w.ids.length ? `<p>${esc(joinNames(w.ids.map((id) => P(id).name)))}</p>` : ''}
      </div>
      <div class="card">
        <h3>Personajes</h3>
        <table class="roles">${G.players.map((p) => `
          <tr><td><b>${esc(p.name)}</b>${p.alive ? '' : ' <span class="muted">†</span>'}</td>
          <td>${roleName(p.role)}${p.card && p.card !== p.role ? ` <span class="muted small">(antes ${roleName(p.card)})</span>` : ''}
          ${p.infected ? ' <span class="pill team-lobo">infectado</span>' : ''}${p.charmed ? ' <span class="pill">hechizado</span>' : ''}${G.lovers.includes(p.id) ? ' 💘' : ''}${p.ally ? ' <span class="pill team-lobo">aliado de los lobos</span>' : ''}${p.devilPact ? ' <span class="pill">😈 pacto</span>' : ''}</td></tr>`).join('')}
        </table>
      </div>
      ${G.players.some((p) => p.devilPact && w.ids.includes(p.id)) ? `<div class="card"><b>😈 Pacto con el diablo:</b> ${esc(joinNames(G.players.filter((p) => p.devilPact && w.ids.includes(p.id)).map((p) => p.name)))} queda fuera de la siguiente partida.</div>` : ''}
      <details class="card"><summary><b>Registro completo de la partida</b></summary><ol class="log">${G.log.map((l) => `<li>${esc(l)}</li>`).join('')}</ol></details>
      <div class="row">
        <button class="btn grow" data-a="cont">Seguir jugando igualmente</button>
        <button class="btn primary grow" data-a="new">Nueva partida</button>
      </div>
    </section>`);
  $('[data-a=new]').onclick = () => { store.del('narrador-game'); screenPlayers(); };
  // Por si la app se equivoca o la mesa quiere continuar (p. ej. Ángel).
  $('[data-a=cont]').onclick = () => { G.winner = null; G.phase = 'day'; G.angelWindow = false; renderDay(); };
}

/* =====================================================================
 * 23. MENÚ, AJUSTES, PANTALLA ENCENDIDA E INSTALACIÓN
 * =================================================================== */
let wakeLock = null;
async function requestWakeLock() { try { wakeLock = await navigator.wakeLock?.request('screen'); } catch { /* no soportado */ } }
function releaseWakeLock() { try { wakeLock?.release(); } catch { /* idem */ } wakeLock = null; }
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && G && ['night', 'day', 'dawn'].includes(G.phase)) requestWakeLock(); });

let installEvt = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvt = e; });

function openMenu() {
  const d = $('#menu-dialog');
  const voices = Voice.voices;
  $('#menu-body').innerHTML = `
    <h2>Ajustes</h2>
    <div class="stack">
      <div><label for="s-voice">Voz</label>
        <select id="s-voice">${voices.length ? voices.map((v) => `<option value="${esc(v.voiceURI)}" ${Voice.voice()?.voiceURI === v.voiceURI ? 'selected' : ''}>${esc(v.name)} (${v.lang})</option>`).join('') : '<option>No hay voces en español instaladas</option>'}</select></div>
      <div><label for="s-rate">Velocidad de la voz: <output id="o-rate">${Settings.rate}</output></label>
        <input type="range" id="s-rate" min="0.6" max="1.4" step="0.05" value="${Settings.rate}" style="width:100%"></div>
      <div><label for="s-pad">Pausas dramáticas: <output id="o-pad">×${Settings.padding}</output></label>
        <input type="range" id="s-pad" min="0.5" max="2" step="0.25" value="${Settings.padding}" style="width:100%"></div>
      <div><label for="s-deb">Duración del debate (min)</label>
        <input type="number" id="s-deb" min="1" max="20" value="${Settings.debateMin}"></div>
      <button class="btn block" type="button" data-m="test">🔊 Probar voz</button>
      ${installEvt ? '<button class="btn block" type="button" data-m="install">📲 Instalar la app</button>' : ''}
      <details><summary><b>Orden de llamada nocturna</b></summary>
        <ol class="small">${NIGHT_STEPS.map((s) => `<li>${s.id}</li>`).join('')}</ol></details>
      ${G && G.phase !== 'gameover' ? '<button class="btn danger block" type="button" data-m="quit">Abandonar partida</button>' : ''}
      <button class="btn primary block" value="close">Cerrar</button>
    </div>`;
  $('#s-voice').onchange = (e) => { Settings.voiceURI = e.target.value; saveSettings(); };
  $('#s-rate').oninput = (e) => { Settings.rate = +e.target.value; $('#o-rate').textContent = Settings.rate; saveSettings(); };
  $('#s-pad').oninput = (e) => { Settings.padding = +e.target.value; $('#o-pad').textContent = '×' + Settings.padding; saveSettings(); };
  $('#s-deb').onchange = (e) => { Settings.debateMin = Math.max(1, +e.target.value || 4); saveSettings(); };
  $('[data-m=test]').onclick = () => say('Se hace de noche. La aldea duerme. La Vidente se despierta.');
  const ins = $('[data-m=install]'); if (ins) ins.onclick = async () => { installEvt.prompt(); installEvt = null; d.close(); };
  const q = $('[data-m=quit]');
  if (q) q.onclick = () => {
    if (!confirm('¿Abandonar la partida? Se perderá el progreso.')) return;
    FLOW++; Voice.stop(); stopTimer(); releaseWakeLock();
    store.del('narrador-game'); G = null; d.close(); screenHome();
  };
  d.showModal();
}

function updateMuteBtn() { $('#btn-mute').textContent = Settings.muted ? '🔇' : '🔊'; }

/* =====================================================================
 * 24. ARRANQUE
 * =================================================================== */
function boot() {
  Voice.init();
  updateMuteBtn();
  $('#btn-menu').onclick = openMenu;
  $('#btn-mute').onclick = () => { Settings.muted = !Settings.muted; if (Settings.muted) Voice.stop(); saveSettings(); updateMuteBtn(); };
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => { /* sin modo offline */ });
  }
  screenHome();
}
boot();
