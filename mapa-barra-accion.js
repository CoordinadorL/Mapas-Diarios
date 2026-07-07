// ═══════════════════════════════════════════════════════════
// MAPA-BARRA-ACCION.JS — panel de clientes mayoristas (solo lectura) y toda
// la lógica propia de la barra de acción inferior (#action-bar): en móvil
// agrupa en una sola fila lo esencial para el chofer en ruta (mayoristas,
// lista, whatsapp, reporte, recalcular); en escritorio no cambia nada.
// Noveno módulo separado de mapa_live_F150.html.
// ═══════════════════════════════════════════════════════════

// ── PANEL DE CLIENTES MAYORISTAS (solo lectura) ─────────────
function abrirMayoristas(){
  const lista=DATA.map((d,i)=>({d,i})).filter(x=>x.d.canalCat==='MAYORISTA');
  document.getElementById('mayoristas-count').textContent = lista.length
    ? `${lista.length} cliente(s) mayorista(s) en esta ruta`
    : 'Ningún cliente mayorista en esta ruta';
  const cont=document.getElementById('mayoristas-list');
  cont.innerHTML = lista.length ? lista.map(({d,i})=>`
    <div onclick="irAMayorista(${i})" style="background:#1e293b;border-left:3px solid #9333ea;border-radius:8px;padding:8px 10px;margin-bottom:6px;cursor:pointer">
      <div style="font-size:.62rem;color:#a78bfa;font-weight:800">#${i+1} · ${d.codigo}</div>
      <div style="font-size:.72rem;color:#e2e8f0;font-weight:700;margin-top:1px">${d.razon}</div>
      <div style="font-size:.62rem;color:#94a3b8;margin-top:2px">${d.dir}</div>
      ${d.ventana?`<div style="font-size:.64rem;color:#c4b5fd;background:#1e1b4b;border-radius:4px;padding:2px 6px;margin-top:4px;display:inline-block">🕐 ${d.ventana}</div>`:''}
    </div>`).join('') : '<div style="text-align:center;color:#475569;font-size:.72rem;padding:24px">Sin clientes mayoristas en la ruta activa.</div>';
  document.getElementById('mayoristas-overlay').style.display='block';
  document.getElementById('mayoristas-panel').style.display='flex';
  setTimeout(()=>document.getElementById('mayoristas-panel').style.right='0',10);
}
function cerrarMayoristas(){
  document.getElementById('mayoristas-panel').style.right='-340px';
  document.getElementById('mayoristas-overlay').style.display='none';
  setTimeout(()=>{ document.getElementById('mayoristas-panel').style.display='none'; },300);
}
function irAMayorista(idx){
  cerrarMayoristas();
  const m=allMarkers[idx];
  if(m){ map.setView(m.getLatLng(),Math.max(map.getZoom(),16)); m.openPopup(); }
}
