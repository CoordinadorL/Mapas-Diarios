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
//
// COLOR POR VENDEDOR (colorParaVendedorCargue): es un color FIJO, calculado
// a partir del propio código del vendedor -- no de su posición dentro de la
// lista de pedidos dibujados en este momento. Antes se armaba con
// buildCargueColorMap(rows) por índice ordenado alfabéticamente de lo
// VISIBLE ahora mismo, así que al tildar/destildar un vendedor todos los
// colores se corrían (y con más de 10 vendedores, la paleta se repetía por
// el módulo). Ver la función más abajo para el detalle del algoritmo.
// ═══════════════════════════════════════════════════════════

// CARGUE_PALETTE queda para lo que ya la usaba antes (colorear los polígonos
// de cargues guardados en cargue-historial.js, por índice de cargue -- no
// tiene relación con el color de un vendedor).
const CARGUE_PALETTE = ['#4ade80','#60a5fa','#c084fc','#34d399','#f472b6','#a78bfa','#38bdf8','#2dd4bf','#818cf8','#fb923c'];

let cargueMap = null;
let cargueMarkersLayer = null;
let CARGUE_DATA = [];        // pedidos del día actualmente pintados
let CARGUE_MARKERS = [];     // [{data, marker, color, atipico}] -- para que geocercas.js sepa qué hay bajo cada punto
let cargueMostrarFueraDeRuta = false; // apagado por defecto al cargar (botón junto al cuadro VEND)

function initCargueMap(elementId){
  cargueMap = L.map(elementId).setView([-1.685,-78.644], 13);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: false
  }).addTo(cargueMap);
  cargueMap.attributionControl.setPrefix(false);
  return cargueMap;
}

// Hash simple (djb2) del código de vendedor -> número estable. Determinista
// por el texto del código en sí, nunca por su posición en ninguna lista --
// así "F250" siempre hashea al mismo número sin importar qué otros
// vendedores estén activos, en qué orden se cargó el catálogo, o cuántos
// haya en total.
function _hashCodigoVendedorCargue(v){
  let h = 5381;
  const s = String(v || '');
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h;
}

// Color HSL fijo por vendedor. Ángulo dorado (137.508°) para repartir el
// tono (hue) lo más lejos posible entre códigos consecutivos del hash -- es
// la misma técnica que se usa para generar N colores bien distinguibles sin
// límite de cuántos vendedores haya. Además alterna banda VIVA (bien
// saturada, más oscura) y PASTEL (clara, suave) según la paridad del hash:
// así dos vendedores con un tono parecido (dos azules, por ejemplo) también
// caen en un brillo distinto y no se confunden a simple vista.
function colorParaVendedorCargue(v){
  const h = _hashCodigoVendedorCargue(v);
  const hue = (h * 137.508) % 360;
  const esVivo = h % 2 === 0;
  const sat = esVivo ? 78 : 60;
  const lum = esVivo ? 48 : 74;
  return `hsl(${hue.toFixed(1)}, ${sat}%, ${lum}%)`;
}

// Seleccionado se ve MUY distinto del resto a propósito (más grande, borde
// grueso, glow amarillo) -- tiene que notarse de un vistazo entre decenas de
// puntos de colores parecidos, no alcanza con solo cambiar el borde.
//
// alerta=true (solo cuando cargueMostrarFueraDeRuta está activo Y el pedido
// quedó marcado por detectarCarguePedidosFueraDeRuta) dibuja un ⚠️ DENTRO
// del mismo círculo de color -- a propósito no se cambia el color ni se
// agrega un anillo aparte: con el botón apagado el punto se ve 100% normal,
// y con el botón prendido alcanza con mirar adentro del punto para saber si
// ese cliente está OK o posiblemente cargado en el día equivocado.
function makeCargueIcon(color, seleccionado, alerta){
  const borde = seleccionado ? '#fbbf24' : '#0f172a';
  const ancho = seleccionado ? 4 : 1.5;
  const tam = seleccionado ? 26 : 16;
  const sombra = seleccionado ? '0 0 0 4px rgba(251,191,36,.5), 0 2px 8px rgba(0,0,0,.6)' : '0 1px 4px rgba(0,0,0,.5)';
  const advertencia = alerta
    ? `<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:${Math.round(tam * 0.62)}px;line-height:1;filter:drop-shadow(0 0 1px #000)">⚠️</div>`
    : '';
  return L.divIcon({
    className: '',
    html: `<div style="position:relative;width:${tam}px;height:${tam}px;border-radius:50%;background:${color};border:${ancho}px solid ${borde};box-shadow:${sombra}">${advertencia}</div>`,
    iconSize: [tam, tam],
    iconAnchor: [tam/2, tam/2],
  });
}

// DD-MM-AAAA para mostrar -- d.fecha ya viene normalizada a AAAA-MM-DD
// desde cargue-api.js (el formato que se usa para filtrar/comparar rangos
// de fechas en todo el resto del tablero). Esto SOLO cambia cómo se ve acá,
// no toca el dato real ni el filtro Desde/Hasta.
function _fechaCargueDisplay(fechaIso){
  const m = String(fechaIso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : (fechaIso || '—');
}

// Se muestra en un tooltip al PASAR el mouse (no en un popup al hacer
// clic) -- el clic quedó reservado 100% para seleccionar/deseleccionar, sin
// que una ventanita tape el mapa de por medio.
//
// "Pedido" (el número de documento real) NO se muestra a propósito -- es
// solo el número de ingreso al sistema, no un dato útil para armar cargues
// (ver cargue-api.js). Litros/Ventas Netas/Status tampoco se leen más.
function buildCarguePopup(d, alerta){
  return `<div style="font-family:system-ui;font-size:12.5px;line-height:1.5;min-width:180px">
    ${alerta ? '<div style="color:#fca5a5;font-weight:700;margin-bottom:4px">⚠️ Posible pedido fuera de ruta</div>' : ''}
    <b>${d.cliente || '(sin nombre)'}</b><br>
    <span style="color:#94a3b8">Fecha:</span> ${_fechaCargueDisplay(d.fecha)}<br>
    <span style="color:#94a3b8">Vendedor:</span> ${d.vendedor}${d.linea ? ' ('+d.linea+')' : ''}<br>
    <span style="color:#94a3b8">Dirección:</span> ${d.direccion || '—'}<br>
    <span style="color:#94a3b8">Ventas Total:</span> $${d.ventasTotal.toFixed(2)}<br>
    <span style="color:#94a3b8">Kilos:</span> ${d.kilos}
  </div>`;
}

// Pinta los pedidos filtrados. Reemplaza cualquier dibujo anterior. Sin
// clustering: cada pedido es su propio punto siempre, aunque haya muchos --
// el filtro de línea/vendedor es lo que mantiene la cantidad manejable.
function drawCarguePedidos(rows){
  if (cargueMarkersLayer) cargueMap.removeLayer(cargueMarkersLayer);
  CARGUE_DATA = rows;
  CARGUE_MARKERS = [];
  // La leyenda YA NO se arma acá -- ahora refleja el catálogo completo de la
  // línea activa (vendedoresVisibles(), ver renderVendedorChips() en
  // cargue-historial.js), no solo los pedidos dibujados en este momento.

  cargueMarkersLayer = L.layerGroup();
  rows.forEach(d => {
    const color = colorParaVendedorCargue(d.vendedor);
    const atipico = (typeof CARGUE_PEDIDOS_ATIPICOS !== 'undefined') && CARGUE_PEDIDOS_ATIPICOS.has(d.pedido);
    const alerta = atipico && cargueMostrarFueraDeRuta;
    const marker = L.marker([d.lat, d.lng], { icon: makeCargueIcon(color, false, alerta) })
      .bindTooltip(buildCarguePopup(d, alerta), { className: 'cargue-tooltip', direction: 'top', opacity: 0.97 });
    // Clic en el punto lo selecciona/deselecciona directo -- el detalle se
    // ve al pasar el mouse (tooltip), no hace falta clickear para verlo.
    marker.on('click', () => { if (typeof alternarClienteEnSeleccion === 'function') alternarClienteEnSeleccion(d.pedido); });
    cargueMarkersLayer.addLayer(marker);
    CARGUE_MARKERS.push({ data: d, marker, color, atipico });
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
  item.marker.setIcon(makeCargueIcon(item.color, seleccionado, item.atipico && cargueMostrarFueraDeRuta));
  item.marker.setZIndexOffset(seleccionado ? 1000 : 0);
}

// Botón "⚠️ Fuera de ruta" (junto al cuadro VEND, ver cargue.html). Prende o
// apaga la señal visual sin redibujar el mapa entero -- conserva zoom,
// encuadre y la selección en progreso, solo actualiza el ícono/tooltip de
// cada marcador ya puesto.
function alternarCargueFueraDeRuta(){
  cargueMostrarFueraDeRuta = !cargueMostrarFueraDeRuta;
  const btn = document.getElementById('cargue-btn-fuera-ruta');
  if (btn) btn.classList.toggle('activo', cargueMostrarFueraDeRuta);
  CARGUE_MARKERS.forEach(item => {
    const seleccionado = (typeof estaSeleccionado === 'function') && estaSeleccionado(item.data.pedido);
    const alerta = item.atipico && cargueMostrarFueraDeRuta;
    item.marker.setIcon(makeCargueIcon(item.color, seleccionado, alerta));
    item.marker.setTooltipContent(buildCarguePopup(item.data, alerta));
  });
}

// Recibe directamente una lista de CÓDIGOS de vendedor (no pedidos) -- la
// llama cargue-historial.js con vendedoresVisibles(), el catálogo completo
// de la línea activa, para que la leyenda no cambie según qué vendedores
// estén tildados ni qué pedidos haya dibujados en este instante.
//
// Muestra solo el CÓDIGO (extraerCodigoVendedor), no el nombre completo --
// con muchos vendedores activos a la vez el nombre completo hacía la leyenda
// demasiado ancha/larga para leerla de un vistazo. El tooltip de cada punto
// (buildCarguePopup) sigue mostrando el nombre completo -- ahí sí hay
// espacio y contexto de un solo cliente a la vez.
function buildCargueLegend(vendedores){
  const cont = document.getElementById('cargue-legend-items');
  if (!cont) return;
  const vs = [...new Set(vendedores)].sort();
  cont.innerHTML = vs.map(v => `<div class="li"><div class="ld" style="background:${colorParaVendedorCargue(v)}"></div>${extraerCodigoVendedor(v) || v}</div>`).join('');
}
