# Garabatrola

Juego de fiesta para dibujar mal y mentir bien. La pantalla grande (`index.html`) crea la sala y muestra un QR; cada jugador entra desde su móvil (`play.html`).

## Cómo se juega
1. Abre la web en la tele u ordenador y pulsa **Jugar**.
2. Cada jugador escanea el QR, pone su nombre y dibuja su cara mientras espera.
3. Cuando todos están listos, empieza la partida: cada uno dibuja una frase secreta.
4. Por cada dibujo, el resto escribe un título falso; luego todos votan cuál es el de verdad.
5. Puntos: acertar la verdad +1000 (y +500 al artista por cada acierto); que alguien se crea tu mentira, +500.

## Técnica
- Web estática servida con GitHub Pages.
- Sincronización en tiempo real con Firebase Realtime Database y acceso anónimo (`js/firebase-config.js`).
- La pantalla grande hace de árbitro: controla tiempos, puntos y cambios de fase.
- Música generada con Web Audio; voz con la síntesis del navegador (`js/voice.js`).

Reglas de la base de datos:
```json
{"rules":{"rooms":{"$room":{".read":"auth != null",".write":"auth != null"}}}}
```
