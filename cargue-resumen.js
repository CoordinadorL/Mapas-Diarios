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
        <th style="padding:5px 6px">Vendedor</th>
        <th style="padding:5px 6px;text-align:right">Pedidos</th>
        <th style="padding:5px 6px;text-align:right">Kilos</th>
        <th style="padding:5px 6px;text-align:right">Total</th>
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

// Desglose de los cargues ya armados (cargueCamionesArmadosHoy, de
// cargue-historial.js): código de camión, vendedores incluidos, facturas,
// kilos y monto -- responde a "¿qué llevo ya armado y con qué?" sin tener
// que ir a buscarlo en la lista chica del panel lateral.
//
// Cada fila es un <details> desplegable (▸/▾) con el detalle pedido por
// pedido agrupado por vendedor -- pensado sobre todo para camiones "cajón"
// como los de fuera de ruta (ej. F140/F141), donde hace falta poder leerle
// a cada vendedor exactamente qué pedidos suyos quedaron ahí, pero funciona
// igual para cualquier camión.
function renderResumenCamiones(){
  const cont = document.getElementById('cargue-resumen-camiones');
  if (!cont) return;

  if (!cargueCamionesArmadosHoy.length) {
    cont.innerHTML = '<p style="color:#64748b;font-size:.78rem">Ningún camión armado todavía.</p>';
    return;
  }

  const detalleDeCamionPorVendedor = (c) => {
    const porVendedor = {};
    (c.pedidosDetalle || []).forEach(p => {
      (porVendedor[p.vendedor] = porVendedor[p.vendedor] || []).push(p);
    });
    return Object.keys(porVendedor).sort().map(v => `
      <div class="rcd-vendedor">
        <b>${(typeof extraerCodigoVendedor === 'function' ? extraerCodigoVendedor(v) : '') || v}</b>
        <ul>
          ${porVendedor[v].map(p => `<li>${p.cliente || '(sin nombre)'} — ${p.direccion || '—'} — $${p.ventasTotal.toFixed(2)} · ${p.kilos.toFixed(1)}kg</li>`).join('')}
        </ul>
      </div>`).join('');
  };

  cont.innerHTML = `
    <div class="resumen-camiones-tabla">
      <div class="rc-fila rc-header">
        <span></span><span>Camión</span><span>Vendedores</span><span>Facturas</span><span>Kilos</span><span>Monto</span>
      </div>
      ${cargueCamionesArmadosHoy.map(c => `
        <details class="rc-fila-detalle">
          <summary class="rc-fila">
            <span class="rc-caret"></span>
            <span>${c.camion}</span>
            <span class="rc-vend">${(c.vendedores || []).join(', ')}</span>
            <span class="rc-num">${c.pedidos.length}</span>
            <span class="rc-num">${(c.kilos || 0).toFixed(2)}</span>
            <span class="rc-num rc-monto">$${c.total.toFixed(2)}</span>
          </summary>
          <div class="rc-detalle">${detalleDeCamionPorVendedor(c)}</div>
        </details>
      `).join('')}
    </div>`;
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
