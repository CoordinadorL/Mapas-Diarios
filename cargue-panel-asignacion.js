// ═══════════════════════════════════════════════════════════
// CARGUE-PANEL-ASIGNACION.JS — panel lateral: pedidos seleccionados por la
// geocerca activa, selector de camión (catálogo fijo, hoja "Cod Camión") y
// guardado. También lleva la lista de camiones ya armados en la sesión de
// hoy, para no perder de vista qué falta.
//
// Se engancha a cargue-geocercas.js vía onCargueSeleccionCambio() (llamada
// directa por scope global, mismo patrón que el resto del proyecto). Pide
// la fecha activa a obtenerCargueFechaActiva(), definida en cargue.html.
// ═══════════════════════════════════════════════════════════

let CARGUE_CAMIONES = [];          // catálogo cacheado {codigo, camion}
let cargueCamionesArmadosHoy = []; // [{camion, pedidos:[...], total}] -- solo en memoria de esta sesión

async function initCarguePanelAsignacion(){
  CARGUE_CAMIONES = await fetchCargueCamiones();
  const sel = document.getElementById('cargue-sel-camion');
  if (sel) {
    sel.innerHTML = '<option value="">— Selecciona un camión —</option>' +
      CARGUE_CAMIONES.map(c => `<option value="${c.codigo}">${c.camion}</option>`).join('');
  }
  const btn = document.getElementById('cargue-btn-guardar');
  if (btn) btn.addEventListener('click', guardarSeleccionActual);
  const btnLimpiar = document.getElementById('cargue-btn-limpiar');
  if (btnLimpiar) btnLimpiar.addEventListener('click', limpiarCargueGeocerca);
}

// Llamado por cargue-geocercas.js cada vez que cambia la selección dibujada.
function onCargueSeleccionCambio(seleccion){
  const lista = document.getElementById('cargue-sel-lista');
  const totalEl = document.getElementById('cargue-sel-total');
  const contEl = document.getElementById('cargue-sel-count');
  if (!lista) return;

  if (!seleccion.items.length) {
    lista.innerHTML = '<li class="vacio">Dibuja un polígono sobre el mapa para seleccionar pedidos.</li>';
    if (totalEl) totalEl.textContent = '$0.00';
    if (contEl) contEl.textContent = '0';
    return;
  }

  const total = seleccion.items.reduce((s, it) => s + it.data.ventasTotal, 0);
  lista.innerHTML = seleccion.items.map(it =>
    `<li><b>${it.data.cliente}</b> — ${it.data.vendedor} — $${it.data.ventasTotal.toFixed(2)}</li>`
  ).join('');
  if (totalEl) totalEl.textContent = '$' + total.toFixed(2);
  if (contEl) contEl.textContent = String(seleccion.items.length);
}

function guardarSeleccionActual(){
  const fecha = (typeof obtenerCargueFechaActiva === 'function') ? obtenerCargueFechaActiva() : '';
  const sel = document.getElementById('cargue-sel-camion');
  const camion = sel ? sel.value : '';
  const items = cargueSeleccionActual.items;

  if (!fecha)        { alert('No hay fecha activa.'); return; }
  if (!camion)        { alert('Selecciona un camión.'); return; }
  if (!items.length)  { alert('No hay pedidos seleccionados. Dibuja la geocerca primero.'); return; }

  const pedidos = items.map(it => it.data.pedido);
  const camionLabel = sel.options[sel.selectedIndex].textContent;

  guardarCargueAsignacion({ fecha, camion: camionLabel, pedidos, geojson: cargueSeleccionActual.poligono });

  cargueCamionesArmadosHoy.push({
    camion: camionLabel, pedidos,
    kilos: items.reduce((s, it) => s + it.data.kilos, 0),
    total: items.reduce((s, it) => s + it.data.ventasTotal, 0),
    vendedores: [...new Set(items.map(it => it.data.vendedor))].sort(),
  });
  renderCamionesArmadosHoy();
  limpiarCargueGeocerca();
  if (sel) sel.value = '';
}

function renderCamionesArmadosHoy(){
  const cont = document.getElementById('cargue-armados');
  if (!cont) return;
  if (!cargueCamionesArmadosHoy.length) { cont.innerHTML = '<li class="vacio">Ningún camión armado todavía.</li>'; return; }
  cont.innerHTML = cargueCamionesArmadosHoy.map(c =>
    `<li><b>${c.camion}</b> — ${c.pedidos.length} pedidos — ${c.kilos.toFixed(1)}kg — $${c.total.toFixed(2)}</li>`
  ).join('');
}
