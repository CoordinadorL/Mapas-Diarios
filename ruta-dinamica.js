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

  const RECALC_MIN_INTERVAL_MS = 5 * 60 * 1000; // no más de 1 vez cada 5 min, salvo forzado
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

  // ── Panel flotante propio (no toca el panel lateral existente) ──
  function crearPanelUI() {
    if (document.getElementById('ruta-dinamica-panel')) return;
    const div = document.createElement('div');
    div.id = 'ruta-dinamica-panel';
    div.style.cssText = 'position:fixed;left:10px;bottom:78px;z-index:900;background:rgba(15,23,42,.92);' +
      'color:#e2e8f0;border-radius:10px;padding:8px 12px;font-size:12px;max-width:230px;' +
      'box-shadow:0 2px 10px rgba(0,0,0,.4);display:none';
    div.innerHTML =
      '<div style="font-weight:700;margin-bottom:4px;color:#4ade80">🧭 Ruta sugerida</div>' +
      '<div id="rd-siguiente" style="margin-bottom:2px">—</div>' +
      '<div id="rd-espera" style="color:#fbbf24;margin-bottom:6px"></div>' +
      '<button id="rd-recalcular-btn" style="background:#334155;color:#e2e8f0;border:none;border-radius:6px;' +
      'padding:4px 8px;font-size:11px;cursor:pointer">🔄 Recalcular ahora</button>';
    document.body.appendChild(div);
    document.getElementById('rd-recalcular-btn').addEventListener('click', () => recalcular(true));
  }

  function actualizarPanel() {
    const panel = document.getElementById('ruta-dinamica-panel');
    if (!panel) return;
    const tier1 = idxPendientesTier1(), tier2Listos = idxPorCobrarListos(), tier2Esperando = idxPorCobrarEsperando();
    if (!tier1.length && !tier2Listos.length && !tier2Esperando.length) { panel.style.display = 'none'; return; }
    panel.style.display = 'block';
    const siguienteIdx = (ultimaSugerencia && ultimaSugerencia.ordenIdx.length) ? ultimaSugerencia.ordenIdx[0]
      : (tier1[0] != null ? tier1[0] : tier2Listos[0]);
    const nombreSig = (siguienteIdx != null && DATA[siguienteIdx]) ? DATA[siguienteIdx].razon : '—';
    const tiempoTxt = (ultimaSugerencia && ultimaSugerencia.duracionMin) ? (' (' + Math.round(ultimaSugerencia.duracionMin) + ' min)') : '';
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

  function iniciar() {
    crearPanelUI();
    engancharPopups();
    cargarTimestamps();
    cargarConfig().then(() => recalcular(true));
    setInterval(() => recalcular(false), 60 * 1000); // respeta RECALC_MIN_INTERVAL_MS salvo forzado

    // Detecta cambio de fecha/chofer activo (nueva ruta cargada) sin enganchar loadAndRender().
    setInterval(() => {
      const clave = (activeFecha || '') + '|' + (activeChofer || '');
      if (clave !== ultimaClaveRuta && clave !== '|') {
        ultimaClaveRuta = clave;
        cargarTimestamps();
        limpiarRutaSugerida();
        ultimaSugerencia = null;
        recalcular(true);
      }
    }, 4000);
  }

  if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', iniciar); }
  else { iniciar(); }
})();
