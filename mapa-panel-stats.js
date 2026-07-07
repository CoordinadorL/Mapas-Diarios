// ═══════════════════════════════════════════════════════════
// MAPA-PANEL-STATS.JS — panel lateral de clientes (lista, filtro, búsqueda)
// y estadísticas del encabezado (clientes/distancia/kg/$/drops, progreso,
// banner de liquidación). Quinto módulo separado de mapa_live_F150.html.
//
// Las funciones de aquí siguen llamando a otras que aún viven en el script
// principal (syncAvance, quemarDesdeNC, marcarAnulado, resetEstado, makeIcon,
// etc.) -- funciona igual porque todo comparte el mismo scope global.
// ═══════════════════════════════════════════════════════════

function toggleVisited(idx){
  if(completed.has(idx)){
    completed.delete(idx);
  } else {
    completed.add(idx);
    porCobrar.delete(idx); // si estaba "por cobrar", quitarlo
  }
  refreshMarkerIcon(idx);
  updateProgress();updateStats();updatePanel();
  map.closePopup();
  syncAvance(idx);
}

// ── PANEL LATERAL ─────────────────────────────────────────

function filterPanel(q){
  const items=document.querySelectorAll('.p-item');
  const ql=q.toLowerCase();
  let shown=0;
  items.forEach(el=>{
    const name=(el.querySelector('.p-name')||{}).textContent||'';
    const meta=(el.querySelector('.p-meta')||{}).textContent||'';
    const match=!ql||name.toLowerCase().includes(ql)||meta.toLowerCase().includes(ql);
    el.style.display=match?'flex':'none';
    if(match)shown++;
  });
  document.getElementById('panel-footer').textContent=
    q?`${shown} resultado(s) para "${q}"`:
    `${completed.size} de ${DATA.length} entregados`;
}
function buildPanel(){
  const list=document.getElementById('panel-list');
  list.innerHTML='';
  DATA.forEach((d,i)=>{
    const tier=getTier(d.total);
    const vis=completed.has(i);
    const col=colorMap[d.vendedor]||'#888';
    const dotCol=tier==='high'?'#dc2626':tier==='medium'?'#ca8a04':col;
    const div=document.createElement('div');
    div.className=`p-item ${tier} ${vis?'visited':''}`;
    div.id=`pi-${i}`;
    div.innerHTML=`
      <span class="p-num">${i+1}</span>
      <div class="p-dot" style="background:${dotCol}"></div>
      <div class="p-info">
        <div class="p-name">${d.razon}</div>
        <div class="p-meta">
          <span class="p-total ${tier}">$${d.total.toFixed(0)}</span>
          <span>${d.vendedor}</span>
          ${d.liq?`<span>Liq ${d.liq}</span>`:''}
          <span id="pq-${i}" style="display:none;color:#fb923c;font-weight:800">🔥 Pend $0</span>
        </div>
      </div>
      <div class="p-actions">
        <button class="p-act-btn p-act-done"   title="Entregado"    data-action="deliver" data-idx="${i}">✅</button>
        <button class="p-act-btn p-act-xc"     title="Por cobrar"   data-action="xc"      data-idx="${i}" style="font-size:.58rem;font-weight:800">XC</button>
        <button class="p-act-btn" style="background:#7f1d1d;color:#fca5a5;font-size:.6rem" title="Quemar (solo si fue Anulado)" data-action="quemado" data-idx="${i}">🔥</button>
        <button class="p-act-btn" style="background:#1e1b4b;color:#c7d2fe;font-size:.6rem" title="Anulado" data-action="anulado" data-idx="${i}">❌</button>
        <button class="p-act-btn p-act-undone" title="Desmarcar"    data-action="undo"    data-idx="${i}">↩</button>
      </div>
      <div id="anulado-menu-p-${i}" style="display:none;padding:4px 0 0" onclick="event.stopPropagation()">
        <select class="motivo-select" style="width:100%;font-size:.62rem;padding:3px 5px;border-radius:6px" onchange="marcarAnulado(${i},this.value,false); toggleAnuladoMenuPanel(${i},true)">
          <option value="">— Motivo anulación —</option>
          <option>Negocio cerrado</option><option>Rechazado comercial</option>
          <option>Cliente sin dinero</option><option>Diferencia de precios</option>
          <option>No realiza pedido</option><option>Pedido cruzado</option>
          <option>Fuera de ruta</option><option>Descuento o crédito no formalizado</option>
          <option>Pedido incompleto</option><option>Error de facturación</option>
          <option>Producto en mal estado</option><option>Sin motivo</option>
        </select>
      </div>`;

    // Click en .p-info → solo navega y abre popup, panel permanece abierto
    div.querySelector('.p-info').addEventListener('click',(e)=>{
      e.stopPropagation();
      const m=allMarkers[i];
      if(m){
        if(useCluster&&clusterGroup){
          clusterGroup.zoomToShowLayer(m,()=>{ setTimeout(()=>m.openPopup(),200); });
        } else {
          map.setView([d.lat,d.lng],17);
          setTimeout(()=>m.openPopup(),150);
        }
      }
    });

    // Botón ✅ Entregar — marca como cobrado, pinta gris en mapa y lista
    div.querySelector('[data-action="deliver"]').addEventListener('click',(e)=>{
      e.stopPropagation();
      completed.add(i);
      porCobrar.delete(i); anulados.delete(i); quemados.delete(i);
      refreshMarkerIcon(i);
      updateProgress();updateStats();updatePanel();
      saveLocalState();
      syncAvance(i);
    });

    // Botón ↩ Desmarcar — quita marca, restaura color en mapa y lista
    div.querySelector('[data-action="undo"]').addEventListener('click',(e)=>{
      e.stopPropagation();
      resetEstado(i);
    });

    // Botón XC — Por cobrar (naranja fijo)
    div.querySelector('[data-action="xc"]').addEventListener('click',(e)=>{
      e.stopPropagation();
      if(porCobrar.has(i)){
        porCobrar.delete(i);
      } else {
        porCobrar.add(i);
        completed.delete(i);
      }
      refreshMarkerIcon(i);
      updateProgress();updateStats();updatePanel();
      syncAvance(i);
    });

    // Botón 🔥 Quemar — solo debe estar visible/habilitado si el pedido ya fue Anulado
    div.querySelector('[data-action="quemado"]').addEventListener('click',(e)=>{
      e.stopPropagation();
      if(!anulados.has(i)) return; // seguridad extra: no quemar si no fue anulado antes
      quemarDesdeNC(i, false);
    });

    // Botón ❌ Anulado — despliega selector de motivo (igual que en el popup del mapa)
    div.querySelector('[data-action="anulado"]').addEventListener('click',(e)=>{
      e.stopPropagation();
      toggleAnuladoMenuPanel(i);
    });

    list.appendChild(div);
  });
  updatePanel();
}

function toggleAnuladoMenuPanel(i, forceHide){
  const m=document.getElementById('anulado-menu-p-'+i);
  if(!m) return;
  m.style.display = forceHide ? 'none' : (m.style.display==='none' ? 'block' : 'none');
}

// Redibuja el ícono de un marcador según su estado actual (visited o no)
function refreshMarkerIcon(i){
  const d=DATA[i];
  if(!d||!allMarkers[i])return;
  const col=colorMap[d.vendedor]||'#888';
  allMarkers[i].setIcon(makeIcon(col,i+1,i===0,d,LABEL_OFFSETS[i]||0));
}
function getEstadoColor(i){
  if(completed.has(i))   return devParcial.has(i)?'#059669':'#4b5563'; // dev=verde oscuro, normal=gris
  if(porCobrar.has(i))   return '#f97316'; // naranja
  if(quemados.has(i))    return '#b91c1c'; // rojo oscuro
  if(anulados.has(i))    return '#4338ca'; // morado
  return null; // usa color vendedor
}

function updatePanel(){
  DATA.forEach((d,i)=>{
    const el=document.getElementById(`pi-${i}`);
    if(!el)return;
    const vis=completed.has(i);
    const xc=!vis&&porCobrar.has(i);
    const isQ=quemados.has(i), isA=anulados.has(i), isDev=devParcial.has(i);
    const quemVal=quemadoParcial.has(i)?quemadoParcial.get(i):(isQ?d.total:0);
    const pendQuema=isQ?Math.max(0,d.total-quemVal):0;
    const stateClass=vis?(isDev?'dev-item':'visited'):xc?'xc-item':isQ?(pendQuema>0.009?'quemado-parcial-item':'quemado-item'):isA?'anulado-item':'';
    el.className=`p-item ${getTier(DATA[i].total)} ${stateClass}`;
    const pq=document.getElementById(`pq-${i}`);
    if(pq){
      if(pendQuema>0.009){ pq.style.display='inline'; pq.textContent=`🔥 Pend $${pendQuema.toFixed(0)}`; }
      else { pq.style.display='none'; }
    }
    const btnDone=el.querySelector('[data-action="deliver"]');
    const btnUndo=el.querySelector('[data-action="undo"]');
    const btnXC=el.querySelector('[data-action="xc"]');
    // Estado normal: mostrar ✅ y XC
    // Estado entregado (vis): mostrar solo ↩
    // Estado por cobrar (xc): mostrar solo ↩
    const anyState=vis||xc||quemados.has(i)||anulados.has(i);
    // Normal: Entregado + XC + Anulado disponibles, Quemado bloqueado.
    // Anulado: Entregado (revisita) + Quemado habilitados, XC/Anulado ocultos.
    // Entregado / Por cobrar / Quemado: solo Desmarcar.
    if(btnDone)btnDone.style.display=(vis||xc||isQ)?'none':'flex';           // visible en normal y en anulado
    if(btnXC)btnXC.style.display=anyState?'none':'flex';                     // solo normal
    if(btnUndo)btnUndo.style.display=anyState?'flex':'none';
    const btnQ=el.querySelector('[data-action="quemado"]');
    const btnA=el.querySelector('[data-action="anulado"]');
    if(btnQ)btnQ.style.display=isA?'flex':'none';                           // solo habilitado si ya fue Anulado
    if(btnA)btnA.style.display=anyState?'none':'flex';                      // solo normal
    if(!isA){ const menu=document.getElementById('anulado-menu-p-'+i); if(menu) menu.style.display='none'; }
  });
  const tot=DATA.length,vis=completed.size;
  // FAB badge
  const badge=document.getElementById('fab-badge');
  if(badge){badge.textContent=tot-vis;badge.style.background=vis===tot&&tot>0?'#22c55e':'#3b82f6';}
  // Panel stats
  const drops=DATA.filter(d=>getTier(d.total)==='high').length;
  const totalV=DATA.reduce((s,d)=>s+d.total,0);
  const ps_t=document.getElementById('ps-total');const ps_e=document.getElementById('ps-entregados');
  const ps_d=document.getElementById('ps-drops');const ps_v=document.getElementById('ps-venta');
  if(ps_t)ps_t.textContent=tot;if(ps_e)ps_e.textContent=vis;
  if(ps_d)ps_d.textContent=drops;if(ps_v)ps_v.textContent='$'+totalV.toFixed(0);
  // Footer
  // XC count for footer
  const xcCount=porCobrar.size;
  const badge2=document.getElementById('fab-badge');
  const pending=tot-vis-xcCount;
  if(badge2){badge2.textContent=pending>0?pending:'✓';badge2.style.background=pending===0?'#22c55e':'#3b82f6';}
  // Panel stats XC
  const ps_xc=document.getElementById('ps-xc');const ps_vis=document.getElementById('ps-entregados');
  if(ps_xc)ps_xc.textContent=xcCount;if(ps_vis)ps_vis.textContent=vis;
  const footer=document.getElementById('panel-footer');
  if(footer)footer.textContent=`✅ ${vis} entregados · 🟠 ${xcCount} por cobrar · ${pending} pendientes`;
  // Sync all marker icons
  DATA.forEach((_,i)=>refreshMarkerIcon(i));
  updateBottomBar();
  saveLocalState();
}

// ── BUSCAR ────────────────────────────────────────────────
function onSearch(val){
  const q=val.trim().toLowerCase();
  if(!q){document.querySelectorAll('.p-item').forEach(el=>el.style.display='');return;}
  const matchFn=(d)=>
    d.razon.toLowerCase().includes(q) ||
    d.codigo.toLowerCase().includes(q) ||
    d.dir.toLowerCase().includes(q) ||
    d.total.toFixed(2).includes(q) ||
    String(Math.round(d.total)).includes(q);
  let anyMatch=false;
  DATA.forEach((d,i)=>{
    const el=document.getElementById(`pi-${i}`);
    const match=matchFn(d);
    if(match)anyMatch=true;
    if(!el)return;
    el.style.display=match?'':'none';
  });
  if(anyMatch && !panelOpen) openPanel();
  // Centro mapa en primer resultado
  const first=DATA.find(matchFn);
  if(first){const m=allMarkers[DATA.indexOf(first)];if(m){map.setView([first.lat,first.lng],17);m.openPopup();}}
}

// ── STATS ─────────────────────────────────────────────────
function updateStats(){
  const tp=DATA.reduce((s,d)=>s+d.peso,0);
  const tv=DATA.reduce((s,d)=>s+d.total,0);
  let km=0;for(let i=0;i<DATA.length-1;i++)km+=haversine(DATA[i].lat,DATA[i].lng,DATA[i+1].lat,DATA[i+1].lng);
  const drops=DATA.filter(d=>getTier(d.total)!=='normal').length;
  document.getElementById('s-clientes').textContent=DATA.length||'—';
  document.getElementById('s-visitados').textContent=`${completed.size}/${DATA.length}`;
  document.getElementById('s-km').textContent=DATA.length?(km.toFixed(1)+' km'):'— km';
  document.getElementById('s-peso').textContent=DATA.length?(tp.toFixed(1)+' kg'):'—';
  document.getElementById('s-venta').textContent=DATA.length?('$ '+tv.toFixed(2)):'—';
  document.getElementById('s-drops').textContent=drops||'—';
}
function updateProgress(){
  const n=completed.size,tot=DATA.length,pct=tot?Math.round(n/tot*100):0;
  document.getElementById('prog-fill').style.width=pct+'%';
  document.getElementById('prog-pct').textContent=`${n} / ${tot} (${pct}%)`;
}
function updateBanner(){
  const ban=document.getElementById('liq-banner');
  if(!DATA.length){ban.style.display='none';return;}
  ban.style.display='flex';
  const tp=DATA.reduce((s,d)=>s+d.peso,0);
  const tv=DATA.reduce((s,d)=>s+d.total,0);
  const hi=DATA.filter(d=>d.total>=TIER_HIGH).length;
  const me=DATA.filter(d=>d.total>=TIER_MEDIUM&&d.total<TIER_HIGH).length;
  document.getElementById('ban-cli').textContent=DATA.length;
  document.getElementById('ban-peso').textContent=tp.toFixed(1)+' kg';
  document.getElementById('ban-total').textContent='$ '+tv.toFixed(2);
  document.getElementById('ban-high').textContent=hi;
  document.getElementById('ban-med').textContent=me;
}

function openPanel(){
  panelOpen=true;
  document.getElementById('side-panel').classList.add('open');
  document.getElementById('panel-overlay').classList.add('show');
  document.getElementById('panel-search').value='';
  filterPanel('');
  document.getElementById('fab-panel').style.display='none';
}
function closePanel(){
  panelOpen=false;
  document.getElementById('side-panel').classList.remove('open');
  document.getElementById('panel-overlay').classList.remove('show');
  document.getElementById('fab-panel').style.display='flex';
  setTimeout(()=>map.invalidateSize(),310);
}

// Móvil: muestra/oculta filtros+jornada+liquidación+controles (#header-extra),
// colapsados por defecto para dejar más espacio al mapa (ver #btn-header-toggle).
function toggleHeaderMobile(){
  const extra=document.getElementById('header-extra');
  const label=document.getElementById('header-toggle-label');
  if(!extra) return;
  const abierto=extra.classList.toggle('open');
  if(label) label.textContent=abierto?'Ocultar':'Detalles';
  setTimeout(()=>map.invalidateSize(),310);
}
