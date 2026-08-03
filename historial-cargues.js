// ═══════════════════════════════════════════════════════════
// HISTORIAL-CARGUES.JS — reporte de solo lectura: todos los cargues armados
// en cualquier rango de fechas pasado, agrupados por día, con su geocerca
// guardada. A diferencia del panel "Camiones armados hoy" de cargue.html
// (que cruza cada cargue en vivo contra CARGUE_PEDIDOS_TODOS), acá se
// muestran los totales CACHEADOS al momento de guardar (columnas
// Kilos/Monto/Vendedores de CARGUE_ASIGNACION, ver CargueAsignacion.gs) --
// necesario porque el archivado diario mueve los pedidos resueltos de
// CARGUE_PEDIDOS al histórico anual al día siguiente, así que este reporte
// no puede depender de que el pedido siga vivo en la hoja de trabajo para
// reconstruir esos números.
// ═══════════════════════════════════════════════════════════

let HIST_MAPA = null;
let HIST_CAPA_GEOJSON = null;
let HIST_CARGUES = [];
let HIST_PEDIDOS_TODOS = []; // pedidos vivos del rango buscado -- para recalcular kilos/monto reales y el desglose por vendedor (ver _detalleDeCargue)
let HIST_LINEAS_MAP = {}; // código de vendedor -> línea (catálogo de "Cod Camión"), para saber quién es ICE (ver _esVendedorIce)

function initHistCarguesMapa(contenedorId){
  HIST_MAPA = L.map(contenedorId, { zoomControl: true }).setView([-1.6, -78.6], 6);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '&copy; OpenStreetMap',
  }).addTo(HIST_MAPA);
}

// Dibuja (o borra, si geojson es null) la geocerca del cargue tocado. Solo
// una a la vez -- ver una forma reemplaza la anterior, no las acumula.
function _pintarGeojsonCargue(geojson){
  const vacio = document.getElementById('hist-map-vacio');
  const mapaEl = document.getElementById('hist-map');
  if (HIST_CAPA_GEOJSON) { HIST_MAPA.removeLayer(HIST_CAPA_GEOJSON); HIST_CAPA_GEOJSON = null; }
  if (!geojson) {
    if (vacio) vacio.style.display = '';
    if (mapaEl) mapaEl.style.display = 'none';
    return;
  }
  if (vacio) vacio.style.display = 'none';
  if (mapaEl) mapaEl.style.display = '';
  HIST_CAPA_GEOJSON = L.geoJSON(geojson, { style: { color: '#a855f7', weight: 2, fillOpacity: .15 } }).addTo(HIST_MAPA);
  setTimeout(() => {
    HIST_MAPA.invalidateSize();
    try { HIST_MAPA.fitBounds(HIST_CAPA_GEOJSON.getBounds(), { padding: [20, 20] }); } catch (e) {}
  }, 0);
}

function _agruparPorFecha(cargues){
  const porFecha = {};
  cargues.forEach(c => { (porFecha[c.fecha] = porFecha[c.fecha] || []).push(c); });
  return Object.keys(porFecha).sort().reverse().map(fecha => ({ fecha, cargues: porFecha[fecha] }));
}

// Cruza un cargue con HIST_PEDIDOS_TODOS (pedidos vivos del rango buscado)
// para sacar kilos/monto/vendedores REALES y el detalle pedido por pedido --
// mismo patrón que computarCamionesArmados en cargue-historial.js. Si no se
// encuentran TODOS los pedidos del cargue (ya se archivaron, o caen fuera
// del rango Desde/Hasta elegido acá), cae a los totales CACHEADOS en la
// propia fila de CARGUE_ASIGNACION -- sin desglose por vendedor posible en
// ese caso (ver _detalleVendedoresHtml).
function _detalleDeCargue(c){
  const pedidosDelCargue = HIST_PEDIDOS_TODOS.filter(p => c.pedidos.includes(p.pedido));
  const detalleCompleto = c.pedidos.length > 0 && pedidosDelCargue.length === c.pedidos.length;
  return {
    kilos: detalleCompleto ? pedidosDelCargue.reduce((s, p) => s + p.kilos, 0) : (c.kilos || 0),
    monto: detalleCompleto ? pedidosDelCargue.reduce((s, p) => s + p.ventasTotal, 0) : (c.monto || 0),
    vendedores: detalleCompleto ? [...new Set(pedidosDelCargue.map(p => p.vendedor))].sort() : (c.vendedores || []),
    pedidosDetalle: detalleCompleto ? pedidosDelCargue : [],
  };
}

function _agruparPorVendedor(pedidosDetalle){
  const porVendedor = {};
  pedidosDetalle.forEach(p => { (porVendedor[p.vendedor] = porVendedor[p.vendedor] || []).push(p); });
  return porVendedor;
}

// Los vendedores de la línea ICE venden por litros, no por kilos -- se
// clasifican por HIST_LINEAS_MAP (catálogo de "Cod Camión", columnas E-F-G,
// ver CargueCamiones.gs). Comparación sin mayúsculas/espacios por las dudas
// de cómo se haya tipeado en la hoja.
function _esVendedorIce(vendedorCompleto){
  const codigo = (typeof extraerCodigoVendedor === 'function' ? extraerCodigoVendedor(vendedorCompleto) : '') || vendedorCompleto;
  return String(HIST_LINEAS_MAP[codigo] || '').trim().toUpperCase() === 'ICE';
}

// HTML del desplegable de un cargue: un <details> por vendedor con sus
// pedidos, o un aviso si el cargue ya se archivó y no hay forma de
// reconstruir el detalle pedido por pedido sin ir al histórico anual.
function _detalleVendedoresHtml(c, detalle){
  if (!detalle.pedidosDetalle.length) {
    if (!(c.pedidos || []).length) return '';
    return '<p class="hist-sin-detalle">Este cargue ya se archivó (los pedidos pasaron al histórico anual) o cae fuera del rango buscado — no hay detalle pedido por pedido acá. Los totales de arriba sí son los reales, guardados al armar el cargue.</p>';
  }
  const porVendedor = _agruparPorVendedor(detalle.pedidosDetalle);
  return Object.keys(porVendedor).sort().map(v => {
    const pedidosDelVendedor = porVendedor[v];
    const totalVendedor = pedidosDelVendedor.reduce((s, p) => s + p.ventasTotal, 0);
    const codigo = (typeof extraerCodigoVendedor === 'function' ? extraerCodigoVendedor(v) : '') || v;
    const esIce = _esVendedorIce(v);
    const totalLitros = esIce ? pedidosDelVendedor.reduce((s, p) => s + (p.litros || 0), 0) : 0;
    return `
    <details class="rcd-vendedor">
      <summary>
        <span class="rcd-caret"></span>
        <b>${codigo}</b>
        <span class="rcd-vendedor-total">${pedidosDelVendedor.length} pedido${pedidosDelVendedor.length === 1 ? '' : 's'} — $${totalVendedor.toFixed(2)}${esIce ? ` — ${totalLitros.toFixed(1)}L` : ''}</span>
      </summary>
      <ul>
        ${pedidosDelVendedor.map(p => `<li>${p.cliente || '(sin nombre)'} — ${p.direccion || '—'} — $${p.ventasTotal.toFixed(2)} · ${p.kilos.toFixed(1)}kg${esIce ? ' · ' + (p.litros || 0).toFixed(1) + 'L' : ''}</li>`).join('')}
      </ul>
    </details>`;
  }).join('');
}

function renderHistCargues(){
  const cont = document.getElementById('hist-resultados');
  if (!cont) return;

  if (!HIST_CARGUES.length) {
    cont.innerHTML = '<p style="color:#64748b;font-size:.8rem;padding:10px">No hay cargues guardados en este rango de fechas.</p>';
    return;
  }

  const grupos = _agruparPorFecha(HIST_CARGUES);

  cont.innerHTML = grupos.map(g => {
    const detallesGrupo = g.cargues.map(c => _detalleDeCargue(c));
    const totFacturas = g.cargues.reduce((s, c) => s + c.pedidos.length, 0);
    const totKilos = detallesGrupo.reduce((s, d) => s + d.kilos, 0);
    const totMonto = detallesGrupo.reduce((s, d) => s + d.monto, 0);
    return `
    <div class="hist-dia">
      <div class="hist-dia-header">
        <b>📅 ${g.fecha}</b>
        <span>${g.cargues.length} camión${g.cargues.length === 1 ? '' : 'es'} · ${totFacturas} facturas · ${totKilos.toFixed(1)}kg · $${totMonto.toFixed(2)}</span>
      </div>
      <div class="hist-fila hist-fila-header">
        <span></span><span>Camión</span><span>Vendedores</span><span>Facturas</span><span>Kilos</span><span>Monto</span><span></span>
      </div>
      ${g.cargues.map((c, i) => {
        const idx = HIST_CARGUES.indexOf(c);
        const detalle = detallesGrupo[i];
        const vendedoresTexto = detalle.vendedores.length
          ? detalle.vendedores.map(v => (typeof extraerCodigoVendedor === 'function' ? extraerCodigoVendedor(v) : v) || v).join(', ')
          : '—';
        return `
        <details class="hist-fila-detalle" data-idx="${idx}">
          <summary class="hist-fila">
            <span class="hist-caret"></span>
            <span>${c.camion}${c.usuario ? `<br><small class="hist-usuario">armado por ${c.usuario}</small>` : ''}</span>
            <span class="hist-vend" title="${vendedoresTexto}">${vendedoresTexto}</span>
            <span class="hist-num">${c.pedidos.length}</span>
            <span class="hist-num">${detalle.kilos.toFixed(1)}</span>
            <span class="hist-num hist-monto">$${detalle.monto.toFixed(2)}</span>
            <button type="button" class="hist-btn-mapa" data-idx="${idx}" ${c.geojson ? '' : 'disabled title="Este cargue no tiene geocerca guardada"'}>🗺️</button>
          </summary>
          <div class="hist-detalle">${_detalleVendedoresHtml(c, detalle)}</div>
        </details>`;
      }).join('')}
    </div>`;
  }).join('');

  cont.querySelectorAll('.hist-btn-mapa').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation();
      const c = HIST_CARGUES[Number(btn.dataset.idx)];
      if (!c) return;
      _pintarGeojsonCargue(c.geojson);
      cont.querySelectorAll('.hist-fila-detalle').forEach(f => f.classList.remove('hist-fila-activa'));
      const fila = cont.querySelector(`.hist-fila-detalle[data-idx="${btn.dataset.idx}"]`);
      if (fila) fila.classList.add('hist-fila-activa');
    });
  });
}

async function buscarHistCargues(){
  const desde = document.getElementById('hist-fecha-desde').value;
  const hasta = document.getElementById('hist-fecha-hasta').value;
  if (!desde || !hasta) { alert('Elegí un rango Desde/Hasta.'); return; }
  const cont = document.getElementById('hist-resultados');
  if (cont) cont.innerHTML = '<p style="color:#64748b;font-size:.8rem;padding:10px">Cargando...</p>';
  _pintarGeojsonCargue(null);
  try {
    // El catálogo de líneas (para saber quién es ICE) es chico y no depende
    // del rango de fechas -- se trae una sola vez y se reusa en cada Buscar.
    if (!Object.keys(HIST_LINEAS_MAP).length) {
      const lineasRows = await fetchCargueLineas();
      HIST_LINEAS_MAP = construirLineasMap(lineasRows);
    }
    const [asignaciones, pedidos] = await Promise.all([
      fetchCargueAsignacionesRango(desde, hasta),
      fetchCarguePedidosRango(desde, hasta),
    ]);
    HIST_CARGUES = asignaciones;
    HIST_CARGUES.sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));
    HIST_PEDIDOS_TODOS = pedidos;
  } catch (e) {
    if (cont) cont.innerHTML = '<p style="color:#f87171;font-size:.8rem;padding:10px">Error al consultar: ' + (e.message || e) + '</p>';
    return;
  }
  renderHistCargues();
}

// Rango por defecto: últimos 7 días (incluye hoy) -- suficiente para
// arrancar viendo algo sin tener que elegir fechas a mano, y liviano.
function initHistCarguesFiltro(){
  const hoy = new Date();
  const hace7 = new Date(hoy.getTime() - 7 * 86400000);
  const fmt = (d) => {
    const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };
  document.getElementById('hist-fecha-desde').value = fmt(hace7);
  document.getElementById('hist-fecha-hasta').value = fmt(hoy);
  document.getElementById('hist-btn-buscar').addEventListener('click', buscarHistCargues);
}
