// ═══════════════════════════════════════════════════════════
// RUTA-DINAMICA.JS — módulo aislado de recálculo de ruta sugerida.
//
// No modifica ninguna función de mapa_live_F150.html: solo LEE variables
// globales que ya existen ahí (DATA, completed, porCobrar, quemados,
// anulados, allMarkers, map, L, BODEGAS, activeBodega, activeFecha,
// activeChofer, gpsMarker, API_URL, getSesion, getToken, jsonpMapa,
// fetchConTimeoutMapa) y agrega su propia capa en el mapa + su propio
// panel flotante. Si algo de esto falla (sin señal, sin llave ORS
// configurada, cuota agotada), el mapa sigue funcionando exactamente
// igual que antes -- este módulo nunca bloquea nada.
//
// Reglas de negocio (confirmadas con el usuario):
//  - Primero se sugieren todos los pedidos PENDIENTES (nunca visitados).
//  - Los pedidos "POR COBRAR" se sugieren después, y solo cuando ya
//    pasó el umbral configurado (Script Property UMBRAL_COBRO_HORAS,
//    por defecto 2h) desde que se marcaron -- es una SUGERENCIA visual,
//    no un bloqueo: el chofer puede cobrar antes si quiere.
//  - El orden dentro de cada grupo se calcula por distancia/tiempo REAL
//    de calle (OpenRouteService), no en línea recta -- importante en
//    zonas de montaña/bosque donde "cerca en línea recta" puede estar
//    lejos por el camino real.
// ═══════════════════════════════════════════════════════════
(function () {
  let UMBRAL_MS = 2 * 60 * 60 * 1000; // se ajusta con la config del backend (Script Property)
  let porCobrarTimestamps = new Map(); // idx -> Date.now() de cuando se detectó "por cobrar"
  let rutaLayer = null;                // capa propia en el mapa (no allLines, draw() nunca la toca)
  let ultimoRecalculo = 0;
  let recalculando = false;
  let ultimaSugerencia = null;         // { ordenIdx:[...], distanciaKm, duracionMin }
  let ultimaClaveRuta = '';
  let intentosRapidos = 0;             // reintentos cada 5s hasta el primer resultado del día/camión

  // 10 min: con ~20 camiones activos, esto da ~960 llamadas/día por endpoint de
  // OpenRouteService (48% del límite gratuito de 2000/día) -- deja margen para
  // los clics manuales de "Recalcular ahora" y reintentos si algo falla.
  const RECALC_MIN_INTERVAL_MS = 10 * 60 * 1000; // no más de 1 vez cada 10 min, salvo forzado
  const MAX_INTENTOS_RAPIDOS = 6; // ~30s de reintentos cada 5s antes de pasar al ciclo normal de 10 min
  const STORAGE_PREFIX = 'rutaDinamica_ts_';

  function claveStorage() {
    return STORAGE_PREFIX + (activeFecha || '') + '_' + (activeChofer || '').replace(/\s/g, '_');
  }
  function cargarTimestamps() {
    try {
      const raw = localStorage.getItem(claveStorage());
      porCobrarTimestamps = raw ? new Map(JSON.parse(raw).map(([k, v]) => [Number(k), Number(v)])) : new Map();
    } catch (e) { porCobrarTimestamps = new Map(); }
  }
  function guardarTimestamps() {
    try { localStorage.setItem(claveStorage(), JSON.stringify([...porCobrarTimestamps.entries()])); } catch (e) {}
  }

  // La primera vez que vemos un cliente en porCobrar (venga de togglePorCobrar, de
  // pollAvanceRemoto, o de cualquier otra función), arrancamos su reloj de espera aquí
  // -- sin necesidad de enganchar cada punto del código que lo agrega.
  function reconciliarTimestamps() {
    let cambio = false;
    porCobrar.forEach(idx => {
      if (!porCobrarTimestamps.has(idx)) { porCobrarTimestamps.set(idx, Date.now()); cambio = true; }
    });
    [...porCobrarTimestamps.keys()].forEach(idx => {
      if (!porCobrar.has(idx)) { porCobrarTimestamps.delete(idx); cambio = true; }
    });
    if (cambio) guardarTimestamps();
  }

  function formatEspera(ms) {
    const abs = Math.abs(ms), h = Math.floor(abs / 3600000), m = Math.floor((abs % 3600000) / 60000);
    return (h > 0 ? h + 'h ' : '') + m + 'm';
  }

  async function cargarConfig() {
    try {
      const data = await jsonpMapa('tipo=config', 15000);
      if (data && data.umbralCobroHoras) UMBRAL_MS = data.umbralCobroHoras * 3600000;
      return data;
    } catch (e) {
      console.warn('ruta-dinamica: no se pudo leer config, uso umbral por defecto de 2h.');
      return null;
    }
  }

  function posicionChofer() {
    if (typeof gpsMarker !== 'undefined' && gpsMarker) {
      const p = gpsMarker.getLatLng();
      return { lat: p.lat, lng: p.lng };
    }
    const bod = (typeof BODEGAS !== 'undefined' && BODEGAS[activeBodega]) ? BODEGAS[activeBodega] : null;
    return bod ? { lat: bod.lat, lng: bod.lng } : null;
  }

  function idxPendientesTier1() {
    return DATA.map((_, i) => i).filter(i => !completed.has(i) && !porCobrar.has(i) && !quemados.has(i) && !anulados.has(i));
  }
  function idxPorCobrarListos() {
    const ahora = Date.now();
    return [...porCobrar].filter(i => (ahora - (porCobrarTimestamps.get(i) || ahora)) >= UMBRAL_MS);
  }
  function idxPorCobrarEsperando() {
    const ahora = Date.now();
    return [...porCobrar].filter(i => (ahora - (porCobrarTimestamps.get(i) || ahora)) < UMBRAL_MS);
  }

  // Ordena un grupo de índices por tiempo REAL de calle (greedy nearest-neighbor),
  // usando una matriz de duraciones ya calculada por ORS. La fila/columna 0 de la
  // matriz es siempre el punto de partida (chofer); 1..N corresponden a `indices`
  // en el mismo orden en que se armó la matriz (offsetEnMatriz suele ser 1).
  function ordenarPorMatriz(indices, matrizDuraciones, offsetEnMatriz) {
    const restantes = indices.map((idx, k) => ({ idx, filaMatriz: offsetEnMatriz + k }));
    const orden = [];
    let actual = 0;
    while (restantes.length) {
      let mejorPos = -1, mejorDur = Infinity;
      restantes.forEach((r, pos) => {
        const dur = matrizDuraciones[actual] ? matrizDuraciones[actual][r.filaMatriz] : null;
        if (dur != null && dur < mejorDur) { mejorDur = dur; mejorPos = pos; }
      });
      if (mejorPos === -1) mejorPos = 0; // ORS no pudo calcular ese tramo -- seguimos con el que quede
      orden.push(restantes[mejorPos].idx);
      actual = restantes[mejorPos].filaMatriz;
      restantes.splice(mejorPos, 1);
    }
    return orden;
  }

  async function pedirMatriz(puntos) {
    const res = await fetchConTimeoutMapa(API_URL, {
      method: 'POST', mode: 'cors',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ tipo: 'ruta_matriz', token: getToken(), puntos }),
    }, 20000);
    return await res.json();
  }
  async function pedirTrazado(puntos) {
    const res = await fetchConTimeoutMapa(API_URL, {
      method: 'POST', mode: 'cors',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ tipo: 'ruta_trazado', token: getToken(), puntos }),
    }, 20000);
    return await res.json();
  }

  function dibujarRutaSugerida(geometria) {
    if (rutaLayer) { map.removeLayer(rutaLayer); rutaLayer = null; }
    if (!geometria || geometria.length < 2) return;
    rutaLayer = L.polyline(geometria, { color: '#22c55e', weight: 5, opacity: .85 }).addTo(map);
  }
  function limpiarRutaSugerida() {
    if (rutaLayer) { map.removeLayer(rutaLayer); rutaLayer = null; }
  }

  async function recalcular(forzado) {
    if (recalculando) return;
    const ahora = Date.now();
    if (!forzado && (ahora - ultimoRecalculo) < RECALC_MIN_INTERVAL_MS) return;
    if (!DATA.length || !activeFecha || !activeChofer) return;

    reconciliarTimestamps();
    const pos = posicionChofer();
    if (!pos) return;

    const tier1 = idxPendientesTier1();
    const tier2 = idxPorCobrarListos();
    const orden = tier1.concat(tier2); // pendientes primero, "por cobrar" listos después
    actualizarPanel();
    if (!orden.length) { limpiarRutaSugerida(); ultimaSugerencia = null; return; }
    if (orden.length > 49) { console.warn('ruta-dinamica: demasiadas paradas para una sola matriz (>49), se omite el trazado por calle.'); return; }

    recalculando = true;
    try {
      const puntos = [[pos.lat, pos.lng]].concat(orden.map(i => [DATA[i].lat, DATA[i].lng]));
      const matriz = await pedirMatriz(puntos);
      if (!matriz || !matriz.ok) { console.warn('ruta-dinamica: matriz no disponible (' + (matriz && matriz.error) + ').'); return; }

      const ordenFinal = ordenarPorMatriz(orden, matriz.duraciones, 1);
      const puntosFinal = [[pos.lat, pos.lng]].concat(ordenFinal.map(i => [DATA[i].lat, DATA[i].lng]));
      const trazado = await pedirTrazado(puntosFinal);
      if (!trazado || !trazado.ok) { console.warn('ruta-dinamica: trazado no disponible (' + (trazado && trazado.error) + ').'); return; }

      dibujarRutaSugerida(trazado.geometria);
      ultimaSugerencia = { ordenIdx: ordenFinal, distanciaKm: trazado.distanciaKm, duracionMin: trazado.duracionMin };
      ultimoRecalculo = Date.now();
      actualizarPanel();
    } catch (e) {
      console.warn('ruta-dinamica: fallo al recalcular, se mantiene la vista actual.', e);
    } finally {
      recalculando = false;
    }
  }

  // ── Panel flotante propio: UN solo indicador de "siguiente parada" ──
  // Antes convivían dos: el chip viejo "➡️ Siguiente" (#nav-cluster, en línea
  // recta) y este panel nuevo (por calle real) -- se pisaban visualmente. Se
  // ocultó el viejo (ver ocultarNavClusterViejo) y este quedó como el único.
  // Todo queda siempre visible (nombre del próximo cliente, tiempo estimado,
  // aviso de espera y el botón de recalcular) -- nada se esconde tras un clic.
  // Tocar la fila superior (el nombre) hace lo mismo que hacía el chip viejo:
  // centra el mapa en ese cliente y abre su popup.
  function crearPanelUI() {
    if (document.getElementById('ruta-dinamica-panel')) return;
    const div = document.createElement('div');
    div.id = 'ruta-dinamica-panel';
    div.style.cssText = 'position:fixed;left:10px;bottom:120px;z-index:1000;display:none;max-width:230px';
    div.innerHTML =
      '<button id="rd-header" title="Ir a este cliente en el mapa" style="background:linear-gradient(135deg,#1d4ed8,#0ea5e9);' +
      'border:none;color:#fff;height:32px;padding:0 12px;border-radius:16px 16px 0 0;font-size:.63rem;font-weight:700;' +
      'cursor:pointer;box-shadow:0 2px 8px rgba(14,165,233,.4);display:flex;align-items:center;gap:5px;' +
      'width:100%;overflow:hidden;white-space:nowrap;text-align:left">' +
      '➡️ <span id="rd-siguiente-corto" style="overflow:hidden;text-overflow:ellipsis">—</span></button>' +
      '<div style="background:rgba(15,23,42,.92);color:#e2e8f0;' +
      'border-radius:0 0 10px 10px;padding:8px 12px;font-size:12px;box-shadow:0 2px 10px rgba(0,0,0,.4)">' +
      '<div id="rd-siguiente" style="margin-bottom:2px">—</div>' +
      '<div id="rd-espera" style="color:#fbbf24;margin-bottom:6px"></div>' +
      '<button id="rd-recalcular-btn" style="background:#334155;color:#e2e8f0;border:none;border-radius:6px;' +
      'padding:4px 8px;font-size:11px;cursor:pointer">🔄 Recalcular ahora</button>' +
      '</div>';
    document.body.appendChild(div);
    document.getElementById('rd-header').addEventListener('click', irAlSiguienteSugerido);
    document.getElementById('rd-recalcular-btn').addEventListener('click', () => recalcular(true));
  }

  // El chip/pill viejo (#nav-cluster: "➡️ Siguiente" en línea recta + "🔄 Re-optimizar")
  // queda reemplazado por el de arriba -- se oculta para no duplicar el indicador.
  function ocultarNavClusterViejo() {
    const nav = document.getElementById('nav-cluster');
    if (nav) nav.style.display = 'none';
  }

  function idxSiguienteSugerido() {
    const tier1 = idxPendientesTier1(), tier2Listos = idxPorCobrarListos();
    return (ultimaSugerencia && ultimaSugerencia.ordenIdx.length) ? ultimaSugerencia.ordenIdx[0]
      : (tier1[0] != null ? tier1[0] : (tier2Listos[0] != null ? tier2Listos[0] : null));
  }

  // Igual que la vieja irAlSiguiente() del mapa, pero usando el orden por calle
  // real en vez del orden fijo de DATA -- centra el mapa en el próximo cliente
  // sugerido y abre su popup.
  function irAlSiguienteSugerido() {
    const idx = idxSiguienteSugerido();
    if (idx == null || !DATA[idx]) return;
    const d = DATA[idx];
    map.setView([d.lat, d.lng], 17);
    setTimeout(() => { if (allMarkers[idx]) allMarkers[idx].openPopup(); }, 250);
  }

  function actualizarPanel() {
    const panel = document.getElementById('ruta-dinamica-panel');
    if (!panel) return;
    const tier1 = idxPendientesTier1(), tier2Listos = idxPorCobrarListos(), tier2Esperando = idxPorCobrarEsperando();
    if (!tier1.length && !tier2Listos.length && !tier2Esperando.length) { panel.style.display = 'none'; return; }
    panel.style.display = 'block';
    const siguienteIdx = idxSiguienteSugerido();
    const nombreSig = (siguienteIdx != null && DATA[siguienteIdx]) ? DATA[siguienteIdx].razon : '—';
    const nombreCorto = siguienteIdx != null ? ('#' + (siguienteIdx + 1) + ' ' + nombreSig.split(' ').slice(0, 3).join(' ')) : '—';
    const tiempoTxt = (ultimaSugerencia && ultimaSugerencia.duracionMin) ? (' (' + Math.round(ultimaSugerencia.duracionMin) + ' min)') : '';
    document.getElementById('rd-siguiente-corto').textContent = nombreCorto;
    document.getElementById('rd-siguiente').textContent = 'Siguiente: ' + nombreSig + tiempoTxt;
    document.getElementById('rd-espera').textContent = tier2Esperando.length > 0 ? ('⏳ ' + tier2Esperando.length + ' por cobrar en espera') : '';
  }

  // Badge de espera dentro del popup existente, inyectado al abrirse -- no toca buildPopup().
  function engancharPopups() {
    map.on('popupopen', (e) => {
      try {
        const idx = allMarkers.indexOf(e.popup._source);
        if (idx < 0 || !porCobrar.has(idx)) return;
        const ts = porCobrarTimestamps.get(idx);
        if (!ts) return;
        const restante = UMBRAL_MS - (Date.now() - ts);
        const texto = restante > 0
          ? ('⏳ Sugerido esperar ' + formatEspera(restante) + ' más antes de cobrar')
          : ('✅ Ya cumplió la espera sugerida (' + formatEspera(Date.now() - ts) + ')');
        const el = e.popup.getElement();
        if (el && !el.querySelector('.rd-badge-espera')) {
          const badge = document.createElement('div');
          badge.className = 'rd-badge-espera';
          badge.style.cssText = 'margin-top:4px;font-size:11px;color:#fbbf24;font-weight:600';
          badge.textContent = texto;
          const content = el.querySelector('.leaflet-popup-content');
          if (content) content.appendChild(badge);
        }
      } catch (err) { /* nunca romper el popup por esto */ }
    });
  }

  // ═══════════════════════════════════════════════════════════
  // PLAN FIJO DEL DÍA — orden de visita + km/tiempo TOTALES, calculados
  // por calle real UNA SOLA VEZ (al inicio del día, con todos los clientes
  // aún pendientes) y congelados: no cambian aunque se vayan entregando o
  // cobrando pedidos durante la jornada. Sirve para saber cuánto hay que
  // recorrer en total, sin que la cifra "baje" a medida que se avanza.
  //
  // Se integra con el mapa existente por dos vías, ambas SIN editar
  // mapa_live_F150.html -- se envuelven (wrap) las funciones ya definidas
  // ahí, algo seguro porque son declaraciones `function` normales en el
  // scope global, no `const`/módulos:
  //   1) nearestNeighborFrom(): si ya existe un plan fijo que coincide
  //      EXACTAMENTE con las coordenadas de hoy, se usa ese orden en vez
  //      del cálculo greedy en línea recta -- así los números de los pines,
  //      el panel lateral y el primer cliente coinciden con la ruta verde.
  //   2) updateStats() / updateTiempoEstimado(): después de que la app
  //      calcule sus valores normales (dinámicos), se sobreescribe el
  //      "DISTANCIA" del encabezado y el "Tiempo est" con los valores FIJOS
  //      del plan, si ya existe uno.
  // ═══════════════════════════════════════════════════════════
  const PLAN_PREFIX = 'rutaDinamica_planFijo_';
  function clavePlan() {
    return PLAN_PREFIX + (activeFecha || '') + '_' + (activeChofer || '').replace(/\s/g, '_');
  }
  function leerPlanFijo() {
    try { const raw = localStorage.getItem(clavePlan()); return raw ? JSON.parse(raw) : null; } catch (e) { return null; }
  }
  function guardarPlanFijo(plan) {
    try { localStorage.setItem(clavePlan(), JSON.stringify(plan)); } catch (e) {}
  }
  function formatDuracion(min) {
    const m = Math.round(min || 0), h = Math.floor(m / 60), r = m % 60;
    return h > 0 ? (h + 'h' + r + 'm') : (r + 'm');
  }

  // Busca, dentro de `pts` ([{lat,lng},...] en el orden que arma applyFiltersAndDraw),
  // el índice de cada punto del plan cacheado -- si TODOS calzan exacto (mismo número
  // de clientes, mismas coordenadas), devuelve el orden ya resuelto; si algo no
  // coincide (cliente nuevo, corrección de ubicación, guía distinta), devuelve null
  // y el mapa sigue con su comportamiento normal (línea recta) para ese caso.
  function ordenFijoParaPuntos(pts, plan) {
    if (!plan || !Array.isArray(plan.orden) || plan.orden.length !== pts.length) return null;
    const usados = new Array(pts.length).fill(false);
    const ordenIdx = [];
    for (const p of plan.orden) {
      let encontrado = -1;
      for (let i = 0; i < pts.length; i++) {
        if (!usados[i] && Math.abs(pts[i].lat - p.lat) < 1e-7 && Math.abs(pts[i].lng - p.lng) < 1e-7) { encontrado = i; break; }
      }
      if (encontrado === -1) return null;
      usados[encontrado] = true;
      ordenIdx.push(encontrado);
    }
    return ordenIdx;
  }

  // Envuelve nearestNeighborFrom (definida en mapa_live_F150.html, línea ~1134) para
  // usar el plan fijo del día si ya existe y coincide con los puntos de hoy.
  function envolverNearestNeighborFrom() {
    if (typeof nearestNeighborFrom !== 'function' || nearestNeighborFrom.__rutaDinamicaWrapped) return;
    const original = nearestNeighborFrom;
    nearestNeighborFrom = function (pts, startLat, startLng) {
      const plan = leerPlanFijo();
      const fijo = plan ? ordenFijoParaPuntos(pts, plan) : null;
      return fijo || original(pts, startLat, startLng);
    };
    nearestNeighborFrom.__rutaDinamicaWrapped = true;
  }

  // Sobreescribe "DISTANCIA" (s-km) y "Tiempo est" (prog-tiempo/bb-tiempo) con los
  // valores FIJOS del plan del día, si ya existe uno para la fecha+chofer activos.
  function aplicarStatsFijas() {
    const plan = leerPlanFijo();
    if (!plan || !plan.distanciaKm) return;
    const elKm = document.getElementById('s-km');
    if (elKm) elKm.textContent = plan.distanciaKm.toFixed(1) + ' km';
    const txt = formatDuracion(plan.duracionMin);
    ['prog-tiempo', 'bb-tiempo'].forEach(id => { const el = document.getElementById(id); if (el) el.textContent = txt; });
  }
  function envolverStatsDinamicas() {
    if (typeof updateStats === 'function' && !updateStats.__rutaDinamicaWrapped) {
      const original = updateStats;
      updateStats = function () { original(); aplicarStatsFijas(); };
      updateStats.__rutaDinamicaWrapped = true;
    }
    if (typeof updateTiempoEstimado === 'function' && !updateTiempoEstimado.__rutaDinamicaWrapped) {
      const original = updateTiempoEstimado;
      updateTiempoEstimado = function (lat, lng) { original(lat, lng); aplicarStatsFijas(); };
      updateTiempoEstimado.__rutaDinamicaWrapped = true;
    }
  }

  let calculandoPlanFijo = false;
  // Calcula el plan fijo del día (orden + km + tiempo totales por calle real) UNA
  // SOLA VEZ por camión+fecha, y solo si la jornada sigue "intacta" (nadie marcó
  // todavía ningún avance) -- así nunca se reordena DATA con estados ya guardados
  // por índice, que se desincronizarían. Si el día ya tiene avances (por ejemplo,
  // porque este módulo se activó a mitad de jornada), se omite para ese día y el
  // mapa sigue con su comportamiento de siempre; el plan fijo arranca limpio al
  // día siguiente.
  async function intentarCalcularPlanFijo() {
    if (calculandoPlanFijo) return;
    if (!DATA.length || !activeFecha || !activeChofer) return;
    const puntosActuales = DATA.map(d => ({ lat: d.lat, lng: d.lng }));
    if (ordenFijoParaPuntos(puntosActuales, leerPlanFijo())) return; // ya hay uno válido
    if (completed.size || porCobrar.size || quemados.size || anulados.size) return; // ya no es "inicio de día"
    const bod = (typeof BODEGAS !== 'undefined' && BODEGAS[activeBodega]) ? BODEGAS[activeBodega] : null;
    if (!bod) return;
    if (DATA.length > 49) { console.warn('ruta-dinamica: demasiados clientes (>49) para calcular el plan fijo del día en una sola matriz.'); return; }

    calculandoPlanFijo = true;
    try {
      const puntos = [[bod.lat, bod.lng]].concat(puntosActuales.map(p => [p.lat, p.lng]));
      const matriz = await pedirMatriz(puntos);
      if (!matriz || !matriz.ok) { console.warn('ruta-dinamica: no se pudo calcular el plan fijo (matriz): ' + (matriz && matriz.error)); return; }

      const indicesTodos = puntosActuales.map((_, i) => i);
      const ordenFinal = ordenarPorMatriz(indicesTodos, matriz.duraciones, 1);
      const puntosFinal = [[bod.lat, bod.lng]].concat(ordenFinal.map(i => [puntosActuales[i].lat, puntosActuales[i].lng]));
      const trazado = await pedirTrazado(puntosFinal);
      if (!trazado || !trazado.ok) { console.warn('ruta-dinamica: no se pudo calcular el plan fijo (trazado): ' + (trazado && trazado.error)); return; }

      // Antes de aplicar, confirma que la jornada SIGUE intacta (pudo haberse marcado
      // algo mientras esperábamos la respuesta de ORS) -- si no, solo se guarda el plan
      // para el próximo reinicio del día, pero no se reordena DATA a mitad de jornada.
      guardarPlanFijo({
        orden: ordenFinal.map(i => ({ lat: puntosActuales[i].lat, lng: puntosActuales[i].lng })),
        distanciaKm: trazado.distanciaKm,
        duracionMin: trazado.duracionMin,
      });
      if (!completed.size && !porCobrar.size && !quemados.size && !anulados.size) {
        DATA = ordenFinal.map(i => DATA[i]);
        if (typeof draw === 'function') draw(activeVendedor);
        if (typeof buildPanel === 'function') buildPanel();
        if (typeof updateStats === 'function') updateStats();
        if (typeof updateProgress === 'function') updateProgress();
        // DATA cambió de orden -- cualquier sugerencia previa de recalcular() quedó con
        // índices apuntando a las posiciones VIEJAS. Se descarta y se vuelve a calcular
        // ya sobre el orden nuevo, para que "siguiente parada" no muestre el cliente
        // equivocado mientras llega el próximo ciclo normal (hasta 10 min después).
        ultimaSugerencia = null;
        recalcular(true);
      }
    } catch (e) {
      console.warn('ruta-dinamica: fallo calculando el plan fijo del día.', e);
    } finally {
      calculandoPlanFijo = false;
    }
  }

  // ═══════════════════════════════════════════════════════════
  // PRECARGA DE MAPA OFFLINE — descarga por adelantado las imágenes de calles
  // de toda la zona de la ruta del día (una sola vez por camión+fecha), para
  // que si se pierde señal en un sector nuevo el mapa no se quede en blanco.
  // Se guarda en el Cache Storage del Service Worker (sw.js sirve estas
  // imágenes con "red primero, cae a esta caché si no hay señal").
  // ═══════════════════════════════════════════════════════════
  const TILES_CACHE_NAME = 'mapas-diarios-tiles-v1';
  const TILE_SUBDOMINIOS = ['a', 'b', 'c'];
  const TILE_ZOOMS = [13, 14, 15]; // rango típico de navegación por calle
  const MAX_TILES_TOTAL = 300;     // tope de imágenes por camión/día -- no gastar datos de más

  function lonATileX(lon, z) { return Math.floor((lon + 180) / 360 * Math.pow(2, z)); }
  function latATileY(lat, z) {
    const rad = lat * Math.PI / 180;
    return Math.floor((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2 * Math.pow(2, z));
  }
  function urlDeTile(z, x, y) {
    const s = TILE_SUBDOMINIOS[Math.abs(x + y) % TILE_SUBDOMINIOS.length];
    const oscuro = typeof darkMode !== 'undefined' && darkMode;
    return oscuro
      ? `https://${s}.basemaps.cartocdn.com/dark_all/${z}/${x}/${y}.png`
      : `https://${s}.tile.openstreetmap.org/${z}/${x}/${y}.png`;
  }
  function claveTilesPrecargados() {
    return 'rutaDinamica_tilesOk_' + (activeFecha || '') + '_' + (activeChofer || '').replace(/\s/g, '_');
  }

  let precargandoTiles = false;
  async function precargarMapaOffline() {
    if (precargandoTiles) return;
    if (!('caches' in window)) return; // sin soporte de Cache Storage, no insistir
    if (!DATA.length || !activeFecha || !activeChofer) return;
    if (localStorage.getItem(claveTilesPrecargados())) return; // ya se hizo hoy para este camión

    const bod = (typeof BODEGAS !== 'undefined' && BODEGAS[activeBodega]) ? BODEGAS[activeBodega] : null;
    const puntos = DATA.map(d => ({ lat: d.lat, lng: d.lng })).concat(bod ? [bod] : []);
    if (!puntos.length) return;

    let latMin = Infinity, latMax = -Infinity, lngMin = Infinity, lngMax = -Infinity;
    puntos.forEach(p => {
      if (p.lat < latMin) latMin = p.lat;
      if (p.lat > latMax) latMax = p.lat;
      if (p.lng < lngMin) lngMin = p.lng;
      if (p.lng > lngMax) lngMax = p.lng;
    });
    // Margen alrededor de la zona (10%) para no dejar el borde exacto sin cobertura.
    const padLat = (latMax - latMin) * 0.1 || 0.01;
    const padLng = (lngMax - lngMin) * 0.1 || 0.01;
    latMin -= padLat; latMax += padLat; lngMin -= padLng; lngMax += padLng;

    // Arranca por el zoom más amplio (más útil como respaldo general) y solo suma
    // zooms más finos mientras no se pase del tope de imágenes del día.
    const tilesPorZoom = [];
    let total = 0;
    for (const z of TILE_ZOOMS) {
      const xMin = lonATileX(lngMin, z), xMax = lonATileX(lngMax, z);
      const yMin = latATileY(latMax, z), yMax = latATileY(latMin, z); // Y crece hacia el sur
      const cuenta = (xMax - xMin + 1) * (yMax - yMin + 1);
      if (total + cuenta > MAX_TILES_TOTAL) break;
      total += cuenta;
      tilesPorZoom.push({ z, xMin, xMax, yMin, yMax });
    }
    if (!tilesPorZoom.length) return;

    precargandoTiles = true;
    try {
      const cache = await caches.open(TILES_CACHE_NAME);
      const urls = [];
      tilesPorZoom.forEach(({ z, xMin, xMax, yMin, yMax }) => {
        for (let x = xMin; x <= xMax; x++) {
          for (let y = yMin; y <= yMax; y++) urls.push(urlDeTile(z, x, y));
        }
      });

      // Descarga con concurrencia limitada -- no disparar todo de una vez.
      const CONCURRENCIA = 6;
      let i = 0;
      async function siguiente() {
        while (i < urls.length) {
          const url = urls[i++];
          try {
            if (await cache.match(url)) continue; // ya estaba de un día anterior en la misma zona
            const resp = await fetch(url);
            if (resp && resp.status === 200) await cache.put(url, resp);
          } catch (e) { /* sin señal en este momento -- se sigue con el resto */ }
        }
      }
      await Promise.all(Array.from({ length: CONCURRENCIA }, siguiente));
      localStorage.setItem(claveTilesPrecargados(), '1');
      console.log('ruta-dinamica: mapa offline precargado (' + urls.length + ' imágenes de la zona).');
    } catch (e) {
      console.warn('ruta-dinamica: no se pudo precargar el mapa offline.', e);
    } finally {
      precargandoTiles = false;
    }
  }

  function iniciar() {
    crearPanelUI();
    ocultarNavClusterViejo();
    engancharPopups();
    envolverNearestNeighborFrom();
    envolverStatsDinamicas();
    cargarTimestamps();
    cargarConfig().then(() => { recalcular(true); intentarCalcularPlanFijo(); precargarMapaOffline(); });
    // La clave de abajo (fecha|chofer) puede cambiar ANTES de que se elija la bodega
    // (DATA sigue vacío en ese instante), así que intentarCalcularPlanFijo() necesita
    // este reintento periódico propio -- igual que recalcular() ya tiene el suyo --
    // en vez de depender solo del disparo por cambio de clave.
    setInterval(() => recalcular(false), 60 * 1000); // respeta RECALC_MIN_INTERVAL_MS salvo forzado
    setInterval(() => { intentarCalcularPlanFijo(); precargarMapaOffline(); }, 15 * 1000); // baratos: salen de inmediato si ya está hecho
    // Mientras no haya un primer resultado para el camión/día activo (ultimaSugerencia
    // sigue null -- por ejemplo, se eligió el camión antes que la bodega, o ORS tardó
    // en responder), reintenta cada 5s en vez de esperar el ciclo normal de 10 min.
    // Se detiene solo (MAX_INTENTOS_RAPIDOS) para no insistir sin fin si algo falla.
    setInterval(() => {
      if (!ultimaSugerencia && intentosRapidos < MAX_INTENTOS_RAPIDOS) {
        intentosRapidos++;
        recalcular(true);
      }
    }, 5000);

    // Detecta cambio de fecha/chofer activo (nueva ruta cargada) sin enganchar loadAndRender().
    setInterval(() => {
      const clave = (activeFecha || '') + '|' + (activeChofer || '');
      if (clave !== ultimaClaveRuta && clave !== '|') {
        ultimaClaveRuta = clave;
        cargarTimestamps();
        limpiarRutaSugerida();
        ultimaSugerencia = null;
        intentosRapidos = 0; // nuevo camión/día: reactiva los reintentos rápidos
        recalcular(true);
        intentarCalcularPlanFijo();
        precargarMapaOffline();
      } else {
        aplicarStatsFijas(); // por si updateStats() corrió antes de que el plan estuviera listo
      }
    }, 4000);
  }

  if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', iniciar); }
  else { iniciar(); }
})();
