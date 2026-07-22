// ═══════════════════════════════════════════════════════════
// CARGUE-HISTORIAL.JS — filtros del mapa de cargue: rango de fechas
// (Desde/Hasta), línea (multi, dropdown con checkboxes) y vendedores
// (multi, chips, acotados a la línea elegida -- no aparece nada hasta que
// se elige línea, para no abrumar con ~150 códigos de una). Elegir línea(s)
// AUTO-marca sus vendedores; el usuario puede después seguir ajustando
// vendedores a mano SIN que un refresco de datos (cambiar fecha, botón
// Actualizar) le pise esos ajustes -- solo cambiar la línea reinicia la
// selección de vendedores.
//
// Dueño de todo el pipeline pedidos-crudos -> filtrados -> dibujados.
// También pinta las geocercas ya guardadas del rango activo (estáticas, no
// editables).
//
// MODO VIVO vs HISTÓRICO: si HOY cae dentro del rango [Desde,Hasta], se
// puede dibujar/marcar/guardar (aunque el rango incluya días atrasados,
// para poder armar un cargue con pedidos viejos + los de hoy). Si HOY no
// cae en el rango, es una consulta de solo lectura.
// ═══════════════════════════════════════════════════════════

let CARGUE_VENDEDORES_DISPONIBLES = [];
let CARGUE_VENDEDORES_ACTIVOS = new Set();
let CARGUE_PEDIDOS_TODOS = [];  // pedidos crudos+línea del rango activo, SIN filtrar por vendedor
let CARGUE_PEDIDOS_ATIPICOS = new Set(); // "Pedido" que parecen fuera de la ruta habitual (ver cargue-utils.js)
let CARGUE_LINEAS_ACTIVAS = new Set(); // vacío = ninguna línea elegida (vendedores no muestran nada)
let cargueLineaPorVendedor = {};       // vendedor (tal cual en CARGUE_PEDIDOS) -> línea
let cargueLineasMap = {};              // código de vendedor -> línea (catálogo)
let cargueHistorialLayer = null;

// Un cargue puede mezclar pedidos de varios días del rango (ej. atrasados +
// hoy) -- se guarda siempre bajo la fecha de HOY (el día en que se arma el
// cargue), no bajo la fecha original del pedido.
// Un cargue puede mezclar pedidos de varios días del rango (ej. atrasados +
// hoy) -- se guarda bajo el día MÁS RECIENTE del rango activo (Hasta). En
// el caso normal (modo vivo) Hasta suele ser hoy, así que esto no cambia
// nada -- pero si bodega/coordinador está armando un cargue puntualmente
// sobre un rango histórico (ver puedeCargueEditarHistorico), se guarda con
// la fecha de ESE rango en vez de la fecha real de hoy -- si no, el cargue
// recién armado quedaría fuera de "Camiones armados" hasta ampliar el
// rango hasta hoy, aunque se acabara de guardar bien.
function obtenerCargueFechaActiva(){ return obtenerRangoFechas().hasta; }

function hoyCargueStr(){
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

// Recuerda rango de fechas + líneas elegidas entre sesiones (para no
// arrancar de cero cada vez que se abre cargue.html). Los vendedores NO se
// guardan acá -- se re-derivan solos de la línea guardada al recargar.
const CARGUE_FILTROS_KEY = 'cargueFiltrosGuardados';
function guardarFiltrosCargue(){
  try {
    localStorage.setItem(CARGUE_FILTROS_KEY, JSON.stringify({
      desde: document.getElementById('cargue-fecha-desde')?.value || '',
      hasta: document.getElementById('cargue-fecha-hasta')?.value || '',
      lineas: [...CARGUE_LINEAS_ACTIVAS],
    }));
  } catch (e) {}
}
function cargarFiltrosCargueGuardados(){
  try { return JSON.parse(localStorage.getItem(CARGUE_FILTROS_KEY) || 'null'); } catch (e) { return null; }
}

function obtenerRangoFechas(){
  const hoy = hoyCargueStr();
  const inDesde = document.getElementById('cargue-fecha-desde');
  const inHasta = document.getElementById('cargue-fecha-hasta');
  let desde = (inDesde && inDesde.value) || hoy;
  let hasta = (inHasta && inHasta.value) || hoy;
  if (desde > hasta) { const t = desde; desde = hasta; hasta = t; } // por si los cruzan sin querer
  return { desde, hasta };
}

function esCargueModoHistorico(){
  const { desde, hasta } = obtenerRangoFechas();
  const hoy = hoyCargueStr();
  return !(desde <= hoy && hoy <= hasta);
}

// Bodega y coordinador pueden armar/editar cargues aunque el rango elegido
// sea puramente histórico (no incluya HOY) -- por ejemplo, para resolver de
// una vez los pedidos pendientes de un día atrasado puntual, sin tener que
// mezclarlos con los de hoy ampliando el rango. Mismo criterio de negocio
// que ya se usa para "editar histórico" en el resto del proyecto (ver
// ROLES_EDITAR_HISTORICO en Auth.gs) -- admin queda afuera a propósito,
// misma decisión ya tomada ahí.
const ROLES_CARGUE_EDITAR_HISTORICO = ['bodega', 'coordinador'];
function puedeCargueEditarHistorico(){
  const s = (typeof getSesion === 'function') ? getSesion() : null;
  return !!(s && ROLES_CARGUE_EDITAR_HISTORICO.includes(s.rol));
}

function initFechaRango(){
  const hoy = hoyCargueStr();
  const guardado = cargarFiltrosCargueGuardados();
  const inDesde = document.getElementById('cargue-fecha-desde');
  const inHasta = document.getElementById('cargue-fecha-hasta');
  if (inDesde) {
    inDesde.max = hoy;
    inDesde.value = (guardado && guardado.desde) || hoy;
    inDesde.addEventListener('change', () => { guardarFiltrosCargue(); actualizarCargueClientesConFeedback(); });
  }
  if (inHasta) {
    inHasta.max = hoy;
    inHasta.value = (guardado && guardado.hasta) || hoy;
    inHasta.addEventListener('change', () => { guardarFiltrosCargue(); actualizarCargueClientesConFeedback(); });
  }
}

async function initCargueHistorial(){
  cargueHistorialLayer = new L.LayerGroup().addTo(cargueMap);

  const guardado = cargarFiltrosCargueGuardados();
  if (guardado && Array.isArray(guardado.lineas)) CARGUE_LINEAS_ACTIVAS = new Set(guardado.lineas);

  initFechaRango();
  // Catálogo de líneas y pedidos del rango EN PARALELO (antes era en serie y
  // sumaba varios segundos de espera extra en cada carga de la página).
  await Promise.all([cargarCatalogoLineas(), actualizarCargueClientes()]);

  verificarSaludArchivadoDiario(); // no bloquea el resto de la carga
}

// Avisa si el archivado automático de CARGUE_PEDIDOS (backend/
// CargueArchivado.gs, corre solo todos los días ~3am) lleva demasiado sin
// ejecutarse -- 36h de margen sobre el ciclo diario normal, para no
// disparar el aviso por una corrida que arrancó un poco tarde. Sin dato
// (nunca corrió, o falló la consulta) NO avisa -- mejor no alarmar de más
// que avisar mal.
async function verificarSaludArchivadoDiario(){
  const banner = document.getElementById('cargue-aviso-archivado-atrasado');
  if (!banner) return;
  const ultimo = await fetchCargueSaludArchivado();
  if (!ultimo) { banner.style.display = 'none'; return; }
  const horas = (Date.now() - new Date(ultimo).getTime()) / 3600000;
  if (horas > 36) {
    banner.style.display = 'block';
    banner.textContent = `⚠️ El archivado automático de pedidos no corrió en las últimas ${Math.floor(horas / 24)} día(s) -- avisale al admin.`;
  } else {
    banner.style.display = 'none';
  }
}

// Carga (o recarga) el catálogo de líneas y pinta el dropdown. Si la llamada
// falla (timeout, sin señal), NO tumba el resto de la página: deja el
// dropdown vacío y se vuelve a intentar solo en el próximo "Actualizar" --
// antes un fallo acá dejaba "Elegí una línea" muerto hasta recargar todo.
async function cargarCatalogoLineas(){
  try {
    const lineasRows = await fetchCargueLineas();
    cargueLineasMap = construirLineasMap(lineasRows);
  } catch (e) {
    cargueLineasMap = {};
  }
  const lineasDisponibles = [...new Set(Object.values(cargueLineasMap))].filter(Boolean).sort();
  CARGUE_LINEAS_ACTIVAS = new Set([...CARGUE_LINEAS_ACTIVAS].filter(l => lineasDisponibles.includes(l))); // por si el catálogo cambió
  renderLineaDropdown(lineasDisponibles);
}

// Vendedores que corresponde MOSTRAR ahora mismo: los de las líneas activas.
// Sin línea elegida, ninguno (a propósito -- evita el muro de ~150 chips).
function vendedoresVisibles(){
  if (!CARGUE_LINEAS_ACTIVAS.size) return [];
  return CARGUE_VENDEDORES_DISPONIBLES.filter(v => CARGUE_LINEAS_ACTIVAS.has(cargueLineaPorVendedor[v]));
}

// Un vendedor sin línea en el catálogo "Cod Camión" no aparece en NINGUNA
// línea -- sus pedidos quedan invisibles en todo el tablero sin ningún
// error ni aviso (vendedoresVisibles() los excluye de todas). Este aviso
// hace visible ese hueco en vez de que se note recién cuando alguien
// pregunte "¿y los pedidos de tal vendedor?".
function renderAvisoVendedoresSinLinea(){
  const badge = document.getElementById('cargue-aviso-sin-linea');
  if (!badge) return;
  const sinLinea = CARGUE_VENDEDORES_DISPONIBLES.filter(v => !cargueLineaPorVendedor[v]);
  if (!sinLinea.length) { badge.style.display = 'none'; return; }
  badge.style.display = 'flex';
  badge.textContent = `⚠️ ${sinLinea.length} sin línea`;
  badge.title = 'No están en el catálogo "Cod Camión" -- sus pedidos no aparecen en ninguna línea:\n' + sinLinea.join(', ');
}

function renderVendedorChips(){
  const cont = document.getElementById('cargue-chips-vendedor');
  const contador = document.getElementById('cargue-vendedor-contador');
  if (!cont) return;
  const visibles = vendedoresVisibles();
  // La leyenda VEND refleja el catálogo COMPLETO de la línea elegida (no
  // solo los pedidos dibujados ahora), con su color ya fijo -- así no
  // cambia al tildar/destildar vendedores de la lista de abajo. Se llama
  // acá porque renderVendedorChips() se re-ejecuta justo cuando cambia el
  // universo de vendedores (línea nueva, refresco de datos), pero NO en
  // cada clic individual de un chip.
  if (typeof buildCargueLegend === 'function') buildCargueLegend(visibles);
  if (!visibles.length) {
    cont.className = 'chips vacio-hint';
    cont.textContent = CARGUE_LINEAS_ACTIVAS.size ? 'Sin vendedores para esa línea.' : 'Elegí una línea para ver sus vendedores.';
    if (contador) contador.textContent = '';
    return;
  }
  if (contador) {
    const marcados = visibles.filter(v => CARGUE_VENDEDORES_ACTIVOS.has(v)).length;
    contador.textContent = `(${marcados}/${visibles.length})`;
  }
  cont.className = 'chips';
  cont.innerHTML = '';

  if (visibles.length > 1) {
    const todos = document.createElement('label');
    const marcarTodos = () => visibles.every(v => CARGUE_VENDEDORES_ACTIVOS.has(v));
    todos.className = 'cargue-chip' + (marcarTodos() ? ' sel' : '');
    todos.innerHTML = '<input type="checkbox"> Todos/Ninguno';
    todos.addEventListener('click', (e) => {
      e.preventDefault();
      if (marcarTodos()) visibles.forEach(v => CARGUE_VENDEDORES_ACTIVOS.delete(v));
      else visibles.forEach(v => CARGUE_VENDEDORES_ACTIVOS.add(v));
      renderVendedorChips();
      aplicarFiltrosYPintar();
    });
    cont.appendChild(todos);
  }

  visibles.forEach(v => {
    const chip = document.createElement('label');
    chip.className = 'cargue-chip' + (CARGUE_VENDEDORES_ACTIVOS.has(v) ? ' sel' : '');
    // Solo el código acá (el chip aprieta espacio) -- v sigue siendo el
    // vendedor completo por dentro (selección/filtro), solo cambia la
    // etiqueta visible. La leyenda VEND sí muestra el nombre completo.
    chip.innerHTML = `<input type="checkbox"> ${extraerCodigoVendedor(v) || v}`;
    chip.addEventListener('click', (e) => {
      e.preventDefault();
      if (CARGUE_VENDEDORES_ACTIVOS.has(v)) CARGUE_VENDEDORES_ACTIVOS.delete(v); else CARGUE_VENDEDORES_ACTIVOS.add(v);
      chip.classList.toggle('sel', CARGUE_VENDEDORES_ACTIVOS.has(v));
      aplicarFiltrosYPintar();
    });
    cont.appendChild(chip);
  });
}

// Dropdown con checkboxes (no un <select> nativo, no soporta multi-selección
// prolija) para elegir una o varias líneas. Elegir línea(s) reinicia la
// selección de vendedores a "todos los de esa línea" -- es una acción
// deliberada del usuario, a diferencia de un refresco de datos.
function renderLineaDropdown(lineas){
  const btn = document.getElementById('cargue-dropdown-linea-btn');
  const panel = document.getElementById('cargue-dropdown-linea-panel');
  if (!btn || !panel) return;

  panel.innerHTML = lineas.map(l => `
    <label><input type="checkbox" value="${l}" ${CARGUE_LINEAS_ACTIVAS.has(l) ? 'checked' : ''}> ${l}</label>
  `).join('');
  panel.querySelectorAll('input[type=checkbox]').forEach(chk => {
    chk.addEventListener('change', () => {
      if (chk.checked) CARGUE_LINEAS_ACTIVAS.add(chk.value); else CARGUE_LINEAS_ACTIVAS.delete(chk.value);
      actualizarBotonLineaDropdown();
      guardarFiltrosCargue();
      aplicarSeleccionLineas();
    });
  });
  actualizarBotonLineaDropdown();

  if (!btn.dataset.wired) {
    btn.dataset.wired = '1';
    btn.addEventListener('click', (e) => { e.stopPropagation(); panel.classList.toggle('open'); });
    panel.addEventListener('click', (e) => e.stopPropagation());
    document.addEventListener('click', () => panel.classList.remove('open'));
  }
}

function actualizarBotonLineaDropdown(){
  const btn = document.getElementById('cargue-dropdown-linea-btn');
  if (!btn) return;
  const n = CARGUE_LINEAS_ACTIVAS.size;
  const etiqueta = n === 0 ? 'Elegí una línea' : n === 1 ? [...CARGUE_LINEAS_ACTIVAS][0] : n + ' líneas';
  btn.textContent = etiqueta + ' ▾';
}

// Se llama SOLO cuando cambia el checkbox de línea: reinicia vendedores a
// "todos los de la línea elegida" (reemplaza cualquier ajuste manual previo).
function aplicarSeleccionLineas(){
  CARGUE_VENDEDORES_ACTIVOS = new Set(vendedoresVisibles());
  renderVendedorChips();
  aplicarFiltrosYPintar();
}

// Vuelve a consultar el Sheet para el rango de fechas activo (botón
// "Actualizar clientes", cambio de Desde/Hasta). Si el Sheet no responde
// (sin señal, token vencido, etc.) avisa con alert() en vez de fallar en
// silencio -- antes un error acá dejaba el botón "sin hacer nada".
async function actualizarCargueClientes(){
  try {
    await _actualizarCargueClientesInterno();
  } catch (e) {
    alert('No se pudo actualizar: ' + (e.message || e));
  }
}

async function _actualizarCargueClientesInterno(){
  const { desde, hasta } = obtenerRangoFechas();
  const historico = esCargueModoHistorico();
  // Bodega/coordinador ignoran el "solo lectura" del modo histórico -- ver
  // puedeCargueEditarHistorico().
  const soloLectura = historico && !puedeCargueEditarHistorico();

  // Si el catálogo de líneas quedó vacío (falló en la carga inicial), se
  // reintenta acá -- así el botón Actualizar también "revive" el dropdown.
  if (!Object.keys(cargueLineasMap).length) await cargarCatalogoLineas();

  const [pedidosCrudos, asignacionesRango, asignacionesTodas] = await Promise.all([
    fetchCarguePedidosRango(desde, hasta),
    fetchCargueAsignacionesRango(desde, hasta),
    fetchCargueAsignacionesTodas(),
  ]);
  CARGUE_PEDIDOS_TODOS = aplicarLineaVendedor(pedidosCrudos, cargueLineasMap);

  // Independiente del filtro de vendedores activos -- se recalcula solo
  // cuando cambian los pedidos del rango, no en cada tilde/destilde.
  CARGUE_PEDIDOS_ATIPICOS = (typeof detectarCarguePedidosFueraDeRuta === 'function')
    ? detectarCarguePedidosFueraDeRuta(CARGUE_PEDIDOS_TODOS) : new Set();

  CARGUE_VENDEDORES_DISPONIBLES = [...new Set(CARGUE_PEDIDOS_TODOS.map(p => p.vendedor))].sort();
  cargueLineaPorVendedor = {};
  CARGUE_PEDIDOS_TODOS.forEach(p => { cargueLineaPorVendedor[p.vendedor] = p.linea; });
  renderAvisoVendedoresSinLinea();

  // Un refresco de datos NO reinicia lo que el usuario ya venía ajustando a
  // mano -- solo se filtra a lo que sigue siendo visible con los datos
  // nuevos, y si quedó vacío (primera carga de esa línea) se pre-marca todo.
  const visibles = vendedoresVisibles();
  CARGUE_VENDEDORES_ACTIVOS = new Set([...CARGUE_VENDEDORES_ACTIVOS].filter(v => visibles.includes(v)));
  if (CARGUE_LINEAS_ACTIVAS.size && !CARGUE_VENDEDORES_ACTIVOS.size && visibles.length) {
    CARGUE_VENDEDORES_ACTIVOS = new Set(visibles);
  }
  renderVendedorChips();

  // Se calcula ANTES de pintar: aplicarFiltrosYPintar() necesita saber qué
  // pedidos ya están asignados a algún camión para no volver a mostrarlos.
  // Con TODAS las asignaciones (sin límite de fecha) -- ver
  // fetchCargueAsignacionesTodas().
  cargueCamionesArmadosHoy = computarCamionesArmados(asignacionesTodas);
  renderCamionesArmadosHoy();

  aplicarFiltrosYPintar();
  // Las geocercas dibujadas sobre el mapa sí quedan acotadas al rango
  // Desde/Hasta que se está viendo -- mostrar TODAS las de siempre sería
  // puro ruido visual (a diferencia de "qué pedidos ya están asignados",
  // que si necesita ser sin límite de fecha, ver arriba).
  dibujarAsignacionesGuardadas(asignacionesRango);
  activarModoEdicion(!soloLectura);

  const aviso = document.getElementById('cargue-modo-aviso');
  if (aviso) aviso.style.display = soloLectura ? 'block' : 'none';
}

// Arma la lista "camiones armados" a partir de las asignaciones crudas del
// backend (SIEMPRE todas, sin límite de fecha -- ver
// fetchCargueAsignacionesTodas), cruzando con CARGUE_PEDIDOS_TODOS para
// sacar kilos/vendedores. Separado de _actualizarCargueClientesInterno para
// poder reusarlo en refrescarSoloAsignaciones() sin tener que volver a
// pedir los pedidos.
//
// El cruce en vivo se queda corto en cuanto el archivado diario
// (CargueArchivado.gs) mueve los pedidos RESUELTOS de un cargue a el
// histórico anual -- pasa un solo día después de armarlo, así que hasta un
// cargue "de hace 2 días" puede no encontrar ninguno de sus pedidos acá. En
// ese caso (cruce incompleto) se usan los totales que quedaron CACHEADOS en
// la propia fila de CARGUE_ASIGNACION al momento de guardar (columnas
// Kilos/Monto/Vendedores, ver CargueAsignacion.gs) en vez de mostrar 0 --
// el detalle pedido por pedido (pedidosDetalle) sí se pierde en ese caso: no
// hay forma de reconstruirlo sin ir al histórico anual (ver
// historial-cargues.html para el reporte que si contempla eso).
function computarCamionesArmados(asignaciones){
  return asignaciones.map(a => {
    const pedidosDelCamion = CARGUE_PEDIDOS_TODOS.filter(p => a.pedidos.includes(p.pedido));
    const detalleCompleto = pedidosDelCamion.length === a.pedidos.length;
    return {
      camion: a.camion, pedidos: a.pedidos, fecha: a.fecha, timestamp: a.timestamp, geojson: a.geojson,
      usuario: a.usuario || '',
      kilos: detalleCompleto ? pedidosDelCamion.reduce((s, p) => s + p.kilos, 0) : (a.kilos || 0),
      total: detalleCompleto ? pedidosDelCamion.reduce((s, p) => s + p.ventasTotal, 0) : (a.monto || 0),
      vendedores: detalleCompleto ? [...new Set(pedidosDelCamion.map(p => p.vendedor))].sort() : (a.vendedores || []),
      // Objetos completos (cliente, dirección, monto...), no solo los IDs --
      // para que el resumen (cargue-resumen.js) pueda desplegar el detalle
      // pedido por pedido de cualquier camión sin tener que refiltrar. Queda
      // vacío si ya se archivó (ver comentario arriba).
      pedidosDetalle: pedidosDelCamion,
    };
  });
}

// Refresco liviano: solo vuelve a pedir las ASIGNACIONES (no los pedidos ni
// los filtros de vendedor/línea), para usar después de guardar/editar/
// eliminar un cargue. A diferencia de aplicarFiltrosYPintar(), NO limpia la
// selección en progreso -- solo repinta qué pedidos siguen disponibles
// (algunos recién se ocultaron por asignados, otros recién se liberaron por
// un eliminar) y vuelve a armar la selección actual contra los marcadores
// nuevos (mismos pedidos, por id).
async function refrescarSoloAsignaciones(){
  try {
    const { desde, hasta } = obtenerRangoFechas();
    const [asignacionesRango, asignacionesTodas] = await Promise.all([
      fetchCargueAsignacionesRango(desde, hasta),
      fetchCargueAsignacionesTodas(),
    ]);
    dibujarAsignacionesGuardadas(asignacionesRango);
    cargueCamionesArmadosHoy = computarCamionesArmados(asignacionesTodas);
    renderCamionesArmadosHoy();
    repintarConservandoSeleccion();
  } catch (e) {
    console.error('No se pudieron refrescar los cargues guardados:', e);
  }
}

// Pedidos que ya están en algún camión guardado y por eso no corresponde
// mostrarlos como disponibles -- salvo los del cargue que se está editando
// en este momento (cargueModoEdicion), que se deja ver igual para poder
// ajustarlo.
function pedidosAsignados(){
  const excepcion = (typeof cargueModoEdicion !== 'undefined' && cargueModoEdicion) ? new Set(cargueModoEdicion.pedidos) : new Set();
  const asignados = new Set();
  cargueCamionesArmadosHoy.forEach(c => c.pedidos.forEach(p => { if (!excepcion.has(p)) asignados.add(p); }));
  return asignados;
}

// Repinta el mapa/lista con el filtro actual, PERO conserva la selección en
// progreso (a diferencia de aplicarFiltrosYPintar). Se usa después de un
// guardar/editar/eliminar en segundo plano, para no perder lo que el
// usuario venía armando para OTRO camión mientras tanto.
function repintarConservandoSeleccion(){
  const pedidosSeleccionados = cargueSeleccionActual.items.map(it => it.data.pedido);
  // drawCarguePedidos reconstruye CARGUE_MARKERS de cero (objetos nuevos) --
  // hay que guardar a mano a qué grupo pertenecía cada pedido (ver "🆕 Nuevo
  // cargue" en cargue-geocercas.js) para no perder la distinción al
  // reasignar la selección sobre los marcadores nuevos.
  const grupoPorPedido = new Map(cargueSeleccionActual.items.map(it => [it.data.pedido, it._cargueGrupo || 1]));
  const asignados = pedidosAsignados();
  const filtrados = CARGUE_PEDIDOS_TODOS.filter(p => CARGUE_VENDEDORES_ACTIVOS.has(p.vendedor) && !asignados.has(p.pedido));
  drawCarguePedidos(filtrados);
  if (typeof renderListaClientes === 'function') renderListaClientes(filtrados);

  const items = CARGUE_MARKERS.filter(m => pedidosSeleccionados.includes(m.data.pedido));
  items.forEach(item => { item._cargueGrupo = grupoPorPedido.get(item.data.pedido) || 1; setMarcadorSeleccionado(item, true); });
  cargueSeleccionActual.items = items;
  notificarCambioSeleccion();
}

// Botón "📋 Ver atrasados": desde que CARGUE_PEDIDOS ya no se archiva por
// antigüedad (ver backend/CargueArchivado.gs -- un pedido pendiente se
// queda activo para siempre hasta que se asigna a un camión), puede haber
// pedidos viejos "escondidos" fuera del rango Desde/Hasta de hoy. En vez de
// que el coordinador tenga que adivinar y escribir una fecha vieja a mano,
// esto trae la fecha real más antigua que exista (fetchCargueFechas(), el
// mismo endpoint cargue_fechas del backend) y arma el rango con eso.
async function verPendientesAtrasados(){
  const btn = document.getElementById('cargue-btn-pendientes-atrasados');
  const textoOriginal = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = '📋 Buscando...'; }
  try {
    const fechas = await fetchCargueFechas();
    if (!fechas.length) { alert('No hay pedidos registrados en CARGUE_PEDIDOS todavía.'); return; }
    const masAntigua = fechas.slice().sort()[0];
    const hoy = hoyCargueStr();
    const inDesde = document.getElementById('cargue-fecha-desde');
    const inHasta = document.getElementById('cargue-fecha-hasta');
    if (inDesde) inDesde.value = masAntigua;
    if (inHasta) inHasta.value = hoy;
    guardarFiltrosCargue();
    await actualizarCargueClientesConFeedback();
  } catch (e) {
    alert('No se pudo consultar las fechas disponibles: ' + (e.message || e));
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = textoOriginal; }
  }
}

// Wrapper del botón "🔄 Actualizar clientes" (y de los inputs Desde/Hasta):
// da feedback visible (antes no se notaba si el click hacía algo cuando los
// datos no habían cambiado).
async function actualizarCargueClientesConFeedback(){
  const btn = document.getElementById('cargue-btn-actualizar');
  if (!btn) { actualizarCargueClientes(); return; }
  const textoOriginal = btn.textContent;
  btn.disabled = true;
  btn.textContent = '🔄 Actualizando...';
  await actualizarCargueClientes();
  btn.textContent = '✅ Actualizado';
  setTimeout(() => { btn.textContent = textoOriginal; btn.disabled = false; }, 1200);
}

// Filtra por vendedor activo (la línea ya hizo su trabajo marcando esos
// vendedores) y por no estar ya asignado a un camión guardado, y repinta
// mapa + lista. Sin vendedores activos, no se pinta nada -- a propósito,
// evita el default de "1500+ puntos de una".
function aplicarFiltrosYPintar(){
  const asignados = pedidosAsignados();
  const filtrados = CARGUE_PEDIDOS_TODOS.filter(p => CARGUE_VENDEDORES_ACTIVOS.has(p.vendedor) && !asignados.has(p.pedido));
  const aviso = document.getElementById('cargue-vacio-mapa');
  if (aviso) aviso.style.display = CARGUE_VENDEDORES_ACTIVOS.size ? 'none' : 'block';

  const stat = document.getElementById('cargue-stat-vivo');
  if (stat) {
    const total = filtrados.reduce((s, p) => s + p.ventasTotal, 0);
    stat.textContent = `🧾 ${filtrados.length} facturas · $${total.toFixed(2)}`;
  }

  limpiarCargueGeocerca(); // el set de puntos cambió, evita seleccion "fantasma"
  drawCarguePedidos(filtrados);
  if (typeof renderListaClientes === 'function') renderListaClientes(filtrados);
}

// Pinta las geocercas ya guardadas del rango activo como polígonos estáticos.
function dibujarAsignacionesGuardadas(asignaciones){
  cargueHistorialLayer.clearLayers();
  asignaciones.forEach((a, i) => {
    if (!a.geojson) return;
    const color = CARGUE_PALETTE[i % CARGUE_PALETTE.length];
    L.polygon(a.geojson, { color, weight: 2, fillOpacity: 0.12 })
      .bindTooltip(`${a.camion} — ${a.pedidos.length} pedidos`)
      .addTo(cargueHistorialLayer);
  });
}

// Modo vivo (HOY dentro del rango activo): permite dibujar/marcar/guardar.
// Modo histórico: solo ver.
function activarModoEdicion(activo){
  const panel = document.getElementById('cargue-panel-guardar');
  if (panel) panel.style.display = activo ? 'block' : 'none';
  const drawToolbar = document.querySelector('.leaflet-draw');
  if (drawToolbar) drawToolbar.style.display = activo ? '' : 'none';
  if (!activo) {
    // Si estaba editando un cargue (✏️) y el rango pasa a histórico, salir
    // del modo edición también -- no tiene sentido "editar" algo que ya no
    // se puede guardar.
    if (typeof cancelarModoEdicion === 'function') cancelarModoEdicion();
    else limpiarCargueGeocerca();
  }
}
