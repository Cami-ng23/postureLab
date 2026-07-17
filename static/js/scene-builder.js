/**
 * scene-builder.js
 * ------------------------------------------------------------------
 * Construye, usando solo primitivas de Three.js (cápsulas, cajas,
 * esferas, cilindros), un avatar humanoide sentado y una silla de
 * oficina. Nada viene de un modelo externo (.glb / Mixamo): así el
 * avatar y la silla siempre calzan exactamente entre sí, porque los
 * diseñamos juntos a la misma escala.
 *
 * Devuelve un "rig": un diccionario de pivotes (THREE.Group) nombrados
 * igual que las claves que entrega posture-math.js (espalda, cuello,
 * brazoIzqSuperior, etc.), para que aplicar una pose sea directo.
 *
 * Se carga como módulo ES (import), con THREE resuelto vía import map
 * (ver templates/index.html).
 * ------------------------------------------------------------------
 */
import * as THREE from 'three';

    // ================================================================
    // Medidas del cuerpo (metros) — proporciones adultas aproximadas,
    // pensadas para una persona sentada. No son datos clínicos, son
    // una aproximación razonable para fines de visualización.
    // ================================================================
    const MEDIDAS = {
        alturaAsiento: 0.46,
        largoEspaldaBaja: 0.16,
        largoEspaldaAlta: 0.16,
        largoCuello: 0.07,
        radioCabeza: 0.11,
        anchoHombros: 0.19,     // distancia del centro a cada hombro
        largoBrazoSuperior: 0.26,
        largoBrazoInferior: 0.24,
        largoMuslo: 0.40,
        largoPantorrilla: 0.40,
        radioTorso: 0.14,
        radioBrazo: 0.045,
        radioPierna: 0.06,
    };

    const COLORES = {
        piel: 0xe0ab7d,
        polera: 0x3b6fd6,
        pantalon: 0x2b2e3a,
        zapato: 0x1a1a1f,
        pelo: 0x2a2320,
        silla: 0x22252b,
        sillaTela: 0x2f333c,
        metal: 0xb9c0c7,
    };

    function malla(geo, color, opts = {}) {
        const mat = new THREE.MeshStandardMaterial({
            color,
            roughness: opts.roughness ?? 0.75,
            metalness: opts.metalness ?? 0.05,
        });
        const m = new THREE.Mesh(geo, mat);
        m.castShadow = true;
        m.receiveShadow = true;
        return m;
    }

    /** Cápsula orientada a lo largo del eje Y, con su origen en el extremo superior. */
    function capsulaColgante(radio, largo, color) {
        const geo = new THREE.CapsuleGeometry(radio, Math.max(0.001, largo - radio * 2), 6, 12);
        const m = malla(geo, color);
        m.position.y = -largo / 2;
        return m;
    }

    /**
     * Construye un avatar humanoide sentado.
     * @returns {object} rig — pivotes nombrados + referencias útiles
     */
    function construirAvatar() {
        const raiz = new THREE.Group();
        raiz.name = 'avatarRaiz';

        // --- Cadera (ancla fija, no se anima: el movimiento del tronco
        //     se modela rotando el pivote "espalda" desde acá) ---
        const caderaGrupo = new THREE.Group();
        caderaGrupo.position.set(0, MEDIDAS.alturaAsiento + 0.06, 0);
        raiz.add(caderaGrupo);

        const pelvis = malla(new THREE.BoxGeometry(0.26, 0.12, 0.18), COLORES.pantalon);
        pelvis.position.y = 0.02;
        caderaGrupo.add(pelvis);

        // --- Piernas (estáticas, dobladas ~90° como sentado) ---
        function construirPierna(signo) {
            const muslo = new THREE.Group();
            muslo.position.set(0.09 * signo, 0, 0);
            muslo.rotation.x = -Math.PI / 2; // el muslo apunta hacia adelante
            const musloMalla = capsulaColgante(MEDIDAS.radioPierna, MEDIDAS.largoMuslo, COLORES.pantalon);
            muslo.add(musloMalla);

            const rodilla = new THREE.Group();
            rodilla.position.y = -MEDIDAS.largoMuslo;
            muslo.add(rodilla);
            rodilla.rotation.x = Math.PI / 2; // la pantorrilla vuelve a bajar
            const pantorrillaMalla = capsulaColgante(MEDIDAS.radioPierna * 0.9, MEDIDAS.largoPantorrilla, COLORES.pantalon);
            rodilla.add(pantorrillaMalla);

            const pie = malla(new THREE.BoxGeometry(0.09, 0.06, 0.22), COLORES.zapato);
            pie.position.set(0, -MEDIDAS.largoPantorrilla - 0.03, 0.06);
            rodilla.add(pie);

            caderaGrupo.add(muslo);
        }
        construirPierna(-1);
        construirPierna(1);

        // --- Tronco / espalda (pivote animable: "espalda") ---
        const espaldaPivot = new THREE.Group();
        espaldaPivot.name = 'espalda';
        espaldaPivot.position.set(0, 0.08, 0);
        caderaGrupo.add(espaldaPivot);

        const torsoAltura = MEDIDAS.largoEspaldaBaja + MEDIDAS.largoEspaldaAlta;
        const torso = malla(
            new THREE.CapsuleGeometry(MEDIDAS.radioTorso, torsoAltura - MEDIDAS.radioTorso, 8, 12),
            COLORES.polera
        );
        torso.position.y = torsoAltura / 2;
        espaldaPivot.add(torso);

        // --- Cuello + cabeza (pivote animable: "cuello") ---
        const cuelloPivot = new THREE.Group();
        cuelloPivot.name = 'cuello';
        cuelloPivot.position.set(0, torsoAltura, 0);
        espaldaPivot.add(cuelloPivot);

        const cuelloMalla = malla(new THREE.CylinderGeometry(0.045, 0.05, MEDIDAS.largoCuello, 10), COLORES.piel);
        cuelloMalla.position.y = MEDIDAS.largoCuello / 2;
        cuelloPivot.add(cuelloMalla);

        const cabezaGrupo = new THREE.Group();
        cabezaGrupo.position.y = MEDIDAS.largoCuello;
        cuelloPivot.add(cabezaGrupo);

        const cabeza = malla(new THREE.SphereGeometry(MEDIDAS.radioCabeza, 20, 16), COLORES.piel);
        cabeza.position.y = MEDIDAS.radioCabeza;
        cabezaGrupo.add(cabeza);

        const pelo = malla(
            new THREE.SphereGeometry(MEDIDAS.radioCabeza * 1.04, 20, 16, 0, Math.PI * 2, 0, Math.PI * 0.62),
            COLORES.pelo
        );
        pelo.position.y = MEDIDAS.radioCabeza;
        cabezaGrupo.add(pelo);

        // Ojos simples (para dar orientación visual de "hacia dónde mira")
        [-1, 1].forEach((signo) => {
            const ojo = malla(new THREE.SphereGeometry(0.012, 8, 8), 0x1a1a1a, { roughness: 0.3 });
            ojo.position.set(0.035 * signo, MEDIDAS.radioCabeza + 0.005, MEDIDAS.radioCabeza * 0.92);
            cabezaGrupo.add(ojo);
        });

        // --- Brazos (pivotes animables: brazo{Izq,Der}{Superior,Inferior}) ---
        function construirBrazo(signo, nombre) {
            const anclaHombro = new THREE.Group();
            anclaHombro.position.set(MEDIDAS.anchoHombros * signo, torsoAltura - 0.05, 0);
            espaldaPivot.add(anclaHombro);

            // Hombrera pequeña, puramente decorativa
            const hombrera = malla(new THREE.SphereGeometry(0.055, 12, 10), COLORES.polera);
            anclaHombro.add(hombrera);

            const superiorPivot = new THREE.Group();
            superiorPivot.name = `brazo${nombre}Superior`;
            // Bind pose: brazo apuntando hacia adelante y un poco abajo,
            // como escribiendo en un teclado.
            superiorPivot.rotation.set(-Math.PI / 2.3, 0, 0.05 * signo);
            anclaHombro.add(superiorPivot);

            const brazoSuperiorMalla = capsulaColgante(MEDIDAS.radioBrazo, MEDIDAS.largoBrazoSuperior, COLORES.piel);
            superiorPivot.add(brazoSuperiorMalla);

            const inferiorPivot = new THREE.Group();
            inferiorPivot.name = `brazo${nombre}Inferior`;
            inferiorPivot.position.y = -MEDIDAS.largoBrazoSuperior;
            // Bind pose: antebrazo se dobla de vuelta hacia adelante (codo ~100°)
            inferiorPivot.rotation.set(Math.PI / 2.1, 0, 0);
            superiorPivot.add(inferiorPivot);

            const brazoInferiorMalla = capsulaColgante(MEDIDAS.radioBrazo * 0.9, MEDIDAS.largoBrazoInferior, COLORES.piel);
            inferiorPivot.add(brazoInferiorMalla);

            const mano = malla(new THREE.BoxGeometry(0.05, 0.09, 0.03), COLORES.piel);
            mano.position.y = -MEDIDAS.largoBrazoInferior - 0.02;
            inferiorPivot.add(mano);

            return { anclaHombro, superiorPivot, inferiorPivot };
        }

        const brazoIzq = construirBrazo(-1, 'Izq');
        const brazoDer = construirBrazo(1, 'Der');

        // Guardamos la rotación de "bind pose" (pose de reposo/tecleo) de
        // cada pivote animable, para poder aplicarle encima el delta que
        // viene de la cámara: rotaciónFinal = delta * bindPose.
        const bindPose = {
            espalda: espaldaPivot.quaternion.clone(),
            cuello: cuelloPivot.quaternion.clone(),
            brazoIzqSuperior: brazoIzq.superiorPivot.quaternion.clone(),
            brazoIzqInferior: brazoIzq.inferiorPivot.quaternion.clone(),
            brazoDerSuperior: brazoDer.superiorPivot.quaternion.clone(),
            brazoDerInferior: brazoDer.inferiorPivot.quaternion.clone(),
        };

        return {
            raiz,
            pivotes: {
                espalda: espaldaPivot,
                cuello: cuelloPivot,
                brazoIzqSuperior: brazoIzq.superiorPivot,
                brazoIzqInferior: brazoIzq.inferiorPivot,
                brazoDerSuperior: brazoDer.superiorPivot,
                brazoDerInferior: brazoDer.inferiorPivot,
            },
            bindPose,
            cabezaGrupo,
            hombroIzqAncla: brazoIzq.anclaHombro,
            hombroDerAncla: brazoDer.anclaHombro,
            cuelloPivot,
            alturaCadera: MEDIDAS.alturaAsiento + 0.06,
            alturaTotalAprox: MEDIDAS.alturaAsiento + 0.06 + 0.08 + torsoAltura + MEDIDAS.largoCuello + MEDIDAS.radioCabeza * 2,
        };
    }

    /**
     * Aplica sobre el rig las rotaciones delta calculadas por
     * posture-math.js (calcularDeltasRig). deltas[nombre] = [x,y,z,w].
     * final = delta * bindPose (delta aplicado en el frame del padre,
     * encima de la pose de reposo/tecleo con la que se dibujó el rig).
     */
    function aplicarPose(rig, deltas, alfaSuavizado = 1) {
        if (!deltas) return;
        const qDelta = new THREE.Quaternion();
        const qFinal = new THREE.Quaternion();

        Object.keys(rig.pivotes).forEach((nombre) => {
            const d = deltas[nombre];
            if (!d) return;
            qDelta.set(d[0], d[1], d[2], d[3]);
            qFinal.copy(rig.bindPose[nombre]).premultiply(qDelta);

            const pivote = rig.pivotes[nombre];
            if (alfaSuavizado >= 1) {
                pivote.quaternion.copy(qFinal);
            } else {
                pivote.quaternion.slerp(qFinal, alfaSuavizado);
            }
        });
    }

    /** Devuelve el rig a su pose de reposo (bind pose), sin deltas. */
    function resetearPose(rig) {
        Object.keys(rig.pivotes).forEach((nombre) => {
            rig.pivotes[nombre].quaternion.copy(rig.bindPose[nombre]);
        });
    }

    // ================================================================
    // Silla de oficina procedural — construida a la MISMA escala que
    // el avatar de arriba (alturaAsiento = MEDIDAS.alturaAsiento), así
    // que siempre calzan sin necesitar calibración de escala.
    // ================================================================
    function construirSilla() {
        const grupo = new THREE.Group();
        grupo.name = 'silla';

        const asiento = malla(new THREE.BoxGeometry(0.5, 0.06, 0.48), COLORES.sillaTela);
        asiento.position.y = MEDIDAS.alturaAsiento;
        grupo.add(asiento);

        const respaldo = malla(new THREE.BoxGeometry(0.46, 0.55, 0.06), COLORES.sillaTela);
        respaldo.position.set(0, MEDIDAS.alturaAsiento + 0.32, -0.23);
        respaldo.rotation.x = -0.15;
        grupo.add(respaldo);

        const columnaRespaldo = malla(new THREE.BoxGeometry(0.06, 0.42, 0.05), COLORES.silla);
        columnaRespaldo.position.set(0, MEDIDAS.alturaAsiento + 0.1, -0.22);
        grupo.add(columnaRespaldo);

        // Pistón de gas
        const piston = malla(new THREE.CylinderGeometry(0.028, 0.032, MEDIDAS.alturaAsiento - 0.08, 14), COLORES.metal, { metalness: 0.85, roughness: 0.2 });
        piston.position.y = (MEDIDAS.alturaAsiento - 0.08) / 2 + 0.04;
        grupo.add(piston);

        // Base estrella de 5 puntas con ruedas
        const brazoBaseGeo = new THREE.BoxGeometry(0.32, 0.035, 0.06);
        for (let i = 0; i < 5; i++) {
            const angulo = (i / 5) * Math.PI * 2;
            const brazo = malla(brazoBaseGeo, COLORES.silla);
            brazo.position.set(Math.cos(angulo) * 0.16, 0.045, Math.sin(angulo) * 0.16);
            brazo.rotation.y = angulo;
            grupo.add(brazo);

            const rueda = malla(new THREE.SphereGeometry(0.035, 10, 8), COLORES.silla);
            rueda.position.set(Math.cos(angulo) * 0.31, 0.035, Math.sin(angulo) * 0.31);
            grupo.add(rueda);
        }

        // Apoyabrazos
        [-1, 1].forEach((signo) => {
            const soporte = malla(new THREE.BoxGeometry(0.035, 0.2, 0.035), COLORES.silla);
            soporte.position.set(0.26 * signo, MEDIDAS.alturaAsiento + 0.13, 0.02);
            grupo.add(soporte);

            const reposabrazo = malla(new THREE.BoxGeometry(0.07, 0.03, 0.26), COLORES.silla);
            reposabrazo.position.set(0.26 * signo, MEDIDAS.alturaAsiento + 0.24, 0.04);
            grupo.add(reposabrazo);
        });

        return grupo;
    }

export { construirAvatar, aplicarPose, resetearPose, construirSilla, MEDIDAS, COLORES };

