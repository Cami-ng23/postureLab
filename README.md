# PostureLab — Evaluación de postura 3D en tiempo real

## Cómo correrlo
```
pip install -r requirements.txt
python app.py
```
Abre http://localhost:5000 en Chrome o Edge (necesitan soporte WebGL + getUserMedia).

## Modo Cámara (real)
1. Al abrir, pide permiso de cámara. Elige el dispositivo en el selector
   ("Cámara" del notebook por ahora; cuando conectes la cámara lateral
   aparecerá en la misma lista).
2. Siéntate derecho/a y presiona "Calibrar postura neutra". A partir de
   ahí, todo se mide como desviación respecto a ESA postura (por eso
   funciona sin importar dónde esté ubicada la cámara).
3. El avatar 3D (silla y cuerpo construidos por código, no son de
   Mixamo) refleja tus movimientos reales de cuello, espalda y brazos.

## Modo Demostración
Botón "Demostración" arriba a la derecha: usa un simulador en el
backend (app.py) para mostrar el sistema funcionando sin cámara ni
persona sentada — útil como respaldo en la feria.

## Mapa de Postura
Botón "🔴 Mapa de Postura": abre un segundo avatar con puntos rojos
en las zonas (cuello / espalda / hombros) que tuvieron alguna alerta
durante la sesión actual. "Reiniciar sesión" limpia esas marcas.

## Estructura
- `app.py` — servidor Flask + modo demostración
- `static/js/posture-math.js` — matemática pura (ángulos/calibración), sin THREE.js, testeada con Node
- `static/js/scene-builder.js` — construcción por código del avatar y la silla
- `static/js/main.js` — cámara, MediaPipe, semáforo, modal
- `test_posture_math.js` (en el chat) — pruebas de la matemática con datos falsos
