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

// Totales de un grupo de items seleccionados (kilos, monto, vendedores) --
// se calculan acá, al momento de guardar, para cachearlos en
// CARGUE_ASIGNACION (ver guardarCargueAsignacion) y que historial-cargues.html
// no dependa de recruzar contra CARGUE_PEDIDOS una vez que el archivado
// diario ya movió esos pedidos al histórico anual.
function _totalesDeItemsCargue(items){
  return {
    kilos: items.reduce((s, it) => s + (it.data.kilos || 0), 0),
    monto: items.reduce((s, it) => s + (it.data.ventasTotal || 0), 0),
    vendedores: [...new Set(items.map(it => it.data.vendedor))].sort(),
  };
}

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
  const btnAgregarArmado = document.getElementById('cargue-btn-agregar-armado');
  if (btnAgregarArmado) btnAgregarArmado.addEventListener('click', agregarSeleccionACamionArmado);
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
  const { kilos, monto, vendedores } = _totalesDeItemsCargue(items);

  // Guardar PRIMERO, eliminar el viejo (si estaba editando) DESPUÉS -- y
  // solo si el guardado nuevo de verdad funcionó. Antes esto era al revés
  // en la práctica (guardado fire-and-forget sin confirmación real): si el
  // guardado fallaba en silencio después de haber tocado el viejo, se
  // perdían pedidos sin ningún aviso. Ahora si el guardado falla, no se
  // toca nada más -- la selección queda intacta para reintentar.
  const resultadoGuardar = await guardarCargueAsignacion({ fecha, camion: camionLabel, pedidos, geojson, kilos, monto, vendedores });
  if (!resultadoGuardar.ok) {
    alert('No se pudo guardar el cargue: ' + (resultadoGuardar.error || 'error desconocido') + '\n\nNo se tocó nada más -- podés reintentar.');
    return;
  }

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

  // El guardado ahora se confirma de verdad (JSONP) -- ya no hace falta
  // esperar "a ciegas" antes de refrescar, como cuando era fire-and-forget.
  if (typeof refrescarSoloAsignaciones === 'function') refrescarSoloAsignaciones();
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
  const { kilos, monto, vendedores } = _totalesDeItemsCargue(items);

  const resultadoGuardar = await guardarCargueAsignacion({ fecha, camion: camionLabel, pedidos, geojson, kilos, monto, vendedores });
  if (!resultadoGuardar.ok) {
    alert('No se pudo guardar este cargue: ' + (resultadoGuardar.error || 'error desconocido') + '\n\nNo se tocó nada más -- podés reintentar.');
    return;
  }

  items.forEach(it => setMarcadorSeleccionado(it, false));
  cargueSeleccionActual.items = cargueSeleccionActual.items.filter(it => (it._cargueGrupo || 1) !== grupoId);
  if (!cargueSeleccionActual.items.length) {
    if (cargueDrawnItems) cargueDrawnItems.clearLayers();
    cargueSeleccionActual.poligono = null;
    if (typeof _resetGruposCargue === 'function') _resetGruposCargue();
  }
  notificarCambioSeleccion();

  if (typeof refrescarSoloAsignaciones === 'function') refrescarSoloAsignaciones();
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
  const filaAgregarArmado = document.getElementById('cargue-fila-agregar-armado');
  if (cargueModoEdicion) {
    if (nombreEl) nombreEl.textContent = cargueModoEdicion.camion;
    if (banner) banner.style.display = 'flex';
    if (btnGuardar) btnGuardar.textContent = '💾 Guardar cambios';
    // Editar es siempre UN cargue -- no tiene sentido distinguir zonas ni
    // agregar a OTRO camión mientras se edita este.
    if (btnNuevoCargue) btnNuevoCargue.style.display = 'none';
    if (filaAgregarArmado) filaAgregarArmado.style.display = 'none';
  } else {
    if (banner) banner.style.display = 'none';
    if (btnGuardar) btnGuardar.textContent = '💾 Guardar cargue';
    if (btnNuevoCargue) btnNuevoCargue.style.display = '';
    if (filaAgregarArmado) filaAgregarArmado.style.display = '';
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

  // Algunos de estos pedidos pueden haber estado ya ARCHIVADOS (ver
  // _restaurarPedidosArchivadosSiHaceFalta en el backend) -- si el backend
  // los recuperó, avisar: sin esto, quedaba invisible que ahora sí van a
  // aparecer de nuevo en el mapa para poder armarlos en otro cargue.
  if (resultado.restaurados > 0) {
    alert(`Cargue eliminado. ${resultado.restaurados} pedido${resultado.restaurados === 1 ? '' : 's'} que ya se había${resultado.restaurados === 1 ? '' : 'n'} archivado volvió${resultado.restaurados === 1 ? '' : 'n'} a estar disponible${resultado.restaurados === 1 ? '' : 's'} para armar un cargue.`);
  }
}

// "➕ Agregar" (junto al selector de camiones YA armados): toma la
// selección actual (el grupo activo, mismo alcance que Guardar cargue) y la
// suma a un camión que ya se guardó hoy, sin tener que pasar por Editar
// (que carga el cargue ENTERO en la selección). Mismo patrón de siempre
// (guardar de nuevo con la lista de pedidos combinada + eliminar el viejo)
// -- CARGUE_ASIGNACION no tiene "agregar una fila a un array ya guardado".
//
// Guardar PRIMERO, eliminar el viejo DESPUÉS -- y solo si el guardado nuevo
// de verdad funcionó (ver el mismo razonamiento en guardarSeleccionActual).
// Si el guardado falla, el cargue viejo queda intacto -- nada se pierde, a
// lo sumo hay que reintentar. El orden al revés (eliminar y recién
// entonces guardar) es justamente el que puede perder pedidos si el
// guardado falla después de haber borrado el viejo.
async function agregarSeleccionACamionArmado(){
  const sel = document.getElementById('cargue-sel-camion-agregar');
  const idx = sel ? sel.value : '';
  if (idx === '') { alert('Elegí a qué camión armado agregar la selección.'); return; }
  const camionExistente = cargueCamionesArmadosHoy[Number(idx)];
  if (!camionExistente) { alert('Ese camión ya no está en la lista -- actualizá e intentá de nuevo.'); return; }
  if (!camionExistente.timestamp) { alert('Ese cargue todavía no terminó de guardarse -- esperá unos segundos y reintentá.'); return; }

  const grupoId = cargueGrupoActivo;
  const items = cargueSeleccionActual.items.filter(it => (it._cargueGrupo || 1) === grupoId);
  if (!items.length) { alert('No hay pedidos seleccionados para agregar.'); return; }

  const nuevosIds = items.map(it => it.data.pedido);
  const pedidosCombinados = [...new Set([...camionExistente.pedidos, ...nuevosIds])];

  // Totales combinados: los del cargue existente (ya calculados por
  // computarCamionesArmados, cruzando contra CARGUE_PEDIDOS_TODOS) más los
  // de la nueva selección que se está agregando.
  const nuevosTotales = _totalesDeItemsCargue(items);
  const kilos = (camionExistente.kilos || 0) + nuevosTotales.kilos;
  const monto = (camionExistente.total || 0) + nuevosTotales.monto;
  const vendedores = [...new Set([...(camionExistente.vendedores || []), ...nuevosTotales.vendedores])].sort();

  // Mismo camión, misma fecha original del cargue (no la de hoy) -- solo
  // crece la lista de pedidos. El polígono de referencia se descarta (los
  // nuevos pedidos pueden caer afuera del original), no afecta nada más.
  const resultadoGuardar = await guardarCargueAsignacion({ fecha: camionExistente.fecha, camion: camionExistente.camion, pedidos: pedidosCombinados, geojson: null, kilos, monto, vendedores });
  if (!resultadoGuardar.ok) {
    alert('No se pudo agregar: ' + (resultadoGuardar.error || 'error desconocido') + '\n\nEl camión armado sigue igual que antes -- podés reintentar.');
    return;
  }

  const resultadoEliminar = await eliminarCargueAsignacion({ fecha: camionExistente.fecha, timestamp: camionExistente.timestamp, camion: camionExistente.camion });
  if (!resultadoEliminar.ok) {
    alert('Se agregó el pedido, pero quedó un cargue viejo duplicado de "' + camionExistente.camion + '" que no se pudo borrar automáticamente (' + (resultadoEliminar.error || 'error desconocido') + '). Eliminalo a mano de la lista para no contar los pedidos dos veces.');
  }

  items.forEach(it => setMarcadorSeleccionado(it, false));
  cargueSeleccionActual.items = cargueSeleccionActual.items.filter(it => (it._cargueGrupo || 1) !== grupoId);
  if (!cargueSeleccionActual.items.length && typeof _resetGruposCargue === 'function') _resetGruposCargue();
  if (sel) sel.value = '';
  notificarCambioSeleccion();

  if (typeof refrescarSoloAsignaciones === 'function') refrescarSoloAsignaciones();
}

// Solo texto (title/option de <select> no soportan HTML) -- se usa donde
// no se puede meter el badge con clase, ver _badgeAcumulador() para el caso
// con HTML real.
function _esAcumulador(camion){
  return (typeof esCamionAcumulador === 'function') && esCamionAcumulador(camion);
}
// Badge chico junto al nombre -- a propósito bien distinto del resto (los
// acumulador se comportan distinto: quedan siempre visibles acá sin
// importar la fecha, ver computarCamionesArmados en cargue-historial.js),
// para que se note de un vistazo cuál es cuál.
function _badgeAcumulador(camion){
  return _esAcumulador(camion)
    ? '<span class="armado-acumulador" title="Acumulador: junta pedidos de varios días hasta salir con un transportista real -- por eso queda siempre visible acá, sin importar el rango de fecha">🔁 ACUMULADOR</span>'
    : '';
}

function renderCamionesArmadosHoy(){
  const cont = document.getElementById('cargue-armados');
  const selAgregar = document.getElementById('cargue-sel-camion-agregar');
  if (selAgregar) {
    selAgregar.innerHTML = '<option value="">— Agregar a camión armado —</option>' +
      cargueCamionesArmadosHoy.map((c, i) => `<option value="${i}">${c.camion}${_esAcumulador(c.camion) ? ' 🔁' : ''} (${c.pedidos.length})</option>`).join('');
  }
  if (!cont) return;
  if (!cargueCamionesArmadosHoy.length) { cont.innerHTML = '<li class="vacio">Ningún camión armado todavía.</li>'; return; }

  cont.innerHTML = cargueCamionesArmadosHoy.map((c, i) => {
    // Sin pedidosDetalle (ya se archivaron -- normal en un acumulador que
    // lleva más de un día armándose) "✏️ Editar" no tiene nada que cargar en
    // la selección (los pedidos no se pueden volver a dibujar en el mapa) --
    // se deshabilita con una pista clara en vez de dejarlo fallar en
    // silencio, y "🔀 Cambiar camión" queda como la vía real para sacarlo.
    const puedeEditar = (c.pedidosDetalle || []).length > 0;
    return `
    <li>
      <div class="armado-fila">
        <div>
          <b>${c.camion}</b>${_badgeAcumulador(c.camion)} — ${c.pedidos.length} pedidos — ${c.kilos.toFixed(1)}kg — $${c.total.toFixed(2)}
          ${c.usuario ? `<span class="armado-usuario">· ${c.usuario}</span>` : ''}
        </div>
        <div class="armado-acciones">
          <button type="button" class="armado-btn" data-idx="${i}" data-accion="cambiar" title="Cambiar de camión: mueve TODOS estos pedidos a otro camión sin tener que verlos en el mapa">🔀</button>
          <button type="button" class="armado-btn" data-idx="${i}" data-accion="editar" ${puedeEditar ? '' : 'disabled'} title="${puedeEditar ? 'Editar: carga estos pedidos en la selección para ajustarlos' : 'No se puede editar: estos pedidos ya se archivaron y no se pueden volver a ver en el mapa -- usá 🔀 Cambiar camión'}">✏️</button>
          <button type="button" class="armado-btn" data-idx="${i}" data-accion="eliminar" title="Eliminar este cargue">🗑️</button>
        </div>
      </div>
      <div class="armado-cambiar-camion" data-idx="${i}" style="display:none">
        <select class="armado-cambiar-select"></select>
        <button type="button" class="armado-cambiar-confirmar" data-idx="${i}">✓ Mover</button>
        <button type="button" class="armado-cambiar-cancelar" data-idx="${i}">✖</button>
      </div>
    </li>
  `;
  }).join('');

  cont.querySelectorAll('.armado-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const c = cargueCamionesArmadosHoy[Number(btn.dataset.idx)];
      if (!c) return;
      if (btn.dataset.accion === 'editar') editarCargueArmado(c);
      else if (btn.dataset.accion === 'eliminar') eliminarCargueArmado(c);
      else if (btn.dataset.accion === 'cambiar') abrirCambiarCamionArmado(Number(btn.dataset.idx));
    });
  });
  cont.querySelectorAll('.armado-cambiar-confirmar').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = Number(btn.dataset.idx);
      const c = cargueCamionesArmadosHoy[idx];
      const div = btn.closest('.armado-cambiar-camion');
      const select = div ? div.querySelector('.armado-cambiar-select') : null;
      const nuevoCamion = select ? select.value : '';
      if (!c || !nuevoCamion) { alert('Elegí un camión primero.'); return; }
      cambiarCamionCargueArmado(c, nuevoCamion);
    });
  });
  cont.querySelectorAll('.armado-cambiar-cancelar').forEach(btn => {
    btn.addEventListener('click', () => {
      const div = btn.closest('.armado-cambiar-camion');
      if (div) div.style.display = 'none';
    });
  });
}

// Abre el selector inline de "🔀 Cambiar camión" para un cargue armado --
// lista todos los camiones del catálogo MENOS el actual.
function abrirCambiarCamionArmado(idx){
  const cont = document.getElementById('cargue-armados');
  const div = cont ? cont.querySelector(`.armado-cambiar-camion[data-idx="${idx}"]`) : null;
  const c = cargueCamionesArmadosHoy[idx];
  if (!div || !c) return;
  const select = div.querySelector('.armado-cambiar-select');
  select.innerHTML = '<option value="">— Elegí un camión —</option>' +
    CARGUE_CAMIONES.filter(cc => cc.camion !== c.camion)
      .map(cc => `<option value="${cc.camion}">${cc.camion}${cc.acumulador ? ' 🔁' : ''}</option>`).join('');
  div.style.display = 'flex';
}

// "🔀 Cambiar camión": mueve TODOS los pedidos de este cargue a otro camión
// SIN pasar por la selección del mapa -- a diferencia de "✏️ Editar" (que
// necesita volver a ver los pedidos puntillados), acá no hace falta: sirve
// sobre todo para sacar un cargue "acumulador" (sus pedidos ya se
// archivaron, no se pueden re-seleccionar en el mapa) y pasarlo a un camión
// real de transportista. Mismo patrón de siempre: guardar el nuevo PRIMERO,
// eliminar el viejo DESPUÉS -- si falla el guardado, no se toca nada más.
async function cambiarCamionCargueArmado(c, nuevoCamion){
  if (!c.timestamp) { alert('Este cargue todavía no terminó de guardarse -- esperá unos segundos y reintentá.'); return; }

  const resultadoGuardar = await guardarCargueAsignacion({
    fecha: c.fecha, camion: nuevoCamion, pedidos: c.pedidos, geojson: c.geojson,
    kilos: c.kilos, monto: c.total, vendedores: c.vendedores,
  });
  if (!resultadoGuardar.ok) {
    alert('No se pudo cambiar de camión: ' + (resultadoGuardar.error || 'error desconocido') + '\n\nEl cargue sigue igual que antes -- podés reintentar.');
    return;
  }

  const resultadoEliminar = await eliminarCargueAsignacion({ fecha: c.fecha, timestamp: c.timestamp, camion: c.camion });
  if (!resultadoEliminar.ok) {
    alert('Se guardó en "' + nuevoCamion + '", pero quedó un cargue viejo duplicado de "' + c.camion + '" que no se pudo borrar automáticamente (' + (resultadoEliminar.error || 'error desconocido') + '). Eliminalo a mano de la lista para no contar los pedidos dos veces.');
  }

  if (typeof refrescarSoloAsignaciones === 'function') await refrescarSoloAsignaciones();
}
