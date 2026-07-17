/**
 * posture-math.js
 * ------------------------------------------------------------------
 * Módulo PURO (sin THREE.js, sin DOM, sin dependencias) que convierte
 * los 33 landmarks 3D de MediaPipe Pose en:
 *   1) Vectores de postura (cuello / espalda / línea de hombros / brazos)
 *   2) Desviaciones angulares respecto a una postura neutra calibrada
 *   3) Rotaciones "delta" (quaternion) para animar un rig genérico
 *
 * Por qué "relativo a calibración" y no "relativo al mundo":
 * MediaPipe no garantiza una convención de ejes fija ni conocida de
 * antemano para nosotros (varía según versión/plataforma), y además la
 * cámara del proyecto se va a mover de lugar (notebook -> cámara lateral
 * fija). En vez de asumir "Y = vertical del mundo", calibramos: el
 * usuario se sienta derecho, presiona "Calibrar", y guardamos esa pose
 * como referencia. Todo lo demás se mide como el ángulo entre el vector
 * ACTUAL y el vector CALIBRADO. Esto funciona sin importar la
 * orientación de la cámara ni la convención exacta de ejes de la
 * librería, y de paso se auto-adapta a la postura natural de cada
 * persona.
 *
 * Este archivo se puede ejecutar tal cual con Node (no usa `window`,
 * `document` ni `THREE`), lo que permite testear la matemática con
 * datos falsos antes de conectar cámara real.
 * ------------------------------------------------------------------
 */

// Exporta tanto para Node (CommonJS, usado en los tests) como para
// navegador (se cuelga en window.PostureMath vía script clásico).
(function (root, factory) {
    const mod = factory();
    if (typeof module === 'object' && module.exports) {
        module.exports = mod; // Node / tests
    }
    if (typeof root !== 'undefined') {
        root.PostureMath = mod; // navegador
    }
})(typeof window !== 'undefined' ? window : globalThis, function () {

    // ================================================================
    // Índices de landmarks de MediaPipe Pose (BlazePose, 33 puntos)
    // ================================================================
    const IDX = {
        NOSE: 0,
        LEFT_EAR: 7, RIGHT_EAR: 8,
        LEFT_SHOULDER: 11, RIGHT_SHOULDER: 12,
        LEFT_ELBOW: 13, RIGHT_ELBOW: 14,
        LEFT_WRIST: 15, RIGHT_WRIST: 16,
        LEFT_HIP: 23, RIGHT_HIP: 24,
    };

    const VISIBILIDAD_MINIMA = 0.5;

    // ================================================================
    // Vectores 3D básicos — arrays planos [x, y, z], sin clases,
    // para que sea trivial de testear y no dependa de THREE.js.
    // ================================================================
    const v3 = {
        sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
        add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
        scale: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
        dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
        cross: (a, b) => [
            a[1] * b[2] - a[2] * b[1],
            a[2] * b[0] - a[0] * b[2],
            a[0] * b[1] - a[1] * b[0],
        ],
        length: (a) => Math.sqrt(v3.dot(a, a)),
        normalize: (a) => {
            const len = v3.length(a);
            if (len < 1e-8) return [0, 0, 0];
            return [a[0] / len, a[1] / len, a[2] / len];
        },
        mid: (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2],
        clampDot: (d) => Math.max(-1, Math.min(1, d)),
    };

    /** Ángulo entre dos vectores (unitarios o no), en grados. */
    function angleBetweenDeg(a, b) {
        const ua = v3.normalize(a);
        const ub = v3.normalize(b);
        const d = v3.clampDot(v3.dot(ua, ub));
        return (Math.acos(d) * 180) / Math.PI;
    }

    // ================================================================
    // Quaterniones mínimos [x, y, z, w] — solo lo necesario para
    // "rotación más corta que lleva el vector A al vector B" y para
    // multiplicar/interpolar. Nada de THREE.js aquí tampoco.
    // ================================================================
    const quat = {
        identity: () => [0, 0, 0, 1],

        /** Quaternion de rotación mínima que lleva `from` a `to` (unitarios). */
        fromUnitVectors: (from, to) => {
            const f = v3.normalize(from);
            const t = v3.normalize(to);
            const d = v3.clampDot(v3.dot(f, t));

            if (d > 0.999999) return [0, 0, 0, 1]; // ya alineados
            if (d < -0.999999) {
                // Vectores opuestos: cualquier eje perpendicular sirve
                let axis = v3.cross([1, 0, 0], f);
                if (v3.length(axis) < 1e-6) axis = v3.cross([0, 1, 0], f);
                axis = v3.normalize(axis);
                return [axis[0], axis[1], axis[2], 0];
            }

            const axis = v3.cross(f, t);
            const w = 1 + d;
            return v3.normalize4([axis[0], axis[1], axis[2], w]);
        },

        multiply: (a, b) => {
            const [ax, ay, az, aw] = a;
            const [bx, by, bz, bw] = b;
            return [
                aw * bx + ax * bw + ay * bz - az * by,
                aw * by - ax * bz + ay * bw + az * bx,
                aw * bz + ax * by - ay * bx + az * bw,
                aw * bw - ax * bx - ay * by - az * bz,
            ];
        },

        /** Interpolación esférica simple (para suavizar el movimiento). */
        slerp: (a, b, t) => {
            let [ax, ay, az, aw] = a;
            let [bx, by, bz, bw] = b;
            let dot = ax * bx + ay * by + az * bz + aw * bw;
            if (dot < 0) { bx = -bx; by = -by; bz = -bz; bw = -bw; dot = -dot; }
            if (dot > 0.9995) {
                return v3.normalize4([
                    ax + (bx - ax) * t, ay + (by - ay) * t,
                    az + (bz - az) * t, aw + (bw - aw) * t,
                ]);
            }
            const theta0 = Math.acos(Math.max(-1, Math.min(1, dot)));
            const theta = theta0 * t;
            const sinTheta = Math.sin(theta);
            const sinTheta0 = Math.sin(theta0);
            const s0 = Math.cos(theta) - (dot * sinTheta) / sinTheta0;
            const s1 = sinTheta / sinTheta0;
            return [
                ax * s0 + bx * s1, ay * s0 + by * s1,
                az * s0 + bz * s1, aw * s0 + bw * s1,
            ];
        },
    };

    v3.normalize4 = (q) => {
        const len = Math.sqrt(q[0] * q[0] + q[1] * q[1] + q[2] * q[2] + q[3] * q[3]);
        if (len < 1e-8) return [0, 0, 0, 1];
        return [q[0] / len, q[1] / len, q[2] / len, q[3] / len];
    };

    // ================================================================
    // Extracción de un "frame" de postura a partir de los 33 landmarks
    // ================================================================

    /**
     * @param {Array} landmarks - array de 33 {x,y,z,visibility} (world landmarks de MediaPipe)
     * @returns {object|null} frame de postura, o null si no hay suficiente confianza
     */
    function extraerFramePostura(landmarks) {
        if (!landmarks || landmarks.length < 29) return null;

        const necesarios = [
            IDX.LEFT_SHOULDER, IDX.RIGHT_SHOULDER,
            IDX.LEFT_HIP, IDX.RIGHT_HIP,
            IDX.NOSE,
        ];
        for (const i of necesarios) {
            const p = landmarks[i];
            if (!p || (typeof p.visibility === 'number' && p.visibility < VISIBILIDAD_MINIMA)) {
                return null;
            }
        }

        const p = (i) => [landmarks[i].x, landmarks[i].y, landmarks[i].z];

        const hombroIzq = p(IDX.LEFT_SHOULDER);
        const hombroDer = p(IDX.RIGHT_SHOULDER);
        const caderaIzq = p(IDX.LEFT_HIP);
        const caderaDer = p(IDX.RIGHT_HIP);
        const nariz = p(IDX.NOSE);

        const hombroMid = v3.mid(hombroIzq, hombroDer);
        const caderaMid = v3.mid(caderaIzq, caderaDer);

        // Cabeza de referencia: si hay orejas visibles, promedio oreja-oreja
        // (más estable); si no, la nariz.
        let cabezaRef = nariz;
        const oi = landmarks[IDX.LEFT_EAR];
        const od = landmarks[IDX.RIGHT_EAR];
        if (oi && od && (oi.visibility ?? 1) > VISIBILIDAD_MINIMA && (od.visibility ?? 1) > VISIBILIDAD_MINIMA) {
            cabezaRef = v3.mid(p(IDX.LEFT_EAR), p(IDX.RIGHT_EAR));
        }

        const frame = {
            // Vector espalda: de cadera media a hombro medio (postura del tronco)
            espaldaDir: v3.normalize(v3.sub(hombroMid, caderaMid)),
            // Vector cuello: de hombro medio a cabeza (adelantamiento de cabeza)
            cuelloDir: v3.normalize(v3.sub(cabezaRef, hombroMid)),
            // Vector línea de hombros: de hombro izq a hombro der (inclinación lateral)
            hombrosDir: v3.normalize(v3.sub(hombroDer, hombroIzq)),
            hombroMid,
            caderaMid,
            brazos: {},
        };

        // Brazos (opcionales: si no están visibles, el rig simplemente no los mueve)
        const brazoLado = (hombroIdx, codoIdx, munecaIdx) => {
            const h = landmarks[hombroIdx], c = landmarks[codoIdx], m = landmarks[munecaIdx];
            if (!h || !c || !m) return null;
            if ((c.visibility ?? 1) < VISIBILIDAD_MINIMA || (m.visibility ?? 1) < VISIBILIDAD_MINIMA) return null;
            return {
                superiorDir: v3.normalize(v3.sub(p(codoIdx), p(hombroIdx))), // hombro -> codo
                inferiorDir: v3.normalize(v3.sub(p(munecaIdx), p(codoIdx))), // codo -> muñeca
            };
        };

        frame.brazos.izq = brazoLado(IDX.LEFT_SHOULDER, IDX.LEFT_ELBOW, IDX.LEFT_WRIST);
        frame.brazos.der = brazoLado(IDX.RIGHT_SHOULDER, IDX.RIGHT_ELBOW, IDX.RIGHT_WRIST);

        return frame;
    }

    /**
     * Calcula las desviaciones (en grados) del frame actual respecto a
     * la postura neutra calibrada.
     */
    function calcularDesviaciones(frameActual, frameCalibrado) {
        if (!frameActual || !frameCalibrado) return null;
        return {
            cuelloDeg: angleBetweenDeg(frameActual.cuelloDir, frameCalibrado.cuelloDir),
            espaldaDeg: angleBetweenDeg(frameActual.espaldaDir, frameCalibrado.espaldaDir),
            hombrosDeg: angleBetweenDeg(frameActual.hombrosDir, frameCalibrado.hombrosDir),
        };
    }

    /**
     * Clasifica una desviación en grados según umbrales configurables.
     * Devuelve 'ok' | 'alerta'.
     */
    function clasificar(deg, umbralGrados) {
        return deg > umbralGrados ? 'alerta' : 'ok';
    }

    /**
     * Construye las rotaciones "delta" (quaternion) que hay que aplicarle
     * al rig: cuánto rotó cada segmento respecto a como estaba en la
     * calibración. Estas se aplican ENCIMA de la rotación base ("bind
     * pose") del rig — ver scene-builder.js.
     */
    function calcularDeltasRig(frameActual, frameCalibrado) {
        if (!frameActual || !frameCalibrado) return null;

        const deltas = {
            espalda: quat.fromUnitVectors(frameCalibrado.espaldaDir, frameActual.espaldaDir),
            cuello: quat.fromUnitVectors(frameCalibrado.cuelloDir, frameActual.cuelloDir),
            brazoIzqSuperior: quat.identity(),
            brazoIzqInferior: quat.identity(),
            brazoDerSuperior: quat.identity(),
            brazoDerInferior: quat.identity(),
        };

        if (frameActual.brazos.izq && frameCalibrado.brazos.izq) {
            deltas.brazoIzqSuperior = quat.fromUnitVectors(
                frameCalibrado.brazos.izq.superiorDir, frameActual.brazos.izq.superiorDir);
            deltas.brazoIzqInferior = quat.fromUnitVectors(
                frameCalibrado.brazos.izq.inferiorDir, frameActual.brazos.izq.inferiorDir);
        }
        if (frameActual.brazos.der && frameCalibrado.brazos.der) {
            deltas.brazoDerSuperior = quat.fromUnitVectors(
                frameCalibrado.brazos.der.superiorDir, frameActual.brazos.der.superiorDir);
            deltas.brazoDerInferior = quat.fromUnitVectors(
                frameCalibrado.brazos.der.inferiorDir, frameActual.brazos.der.inferiorDir);
        }

        return deltas;
    }

    return {
        IDX,
        v3,
        quat,
        angleBetweenDeg,
        extraerFramePostura,
        calcularDesviaciones,
        clasificar,
        calcularDeltasRig,
    };
});
