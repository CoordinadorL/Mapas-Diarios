// ═══════════════════════════════════════════════════════════
// CARGUE-GEOCERCAS.JS — dueño de la selección actual de pedidos (cargueSeleccionActual).
// Formas de armarla:
//  - Dibujar un polígono libre (Leaflet.draw + punto-en-polígono puro de
//    cargue-utils.js). Modo SUMAR (default): el polígono AGREGA a lo que ya
//    había. Modo RESTAR: el polígono QUITA de la selección actual lo que
//    caiga adentro. El toggle lo maneja setCargueModoResta().
//  - Marcar/desmarcar un cliente uno por uno desde la lista
//    (cargue-lista-clientes.js llama a alternarClienteEnSeleccion) -- suma o
//    quita ese único punto, sin tocar el resto.
//  - "Seleccionar todo lo visible" -- agrega todo lo que entra en el
//    encuadre actual del mapa, sin dibujar nada.
//  - Cargar una plantilla guardada (cargue-plantillas.js) -- dibuja ese
//    polígono y aplica sumar/restar igual que si lo hubieras trazado a mano.
//
// GRUPOS (cargueGrupoActivo): la selección puede contener más de un "cargue"
// a la vez -- cada item queda tagueado con item._cargueGrupo (número). Por
// default todo cae en el grupo 1 (comportamiento de siempre, sin cambios
// visibles). "🆕 Nuevo cargue" (nuevoGrupoCargue(), llamado desde
// cargue-panel-asignacion.js) congela el grupo activo y abre uno nuevo --
// así se puede dibujar el polígono de la ZONA 2 sin que sus pedidos se
// mezclen con los de la ZONA 1 en el mismo total. cargue-panel-asignacion.js
// es quien decide qué hacer con cada grupo (mostrarlo aparte, guardarlo con
// su propio camión).
//
// No arma el panel ni guarda nada -- al cambiar la selección llama a
// onCargueSeleccionCambio(seleccion), que define cargue-panel-asignacion.js
// (mismo patrón de "funciones que se llaman entre módulos por scope global"
// que ya usa mapa-render.js con buildPopup()).
// ═══════════════════════════════════════════════════════════

let cargueDrawnItems = null;
let cargueSeleccionActual = { poligono: null, items: [] };
let cargueModoResta = false;
let cargueGrupoActivo = 1;             // a qué grupo se suman los próximos pedidos
let cargueGrupoPoligonos = { 1: null }; // grupo -> último polígono dibujado en ese grupo (referencia visual al editar)

function initCargueGeocercas(){
  cargueDrawnItems = new L.FeatureGroup();
  cargueMap.addLayer(cargueDrawnItems);

  const drawControl = new L.Control.Draw({
    draw: {
      polygon: { allowIntersection: false, showArea: true, shapeOptions: { color: '#fbbf24' } },
      marker: false, circle: false, circlemarker: false, rectangle: false, polyline: false
    },
    edit: { featureGroup: cargueDrawnItems, remove: false }
  });
  cargueMap.addControl(drawControl);

  cargueMap.on(L.Draw.Event.CREATED, (e) => {
    cargueDrawnItems.clearLayers(); // una sola forma visible a la vez (referencia), la SELECCIÓN sí acumula
    cargueDrawnItems.addLayer(e.layer);
    if (cargueModoResta) restarPorPoligono(e.layer); else sumarPorPoligono(e.layer);
  });
  cargueMap.on(L.Draw.Event.EDITED, (e) => {
    e.layers.eachLayer(layer => { if (cargueModoResta) restarPorPoligono(layer); else sumarPorPoligono(layer); });
  });

  const btnSumar = document.getElementById('cargue-modo-sumar');
  const btnRestar = document.getElementById('cargue-modo-restar');
  if (btnSumar) btnSumar.addEventListener('click', () => setCargueModoResta(false));
  if (btnRestar) btnRestar.addEventListener('click', () => setCargueModoResta(true));

  const btnVisible = document.getElementById('cargue-btn-seleccionar-visible');
  if (btnVisible) btnVisible.addEventListener('click', seleccionarTodoVisible);
}

function setCargueModoResta(activo){
  cargueModoResta = activo;
  const btnSumar = document.getElementById('cargue-modo-sumar');
  const btnRestar = document.getElementById('cargue-modo-restar');
  if (btnSumar) btnSumar.classList.toggle('activo', !activo);
  if (btnRestar) btnRestar.classList.toggle('activo', activo);
}

function sumarPorPoligono(layer){
  const poligono = layer.getLatLngs()[0].map(ll => [ll.lat, ll.lng]);
  const nuevos = CARGUE_MARKERS.filter(item => puntoEnPoligono(item.data.lat, item.data.lng, poligono) && !cargueSeleccionActual.items.includes(item));
  nuevos.forEach(item => { item._cargueGrupo = cargueGrupoActivo; setMarcadorSeleccionado(item, true); });
  cargueSeleccionActual.items.push(...nuevos);
  cargueSeleccionActual.poligono = poligono;
  cargueGrupoPoligonos[cargueGrupoActivo] = poligono;
  notificarCambioSeleccion();
}

function restarPorPoligono(layer){
  const poligono = layer.getLatLngs()[0].map(ll => [ll.lat, ll.lng]);
  const aQuitar = cargueSeleccionActual.items.filter(item => puntoEnPoligono(item.data.lat, item.data.lng, poligono));
  aQuitar.forEach(item => {
    setMarcadorSeleccionado(item, false);
    const idx = cargueSeleccionActual.items.indexOf(item);
    if (idx >= 0) cargueSeleccionActual.items.splice(idx, 1);
  });
  cargueSeleccionActual.poligono = poligono;
  notificarCambioSeleccion();
}

// Agrega todo lo que entra en el encuadre actual del mapa, sin dibujar nada.
// Siempre suma (ignora el toggle sumar/restar -- "seleccionar" no "quitar").
function seleccionarTodoVisible(){
  const bounds = cargueMap.getBounds();
  const nuevos = CARGUE_MARKERS.filter(item => bounds.contains([item.data.lat, item.data.lng]) && !cargueSeleccionActual.items.includes(item));
  nuevos.forEach(item => { item._cargueGrupo = cargueGrupoActivo; setMarcadorSeleccionado(item, true); });
  cargueSeleccionActual.items.push(...nuevos);
  notificarCambioSeleccion();
}

// "🆕 Nuevo cargue": congela el grupo activo (a partir de ahora se muestra
// aparte, con su propio selector de camión, en la lista de seleccionados) y
// abre uno nuevo -- lo próximo que se dibuje/marque cae ahí, sin mezclarse
// con lo que ya había. No hace nada si el grupo activo todavía está vacío
// (nada que congelar, evita saltar a "Cargue 2" sin necesidad).
function nuevoGrupoCargue(){
  const hayAlgoEnGrupoActivo = cargueSeleccionActual.items.some(it => (it._cargueGrupo || 1) === cargueGrupoActivo);
  if (!hayAlgoEnGrupoActivo) return;
  cargueGrupoActivo++;
  cargueGrupoPoligonos[cargueGrupoActivo] = null;
  notificarCambioSeleccion();
}

// Vuelve todo al estado "un solo cargue" -- se llama al limpiar la selección
// entera o cuando se termina de guardar el último grupo pendiente.
function _resetGruposCargue(){
  cargueGrupoActivo = 1;
  cargueGrupoPoligonos = { 1: null };
}

// Dibuja el polígono de una plantilla guardada (cargue-plantillas.js) y le
// aplica el modo sumar/restar activo, igual que si se hubiera trazado a mano.
function cargarPlantillaComoGeocerca(geojson){
  if (!cargueDrawnItems || !Array.isArray(geojson) || !geojson.length) return;
  cargueDrawnItems.clearLayers();
  const layer = L.polygon(geojson, { color: '#fbbf24' });
  cargueDrawnItems.addLayer(layer);
  if (cargueModoResta) restarPorPoligono(layer); else sumarPorPoligono(layer);
}

// Recarga en la selección los pedidos de un cargue ya guardado (botón
// "✏️ Editar" en cargue-panel-asignacion.js). A diferencia de
// aplicarFiltrosYPintar(), NO limpia la selección antes de pintar -- la
// arma directo con exactamente esos pedidos, sin importar si sus vendedores
// están marcados en los chips ahora mismo (los fuerza a activos para que se
// vean en el mapa). El polígono original se redibuja como referencia, si
// vino guardado.
function prepararEdicionCargue(pedidos, geojson){
  // Editar es siempre UN solo cargue -- si había otros grupos pendientes sin
  // guardar de una sesión de "🆕 Nuevo cargue" anterior, se pierden acá (se
  // reemplaza toda la selección por la de este cargue puntual).
  _resetGruposCargue();

  const vendedoresNecesarios = [...new Set(CARGUE_PEDIDOS_TODOS.filter(p => pedidos.includes(p.pedido)).map(p => p.vendedor))];
  vendedoresNecesarios.forEach(v => CARGUE_VENDEDORES_ACTIVOS.add(v));
  if (typeof renderVendedorChips === 'function') renderVendedorChips();

  // cargueModoEdicion ya está seteado (editarCargueArmado lo hace antes de
  // llamar acá), así que pedidosAsignados() no oculta los pedidos de ESTE
  // cargue -- solo los de cualquier otro.
  const asignados = (typeof pedidosAsignados === 'function') ? pedidosAsignados() : new Set();
  const filtrados = CARGUE_PEDIDOS_TODOS.filter(p => CARGUE_VENDEDORES_ACTIVOS.has(p.vendedor) && !asignados.has(p.pedido));
  drawCarguePedidos(filtrados);
  if (typeof renderListaClientes === 'function') renderListaClientes(filtrados);

  const items = CARGUE_MARKERS.filter(m => pedidos.includes(m.data.pedido));
  items.forEach(item => { item._cargueGrupo = 1; setMarcadorSeleccionado(item, true); });
  cargueSeleccionActual = { poligono: geojson || null, items };
  cargueGrupoPoligonos[1] = geojson || null;

  if (cargueDrawnItems) {
    cargueDrawnItems.clearLayers();
    if (Array.isArray(geojson) && geojson.length) cargueDrawnItems.addLayer(L.polygon(geojson, { color: '#fbbf24' }));
  }
  notificarCambioSeleccion();
}

// Marca/desmarca UN pedido (checkbox de cargue-lista-clientes.js o clic en
// el marcador del mapa, ver cargue-render.js). Suma o quita sobre la
// selección actual, no la reemplaza.
function alternarClienteEnSeleccion(pedidoId){
  const item = CARGUE_MARKERS.find(it => it.data.pedido === pedidoId);
  if (!item) return;
  const idx = cargueSeleccionActual.items.findIndex(it => it.data.pedido === pedidoId);
  if (idx >= 0) {
    setMarcadorSeleccionado(item, false);
    cargueSeleccionActual.items.splice(idx, 1);
  } else {
    item._cargueGrupo = cargueGrupoActivo;
    setMarcadorSeleccionado(item, true);
    cargueSeleccionActual.items.push(item);
  }
  notificarCambioSeleccion();
}

// Marca/desmarca VARIOS pedidos de una (checkbox "seleccionar todos" de un
// vendedor, cargue-lista-clientes.js) -- una sola notificación al final en
// vez de una por pedido.
function seleccionarVarios(pedidoIds, marcar){
  pedidoIds.forEach(pedidoId => {
    const item = CARGUE_MARKERS.find(it => it.data.pedido === pedidoId);
    if (!item) return;
    const idx = cargueSeleccionActual.items.indexOf(item);
    if (marcar && idx < 0) {
      item._cargueGrupo = cargueGrupoActivo;
      setMarcadorSeleccionado(item, true);
      cargueSeleccionActual.items.push(item);
    } else if (!marcar && idx >= 0) {
      setMarcadorSeleccionado(item, false);
      cargueSeleccionActual.items.splice(idx, 1);
    }
  });
  notificarCambioSeleccion();
}

function estaSeleccionado(pedidoId){
  return cargueSeleccionActual.items.some(it => it.data.pedido === pedidoId);
}

function limpiarResaltado(){
  cargueSeleccionActual.items.forEach(item => setMarcadorSeleccionado(item, false));
}

// Borra la geocerca dibujada y la selección (botón "Limpiar" del panel).
function limpiarCargueGeocerca(){
  if (cargueDrawnItems) cargueDrawnItems.clearLayers();
  limpiarResaltado();
  cargueSeleccionActual = { poligono: null, items: [] };
  _resetGruposCargue();
  notificarCambioSeleccion();
}

function notificarCambioSeleccion(){
  if (typeof onCargueSeleccionCambio === 'function') onCargueSeleccionCambio(cargueSeleccionActual);
  if (typeof actualizarChecksListaClientes === 'function') actualizarChecksListaClientes();
}
