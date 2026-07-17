/**
 * main.js
 * ------------------------------------------------------------------
 * Orquesta todo lo demás:
 *   - Dos escenas Three.js (principal + la del modal "Mapa de Postura"),
 *     cada una con su propio avatar+silla construidos por scene-builder.js
 *   - Captura de cámara (selector de dispositivo) + MediaPipe Pose Landmarker
 *   - Calibración de postura neutra
 *   - Cálculo de desviaciones/deltas (posture-math.js) y aplicación al rig
 *   - Semáforo de alertas por zona (cuello / espalda / hombros)
 *   - Modo demostración (respaldo si falla la cámara), vía Socket.IO
 *   - Estadísticas de sesión + modal con avatar secundario y puntos rojos
 * ------------------------------------------------------------------
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import * as SceneBuilder from './scene-builder.js';
// PostureMath se carga como script clásico (window.PostureMath) en
// index.html, así que está disponible acá como variable global.

// ====================================================================
// Umbrales de alerta (grados de desviación respecto a la calibración).
// Son aproximaciones razonables inspiradas en criterios ergonómicos
// comunes (tipo RULA/REBA), NO un diagnóstico médico.
// ====================================================================
const UMBRALES = {
    cuello: 15,
    espalda: 15,
    hombros: 8,
};

const SUAVIZADO = 0.28; // 0-1, más alto = responde más rápido pero más "nervioso"

// ====================================================================
// Estado global de sesión
// ====================================================================
const statsSesion = { cuelloMalo: false, espaldaMalo: false, hombrosMalo: false };
let frameCalibrado = null;
let ultimasDesviaciones = { cuelloDeg: 0, espaldaDeg: 0, hombrosDeg: 0 };
let modoActual = 'camara'; // 'camara' | 'demo'

// ====================================================================
// 1. ESCENA PRINCIPAL (Three.js)
// ====================================================================
const contenedorPrincipal = document.getElementById('canvas-avatar');
const scenePrincipal = new THREE.Scene();
scenePrincipal.background = new THREE.Color(0x0d1117);
scenePrincipal.fog = new THREE.Fog(0x0d1117, 5, 12);

const camaraPrincipal = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
const rendererPrincipal = new THREE.WebGLRenderer({ antialias: true });
rendererPrincipal.setPixelRatio(Math.min(window.devicePixelRatio, 2));
rendererPrincipal.outputColorSpace = THREE.SRGBColorSpace;
rendererPrincipal.toneMapping = THREE.ACESFilmicToneMapping;
rendererPrincipal.shadowMap.enabled = true;
contenedorPrincipal.appendChild(rendererPrincipal.domElement);

const controlsPrincipal = new OrbitControls(camaraPrincipal, rendererPrincipal.domElement);
controlsPrincipal.enableDamping = true;
controlsPrincipal.dampingFactor = 0.08;
controlsPrincipal.minDistance = 0.8;
controlsPrincipal.maxDistance = 6;

function iluminarEscena(scene) {
    scene.add(new THREE.HemisphereLight(0x9fc4ff, 0x1a1d24, 0.65));
    const key = new THREE.DirectionalLight(0xfff2e0, 1.6);
    key.position.set(2.2, 4, 2.5);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0x6fa8ff, 0.35);
    fill.position.set(-3, 2, -1.5);
    scene.add(fill);
}
iluminarEscena(scenePrincipal);

const piso = new THREE.Mesh(
    new THREE.CircleGeometry(2.2, 48),
    new THREE.MeshStandardMaterial({ color: 0x161b22, roughness: 0.95 })
);
piso.rotation.x = -Math.PI / 2;
piso.receiveShadow = true;
scenePrincipal.add(piso);

const rigPrincipal = SceneBuilder.construirAvatar();
scenePrincipal.add(rigPrincipal.raiz);
scenePrincipal.add(SceneBuilder.construirSilla());

// Encuadre de cámara fijo (no requiere calibración de escala: avatar y
// silla se diseñaron juntos, a la misma medida).
const alturaFoco = rigPrincipal.alturaCadera + 0.35;
controlsPrincipal.target.set(0, alturaFoco, 0);
camaraPrincipal.position.set(1.1, alturaFoco + 0.25, 1.3);

function ajustarTamano(renderer, camera, contenedor) {
    const w = contenedor.clientWidth || 400;
    const h = contenedor.clientHeight || 400;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
}
ajustarTamano(rendererPrincipal, camaraPrincipal, contenedorPrincipal);
window.addEventListener('resize', () => ajustarTamano(rendererPrincipal, camaraPrincipal, contenedorPrincipal));

function animarPrincipal() {
    requestAnimationFrame(animarPrincipal);
    controlsPrincipal.update();
    rendererPrincipal.render(scenePrincipal, camaraPrincipal);
}
animarPrincipal();

// ====================================================================
// 2. SEMÁFORO Y PANEL DE DIAGNÓSTICO
// ====================================================================
const elSemCuello = document.getElementById('sem-cuello');
const elSemEspalda = document.getElementById('sem-espalda');
const elSemHombros = document.getElementById('sem-hombros');
const elEstadoGeneral = document.getElementById('estado-general');
const elBannerCalibracion = document.getElementById('banner-calibracion');

function pintarSemaforo(el, estado) {
    el.classList.remove('bg-emerald-500/20', 'text-emerald-400', 'bg-red-500/20', 'text-red-400', 'bg-gray-500/20', 'text-gray-400');
    if (estado === 'alerta') {
        el.classList.add('bg-red-500/20', 'text-red-400');
    } else if (estado === 'ok') {
        el.classList.add('bg-emerald-500/20', 'text-emerald-400');
    } else {
        el.classList.add('bg-gray-500/20', 'text-gray-400');
    }
}

function actualizarSemaforo(desviaciones) {
    if (!desviaciones) {
        pintarSemaforo(elSemCuello, 'na');
        pintarSemaforo(elSemEspalda, 'na');
        pintarSemaforo(elSemHombros, 'na');
        elEstadoGeneral.textContent = 'Esperando calibración…';
        elEstadoGeneral.className = 'text-sm font-semibold text-gray-400';
        return;
    }
    const eCuello = PostureMath.clasificar(desviaciones.cuelloDeg, UMBRALES.cuello);
    const eEspalda = PostureMath.clasificar(desviaciones.espaldaDeg, UMBRALES.espalda);
    const eHombros = PostureMath.clasificar(desviaciones.hombrosDeg, UMBRALES.hombros);

    pintarSemaforo(elSemCuello, eCuello);
    pintarSemaforo(elSemEspalda, eEspalda);
    pintarSemaforo(elSemHombros, eHombros);

    if (eCuello === 'alerta') statsSesion.cuelloMalo = true;
    if (eEspalda === 'alerta') statsSesion.espaldaMalo = true;
    if (eHombros === 'alerta') statsSesion.hombrosMalo = true;

    const hayAlerta = [eCuello, eEspalda, eHombros].includes('alerta');
    elEstadoGeneral.textContent = hayAlerta ? '⚠️ Postura a corregir' : '✅ Postura correcta';
    elEstadoGeneral.className = 'text-sm font-semibold ' + (hayAlerta ? 'text-red-400' : 'text-emerald-400');
}

// ====================================================================
// 3. MODO CÁMARA — MediaPipe Pose Landmarker
// ====================================================================
const video = document.getElementById('video-camara');
const canvasOverlay = document.getElementById('overlay-esqueleto');
const ctxOverlay = canvasOverlay.getContext('2d');
const selectCamara = document.getElementById('select-camara');
const btnCalibrar = document.getElementById('btn-calibrar');
const elEstadoCamara = document.getElementById('estado-camara');

let poseLandmarker = null;
let streamActual = null;
let ultimoFramePersona = null; // último frame de landmarks válido (para calibrar)
let corriendoDeteccion = false;

async function listarCamaras() {
    try {
        // Pedimos permiso brevemente para que enumerateDevices devuelva labels
        const tmp = await navigator.mediaDevices.getUserMedia({ video: true });
        tmp.getTracks().forEach((t) => t.stop());
    } catch (e) {
        console.warn('No se pudo pre-solicitar permiso de cámara:', e);
    }
    const dispositivos = await navigator.mediaDevices.enumerateDevices();
    const camaras = dispositivos.filter((d) => d.kind === 'videoinput');
    selectCamara.innerHTML = '';
    camaras.forEach((cam, i) => {
        const opt = document.createElement('option');
        opt.value = cam.deviceId;
        opt.textContent = cam.label || `Cámara ${i + 1}`;
        selectCamara.appendChild(opt);
    });
    if (camaras.length === 0) {
        const opt = document.createElement('option');
        opt.textContent = 'No se detectaron cámaras';
        selectCamara.appendChild(opt);
    }
    // Recordamos la última cámara elegida (útil cuando conectes la cámara lateral)
    const guardada = localStorage.getItem('posturelab_camara_id');
    if (guardada && camaras.some((c) => c.deviceId === guardada)) {
        selectCamara.value = guardada;
    }
    return camaras;
}

async function iniciarCamara(deviceId) {
    if (streamActual) {
        streamActual.getTracks().forEach((t) => t.stop());
    }
    const constraints = {
        video: deviceId ? { deviceId: { exact: deviceId } } : true,
        audio: false,
    };
    streamActual = await navigator.mediaDevices.getUserMedia(constraints);
    video.srcObject = streamActual;
    await video.play();
    canvasOverlay.width = video.videoWidth || 640;
    canvasOverlay.height = video.videoHeight || 480;
    localStorage.setItem('posturelab_camara_id', deviceId || '');
}

async function inicializarMediaPipe() {
    const { FilesetResolver, PoseLandmarker } = await import(
        'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest'
    );
    const vision = await FilesetResolver.forVisionTasks(
        'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm'
    );
    poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
        baseOptions: {
            modelAssetPath:
                'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
            delegate: 'GPU',
        },
        runningMode: 'VIDEO',
        numPoses: 1,
    });
}

/** Dibuja un esqueleto simple sobre el video, para feedback visual de tracking. */
function dibujarEsqueleto(landmarksImagen) {
    ctxOverlay.clearRect(0, 0, canvasOverlay.width, canvasOverlay.height);
    if (!landmarksImagen) return;
    const conexiones = [
        [11, 12], [11, 13], [13, 15], [12, 14], [14, 16],
        [11, 23], [12, 24], [23, 24], [7, 11], [8, 12],
    ];
    ctxOverlay.strokeStyle = '#22c55e';
    ctxOverlay.lineWidth = 3;
    conexiones.forEach(([a, b]) => {
        const pa = landmarksImagen[a], pb = landmarksImagen[b];
        if (!pa || !pb) return;
        ctxOverlay.beginPath();
        ctxOverlay.moveTo(pa.x * canvasOverlay.width, pa.y * canvasOverlay.height);
        ctxOverlay.lineTo(pb.x * canvasOverlay.width, pb.y * canvasOverlay.height);
        ctxOverlay.stroke();
    });
    ctxOverlay.fillStyle = '#facc15';
    landmarksImagen.forEach((p) => {
        ctxOverlay.beginPath();
        ctxOverlay.arc(p.x * canvasOverlay.width, p.y * canvasOverlay.height, 3, 0, Math.PI * 2);
        ctxOverlay.fill();
    });
}

function loopDeteccion() {
    if (!corriendoDeteccion || modoActual !== 'camara') return;
    requestAnimationFrame(loopDeteccion);
    if (!poseLandmarker || video.readyState < 2) return;

    const resultado = poseLandmarker.detectForVideo(video, performance.now());
    const hayPersona = resultado.worldLandmarks && resultado.worldLandmarks.length > 0;

    dibujarEsqueleto(hayPersona ? resultado.landmarks[0] : null);
    elEstadoCamara.textContent = hayPersona ? '🟢 Persona detectada' : '🟠 Buscando persona…';

    if (!hayPersona) return;

    const frame = PostureMath.extraerFramePostura(resultado.worldLandmarks[0]);
    if (!frame) return;
    ultimoFramePersona = frame;

    if (!frameCalibrado) {
        elBannerCalibracion.classList.remove('hidden');
        return;
    }
    elBannerCalibracion.classList.add('hidden');

    const desviaciones = PostureMath.calcularDesviaciones(frame, frameCalibrado);
    const deltas = PostureMath.calcularDeltasRig(frame, frameCalibrado);
    ultimasDesviaciones = desviaciones;
    SceneBuilder.aplicarPose(rigPrincipal, deltas, SUAVIZADO);
    actualizarSemaforo(desviaciones);
}

async function activarModoCamara() {
    modoActual = 'camara';
    document.getElementById('panel-camara').classList.remove('hidden');
    document.getElementById('badge-modo').textContent = '📷 Cámara en vivo';
    if (typeof socket !== 'undefined') socket.emit('detener_demo');

    try {
        if (!poseLandmarker) {
            elEstadoCamara.textContent = 'Cargando modelo de detección…';
            await inicializarMediaPipe();
        }
        const camaras = await listarCamaras();
        await iniciarCamara(selectCamara.value || (camaras[0] && camaras[0].deviceId));
        corriendoDeteccion = true;
        loopDeteccion();
    } catch (err) {
        console.error('No se pudo iniciar la cámara:', err);
        elEstadoCamara.textContent = '🔴 No se pudo acceder a la cámara';
    }
}

selectCamara.addEventListener('change', () => iniciarCamara(selectCamara.value));

btnCalibrar.addEventListener('click', () => {
    if (!ultimoFramePersona) {
        elEstadoCamara.textContent = '🟠 Ubícate frente a la cámara antes de calibrar';
        return;
    }
    frameCalibrado = ultimoFramePersona;
    statsSesion.cuelloMalo = false;
    statsSesion.espaldaMalo = false;
    statsSesion.hombrosMalo = false;
    elBannerCalibracion.classList.add('hidden');
    elEstadoCamara.textContent = '✅ Calibrado — postura neutra guardada';
});

// ====================================================================
// 4. MODO DEMOSTRACIÓN (respaldo vía Socket.IO / app.py)
//    Útil si la cámara falla o no hay nadie sentado en la feria.
// ====================================================================
const socket = io();

function anguloEjeX(deg) {
    return new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), THREE.MathUtils.degToRad(deg));
}
function anguloEjeZ(deg) {
    return new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), THREE.MathUtils.degToRad(deg));
}

socket.on('estado_postura_demo', (datos) => {
    if (modoActual !== 'demo') return;

    const desviaciones = {
        cuelloDeg: datos.cuelloDeg,
        espaldaDeg: datos.espaldaDeg,
        hombrosDeg: datos.hombrosDeg,
    };
    ultimasDesviaciones = desviaciones;
    actualizarSemaforo(desviaciones);

    // Traducimos los ángulos genéricos a rotaciones directas sobre el rig.
    const qCuello = anguloEjeX(datos.cuelloDeg * 0.6);
    const qEspalda = anguloEjeX(datos.espaldaDeg * 0.5).multiply(anguloEjeZ(datos.hombrosDeg * 0.4));
    const qBrazoSup = anguloEjeX(datos.brazoSuperiorDeg);
    const qBrazoInf = anguloEjeX(datos.brazoInferiorDeg);

    SceneBuilder.aplicarPose(rigPrincipal, {
        cuello: [qCuello.x, qCuello.y, qCuello.z, qCuello.w],
        espalda: [qEspalda.x, qEspalda.y, qEspalda.z, qEspalda.w],
        brazoIzqSuperior: [qBrazoSup.x, qBrazoSup.y, qBrazoSup.z, qBrazoSup.w],
        brazoDerSuperior: [qBrazoSup.x, qBrazoSup.y, qBrazoSup.z, qBrazoSup.w],
        brazoIzqInferior: [qBrazoInf.x, qBrazoInf.y, qBrazoInf.z, qBrazoInf.w],
        brazoDerInferior: [qBrazoInf.x, qBrazoInf.y, qBrazoInf.z, qBrazoInf.w],
    }, 1);
});

function activarModoDemo() {
    modoActual = 'demo';
    corriendoDeteccion = false;
    document.getElementById('panel-camara').classList.add('hidden');
    document.getElementById('badge-modo').textContent = '🎬 Modo demostración';
    elBannerCalibracion.classList.add('hidden');
    frameCalibrado = { valida: true }; // en demo no se requiere calibración real
    socket.emit('iniciar_demo');
}

document.getElementById('btn-modo-camara').addEventListener('click', activarModoCamara);
document.getElementById('btn-modo-demo').addEventListener('click', activarModoDemo);

// ====================================================================
// 5. MAPA DE POSTURA (modal con avatar secundario + puntos rojos)
// ====================================================================
const modalResumen = document.getElementById('modal-resumen');
const canvasResumen = document.getElementById('canvas-resumen');
const textoResumen = document.getElementById('texto-resumen');
let escenaResumen = null;

function crearMarcador(malo) {
    const color = malo ? 0xff3b30 : 0x22c55e;
    const grupo = new THREE.Group();
    grupo.add(new THREE.Mesh(new THREE.SphereGeometry(0.032, 16, 16), new THREE.MeshBasicMaterial({ color })));
    grupo.add(new THREE.Mesh(new THREE.SphereGeometry(0.062, 16, 16), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.28 })));
    return grupo;
}

function inicializarEscenaResumen() {
    const scene2 = new THREE.Scene();
    scene2.background = new THREE.Color(0x0d1117);
    const cam2 = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
    const rend2 = new THREE.WebGLRenderer({ antialias: true });
    rend2.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    rend2.outputColorSpace = THREE.SRGBColorSpace;
    canvasResumen.appendChild(rend2.domElement);

    const controls2 = new OrbitControls(cam2, rend2.domElement);
    controls2.enableDamping = true;
    iluminarEscena(scene2);

    const rig2 = SceneBuilder.construirAvatar();
    scene2.add(rig2.raiz);
    scene2.add(SceneBuilder.construirSilla());

    const marcadorCuello = crearMarcador(statsSesion.cuelloMalo);
    marcadorCuello.position.set(0, 0.03, 0.06);
    rig2.cuelloPivot.add(marcadorCuello);

    const marcadorEspalda = crearMarcador(statsSesion.espaldaMalo);
    marcadorEspalda.position.set(0, 0.18, 0.15);
    rig2.pivotes.espalda.add(marcadorEspalda);

    const marcadorHombroIzq = crearMarcador(statsSesion.hombrosMalo);
    rig2.hombroIzqAncla.add(marcadorHombroIzq);
    const marcadorHombroDer = crearMarcador(statsSesion.hombrosMalo);
    rig2.hombroDerAncla.add(marcadorHombroDer);

    const alturaFoco2 = rig2.alturaCadera + 0.35;
    controls2.target.set(0, alturaFoco2, 0);
    cam2.position.set(1.1, alturaFoco2 + 0.25, 1.3);

    return { scene: scene2, camera: cam2, renderer: rend2, controls: controls2, marcadorCuello, marcadorEspalda, marcadorHombroIzq, marcadorHombroDer };
}

function actualizarColoresResumen() {
    if (!escenaResumen) return;
    const setColor = (grupo, malo) => grupo.children.forEach((m) => m.material.color.setHex(malo ? 0xff3b30 : 0x22c55e));
    setColor(escenaResumen.marcadorCuello, statsSesion.cuelloMalo);
    setColor(escenaResumen.marcadorEspalda, statsSesion.espaldaMalo);
    setColor(escenaResumen.marcadorHombroIzq, statsSesion.hombrosMalo);
    setColor(escenaResumen.marcadorHombroDer, statsSesion.hombrosMalo);
}

function generarTextoResumen() {
    const puntos = [
        { malo: statsSesion.cuelloMalo, titulo: 'Cuello Adelantado', tip: 'Ajusta la altura de la pantalla a la altura de tus ojos.' },
        { malo: statsSesion.espaldaMalo, titulo: 'Espalda Encorvada', tip: 'Apoya la espalda baja contra el respaldo y evita inclinarte hacia la pantalla.' },
        { malo: statsSesion.hombrosMalo, titulo: 'Asimetría de Hombros', tip: 'Reparte el peso uniformemente y evita apoyarte sobre un solo lado.' },
    ];
    if (puntos.every((p) => !p.malo)) {
        textoResumen.innerHTML = '<p class="text-emerald-400 font-semibold mb-2">✅ Sin alertas registradas</p><p>Tu alineación se mantuvo dentro de rangos saludables durante toda la sesión.</p>';
        return;
    }
    textoResumen.innerHTML = puntos.filter((p) => p.malo).map((p) => `
        <div class="mb-4">
            <p class="text-red-400 font-semibold mb-1">❌ ${p.titulo}</p>
            <p class="text-xs text-blue-300">👉 ${p.tip}</p>
        </div>`).join('');
}

let animandoResumen = false;
function animarResumen() {
    if (!animandoResumen) return;
    requestAnimationFrame(animarResumen);
    escenaResumen.controls.update();
    escenaResumen.renderer.render(escenaResumen.scene, escenaResumen.camera);
}

function abrirResumen() {
    modalResumen.classList.remove('hidden');
    generarTextoResumen();
    if (!escenaResumen) escenaResumen = inicializarEscenaResumen();
    else actualizarColoresResumen();
    animandoResumen = true;
    requestAnimationFrame(() => {
        ajustarTamano(escenaResumen.renderer, escenaResumen.camera, canvasResumen);
        animarResumen();
    });
}
function cerrarResumen() {
    modalResumen.classList.add('hidden');
    animandoResumen = false;
}
function reiniciarSesion() {
    statsSesion.cuelloMalo = false;
    statsSesion.espaldaMalo = false;
    statsSesion.hombrosMalo = false;
    actualizarColoresResumen();
    generarTextoResumen();
    socket.emit('reiniciar_sesion');
}

document.getElementById('btn-mapa-postura').addEventListener('click', abrirResumen);
document.getElementById('btn-cerrar-resumen').addEventListener('click', cerrarResumen);
document.getElementById('btn-reiniciar-sesion').addEventListener('click', reiniciarSesion);
window.addEventListener('resize', () => {
    if (!modalResumen.classList.contains('hidden')) ajustarTamano(escenaResumen.renderer, escenaResumen.camera, canvasResumen);
});

// ====================================================================
// Arranque: modo cámara por defecto
// ====================================================================
activarModoCamara();
