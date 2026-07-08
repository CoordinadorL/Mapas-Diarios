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

function abrirResumenCargue(){
  renderResumenTabla();
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
