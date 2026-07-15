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
//  - Vendedor viene como "F131-HARO JEFFERSON" (código+nombre completo) --
//    se recorta a los primeros 5 caracteres ("F131-", el código de 4 más el
//    guion) porque el nombre completo no hace falta en ningún lado del
//    tablero. extraerCodigoVendedor() (cargue-utils.js) sigue funcionando
//    igual sobre el valor ya recortado.
//  - Pedido ahora es el número de documento real (ej. "79 001 VI 98051"),
//    no el contador 1,2,3... de antes -- sigue siendo el identificador
//    único de fila puertas adentro (selección, asignación a camión,
//    archivado diario), pero ya NO se muestra en el resumen: es solo el
//    número de ingreso al sistema, no un dato de negocio.
//  - Cliente viene como "Código + Sucursal + Razón social" (mismo código
//    puede repetirse en más de una sucursal) -- se deja tal cual llega.
//  - Litros, Ventas Netas y Status ya no se leen: no se usan en ningún
//    lado más que el resumen, así que se sacan del todo en vez de traerlos
//    sin usarlos.
function _mapCarguePedidoRow(row) {
  return {
    fecha: ffCargue(gfCargue(row, 'Fecha', 'fecha')),
    vendedor: String(gfCargue(row, 'Vendedor', 'vendedor')).trim().slice(0, 5),
    pedido: String(gfCargue(row, 'Pedido', 'pedido')).trim(),
    cliente: String(gfCargue(row, 'Cliente', 'cliente')).trim(),
    direccion: String(gfCargue(row, 'Direccion', 'direccion', 'Dirección')).trim(),
    kilos: pnCargue(gfCargue(row, 'Kilos', 'kilos')),
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
  let pedidos = [], geojson = null;
  try { pedidos = JSON.parse(row.Pedidos || '[]'); } catch (e) {}
  try { geojson = JSON.parse(row.GeoJSON || 'null'); } catch (e) {}
  return { fecha: row.Fecha, camion: row.Camion, pedidos, geojson, usuario: row.Usuario, timestamp: row.Timestamp };
}
// Asignaciones (camiones) ya guardadas para un rango de fechas, con sus geocercas.
async function fetchCargueAsignacionesRango(desde, hasta) {
  const qs = 'tipo=cargue_asignacion&desde=' + encodeURIComponent(desde) + '&hasta=' + encodeURIComponent(hasta);
  const raw = await jsonpCargue(qs, 25000);
  return Array.isArray(raw) ? raw.map(_mapCargueAsignacionRow) : [];
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

// Guardar una agrupación. Fire-and-forget (no-cors: Apps Script no siempre
// responde con headers legibles en POST) -- mismo patrón que el resto del
// proyecto (ver Avance/Cuadre/Geo). Validar los campos ANTES de llamar esto,
// porque no se puede leer un {ok:false} de vuelta.
function guardarCargueAsignacion({ fecha, camion, pedidos, geojson }) {
  const payload = { tipo: 'cargue_asignacion', token: getToken(), fecha, camion, pedidos, geojson };
  return fetchConTimeoutCargue(API_URL, {
    method: 'POST', mode: 'no-cors',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(payload),
  }, 12000);
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
