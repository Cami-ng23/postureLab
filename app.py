import logging
import math
import os
import threading
import time

from flask import Flask, render_template
from flask_socketio import SocketIO

# ================================================================
# CONFIGURACIÓN
# ================================================================
HOST = os.getenv("POSTURELAB_HOST", "0.0.0.0")
PUERTO = int(os.getenv("POSTURELAB_PUERTO", "5000"))
DEBUG = os.getenv("POSTURELAB_DEBUG", "0") == "1"

INTERVALO_ENVIO = 0.05                                       # 20 fps
DURACION_FASE_SEGUNDOS = int(os.getenv("POSTURELAB_DURACION_FASE", "12"))

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s", datefmt="%H:%M:%S")
log = logging.getLogger("posturelab")

app = Flask(__name__)
socketio = SocketIO(app, cors_allowed_origins="*")


@app.route("/")
def index():
    return render_template("index.html")


# ================================================================
# MODO DEMOSTRACIÓN
#
# Esto es SOLO el respaldo para cuando no hay cámara disponible (o
# nadie sentado frente a ella durante la feria). El modo real usa la
# cámara + MediaPipe, calculado enteramente en el navegador (ver
# static/js/main.js) — este simulador no participa en ese modo.
#
# A diferencia de la versión anterior, acá los DOS BRAZOS comparten
# exactamente los mismos ángulos en todo momento (misma fase, misma
# amplitud). Antes cada brazo tenía su propia fórmula con sin()/cos()
# independientes, lo que en ciertos instantes los desincronizaba y se
# veía como "un brazo adelante y el otro atrás". Al usar un único
# ángulo compartido para hombro y otro para codo, el movimiento de
# tecleo se ve simétrico y natural en cualquier instante t.
# ================================================================
def calcular_angulos_demo(t: float) -> dict:
    """Función pura: dado el tiempo simulado t, devuelve los ángulos
    (en grados) que el frontend le aplica al avatar y al semáforo.

    Fases (se repiten cada DURACION_FASE_SEGUNDOS * 4 segundos):
      0: Postura correcta
      1: Cuello adelantado
      2: Espalda encorvada
      3: Hombros inclinados / asimétricos
    """
    fase = (int(t) // DURACION_FASE_SEGUNDOS) % 4

    cuello_deg = 0.0
    espalda_deg = 0.0
    hombros_deg = 0.0

    if fase == 1:
        cuello_deg = 22.0 + math.sin(t * 0.6) * 2.0
    elif fase == 2:
        espalda_deg = 24.0 + math.sin(t * 0.6) * 2.0
    elif fase == 3:
        hombros_deg = 13.0 + math.sin(t * 0.6) * 1.5

    # Brazos: MISMA fórmula para ambos lados (izquierdo y derecho),
    # de modo que el frontend, al aplicarla espejada a cada brazo,
    # los mueva de forma perfectamente simétrica y sincronizada.
    brazo_superior_deg = math.sin(t * 1.3) * 4.0       # leve vaivén de hombro al escribir
    brazo_inferior_deg = math.sin(t * 1.9) * 5.0 + 3.0  # leve vaivén de codo al escribir

    return {
        "cuelloDeg": cuello_deg,
        "espaldaDeg": espalda_deg,
        "hombrosDeg": hombros_deg,
        "brazoSuperiorDeg": brazo_superior_deg,
        "brazoInferiorDeg": brazo_inferior_deg,
    }


_reloj = {"t": 0.0}
_reloj_lock = threading.Lock()
_demo_activo = threading.Event()


def bucle_demo():
    log.info("🎬 Hilo de modo demostración listo (en espera)")
    while True:
        if _demo_activo.is_set():
            try:
                with _reloj_lock:
                    _reloj["t"] += INTERVALO_ENVIO
                    t = _reloj["t"]
                socketio.emit("estado_postura_demo", calcular_angulos_demo(t))
            except Exception:
                log.exception("Error generando/emitiendo un frame de demostración")
        time.sleep(INTERVALO_ENVIO)


@socketio.on("connect")
def on_connect():
    log.info("🔌 Cliente conectado")


@socketio.on("disconnect")
def on_disconnect():
    log.info("🔌 Cliente desconectado")


@socketio.on("iniciar_demo")
def on_iniciar_demo():
    with _reloj_lock:
        _reloj["t"] = 0.0
    _demo_activo.set()
    log.info("▶️ Modo demostración iniciado")


@socketio.on("detener_demo")
def on_detener_demo():
    _demo_activo.clear()
    log.info("⏸️ Modo demostración detenido (cliente pasó a modo cámara)")


@socketio.on("reiniciar_sesion")
def on_reiniciar_sesion():
    with _reloj_lock:
        _reloj["t"] = 0.0
    log.info("🔁 Sesión reiniciada por el cliente")


hilo_demo = threading.Thread(target=bucle_demo, daemon=True)
hilo_demo.start()

if __name__ == "__main__":
    log.info(f"Arrancando PostureLab en http://{HOST}:{PUERTO} (debug={DEBUG})")
    socketio.run(app, host=HOST, port=PUERTO, debug=DEBUG)
