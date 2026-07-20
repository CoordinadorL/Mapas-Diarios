// ═══════════════════════════════════════════════════════════
// CARGUE-RESUMEN.JS — reporte "Pedidos x Vendedor": código de vendedor,
// número de pedidos, kilos y total en $, con fila TOTAL GENERAL. Se calcula
// de CARGUE_PEDIDOS_TODOS (cargue-historial.js) -- respeta las líneas
// activas si hay alguna elegida, si no, muestra todos los vendedores del
// rango de fechas. Se abre en un modal aparte del mapa.
// ═══════════════════════════════════════════════════════════

function calcularResumenVendedores(){
  const enScopeLineas = CARGUE_LINEAS_ACTIVAS.size > 0;
  const porVendedor = {};
  CARGUE_PEDIDOS_TODOS.forEach(p => {
    if (enScopeLineas && !CARGUE_LINEAS_ACTIVAS.has(p.linea)) return;
    if (!porVendedor[p.vendedor]) {
      porVendedor[p.vendedor] = { vendedor: p.vendedor, pedidos: 0, kilos: 0, ventasTotal: 0 };
    }
    const r = porVendedor[p.vendedor];
    r.pedidos++; r.kilos += p.kilos; r.ventasTotal += p.ventasTotal;
  });
  const filas = Object.values(porVendedor).sort((a, b) => a.vendedor.localeCompare(b.vendedor));
  const total = filas.reduce((acc, f) => ({
    pedidos: acc.pedidos + f.pedidos, kilos: acc.kilos + f.kilos, ventasTotal: acc.ventasTotal + f.ventasTotal,
  }), { pedidos: 0, kilos: 0, ventasTotal: 0 });
  return { filas, total };
}

function renderResumenTabla(){
  const cont = document.getElementById('cargue-resumen-tabla');
  if (!cont) return;
  const { filas, total } = calcularResumenVendedores();

  if (!filas.length) {
    cont.innerHTML = `<p style="color:#64748b;font-size:.78rem">No hay pedidos para este rango de fechas${CARGUE_LINEAS_ACTIVAS.size ? ' y la(s) línea(s) elegida(s)' : ''}.</p>`;
    return;
  }

  cont.innerHTML = `
    <table style="width:100%;max-width:420px;border-collapse:collapse;font-size:.75rem">
      <thead><tr style="text-align:left;color:#94a3b8;border-bottom:1px solid #334155">
        <th style="padding:5px 6px;position:sticky;top:0;background:#111827">Vendedor</th>
        <th style="padding:5px 6px;text-align:right;position:sticky;top:0;background:#111827">Pedidos</th>
        <th style="padding:5px 6px;text-align:right;position:sticky;top:0;background:#111827">Kilos</th>
        <th style="padding:5px 6px;text-align:right;position:sticky;top:0;background:#111827">Total</th>
      </tr></thead>
      <tbody>
        ${filas.map(f => `<tr style="border-bottom:1px solid #1e293b">
          <td style="padding:5px 6px">${f.vendedor}</td>
          <td style="padding:5px 6px;text-align:right">${f.pedidos}</td>
          <td style="padding:5px 6px;text-align:right">${f.kilos.toFixed(2)}</td>
          <td style="padding:5px 6px;text-align:right;font-weight:700">$${f.ventasTotal.toFixed(2)}</td>
        </tr>`).join('')}
      </tbody>
      <tfoot><tr style="font-weight:700;border-top:2px solid #475569;color:#fff">
        <td style="padding:6px">TOTAL GENERAL</td>
        <td style="padding:6px;text-align:right">${total.pedidos}</td>
        <td style="padding:6px;text-align:right">${total.kilos.toFixed(2)}</td>
        <td style="padding:6px;text-align:right">$${total.ventasTotal.toFixed(2)}</td>
      </tr></tfoot>
    </table>`;
}

// Arma un texto legible (para copiar y pegar en WhatsApp) con el detalle de
// los pedidos de UN vendedor dentro de un camión.
function _textoDetalleVendedorCargue(camion, codigoVendedor, pedidos){
  const total = pedidos.reduce((s, p) => s + p.ventasTotal, 0);
  const lineas = pedidos.map((p, i) => `${i + 1}. ${p.cliente || '(sin nombre)'} — ${p.direccion || '—'} — $${p.ventasTotal.toFixed(2)} · ${p.kilos.toFixed(1)}kg`);
  return `CAMIÓN: ${camion}\nVENDEDOR: ${codigoVendedor}\n${pedidos.length} pedido${pedidos.length === 1 ? '' : 's'} — $${total.toFixed(2)}\n\n${lineas.join('\n')}`;
}

// Ídem pero con TODOS los vendedores de un camión, uno debajo del otro.
function _textoDetalleCamionCargue(c, porVendedor){
  const bloques = Object.keys(porVendedor).sort().map(v => {
    const codigo = (typeof extraerCodigoVendedor === 'function' ? extraerCodigoVendedor(v) : '') || v;
    return _textoDetalleVendedorCargue(c.camion, codigo, porVendedor[v]);
  });
  return `CAMIÓN: ${c.camion} — ${c.pedidos.length} pedido${c.pedidos.length === 1 ? '' : 's'} — $${c.total.toFixed(2)}\n\n${bloques.join('\n\n---\n\n')}`;
}

// Copia un texto al portapapeles con feedback visual en el botón tocado
// ("✅ Copiado" un toque y vuelve a su ícono). navigator.clipboard requiere
// contexto seguro (https) -- si no está disponible (ej. abierto como
// file:// en vez del link publicado), cae al método viejo (textarea +
// execCommand); si ni eso funciona, muestra el texto en una alerta para
// copiarlo a mano en vez de fallar en silencio.
async function copiarAlPortapapeles(texto, boton){
  const iconoOriginal = boton ? boton.textContent : '';
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(texto);
    } else {
      const ta = document.createElement('textarea');
      ta.value = texto;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    if (boton) {
      boton.textContent = '✅';
      setTimeout(() => { boton.textContent = iconoOriginal; }, 1500);
    }
  } catch (err) {
    alert('No se pudo copiar automáticamente. Copialo a mano:\n\n' + texto);
  }
}

// Desglose de los cargues ya armados (cargueCamionesArmadosHoy, de
// cargue-historial.js): código de camión, quién lo armó, vendedores
// incluidos, facturas, kilos y monto -- responde a "¿qué llevo ya armado y
// con qué?" sin tener que ir a buscarlo en la lista chica del panel
// lateral.
//
// Cada fila es un <details> desplegable (▸/▾) con el detalle pedido por
// pedido agrupado por vendedor (cada vendedor a su vez desplegable aparte,
// contraído por defecto) -- pensado sobre todo para camiones "cajón" como
// los de fuera de ruta (ej. F140/F141), donde hace falta poder leerle a
// cada vendedor exactamente qué pedidos suyos quedaron ahí, pero funciona
// igual para cualquier camión. El botón 📋 (por vendedor y por camión)
// copia ese detalle listo para pegar y pasarle la info al vendedor.
function renderResumenCamiones(){
  const cont = document.getElementById('cargue-resumen-camiones');
  if (!cont) return;

  if (!cargueCamionesArmadosHoy.length) {
    cont.innerHTML = '<p style="color:#64748b;font-size:.78rem">Ningún camión armado todavía.</p>';
    return;
  }

  const porVendedorDeCamion = (c) => {
    const porVendedor = {};
    (c.pedidosDetalle || []).forEach(p => {
      (porVendedor[p.vendedor] = porVendedor[p.vendedor] || []).push(p);
    });
    return porVendedor;
  };

  const detalleDeCamionPorVendedor = (c, camionIdx) => {
    const porVendedor = porVendedorDeCamion(c);
    // Sin pedidosDetalle pero CON pedidos -- ya se archivaron (ver
    // computarCamionesArmados en cargue-historial.js): no hay forma de
    // reconstruir el detalle pedido por pedido sin ir al histórico anual,
    // así que se avisa en vez de dejar el desplegable vacío como si no
    // hubiera nada que ver.
    if (!Object.keys(porVendedor).length && (c.pedidos || []).length) {
      return '<p style="color:#64748b;font-size:.75rem;padding:4px 0">Este cargue ya se archivó (los pedidos pasaron al histórico anual) — no hay detalle pedido por pedido acá. Los totales de arriba sí son los reales, guardados al armar el cargue.</p>';
    }
    return Object.keys(porVendedor).sort().map(v => {
      const pedidosDelVendedor = porVendedor[v];
      const totalVendedor = pedidosDelVendedor.reduce((s, p) => s + p.ventasTotal, 0);
      return `
      <details class="rcd-vendedor">
        <summary>
          <span class="rcd-caret"></span>
          <b>${(typeof extraerCodigoVendedor === 'function' ? extraerCodigoVendedor(v) : '') || v}</b>
          <span class="rcd-vendedor-total">${pedidosDelVendedor.length} pedido${pedidosDelVendedor.length === 1 ? '' : 's'} — $${totalVendedor.toFixed(2)}</span>
          <button type="button" class="rcd-btn-copiar" data-camion-idx="${camionIdx}" data-vendedor="${v}" title="Copiar el detalle de ${v} para pasárselo">📋</button>
        </summary>
        <ul>
          ${pedidosDelVendedor.map(p => `<li>${p.cliente || '(sin nombre)'} — ${p.direccion || '—'} — $${p.ventasTotal.toFixed(2)} · ${p.kilos.toFixed(1)}kg</li>`).join('')}
        </ul>
      </details>`;
    }).join('');
  };

  cont.innerHTML = `
    <div class="resumen-camiones-tabla">
      <div class="rc-fila rc-header">
        <span></span><span>Camión</span><span>Vendedores</span><span>Facturas</span><span>Kilos</span><span>Monto</span><span></span>
      </div>
      ${cargueCamionesArmadosHoy.map((c, i) => `
        <details class="rc-fila-detalle">
          <summary class="rc-fila">
            <span class="rc-caret"></span>
            <span>${c.camion}${c.usuario ? `<br><small class="rc-usuario">armado por ${c.usuario}</small>` : ''}</span>
            <span class="rc-vend">${(c.vendedores || []).map(v => (typeof extraerCodigoVendedor === 'function' ? extraerCodigoVendedor(v) : '') || v).join(', ')}</span>
            <span class="rc-num">${c.pedidos.length}</span>
            <span class="rc-num">${(c.kilos || 0).toFixed(2)}</span>
            <span class="rc-num rc-monto">$${c.total.toFixed(2)}</span>
            <button type="button" class="rc-btn-copiar" data-camion-idx="${i}" title="Copiar el detalle completo de este camión">📋</button>
          </summary>
          <div class="rc-detalle">${detalleDeCamionPorVendedor(c, i)}</div>
        </details>
      `).join('')}
    </div>`;

  cont.querySelectorAll('.rcd-btn-copiar').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation();
      const c = cargueCamionesArmadosHoy[Number(btn.dataset.camionIdx)];
      if (!c) return;
      const v = btn.dataset.vendedor;
      const pedidosDelVendedor = (c.pedidosDetalle || []).filter(p => p.vendedor === v);
      const codigo = (typeof extraerCodigoVendedor === 'function' ? extraerCodigoVendedor(v) : '') || v;
      copiarAlPortapapeles(_textoDetalleVendedorCargue(c.camion, codigo, pedidosDelVendedor), btn);
    });
  });
  cont.querySelectorAll('.rc-btn-copiar').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation();
      const c = cargueCamionesArmadosHoy[Number(btn.dataset.camionIdx)];
      if (!c) return;
      copiarAlPortapapeles(_textoDetalleCamionCargue(c, porVendedorDeCamion(c)), btn);
    });
  });
}

function abrirResumenCargue(){
  renderResumenTabla();
  renderResumenCamiones();
  const modal = document.getElementById('cargue-modal-resumen');
  if (modal) modal.style.display = 'flex';
}
function cerrarResumenCargue(){
  const modal = document.getElementById('cargue-modal-resumen');
  if (modal) modal.style.display = 'none';
}

function initCargueResumen(){
  const btnAbrir = document.getElementById('cargue-btn-resumen-vendedores');
  const btnCerrar = document.getElementById('cargue-btn-cerrar-resumen');
  const modal = document.getElementById('cargue-modal-resumen');
  if (btnAbrir) btnAbrir.addEventListener('click', abrirResumenCargue);
  if (btnCerrar) btnCerrar.addEventListener('click', cerrarResumenCargue);
  if (modal) modal.addEventListener('click', (e) => { if (e.target === modal) cerrarResumenCargue(); });
}
