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
// GRUPOS (🆕 Nuevo cargue, ver cargue-geocercas.js): con 1 solo grupo activo
// (caso normal) el panel se ve exactamente igual que siempre -- un total, un
// selector de camión, un botón Guardar. Al congelar un grupo con "Nuevo
// cargue" aparecen tantas cabeceras "Cargue N" como grupos haya en la
// selección, cada una con su propio subtotal; los grupos YA congelados
// llevan su propio selector de camión + botón Guardar inline (ver
// guardarGrupoCargue), y el selector/botón de arriba del panel siguen
// gobernando solo el grupo activo (el que se sigue dibujando).
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
  const btnNuevoCargue = document.getElementById('cargue-btn-nuevo-cargue');
  if (btnNuevoCargue) btnNuevoCargue.addEventListener('click', () => { if (typeof nuevoGrupoCargue === 'function') nuevoGrupoCargue(); });
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
  if (totalEl) totalEl.textContent = '$' + total.toFixed(2);
  if (contEl) contEl.textContent = String(seleccion.items.length);

  const grupoIds = [...new Set(seleccion.items.map(it => it._cargueGrupo || 1))].sort((a, b) => a - b);
  const hayVarios = grupoIds.length > 1;

  const filasDeCliente = (items) => items.map(it => `
    <li>
      <label class="chk-cliente">
        <input type="checkbox" checked data-pedido="${it.data.pedido}">
        <span><b>${it.data.cliente}</b> — ${it.data.vendedor} — $${it.data.ventasTotal.toFixed(2)}</span>
      </label>
    </li>`
  ).join('');

  if (!hayVarios) {
    // Caso normal (un solo cargue en construcción): lista plana, igual que
    // siempre -- sin cabeceras de grupo que no aportarían nada.
    lista.innerHTML = filasDeCliente(seleccion.items);
  } else {
    lista.innerHTML = grupoIds.map(gid => {
      const items = seleccion.items.filter(it => (it._cargueGrupo || 1) === gid);
      const subtotal = items.reduce((s, it) => s + it.data.ventasTotal, 0);
      const esActivo = gid === cargueGrupoActivo;
      const encabezado = `
        <li class="grupo-cargue-header">
          <div class="grupo-cargue-info">📦 <b>Cargue ${gid}</b>${esActivo ? ' (dibujando)' : ''} — ${items.length} facturas — $${subtotal.toFixed(2)}</div>
          ${esActivo ? '' : `
            <div class="grupo-cargue-guardar">
              <select class="grupo-camion">
                <option value="">— Camión —</option>
                ${CARGUE_CAMIONES.map(c => `<option value="${c.codigo}">${c.camion}</option>`).join('')}
              </select>
              <button type="button" class="grupo-btn-guardar" data-grupo="${gid}">💾 Guardar</button>
            </div>`}
        </li>`;
      return encabezado + filasDeCliente(items);
    }).join('');
  }

  // Todos arrancan tildados (están en la selección por definición) --
  // destildar acá los saca, mismo mecanismo que la lista de Clientes.
  lista.querySelectorAll('input[data-pedido]').forEach(chk => {
    chk.addEventListener('change', () => alternarClienteEnSeleccion(chk.dataset.pedido));
  });
  lista.querySelectorAll('.grupo-btn-guardar').forEach(btn => {
    btn.addEventListener('click', () => {
      const selectEl = btn.parentElement.querySelector('.grupo-camion');
      guardarGrupoCargue(Number(btn.dataset.grupo), selectEl);
    });
  });
}

// Guarda SOLO el grupo activo (el que se sigue dibujando arriba, ver
// cargue-geocercas.js) -- si había otro(s) grupo(s) ya congelados con "🆕
// Nuevo cargue" quedan intactos en la lista, esperando su propio camión
// (cada uno se guarda aparte con guardarGrupoCargue).
async function guardarSeleccionActual(){
  const fecha = (typeof obtenerCargueFechaActiva === 'function') ? obtenerCargueFechaActiva() : '';
  const sel = document.getElementById('cargue-sel-camion');
  const camion = sel ? sel.value : '';
  const grupoId = cargueGrupoActivo;
  const items = cargueSeleccionActual.items.filter(it => (it._cargueGrupo || 1) === grupoId);

  if (!fecha)        { alert('No hay fecha activa.'); return; }
  if (!camion)        { alert('Selecciona un camión.'); return; }
  if (!items.length)  { alert('No hay pedidos seleccionados. Dibuja la geocerca primero.'); return; }

  const pedidos = items.map(it => it.data.pedido);
  const camionLabel = sel.options[sel.selectedIndex].textContent;
  const editando = cargueModoEdicion; // guardar referencia: guardarSeleccionActual limpia el modo antes de terminar
  const geojson = (typeof cargueGrupoPoligonos !== 'undefined' ? cargueGrupoPoligonos[grupoId] : null) || cargueSeleccionActual.poligono;

  guardarCargueAsignacion({ fecha, camion: camionLabel, pedidos, geojson });

  if (editando) {
    const resultado = await eliminarCargueAsignacion({ fecha: editando.fecha, timestamp: editando.timestamp, camion: editando.camion });
    if (!resultado.ok) {
      alert('El cargue nuevo se guardó, pero no se pudo eliminar el viejo automáticamente (' + (resultado.error || 'error desconocido') + '). Eliminalo a mano de la lista para no dejarlo duplicado.');
    }
    cargueModoEdicion = null;
    actualizarUiModoEdicion();
  }

  items.forEach(it => setMarcadorSeleccionado(it, false));
  cargueSeleccionActual.items = cargueSeleccionActual.items.filter(it => (it._cargueGrupo || 1) !== grupoId);
  if (!cargueSeleccionActual.items.length) {
    if (cargueDrawnItems) cargueDrawnItems.clearLayers();
    cargueSeleccionActual.poligono = null;
    if (typeof _resetGruposCargue === 'function') _resetGruposCargue();
  }
  if (sel) sel.value = '';
  notificarCambioSeleccion();

  // El guardado nuevo es fire-and-forget (igual que siempre) -- esperamos un
  // toque y refrescamos SOLO los cargues guardados (no los pedidos ni la
  // selección) para traer el Timestamp real, necesario para poder editar o
  // eliminar este cargue después.
  if (typeof refrescarSoloAsignaciones === 'function') setTimeout(refrescarSoloAsignaciones, 1500);
}

// Guarda UN grupo ya congelado (botón inline "💾 Guardar" de su cabecera en
// la lista, ver onCargueSeleccionCambio) sin tocar los demás grupos
// pendientes ni el que se sigue dibujando arriba.
async function guardarGrupoCargue(grupoId, selectEl){
  const fecha = (typeof obtenerCargueFechaActiva === 'function') ? obtenerCargueFechaActiva() : '';
  const camion = selectEl ? selectEl.value : '';
  const items = cargueSeleccionActual.items.filter(it => (it._cargueGrupo || 1) === grupoId);

  if (!fecha)       { alert('No hay fecha activa.'); return; }
  if (!camion)      { alert('Selecciona un camión para este cargue.'); return; }
  if (!items.length) return;

  const pedidos = items.map(it => it.data.pedido);
  const camionLabel = selectEl.options[selectEl.selectedIndex].textContent;
  const geojson = (typeof cargueGrupoPoligonos !== 'undefined') ? (cargueGrupoPoligonos[grupoId] || null) : null;

  guardarCargueAsignacion({ fecha, camion: camionLabel, pedidos, geojson });

  items.forEach(it => setMarcadorSeleccionado(it, false));
  cargueSeleccionActual.items = cargueSeleccionActual.items.filter(it => (it._cargueGrupo || 1) !== grupoId);
  if (!cargueSeleccionActual.items.length) {
    if (cargueDrawnItems) cargueDrawnItems.clearLayers();
    cargueSeleccionActual.poligono = null;
    if (typeof _resetGruposCargue === 'function') _resetGruposCargue();
  }
  notificarCambioSeleccion();

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
  const sel = document.getElementById('cargue-sel-camion');
  if (sel) sel.value = '';
  actualizarUiModoEdicion();
  // Sin la excepción de modo edición, los pedidos de este cargue vuelven a
  // estar "asignados" -- hay que repintar para que se oculten de nuevo (si
  // solo se llamara a limpiarCargueGeocerca(), quedarían visibles igual).
  if (typeof aplicarFiltrosYPintar === 'function') aplicarFiltrosYPintar();
  else limpiarCargueGeocerca();
}

// Banner sobre el mapa + texto del botón Guardar, para que sea imposible no
// darse cuenta de que se está editando un cargue (y no armando uno nuevo).
function actualizarUiModoEdicion(){
  const banner = document.getElementById('cargue-banner-edicion');
  const nombreEl = document.getElementById('cargue-banner-edicion-nombre');
  const btnGuardar = document.getElementById('cargue-btn-guardar');
  const btnNuevoCargue = document.getElementById('cargue-btn-nuevo-cargue');
  if (cargueModoEdicion) {
    if (nombreEl) nombreEl.textContent = cargueModoEdicion.camion;
    if (banner) banner.style.display = 'flex';
    if (btnGuardar) btnGuardar.textContent = '💾 Guardar cambios';
    // Editar es siempre UN cargue -- no tiene sentido distinguir zonas acá.
    if (btnNuevoCargue) btnNuevoCargue.style.display = 'none';
  } else {
    if (banner) banner.style.display = 'none';
    if (btnGuardar) btnGuardar.textContent = '💾 Guardar cargue';
    if (btnNuevoCargue) btnNuevoCargue.style.display = '';
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
