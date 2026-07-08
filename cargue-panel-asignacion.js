// ═══════════════════════════════════════════════════════════
// CARGUE-PANEL-ASIGNACION.JS — panel lateral: pedidos seleccionados por la
// geocerca activa, selector de camión (catálogo fijo, hoja "Cod Camión") y
// guardado. También lleva la lista de camiones ya armados, con botones para
// editarlos o eliminarlos de verdad (ver CargueAsignacion.gs -- queda
// registrado en la hoja aparte CARGUE_REPORTE antes de borrar).
//
// Se engancha a cargue-geocercas.js vía onCargueSeleccionCambio() (llamada
// directa por scope global, mismo patrón que el resto del proyecto). Pide
// la fecha activa a obtenerCargueFechaActiva(), definida en cargue.html.
// ═══════════════════════════════════════════════════════════

let CARGUE_CAMIONES = [];          // catálogo cacheado {codigo, camion}
let cargueCamionesArmadosHoy = []; // [{camion, pedidos, fecha, timestamp, geojson, kilos, total, vendedores}]

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
  limpiarCargueGeocerca();
  if (sel) sel.value = '';

  // Fire-and-forget: esperamos un toque y refrescamos SOLO los cargues
  // guardados (no los pedidos ni la selección) para traer el Timestamp real
  // -- sin eso no se puede editar ni eliminar este cargue después.
  if (typeof refrescarSoloAsignaciones === 'function') setTimeout(refrescarSoloAsignaciones, 1500);
}

// "Editar": anula el cargue guardado y recarga esos mismos pedidos en la
// selección para que el usuario los ajuste (agregar/quitar clientes, cambiar
// de camión) y los vuelva a guardar. No hay edición en el lugar -- primero
// elimina de verdad la fila vieja (queda igual registrada en CARGUE_REPORTE
// como ELIMINADO, ver CargueAsignacion.gs).
function editarCargueArmado(c){
  const ok = confirm(`Vas a editar el cargue de "${c.camion}" (${c.pedidos.length} pedidos).\n\nEsto elimina ese cargue guardado y carga esos pedidos en la selección para que los ajustes y lo guardes de nuevo.\n\n¿Continuar?`);
  if (!ok) return;
  if (!c.timestamp) { alert('Este cargue todavía no terminó de guardarse -- esperá unos segundos y reintentá.'); return; }

  eliminarCargueAsignacion({ fecha: c.fecha, timestamp: c.timestamp, camion: c.camion });
  prepararEdicionCargue(c.pedidos, c.geojson);

  const sel = document.getElementById('cargue-sel-camion');
  if (sel) {
    const opcion = [...sel.options].find(o => o.textContent === c.camion);
    if (opcion) sel.value = opcion.value;
  }

  if (typeof refrescarSoloAsignaciones === 'function') setTimeout(refrescarSoloAsignaciones, 1500);
}

// "Eliminar": borra la fila de verdad en CARGUE_ASIGNACION (queda registrada
// en CARGUE_REPORTE como ELIMINADO, ver CargueAsignacion.gs). No toca la
// selección actual.
function eliminarCargueArmado(c){
  const ok = confirm(`¿Eliminar el cargue de "${c.camion}" (${c.pedidos.length} pedidos, $${c.total.toFixed(2)})?\n\nEsto no se puede deshacer desde acá.`);
  if (!ok) return;
  if (!c.timestamp) { alert('Este cargue todavía no terminó de guardarse -- esperá unos segundos y reintentá.'); return; }

  eliminarCargueAsignacion({ fecha: c.fecha, timestamp: c.timestamp, camion: c.camion });
  if (typeof refrescarSoloAsignaciones === 'function') setTimeout(refrescarSoloAsignaciones, 1500);
}

function renderCamionesArmadosHoy(){
  const cont = document.getElementById('cargue-armados');
  if (!cont) return;
  if (!cargueCamionesArmadosHoy.length) { cont.innerHTML = '<li class="vacio">Ningún camión armado todavía.</li>'; return; }

  cont.innerHTML = cargueCamionesArmadosHoy.map((c, i) => `
    <li>
      <div class="armado-fila">
        <div>
          <b>${c.camion}</b> — ${c.pedidos.length} pedidos — ${c.kilos.toFixed(1)}kg — $${c.total.toFixed(2)}
        </div>
        <div class="armado-acciones">
          <button type="button" class="armado-btn" data-idx="${i}" data-accion="editar" title="Editar: recarga estos pedidos en la selección">✏️</button>
          <button type="button" class="armado-btn" data-idx="${i}" data-accion="eliminar" title="Eliminar este cargue">🗑️</button>
        </div>
      </div>
    </li>
  `).join('');

  cont.querySelectorAll('.armado-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const c = cargueCamionesArmadosHoy[Number(btn.dataset.idx)];
      if (!c) return;
      if (btn.dataset.accion === 'editar') editarCargueArmado(c); else eliminarCargueArmado(c);
    });
  });
}
