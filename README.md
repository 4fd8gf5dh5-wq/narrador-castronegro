# Narrador de Castronegro — El Pacto

Narrador automático por voz para **Los Hombres Lobo de Castronegro: El Pacto**. Es una PWA en HTML, CSS y JavaScript sin dependencias: se deja el móvil o la tablet en el centro de la mesa y la app llama a cada personaje por la noche, resuelve las muertes al amanecer y gestiona el día.

**Jugar:** https://4fd8gf5dh5-wq.github.io/narrador-castronegro/ (en el móvil: menú del navegador → "Añadir a pantalla de inicio" para instalarla).

## Qué incluye

- **Generador de mazos** desde 5 jugadores, editable, con medidor de equilibrio.
- **Reparto secreto "pasa el móvil"**: cada jugador marca en privado la carta que le ha tocado.
- **Fase pública**: edificios de *La Aldea*, Alguacil, Guardia y grupos del Abominable Sectario.
- **Noche en modo oscuro y silencioso**: la voz (`speechSynthesis`, en español) llama a los personajes en el orden oficial y cada uno actúa tocando la pantalla.
- **Amanecer con resolución simultánea** y una cola de efectos en cadena: Cazador, enamorados, sucesión del Alguacil, Guardia y verdugo.
- **Las 36 cartas de evento de *Luna Nueva***. Se pueden usar las cartas físicas (se marca en la app cuál ha salido) o dejar que la app robe y lea. Incluye la Gitana con las cartas de Espiritismo y el Guardia con sus cartas.
- La partida se guarda sola y funciona sin conexión.

## Archivos

| Archivo | Contenido |
|---|---|
| `index.html` | Estructura de la página |
| `style.css` | Modo día y modo noche |
| `app.js` | Máquina de estados, personajes, noche, amanecer, día y voz |
| `eventos.js` | Las 36 cartas de evento de *Luna Nueva* |
| `manifest.json`, `sw.js`, `icons/` | Instalación como PWA y modo sin conexión |

## Probarla en local

```bash
python -m http.server 8790
```

Después abre http://localhost:8790.

## Aviso

Es un proyecto de fans, sin afiliación con lui-même ni Asmodee. Para jugar hacen falta el juego y sus cartas. Los textos de los eventos son resúmenes propios de cada efecto, no una reproducción de las cartas.
