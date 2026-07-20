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

function renderHistCargues(){
  const cont = document.getElementById('hist-resultados');
  if (!cont) return;

  if (!HIST_CARGUES.length) {
    cont.innerHTML = '<p style="color:#64748b;font-size:.8rem;padding:10px">No hay cargues guardados en este rango de fechas.</p>';
    return;
  }

  const grupos = _agruparPorFecha(HIST_CARGUES);

  cont.innerHTML = grupos.map(g => {
    const totFacturas = g.cargues.reduce((s, c) => s + c.pedidos.length, 0);
    const totKilos = g.cargues.reduce((s, c) => s + (c.kilos || 0), 0);
    const totMonto = g.cargues.reduce((s, c) => s + (c.monto || 0), 0);
    return `
    <div class="hist-dia">
      <div class="hist-dia-header">
        <b>📅 ${g.fecha}</b>
        <span>${g.cargues.length} camión${g.cargues.length === 1 ? '' : 'es'} · ${totFacturas} facturas · ${totKilos.toFixed(1)}kg · $${totMonto.toFixed(2)}</span>
      </div>
      <div class="hist-fila hist-fila-header">
        <span>Camión</span><span>Usuario</span><span>Vendedores</span><span>Facturas</span><span>Kilos</span><span>Monto</span><span></span>
      </div>
      ${g.cargues.map(c => {
        const idx = HIST_CARGUES.indexOf(c);
        const vendedoresTexto = (c.vendedores && c.vendedores.length)
          ? c.vendedores.map(v => (typeof extraerCodigoVendedor === 'function' ? extraerCodigoVendedor(v) : v) || v).join(', ')
          : '—';
        return `
        <div class="hist-fila" data-idx="${idx}">
          <span>${c.camion}</span>
          <span class="hist-usuario">${c.usuario || '—'}</span>
          <span class="hist-vend" title="${vendedoresTexto}">${vendedoresTexto}</span>
          <span class="hist-num">${c.pedidos.length}</span>
          <span class="hist-num">${(c.kilos || 0).toFixed(1)}</span>
          <span class="hist-num hist-monto">$${(c.monto || 0).toFixed(2)}</span>
          <button type="button" class="hist-btn-mapa" data-idx="${idx}" ${c.geojson ? '' : 'disabled title="Este cargue no tiene geocerca guardada"'}>🗺️</button>
        </div>`;
      }).join('')}
    </div>`;
  }).join('');

  cont.querySelectorAll('.hist-btn-mapa').forEach(btn => {
    btn.addEventListener('click', () => {
      const c = HIST_CARGUES[Number(btn.dataset.idx)];
      if (!c) return;
      _pintarGeojsonCargue(c.geojson);
      cont.querySelectorAll('.hist-fila').forEach(f => f.classList.remove('hist-fila-activa'));
      const fila = cont.querySelector(`.hist-fila[data-idx="${btn.dataset.idx}"]`);
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
    HIST_CARGUES = await fetchCargueAsignacionesRango(desde, hasta);
    HIST_CARGUES.sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));
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
