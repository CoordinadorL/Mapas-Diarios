// ═══════════════════════════════════════════════════════════
// CARGUE-API.JS — lectura/escritura contra el backend (Apps Script), mismo
// Web App y mismo esquema JSONP que mapa-api.js, pero para los endpoints
// tipo=cargue* (CargueData.gs / CargueAsignacion.gs). Módulo independiente
// de mapa-api.js a propósito: proyectos separados, sin acoplar código.
//
// Requiere que ya existan en el scope global (definidos en cargue.html y
// en mapa-auth-sync.js, cargados antes que este script): API_URL, getToken(),
// sesionExpirada().
// ═══════════════════════════════════════════════════════════

function fetchConTimeoutCargue(url, opts, ms) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try { return fetch(url, { ...opts, signal: ctrl.signal }); }
  finally { clearTimeout(timer); }
}

// JSONP: mismo mecanismo que jsonpMapa() en mapa-api.js (evita CORS/proxies).
function jsonpCargue(qs, ms) {
  ms = ms || 25000;
  return new Promise((resolve, reject) => {
    const cb = '__cbc' + Date.now() + Math.floor(Math.random() * 100000);
    const script = document.createElement('script');
    let done = false;
    const limpiar = () => { try { delete window[cb]; } catch (e) { window[cb] = undefined; } if (script.parentNode) script.parentNode.removeChild(script); };
    const timer = setTimeout(() => { if (done) return; done = true; limpiar(); reject(new Error('Tiempo agotado')); }, ms);
    window[cb] = (data) => {
      if (done) return; done = true; clearTimeout(timer); limpiar();
      if (data && data.auth === false) { sesionExpirada(); reject(new Error(data.error || 'Sesión expirada')); return; }
      resolve(data);
    };
    script.onerror = () => { if (done) return; done = true; clearTimeout(timer); limpiar(); reject(new Error('Error de red')); };
    script.src = API_URL + '?' + qs + '&callback=' + cb + '&token=' + encodeURIComponent(getToken()) + '&t=' + Date.now();
    document.head.appendChild(script);
  });
}

// CARGUE_PEDIDOS ahora se pega tal cual lo exporta el sistema (columnas de
// más incluidas: HoraCreacion, Ruta, Cajas, Empresa, Clavecorr, Serie,
// Nrodoc, Prove -- se ignoran a propósito, ni se leen). Las que sí importan:
// Fecha, Vendedor, Pedido, Cliente, Direccion, Kilos, Ventas Total,
// longitud_x, latitud_y.
//  - Vendedor se guarda COMPLETO ("F131-HARO JEFFERSON") -- el tooltip de
//    cada punto lo necesita así (buildCarguePopup). En todo lo demás donde
//    el espacio aprieta (chips de Vendedores, lista de Clientes, leyenda del
//    mapa, columna Vendedores del resumen) se muestra solo el código con
//    extraerCodigoVendedor(v) al momento de renderizar, sin tocar el dato
//    de fondo (cargue-historial.js/cargue-lista-clientes.js/cargue-render.js
//    /cargue-resumen.js).
//  - Pedido ahora es el número de documento real (ej. "79 001 VI 98051"),
//    no el contador 1,2,3... de antes -- sigue siendo el identificador
//    único de fila puertas adentro (selección, asignación a camión,
//    archivado diario), pero ya NO se muestra en el resumen: es solo el
//    número de ingreso al sistema, no un dato de negocio.
//  - Cliente viene como "Código + Sucursal + Razón social" (mismo código
//    puede repetirse en más de una sucursal) -- se deja tal cual llega.
//  - Ventas Netas y Status no se leen: no se usan en ningún lado, así que
//    se sacan del todo en vez de traerlos sin usarlos.
//  - Litros SÍ se lee (historial-cargues.html lo usa para los vendedores de
//    línea ICE, que venden por litros y no solo por kilos) -- ver
//    _detalleVendedoresHtml en historial-cargues.js.
function _mapCarguePedidoRow(row) {
  return {
    fecha: ffCargue(gfCargue(row, 'Fecha', 'fecha')),
    vendedor: String(gfCargue(row, 'Vendedor', 'vendedor')).trim(),
    pedido: String(gfCargue(row, 'Pedido', 'pedido')).trim(),
    cliente: String(gfCargue(row, 'Cliente', 'cliente')).trim(),
    direccion: String(gfCargue(row, 'Direccion', 'direccion', 'Dirección')).trim(),
    kilos: pnCargue(gfCargue(row, 'Kilos', 'kilos')),
    litros: pnCargue(gfCargue(row, 'Litros', 'litros')),
    ventasTotal: pnCargue(gfCargue(row, 'Ventas Total', 'ventas_total')),
    lat: pnCargue(gfCargue(row, 'latitud_y', 'Latitud', 'latitud', 'lat')),
    lng: pnCargue(gfCargue(row, 'longitud_x', 'Longitud', 'longitud', 'lng')),
  };
}
// Fechas distintas con pedidos en CARGUE_PEDIDOS (liviano, solo la columna
// Fecha) -- lo usa el botón "📋 Ver atrasados" para saber cuál es el pedido
// pendiente más antiguo sin tener que adivinar una fecha a mano.
async function fetchCargueFechas() {
  const r = await jsonpCargue('tipo=cargue_fechas', 20000);
  return Array.isArray(r) ? r : [];
}

// Última corrida exitosa del archivado diario (backend/CargueArchivado.gs)
// -- para avisar en el tablero si el disparador se dejó de ejecutar, en vez
// de que nadie se entere hasta que CARGUE_PEDIDOS vuelva a crecer solo.
// Si falla la consulta, no es motivo para romper nada más: se trata como
// "sin dato" y no se avisa (mejor no avisar que avisar mal).
async function fetchCargueSaludArchivado() {
  try {
    const r = await jsonpCargue('tipo=cargue_salud_archivado', 10000);
    return (r && r.ultimoDiario) || null;
  } catch (e) {
    return null;
  }
}

// Por rango de fechas (desde/hasta) -- lo usa cargue-historial.js para el
// selector "Desde/Hasta".
async function fetchCarguePedidosRango(desde, hasta) {
  const qs = 'tipo=cargue&desde=' + encodeURIComponent(desde) + '&hasta=' + encodeURIComponent(hasta);
  const raw = await jsonpCargue(qs, 25000);
  if (!Array.isArray(raw)) return [];
  return raw.map(_mapCarguePedidoRow).filter(r => r.lat !== 0 && r.lng !== 0 && r.pedido);
}

// Catálogo de camiones/choferes (hoja "Cod Camión"), para el selector del
// panel de asignación -- lista fija, no texto libre.
async function fetchCargueCamiones() {
  const r = await jsonpCargue('tipo=cargue_camiones', 20000);
  return Array.isArray(r) ? r : [];
}

// Catálogo de líneas por vendedor (columnas E-F-G de "Cod Camión").
async function fetchCargueLineas() {
  const r = await jsonpCargue('tipo=cargue_lineas', 20000);
  return Array.isArray(r) ? r : [];
}

function _mapCargueAsignacionRow(row) {
  let pedidos = [], geojson = null, vendedores = [];
  try { pedidos = JSON.parse(row.Pedidos || '[]'); } catch (e) {}
  try { geojson = JSON.parse(row.GeoJSON || 'null'); } catch (e) {}
  try { vendedores = JSON.parse(row.Vendedores || '[]'); } catch (e) {}
  return {
    fecha: row.Fecha, camion: row.Camion, pedidos, geojson, usuario: row.Usuario, timestamp: row.Timestamp,
    // Kilos/Monto/Vendedores: columnas agregadas después -- filas viejas no
    // las tienen, de ahí los valores por defecto (0 / []) en vez de undefined.
    kilos: Number(row.Kilos) || 0, monto: Number(row.Monto) || 0, vendedores,
  };
}
// Asignaciones (camiones) ya guardadas para un rango de fechas, con sus geocercas.
async function fetchCargueAsignacionesRango(desde, hasta) {
  const qs = 'tipo=cargue_asignacion&desde=' + encodeURIComponent(desde) + '&hasta=' + encodeURIComponent(hasta);
  const raw = await jsonpCargue(qs, 25000);
  return Array.isArray(raw) ? raw.map(_mapCargueAsignacionRow) : [];
}

// TODAS las asignaciones guardadas, sin límite de fecha -- para saber qué
// pedidos ya están asignados a algún camión (pedidosAsignados(), ver
// cargue-historial.js) y para la lista "Camiones armados". A propósito NO
// se filtra por el rango Desde/Hasta que se está viendo: la columna Fecha
// de un cargue es la del RANGO que se veía al armarlo, no necesariamente la
// de cada pedido adentro (un cargue armado viendo "20/07 al 21/07" puede
// tener pedidos de ambos días bajo Fecha=20/07) -- filtrar por rango hacía
// que esos pedidos parecieran "sin asignar" en cuanto se mira solo el
// 21/07, y que camiones "acumulado" (que juntan pedidos de fechas
// distintas a lo largo del tiempo, ver hoja "Cod Camión") desaparecieran
// de la lista de armados según qué rango se estuviera mirando.
async function fetchCargueAsignacionesTodas() {
  return fetchCargueAsignacionesRango('', '');
}

// Eliminar un cargue guardado DE VERDAD (botón 🗑️, o al confirmar una
// edición) -- se borra la fila del Sheet, no se marca. Se identifica por
// Timestamp. A diferencia de guardar/plantillas, esto SÍ va por JSONP (no
// POST no-cors): es una acción destructiva, hace falta poder leer si
// realmente funcionó en vez de asumirlo -- devuelve {ok, error} de verdad.
async function eliminarCargueAsignacion({ fecha, timestamp, camion }) {
  const qs = 'tipo=cargue_asignacion_eliminar'
    + '&timestamp=' + encodeURIComponent(timestamp)
    + '&fecha=' + encodeURIComponent(fecha || '')
    + '&camion=' + encodeURIComponent(camion || '');
  try {
    return await jsonpCargue(qs, 15000);
  } catch (e) {
    return { ok: false, error: e.message || 'Sin respuesta del servidor.' };
  }
}

// Guardar una agrupación -- vía JSONP (no POST no-cors, a diferencia de
// como era antes): un guardado fire-and-forget que fallara en silencio
// podía perder pedidos sin que nadie se entere, sobre todo combinado con
// flujos que primero eliminan un cargue viejo (ver guardarSeleccionActual /
// agregarSeleccionACamionArmado en cargue-panel-asignacion.js). Devuelve
// {ok, error} de verdad, mismo contrato que eliminarCargueAsignacion.
//
// pedidos/geojson/vendedores van pre-serializados con JSON.stringify()
// porque viajan en la URL, no en un body -- el backend
// (tipo=cargue_asignacion_guardar) los acepta igual vengan como string (este
// caso) o como array/objeto ya deserializado. kilos/monto se calculan en el
// llamador (cargue-panel-asignacion.js) a partir de los pedidos ya en
// memoria y se guardan tal cual, como caché para historial-cargues.html.
async function guardarCargueAsignacion({ fecha, camion, pedidos, geojson, kilos, monto, vendedores }) {
  const qs = 'tipo=cargue_asignacion_guardar'
    + '&fecha=' + encodeURIComponent(fecha || '')
    + '&camion=' + encodeURIComponent(camion || '')
    + '&pedidos=' + encodeURIComponent(JSON.stringify(pedidos || []))
    + '&geojson=' + encodeURIComponent(JSON.stringify(geojson || null))
    + '&kilos=' + encodeURIComponent(kilos || 0)
    + '&monto=' + encodeURIComponent(monto || 0)
    + '&vendedores=' + encodeURIComponent(JSON.stringify(vendedores || []));

  // Salvavidas: una URL demasiado larga (cargue con muchísimos pedidos)
  // puede comportarse de formas raras según el navegador/servidor -- mejor
  // avisar claro y sugerir partir el cargue en dos con "🆕 Nuevo cargue"
  // que arriesgar un envío que quizás ni llegue.
  if (qs.length > 6000) {
    return { ok: false, error: 'Este cargue tiene demasiados pedidos para guardarlo de una vez (' + (pedidos || []).length + '). Partilo en dos con "🆕 Nuevo cargue" y guardá cada parte por separado.' };
  }

  try {
    return await jsonpCargue(qs, 20000);
  } catch (e) {
    return { ok: false, error: e.message || 'Sin respuesta del servidor.' };
  }
}

// Plantillas de geocerca (sectores fijos guardados con nombre, reusables día
// a día -- no son un cargue armado, solo la forma del polígono).
async function fetchCarguePlantillas() {
  const r = await jsonpCargue('tipo=cargue_plantillas', 20000);
  return Array.isArray(r) ? r : [];
}
function guardarCarguePlantilla({ nombre, geojson }) {
  const payload = { tipo: 'cargue_plantilla', token: getToken(), nombre, geojson };
  return fetchConTimeoutCargue(API_URL, {
    method: 'POST', mode: 'no-cors',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(payload),
  }, 12000);
}
