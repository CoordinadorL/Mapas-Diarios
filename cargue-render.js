// ═══════════════════════════════════════════════════════════
// CARGUE-RENDER.JS — mapa base del Mapa de Cargue: init del mapa Leaflet,
// colores por vendedor, marcadores SIEMPRE individuales (sin agrupar en
// clusters -- a propósito: el filtro de línea/vendedor ya acota cuántos
// puntos hay a la vez, y se necesita ver cada cliente puntillado por
// separado, no una burbuja con un número), popup de cada pedido y leyenda.
// Segundo módulo del proyecto (después de cargue-utils/cargue-api).
// La selección por geocerca (resaltar/desresaltar un marcador) la maneja
// cargue-geocercas.js llamando a setMarcadorSeleccionado() de este módulo,
// no duplica el dibujo.
// ═══════════════════════════════════════════════════════════

const CARGUE_PALETTE = ['#4ade80','#60a5fa','#c084fc','#34d399','#f472b6','#a78bfa','#38bdf8','#2dd4bf','#818cf8','#fb923c'];

let cargueMap = null;
let cargueMarkersLayer = null;
let cargueColorMap = {};
let CARGUE_DATA = [];        // pedidos del día actualmente pintados
let CARGUE_MARKERS = [];     // [{data, marker}] -- para que geocercas.js sepa qué hay bajo cada punto

function initCargueMap(elementId){
  cargueMap = L.map(elementId).setView([-1.685,-78.644], 13);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: false
  }).addTo(cargueMap);
  cargueMap.attributionControl.setPrefix(false);
  return cargueMap;
}

function buildCargueColorMap(rows){
  cargueColorMap = {};
  [...new Set(rows.map(r => r.vendedor))].sort().forEach((v, i) => {
    cargueColorMap[v] = CARGUE_PALETTE[i % CARGUE_PALETTE.length];
  });
}

// Seleccionado se ve MUY distinto del resto a propósito (más grande, borde
// grueso, glow amarillo) -- tiene que notarse de un vistazo entre decenas de
// puntos de colores parecidos, no alcanza con solo cambiar el borde.
function makeCargueIcon(color, seleccionado){
  const borde = seleccionado ? '#fbbf24' : '#0f172a';
  const ancho = seleccionado ? 4 : 1.5;
  const tam = seleccionado ? 26 : 16;
  const sombra = seleccionado ? '0 0 0 4px rgba(251,191,36,.5), 0 2px 8px rgba(0,0,0,.6)' : '0 1px 4px rgba(0,0,0,.5)';
  return L.divIcon({
    className: '',
    html: `<div style="width:${tam}px;height:${tam}px;border-radius:50%;background:${color};border:${ancho}px solid ${borde};box-shadow:${sombra}"></div>`,
    iconSize: [tam, tam],
    iconAnchor: [tam/2, tam/2],
  });
}

function buildCarguePopup(d){
  return `<div style="font-family:system-ui;font-size:12.5px;line-height:1.5;min-width:200px">
    <b>${d.cliente || '(sin nombre)'}</b><br>
    <span style="color:#94a3b8">Pedido:</span> ${d.pedido}<br>
    <span style="color:#94a3b8">Vendedor:</span> ${d.vendedor}${d.linea ? ' ('+d.linea+')' : ''}<br>
    <span style="color:#94a3b8">Dirección:</span> ${d.direccion || '—'}<br>
    <span style="color:#94a3b8">Ventas Total:</span> $${d.ventasTotal.toFixed(2)}<br>
    <span style="color:#94a3b8">Kilos / Litros:</span> ${d.kilos} / ${d.litros}<br>
    ${d.status ? `<span style="color:#94a3b8">Status:</span> ${d.status}` : ''}
  </div>`;
}

// Pinta los pedidos filtrados. Reemplaza cualquier dibujo anterior. Sin
// clustering: cada pedido es su propio punto siempre, aunque haya muchos --
// el filtro de línea/vendedor es lo que mantiene la cantidad manejable.
function drawCarguePedidos(rows){
  if (cargueMarkersLayer) cargueMap.removeLayer(cargueMarkersLayer);
  CARGUE_DATA = rows;
  CARGUE_MARKERS = [];
  buildCargueColorMap(rows);
  buildCargueLegend(rows);

  cargueMarkersLayer = L.layerGroup();
  rows.forEach(d => {
    const color = cargueColorMap[d.vendedor] || '#888';
    const marker = L.marker([d.lat, d.lng], { icon: makeCargueIcon(color, false) })
      .bindPopup(buildCarguePopup(d), { maxWidth: 300, minWidth: 220 });
    // Clic en el punto también lo selecciona/deselecciona (además de abrir
    // el popup con el detalle) -- otra forma de armar la selección, sin
    // tener que dibujar ni buscar en la lista.
    marker.on('click', () => { if (typeof alternarClienteEnSeleccion === 'function') alternarClienteEnSeleccion(d.pedido); });
    cargueMarkersLayer.addLayer(marker);
    CARGUE_MARKERS.push({ data: d, marker, color });
  });
  cargueMap.addLayer(cargueMarkersLayer);

  if (rows.length) {
    cargueMap.fitBounds(L.latLngBounds(rows.map(d => [d.lat, d.lng])), { padding: [40, 40] });
  }
}

// Resalta/quita resalte de un marcador (lo usa cargue-geocercas.js al
// seleccionar/deseleccionar puntos, por geocerca, checkbox o clic directo).
// zIndexOffset para que un punto seleccionado siempre se vea por encima de
// los que tiene cerca, aunque se solapen.
function setMarcadorSeleccionado(item, seleccionado){
  item.marker.setIcon(makeCargueIcon(item.color, seleccionado));
  item.marker.setZIndexOffset(seleccionado ? 1000 : 0);
}

function buildCargueLegend(rows){
  const cont = document.getElementById('cargue-legend-items');
  if (!cont) return;
  const vs = [...new Set(rows.map(r => r.vendedor))].sort();
  cont.innerHTML = vs.map(v => `<div class="li"><div class="ld" style="background:${cargueColorMap[v]}"></div>${v}</div>`).join('');
}
