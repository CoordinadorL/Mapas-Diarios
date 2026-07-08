// ═══════════════════════════════════════════════════════════
// CARGUE-PANEL-ASIGNACION.JS — panel lateral: pedidos seleccionados por la
// geocerca activa, selector de camión (catálogo fijo, hoja "Cod Camión") y
// guardado. También lleva la lista de camiones ya armados, con botones para
// editarlos o eliminarlos de verdad (ver CargueAsignacion.gs -- queda
// registrado en la hoja aparte CARGUE_REPORTE antes de borrar).
//
// MODO EDICIÓN (✏️): al editar un cargue armado NO se borra nada todavía --
// se carga esa selección en el mapa, se muestra un banner bien visible sobre
// el mapa, y el botón "Guardar cargue" pasa a decir "Guardar cambios". Recién
// ahí (al confirmar) se guarda el cargue nuevo Y se elimina el viejo. Si el
// usuario se arrepiente, "✖️ Cancelar" en el banner sale del modo sin tocar
// nada -- el cargue original queda intacto todo el tiempo hasta ese momento.
//
// Se engancha a cargue-geocercas.js vía onCargueSeleccionCambio() (llamada
// directa por scope global, mismo patrón que el resto del proyecto). Pide
// la fecha activa a obtenerCargueFechaActiva(), definida en cargue.html.
// ═══════════════════════════════════════════════════════════

let CARGUE_CAMIONES = [];          // catálogo cacheado {codigo, camion}
let cargueCamionesArmadosHoy = []; // [{camion, pedidos, fecha, timestamp, geojson, kilos, total, vendedores}]
let cargueModoEdicion = null;      // null = normal; si no, el cargue que se está reemplazando

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
  const btnCancelarEdicion = document.getElementById('cargue-btn-cancelar-edicion');
  if (btnCancelarEdicion) btnCancelarEdicion.addEventListener('click', cancelarModoEdicion);
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

async function guardarSeleccionActual(){
  const fecha = (typeof obtenerCargueFechaActiva === 'function') ? obtenerCargueFechaActiva() : '';
  const sel = document.getElementById('cargue-sel-camion');
  const camion = sel ? sel.value : '';
  const items = cargueSeleccionActual.items;

  if (!fecha)        { alert('No hay fecha activa.'); return; }
  if (!camion)        { alert('Selecciona un camión.'); return; }
  if (!items.length)  { alert('No hay pedidos seleccionados. Dibuja la geocerca primero.'); return; }

  const pedidos = items.map(it => it.data.pedido);
  const camionLabel = sel.options[sel.selectedIndex].textContent;
  const editando = cargueModoEdicion; // guardar referencia: guardarSeleccionActual limpia el modo antes de terminar

  guardarCargueAsignacion({ fecha, camion: camionLabel, pedidos, geojson: cargueSeleccionActual.poligono });

  if (editando) {
    const resultado = await eliminarCargueAsignacion({ fecha: editando.fecha, timestamp: editando.timestamp, camion: editando.camion });
    if (!resultado.ok) {
      alert('El cargue nuevo se guardó, pero no se pudo eliminar el viejo automáticamente (' + (resultado.error || 'error desconocido') + '). Eliminalo a mano de la lista para no dejarlo duplicado.');
    }
    cargueModoEdicion = null;
    actualizarUiModoEdicion();
  }

  limpiarCargueGeocerca();
  if (sel) sel.value = '';

  // El guardado nuevo es fire-and-forget (igual que siempre) -- esperamos un
  // toque y refrescamos SOLO los cargues guardados (no los pedidos ni la
  // selección) para traer el Timestamp real, necesario para poder editar o
  // eliminar este cargue después.
  if (typeof refrescarSoloAsignaciones === 'function') setTimeout(refrescarSoloAsignaciones, 1500);
}

// "Editar": entra en modo edición SIN borrar nada todavía. Carga esos
// pedidos en la selección; recién al guardar (guardarSeleccionActual) se
// elimina el cargue viejo y se guarda el nuevo. "Cancelar" en el banner
// sale del modo sin tocar el cargue original.
function editarCargueArmado(c){
  if (!c.timestamp) { alert('Este cargue todavía no terminó de guardarse -- esperá unos segundos y reintentá.'); return; }

  cargueModoEdicion = c;
  prepararEdicionCargue(c.pedidos, c.geojson);

  const sel = document.getElementById('cargue-sel-camion');
  if (sel) {
    const opcion = [...sel.options].find(o => o.textContent === c.camion);
    if (opcion) sel.value = opcion.value;
  }
  actualizarUiModoEdicion();
}

// "✖️ Cancelar" del banner de edición: sale del modo sin guardar ni borrar
// nada. También lo llama activarModoEdicion(false) en cargue-historial.js si
// el usuario cambia a un rango histórico mientras estaba editando.
function cancelarModoEdicion(){
  if (!cargueModoEdicion) return;
  cargueModoEdicion = null;
  limpiarCargueGeocerca();
  const sel = document.getElementById('cargue-sel-camion');
  if (sel) sel.value = '';
  actualizarUiModoEdicion();
}

// Banner sobre el mapa + texto del botón Guardar, para que sea imposible no
// darse cuenta de que se está editando un cargue (y no armando uno nuevo).
function actualizarUiModoEdicion(){
  const banner = document.getElementById('cargue-banner-edicion');
  const nombreEl = document.getElementById('cargue-banner-edicion-nombre');
  const btnGuardar = document.getElementById('cargue-btn-guardar');
  if (cargueModoEdicion) {
    if (nombreEl) nombreEl.textContent = cargueModoEdicion.camion;
    if (banner) banner.style.display = 'flex';
    if (btnGuardar) btnGuardar.textContent = '💾 Guardar cambios';
  } else {
    if (banner) banner.style.display = 'none';
    if (btnGuardar) btnGuardar.textContent = '💾 Guardar cargue';
  }
}

// "🗑️ Eliminar": borra la fila de verdad en CARGUE_ASIGNACION (queda
// registrada en CARGUE_REPORTE como ELIMINADO). Espera la confirmación real
// del backend antes de refrescar -- si falla, avisa en vez de quedarse
// callado.
async function eliminarCargueArmado(c){
  const ok = confirm(`¿Eliminar el cargue de "${c.camion}" (${c.pedidos.length} pedidos, $${c.total.toFixed(2)})?\n\nEsto no se puede deshacer desde acá.`);
  if (!ok) return;
  if (!c.timestamp) { alert('Este cargue todavía no terminó de guardarse -- esperá unos segundos y reintentá.'); return; }

  const resultado = await eliminarCargueAsignacion({ fecha: c.fecha, timestamp: c.timestamp, camion: c.camion });
  if (!resultado.ok) { alert('No se pudo eliminar: ' + (resultado.error || 'error desconocido')); return; }
  if (typeof refrescarSoloAsignaciones === 'function') await refrescarSoloAsignaciones();
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
          <button type="button" class="armado-btn" data-idx="${i}" data-accion="editar" title="Editar: carga estos pedidos en la selección para ajustarlos">✏️</button>
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
