// ═══════════════════════════════════════════════════════════
// MAPA-JORNADA-GPS-REPORTES.JS — jornada/liquidacion del chofer, GPS en
// tiempo real, tiempo estimado, exportar reporte (PDF/WhatsApp/copiar),
// navegacion (ir al siguiente, re-optimizar), guardado de estado local y
// carga principal de la pagina (loadAndRender). Septimo modulo separado de
// mapa_live_F150.html -- el mas grande hasta ahora.
//
// toggleRetencion, confirmarCobroRetencion y saveNota se quedan en el
// script principal (van con el modulo final de popups/estado).
// ═══════════════════════════════════════════════════════════

// ── WHATSAPP SHARE ────────────────────────────────────────
function shareWhatsApp(){
  const drops=DATA.filter(d=>getTier(d.total)!=='normal');
  const tv=DATA.reduce((s,d)=>s+d.total,0);
  const url=encodeURIComponent(window.location.href);
  const msg=encodeURIComponent(
    `🚛 *Ruta ${activeFecha}*\n`+
    `👤 ${activeChofer}\n`+
    `📦 ${DATA.length} clientes | 💰 $${tv.toFixed(2)}\n`+
    (drops.length?`⚠️ ${drops.length} drops fuertes (>$${TIER_MEDIUM})\n`:'')+
    `\n🗺️ Ver mapa: ${decodeURIComponent(url)}`
  );
  window.open(`https://wa.me/?text=${msg}`,'_blank');
}

// ── CARGA PRINCIPAL ───────────────────────────────────────

// ══════════════════════════════════════════════════════════════
// 1. IR AL SIGUIENTE CLIENTE
// ══════════════════════════════════════════════════════════════
function irAlSiguiente(){
  const nextIdx = DATA.findIndex((_,i) =>
    !completed.has(i) && !porCobrar.has(i) && !quemados.has(i) && !anulados.has(i)
  );
  if(nextIdx < 0){ alert('🎉 ¡Todos los clientes han sido gestionados!'); return; }
  const d = DATA[nextIdx];
  // Solo centra el mapa y abre el popup — el usuario elige Google Maps/Waze desde ahí
  map.setView([d.lat, d.lng], 17);
  setTimeout(()=>{ if(allMarkers[nextIdx]) allMarkers[nextIdx].openPopup(); }, 250);
}
function updateFabSiguiente(){
  const nextIdx = DATA.findIndex((_,i) =>
    !completed.has(i) && !porCobrar.has(i) && !quemados.has(i) && !anulados.has(i)
  );
  const lbl = document.getElementById('sig-label');
  const btn = document.getElementById('btn-siguiente-c');
  if(nextIdx < 0){
    if(lbl) lbl.textContent = '🎉 Completa';
    if(btn) btn.style.opacity = '.5';
    return;
  }
  if(btn) btn.style.opacity = '1';
  if(lbl) lbl.textContent = `#${nextIdx+1} ${DATA[nextIdx].razon.split(' ').slice(0,2).join(' ')}`;
}

// ══════════════════════════════════════════════════════════════
// 2. RE-OPTIMIZAR DESDE CLIENTE ACTUAL
// ══════════════════════════════════════════════════════════════
function reoptimizarDesdeAqui(){
  const pendientes = DATA
    .map((d,i)=>({d,i}))
    .filter(({i})=> !completed.has(i) && !porCobrar.has(i) && !quemados.has(i) && !anulados.has(i));
  if(pendientes.length < 2){ alert('No hay suficientes clientes pendientes para re-optimizar.'); return; }

  // Si tenemos GPS, partir desde ahí; sino desde el primero pendiente
  let startLat = pendientes[0].d.lat, startLng = pendientes[0].d.lng;
  if(gpsMarker){ startLat = gpsMarker.getLatLng().lat; startLng = gpsMarker.getLatLng().lng; }

  const pts = pendientes.map(p=>({lat:p.d.lat,lng:p.d.lng,orig:p.i}));
  const visited = new Array(pts.length).fill(false);
  const route = [];
  let curLat = startLat, curLng = startLng;
  for(let s=0; s<pts.length; s++){
    let best=-1, bestD=Infinity;
    for(let j=0;j<pts.length;j++){
      if(!visited[j]){
        const d=haversine(curLat,curLng,pts[j].lat,pts[j].lng);
        if(d<bestD){bestD=d;best=j;}
      }
    }
    visited[best]=true;
    route.push(pts[best].orig);
    curLat=pts[best].lat; curLng=pts[best].lng;
  }

  // Mapear cada objeto de DATA (por referencia) a su índice ANTES de reordenar,
  // para no depender de ALL_ROWS (que tiene otro orden/tamaño) ni de indexOf por valor.
  const oldIndexOf = new Map();
  DATA.forEach((d,i)=> oldIndexOf.set(d,i));

  // Rebuild DATA: completados primero, luego re-ordenados
  const done = DATA.filter((_,i)=> completed.has(i)||porCobrar.has(i)||quemados.has(i)||anulados.has(i));
  const reordered = route.map(i=>DATA[i]);
  DATA = [...done, ...reordered];

  // Reset state maps a los nuevos índices, usando la referencia guardada arriba
  const newCompleted=new Set(), newXC=new Set(), newQuem=new Set(), newAnul=new Map(), newDev=new Map(), newNotas=new Map(), newRet=new Set(), newQuemP=new Map(), newMetodo=new Map();
  DATA.forEach((d,newI)=>{
    const oldI = oldIndexOf.get(d);
    if(completed.has(oldI)) newCompleted.add(newI);
    if(porCobrar.has(oldI)) newXC.add(newI);
    if(quemados.has(oldI)) newQuem.add(newI);
    if(anulados.has(oldI)) newAnul.set(newI, anulados.get(oldI));
    if(devParcial.has(oldI)) newDev.set(newI, devParcial.get(oldI));
    if(notas.has(oldI)) newNotas.set(newI, notas.get(oldI));
    if(retencionSet.has(oldI)) newRet.add(newI);
    if(quemadoParcial.has(oldI)) newQuemP.set(newI, quemadoParcial.get(oldI));
    if(metodoPago.has(oldI)) newMetodo.set(newI, metodoPago.get(oldI));
  });
  completed=newCompleted; porCobrar=newXC; quemados=newQuem;
  anulados=newAnul; devParcial=newDev; notas=newNotas; retencionSet=newRet; quemadoParcial=newQuemP; metodoPago=newMetodo;

  LABEL_OFFSETS = computeLabelOffsets(DATA);
  draw(activeVendedor);
  updateStats(); updateProgress(); updatePanel(); updateFabSiguiente(); updateBottomBar();
  alert(`✅ Ruta re-optimizada. ${pendientes.length} clientes reordenados.`);
}


// 4. GPS EN TIEMPO REAL
// ══════════════════════════════════════════════════════════════
let gpsMarker = null, gpsWatchId = null;
function initGPS(){
  // GPS deshabilitado por defecto — el usuario debe activarlo manualmente
  // tocando el indicador GPS en la barra inferior. Esto evita que el
  // navegador muestre el popup de permiso automáticamente al abrir el mapa.
  updateGPSDot(false,'Toca para activar');
}
function activarGPS(){
  if(!navigator.geolocation){ updateGPSDot(false,'No soportado'); return; }
  if(gpsWatchId){ return; } // ya activo
  startGPSWatch();
}
function startGPSWatch(){
  gpsWatchId = navigator.geolocation.watchPosition(pos=>{
    localStorage.setItem('gps_permission','granted');
    const lat=pos.coords.latitude, lng=pos.coords.longitude;
    updateGPSDot(true, `${lat.toFixed(4)},${lng.toFixed(4)}`);
    if(!gpsMarker){
      gpsMarker = L.marker([lat,lng],{
        icon: L.divIcon({className:'',html:'<div class="gps-marker"></div>',iconSize:[16,16],iconAnchor:[8,8]}),
        zIndexOffset:1000
      }).addTo(map).bindTooltip('📍 Tu ubicación',{permanent:false});
    } else { gpsMarker.setLatLng([lat,lng]); }
    updateTiempoEstimado(lat,lng);
  }, err=>{
    updateGPSDot(false, err.code===1?'Denegado':'Sin señal');
  }, {enableHighAccuracy:true,maximumAge:10000});
}
function updateGPSDot(active, txt){
  const dot=document.getElementById('gps-dot');
  const label=document.getElementById('gps-txt');
  if(dot){ dot.className='gps-dot'+(active?' active':''); }
  if(label){ label.textContent=active?'GPS activo':'Sin GPS'; label.style.color=active?'#4ade80':'#64748b'; }
}

// ══════════════════════════════════════════════════════════════
// 5. TIEMPO ESTIMADO DE RUTA
// ══════════════════════════════════════════════════════════════
// Tiempo TOTAL de toda la ruta (bodega → los 37 clientes en orden) -- no el
// tiempo restante desde donde va el camión. No debe "bajar" según se van
// entregando/cobrando pedidos ni según se mueve el GPS: se calcula siempre
// sobre TODA la ruta, para que sea la misma cifra toda la jornada (se afina
// sola cuando ruta-dinamica.js calcula el plan fijo por calle real -- ver
// aplicarStatsFijas en ruta-dinamica.js, que sobreescribe esto con el dato
// real de OpenRouteService en cuanto está listo).
function updateTiempoEstimado(fromLat, fromLng){
  // Próximo cliente pendiente: esto sí es informativo del avance, se deja dinámico.
  const nextIdx = DATA.findIndex((_,i)=>!completed.has(i)&&!porCobrar.has(i)&&!quemados.has(i)&&!anulados.has(i));
  const nextEl = document.getElementById('prog-proximo');
  if(nextEl){
    nextEl.textContent = nextIdx>=0 ? DATA[nextIdx].razon.split(' ').slice(0,2).join(' ') : '—';
  }
  if(!DATA.length){
    const el=document.getElementById('prog-tiempo'); if(el)el.textContent='—';
    return;
  }
  const bod = (typeof BODEGAS!=='undefined' && typeof activeBodega!=='undefined' && BODEGAS[activeBodega]) ? BODEGAS[activeBodega] : null;
  let totalKm=0, curLat=bod?bod.lat:DATA[0].lat, curLng=bod?bod.lng:DATA[0].lng;
  DATA.forEach(d=>{ totalKm+=haversine(curLat,curLng,d.lat,d.lng); curLat=d.lat; curLng=d.lng; });
  const driveMin=Math.round(totalKm/30*60), stopMin=DATA.length*3, totalMin=driveMin+stopMin;
  const h=Math.floor(totalMin/60), m=totalMin%60;
  const txt = h>0?`${h}h${m}m`:`${m}m`;
  ['prog-tiempo','bb-tiempo'].forEach(id=>{ const el=document.getElementById(id); if(el)el.textContent=txt; });
}

// ══════════════════════════════════════════════════════════════
// BARRA INFERIOR UPDATE
// ══════════════════════════════════════════════════════════════
function updateBottomBar(){
  const set=(id,v)=>{const el=document.getElementById(id);if(el)el.textContent=v;};
  set('bb-ent', completed.size);
  set('bb-xc', porCobrar.size);
  set('bb-quem', quemados.size);
  const pend=DATA.length-completed.size-porCobrar.size-quemados.size-anulados.size;
  set('bb-pend', Math.max(0,pend));
  updateFabSiguiente();
  if(!gpsMarker) updateTiempoEstimado(null,null);
}

// ══════════════════════════════════════════════════════════════
// 6. EXPORTAR REPORTE
// ══════════════════════════════════════════════════════════════

function abrirExportarWA(){ window.open("https://wa.me/?text="+encodeURIComponent(getReporteTexto()),"_blank"); }
function abrirExportar(){
  generarReporte();
  document.getElementById('export-panel').classList.add('show');
  document.getElementById('export-overlay').classList.add('show');
}
function cerrarExportar(){
  document.getElementById('export-panel').classList.remove('show');
  document.getElementById('export-overlay').classList.remove('show');
}
function generarReporte(){
  const tot=DATA.length;
  const vis=completed.size, xcCount=porCobrar.size, quemCount=quemados.size, anulCount=anulados.size;
  const pend=Math.max(0,tot-vis-xcCount-quemCount-anulCount);
  const totalVal=DATA.reduce((s,d)=>s+d.total,0);
  let entVal=0,ncVal=0,retenVal=0,retenCount=0,ncCount=0;
  DATA.forEach((d,i)=>{
    if(!completed.has(i))return;
    if(devParcial.has(i)){
      const p=devParcial.get(i); entVal+=p;
      const dif=d.total-p; // lo no cobrado en este cliente
      if(d.hasRet && (d.retencionVal||0)>0 && Math.abs(dif-d.retencionVal)<0.02){ retenVal+=dif; retenCount++; } // retención 2%
      else if(dif>0.009){ ncVal+=dif; ncCount++; } // devolución / NC parcial real
    } else { entVal+=d.total; }
  });
  const xcVal=DATA.filter((_,i)=>porCobrar.has(i)).reduce((s,d)=>s+d.total,0);
  // Quemado de NC: lo quemado es dinero recaudado (suma a Entregados); la diferencia va a NC parcial.
  let quemMonto=0;
  DATA.forEach((d,i)=>{
    if(!quemados.has(i))return;
    const q=Math.min(quemadoParcial.has(i)?quemadoParcial.get(i):d.total, d.total);
    entVal+=q; quemMonto+=q;
    const dif=Math.max(0,d.total-q);
    if(dif>0.009){ ncVal+=dif; ncCount++; }
  });
  const entregadosCount = vis + quemCount; // los quemados también recaudaron → cuentan en Entregados
  // Desglose de lo recaudado por forma de pago (efectivo/transferencia/cheque/crédito)
  const metSum={EFECTIVO:0,TRANSFERENCIA:0,CHEQUE:0,CREDITO:0};
  DATA.forEach((d,i)=>{
    let amt=0;
    if(completed.has(i)) amt = devParcial.has(i)?devParcial.get(i):d.total;
    else if(quemados.has(i)) amt = Math.min(quemadoParcial.has(i)?quemadoParcial.get(i):d.total, d.total);
    else return;
    const m=metodoPago.get(i);
    metSum[(m && metSum[m]!==undefined)?m:'EFECTIVO'] += amt;
  });
  const anulVal=DATA.filter((_,i)=>anulados.has(i)).reduce((s,d)=>s+d.total,0);
  const now=new Date().toLocaleString('es-EC');

  // Detalle anulados con motivo
  let anulDetalle='';
  anulados.forEach((motivo,i)=>{ const d=DATA[i]; if(d) anulDetalle+=`<div class="exp-row"><span class="exp-label" style="font-size:.58rem">${d.razon.split(' ').slice(0,3).join(' ')}</span><span class="exp-val" style="font-size:.6rem;color:#818cf8">${motivo}</span></div>`; });

  document.getElementById('exp-content').innerHTML=`
    <div class="exp-section">
      <div class="exp-row"><span class="exp-label">🚛 Camión</span><span class="exp-val">${activeChofer}</span></div>
      <div class="exp-row"><span class="exp-label">📅 Fecha</span><span class="exp-val">${activeFecha}</span></div>
      <div class="exp-row"><span class="exp-label">🕐 Generado</span><span class="exp-val" style="font-size:.62rem">${now}</span></div>
    </div>
    <div class="exp-section">
      <div class="exp-row"><span class="exp-label">📦 Total pedidos</span><span class="exp-val blue">${tot} — $${totalVal.toFixed(2)}</span></div>
      <div class="exp-row"><span class="exp-label">✅ Entregados</span><span class="exp-val green">${entregadosCount} — $${entVal.toFixed(2)}</span></div>
      <div class="exp-row" style="padding-left:16px"><span class="exp-label" style="font-size:.64rem">💵 Efectivo</span><span class="exp-val green" style="font-size:.7rem">$${metSum.EFECTIVO.toFixed(2)}</span></div>
      <div class="exp-row" style="padding-left:16px"><span class="exp-label" style="font-size:.64rem">🏦 Transferencia</span><span class="exp-val blue" style="font-size:.7rem">$${metSum.TRANSFERENCIA.toFixed(2)}</span></div>
      <div class="exp-row" style="padding-left:16px"><span class="exp-label" style="font-size:.64rem">🧾 Cheque</span><span class="exp-val" style="font-size:.7rem;color:#a78bfa">$${metSum.CHEQUE.toFixed(2)}</span></div>
      <div class="exp-row" style="padding-left:16px"><span class="exp-label" style="font-size:.64rem">📄 Crédito (paga después)</span><span class="exp-val" style="font-size:.7rem;color:#fbbf24">$${metSum.CREDITO.toFixed(2)}</span></div>
      <div class="exp-row"><span class="exp-label">🟠 Por cobrar</span><span class="exp-val orange">${xcCount} — $${xcVal.toFixed(2)}</span></div>
      <div class="exp-row"><span class="exp-label">💰 NC Parciales</span><span class="exp-val red">${ncCount} — $${ncVal.toFixed(2)}</span></div>
      <div class="exp-row"><span class="exp-label">🧾 Retención 2%</span><span class="exp-val" style="color:#c084fc">${retenCount} — $${retenVal.toFixed(2)}</span></div>
      <div class="exp-row"><span class="exp-label">🔥 Quemado (de NC · ya en Entregados)</span><span class="exp-val" style="color:#fb923c">${quemCount} — $${quemMonto.toFixed(2)}</span></div>
      <div class="exp-row"><span class="exp-label">❌ Anulados</span><span class="exp-val" style="color:#818cf8">${anulCount} — $${anulVal.toFixed(2)}</span></div>
      <div class="exp-row"><span class="exp-label">⏳ Pendientes</span><span class="exp-val">${pend}</span></div>
      <div class="exp-row" style="border-top:2px solid #1e3a5f;margin-top:4px;padding-top:6px"><span class="exp-label" style="font-weight:800;color:#4ade80">💵 A DEPOSITAR (efectivo)</span><span class="exp-val green" style="font-size:.9rem">$${metSum.EFECTIVO.toFixed(2)}</span></div>
    </div>
    ${anulDetalle?`<div class="exp-section"><div style="font-size:.6rem;color:#64748b;font-weight:700;margin-bottom:4px">MOTIVOS DE ANULACIÓN</div>${anulDetalle}</div>`:''}`;

  // Guardar en historial automáticamente al exportar
  saveLocalState();
}
function getReporteTexto(){
  const tot=DATA.length, vis=completed.size, xcCount=porCobrar.size;
  const quemCount=quemados.size, anulCount=anulados.size;
  const pend=Math.max(0,tot-vis-xcCount-quemCount-anulCount);
  const totalVal=DATA.reduce((s,d)=>s+d.total,0);
  let entVal=0,ncVal=0,retenVal=0,retenCount=0,ncCount=0;
  DATA.forEach((d,i)=>{
    if(!completed.has(i))return;
    if(devParcial.has(i)){
      const p=devParcial.get(i); entVal+=p;
      const dif=d.total-p;
      if(d.hasRet && (d.retencionVal||0)>0 && Math.abs(dif-d.retencionVal)<0.02){ retenVal+=dif; retenCount++; }
      else if(dif>0.009){ ncVal+=dif; ncCount++; }
    } else { entVal+=d.total; }
  });
  const xcVal=DATA.filter((_,i)=>porCobrar.has(i)).reduce((s,d)=>s+d.total,0);
  let quemMonto=0;
  DATA.forEach((d,i)=>{
    if(!quemados.has(i))return;
    const q=Math.min(quemadoParcial.has(i)?quemadoParcial.get(i):d.total, d.total);
    entVal+=q; quemMonto+=q;
    const dif=Math.max(0,d.total-q);
    if(dif>0.009){ ncVal+=dif; ncCount++; }
  });
  const entregadosCount = vis + quemCount;
  const metSum={EFECTIVO:0,TRANSFERENCIA:0,CHEQUE:0,CREDITO:0};
  DATA.forEach((d,i)=>{
    let amt=0;
    if(completed.has(i)) amt = devParcial.has(i)?devParcial.get(i):d.total;
    else if(quemados.has(i)) amt = Math.min(quemadoParcial.has(i)?quemadoParcial.get(i):d.total, d.total);
    else return;
    const m=metodoPago.get(i);
    metSum[(m && metSum[m]!==undefined)?m:'EFECTIVO'] += amt;
  });
  const anulVal=DATA.filter((_,i)=>anulados.has(i)).reduce((s,d)=>s+d.total,0);
  const now=new Date().toLocaleString('es-EC');
  let txt=`🚛 *REPORTE DE RUTA*\n`;
  txt+=`${activeChofer} | ${activeFecha}\n`;
  txt+=`🕐 ${now}\n\n`;
  txt+=`📦 Total: ${tot} pedidos — $${totalVal.toFixed(2)}\n`;
  txt+=`✅ Entregados: ${entregadosCount} — $${entVal.toFixed(2)} recaudado\n`;
  txt+=`   💵 Efectivo: $${metSum.EFECTIVO.toFixed(2)}\n`;
  txt+=`   🏦 Transferencia: $${metSum.TRANSFERENCIA.toFixed(2)}\n`;
  txt+=`   🧾 Cheque: $${metSum.CHEQUE.toFixed(2)}\n`;
  txt+=`   📄 Crédito: $${metSum.CREDITO.toFixed(2)}\n`;
  txt+=`🟠 Por cobrar: ${xcCount} — $${xcVal.toFixed(2)}\n`;
  if(ncVal>0) txt+=`💰 NC Parciales: ${ncCount} — $${ncVal.toFixed(2)}\n`;
  if(retenCount>0) txt+=`🧾 Retención 2%: ${retenCount} — $${retenVal.toFixed(2)}\n`;
  if(quemCount>0) txt+=`🔥 Quemado (de NC · ya en Entregados): ${quemCount} — $${quemMonto.toFixed(2)}\n`;
  txt+=`❌ Anulados: ${anulCount} — $${anulVal.toFixed(2)}\n`;
  txt+=`⏳ Pendientes: ${pend}\n`;
  txt+=`\n💵 *A DEPOSITAR (efectivo): $${metSum.EFECTIVO.toFixed(2)}*\n`;
  if(anulados.size){
    txt+=`\n📋 MOTIVOS ANULACIÓN:\n`;
    anulados.forEach((motivo,i)=>{const d=DATA[i];if(d)txt+=`• ${d.razon.split(' ').slice(0,3).join(' ')}: ${motivo}\n`;});
  }
  return txt;
}
function exportarWA(){
  const txt=getReporteTexto();
  window.open('https://wa.me/?text='+encodeURIComponent(txt),'_blank');
}
function exportarCopiar(){
  const txt=getReporteTexto();
  navigator.clipboard.writeText(txt).then(()=>alert('✅ Reporte copiado al portapapeles'));
}

// ══════════════════════════════════════════════════════════════
// 7. HISTORIAL LOCAL
// ══════════════════════════════════════════════════════════════
function saveLocalState(){
  try{
    const state={
      fecha:activeFecha, chofer:activeChofer,
      completed:[...completed], porCobrar:[...porCobrar],
      quemados:[...quemados],
      anulados:[...anulados.entries()],
      devParcial:[...devParcial.entries()],
      notas:[...notas.entries()],
      retencion:[...retencionSet],
      quemadoParcial:[...quemadoParcial.entries()],
      metodoPago:[...metodoPago.entries()],
      savedAt:new Date().toISOString()
    };
    // Save current route state
    localStorage.setItem('mapaState_current', JSON.stringify(state));
    // Save to historial
    const key=`mapaHist_${activeFecha}_${activeChofer.replace(/\s/g,'_')}`;
    localStorage.setItem(key, JSON.stringify({...state, summary: getReporteTexto()}));
  }catch(e){console.warn('LocalStorage not available');}
}
function loadLocalState(){
  try{
    // Restaura el estado propio de ESTE camión+fecha (guardado en su espacio por-camión),
    // no el último genérico. Así cambiar de camión y volver ya no pierde ni mezcla el avance.
    const key=`mapaHist_${activeFecha}_${activeChofer.replace(/\s/g,'_')}`;
    let raw=localStorage.getItem(key);
    if(!raw){
      const cur=localStorage.getItem('mapaState_current');
      if(cur){ const c=JSON.parse(cur); if(c.fecha===activeFecha && c.chofer===activeChofer) raw=cur; }
    }
    if(!raw)return;
    const s=JSON.parse(raw);
    if(s.fecha===activeFecha && s.chofer===activeChofer){
      completed=new Set(s.completed||[]);
      porCobrar=new Set(s.porCobrar||[]);
      quemados=new Set(s.quemados||[]);
      anulados=new Map(s.anulados||[]);
      devParcial=new Map((s.devParcial||[]).map(([k,v])=>[k,Number(v)]));
      notas=new Map(s.notas||[]);
      retencionSet=new Set(s.retencion||[]);
      quemadoParcial=new Map((s.quemadoParcial||[]).map(([k,v])=>[k,Number(v)]));
      metodoPago=new Map(s.metodoPago||[]);
      DATA.forEach((_,i)=>refreshMarkerIcon(i));
      updateProgress();updateStats();updatePanel();updateBottomBar();
      console.log('Estado restaurado desde caché local (por camión)');
    }
  }catch(e){console.warn('No se pudo restaurar estado:',e);}
}

// ══════════════════════════════════════════════════════════════
// JORNADA — bloqueo de un solo mapa para transportista / reparto
// El chofer elige fecha+camión+bodega+liquidación una vez, "inicia jornada"
// y queda fijo en ese mapa (no puede saltar a otro) hasta el "Cierre de
// liquidación". La selección se guarda: si cierra/reabre la app, vuelve al
// mismo mapa. El avance NO se borra al cerrar (puede reingresar a poner fotos).
// ══════════════════════════════════════════════════════════════
const ROLES_JORNADA=['transportista','reparto'];
let _ultimaSigModalJornada=null;
function esRolChofer(){ const s=getSesion(); return !!(s && ROLES_JORNADA.includes(s.rol)); }
function getJornada(){ try{ return JSON.parse(localStorage.getItem('jornadaActiva')||'null'); }catch(e){ return null; } }
function setJornada(j){ try{ if(j) localStorage.setItem('jornadaActiva', JSON.stringify(j)); else localStorage.removeItem('jornadaActiva'); }catch(e){} }
function selSignatureJornada(){ return `${activeFecha}|${activeChofer}|${activeBodega}|${[...activeLiqs].sort().join(',')}`; }

// Habilita/deshabilita los selectores de fecha/camión/bodega/liquidación.
function bloquearSelectores(bloq){
  ['sel-fecha','sel-chofer','sel-bodega'].forEach(id=>{
    const el=document.getElementById(id);
    if(el){ el.disabled=bloq; el.style.opacity=bloq?'.5':''; el.style.cursor=bloq?'not-allowed':''; }
  });
  const chips=document.getElementById('liq-chips');
  if(chips){ chips.style.pointerEvents=bloq?'none':''; chips.style.opacity=bloq?'.5':''; }
  const apply=document.querySelector('.liq-apply');
  if(apply){ apply.style.display=bloq?'none':''; }
}

// Refleja en la UI el estado actual de la jornada (banner, botón cierre, bloqueo).
function actualizarUIJornada(){
  const btn=document.getElementById('btn-cierre-liq');
  const banner=document.getElementById('jornada-banner');
  const j=getJornada();
  const activa=esRolChofer() && j && j.iniciada;
  if(activa){
    bloquearSelectores(true);
    if(btn) btn.style.display='flex';
    if(banner){ banner.style.display='flex'; const info=document.getElementById('jornada-info'); if(info) info.textContent=`${j.chofer} · ${j.fecha}`; }
  } else {
    bloquearSelectores(false);
    if(btn) btn.style.display='none';
    if(banner) banner.style.display='none';
  }
}

// Liquidaciones disponibles para el camión+fecha activos.
function liqsDisponibles(){
  const rows=ALL_ROWS.filter(r=>r.fecha===activeFecha&&r.chofer===activeChofer);
  return [...new Set(rows.map(r=>r.liq).filter(Boolean))].sort((a,b)=>Number(a)-Number(b)||a.localeCompare(b));
}
// Si es chofer, no hay jornada activa y ya hay ruta dibujada → ofrecer iniciar jornada.
// Si el camión tiene 1 sola liquidación, arranca directo; con 2 o más, deja elegir cuáles lleva.
function quizasPedirInicioJornada(){
  if(!esRolChofer()) return;
  if(getJornada()) return;
  if(!DATA.length) return;
  const sig=selSignatureJornada();
  if(sig===_ultimaSigModalJornada) return; // ya se preguntó por esta misma selección
  _ultimaSigModalJornada=sig;
  const b=BODEGAS[activeBodega];
  document.getElementById('jornada-modal-info').innerHTML=`🚛 <b>${activeChofer}</b><br>📅 ${activeFecha} · 🏭 ${b?b.nombre:'—'}`;
  const liqs=liqsDisponibles();
  const wrap=document.getElementById('jornada-liq-wrap');
  document.getElementById('jornada-liq-msg').textContent='';
  if(liqs.length>=2){
    wrap.innerHTML=`<div style="font-size:.66rem;color:#94a3b8;font-weight:700;text-transform:uppercase;letter-spacing:.4px;margin:12px 0 8px;text-align:center">📋 Elige las liquidaciones que llevas</div>`
      +`<div id="jornada-liq-list" style="display:flex;flex-wrap:wrap;gap:8px;justify-content:center">`
      +liqs.map(l=>`<label class="liq-chip sel" data-liq="${l}"><input type="checkbox" checked style="display:none"> Liq ${l}</label>`).join('')
      +`</div>`;
    wrap.querySelectorAll('.liq-chip').forEach(ch=>ch.addEventListener('click',e=>{ e.preventDefault(); ch.classList.toggle('sel'); }));
  } else if(liqs.length===1){
    wrap.innerHTML=`<div style="text-align:center;font-size:.72rem;color:#94a3b8;margin:12px 0">📋 Liquidación única: <b style="color:#e2e8f0">Liq ${liqs[0]}</b></div>`;
  } else {
    wrap.innerHTML='';
  }
  document.getElementById('jornada-modal').classList.add('show');
}
function iniciarJornada(){
  const liqs=liqsDisponibles();
  if(liqs.length>=2){
    const sel=[...document.querySelectorAll('#jornada-liq-list .liq-chip.sel')].map(c=>c.dataset.liq);
    if(!sel.length){ document.getElementById('jornada-liq-msg').textContent='Selecciona al menos una liquidación para iniciar.'; return; }
    activeLiqs=new Set(sel);
  }
  setJornada({ fecha:activeFecha, chofer:activeChofer, bodega:activeBodega, liqs:[...activeLiqs], iniciada:true, ts:new Date().toISOString() });
  document.getElementById('jornada-modal').classList.remove('show');
  buildLiqChips(false);   // refleja la selección elegida en los chips del filtro
  applyFiltersAndDraw();  // redibuja SOLO las liquidaciones elegidas y bloquea (jornada ya activa)
}
function cancelarInicioJornada(){
  document.getElementById('jornada-modal').classList.remove('show');
  // No se bloquea; puede cambiar la selección y se volverá a preguntar.
}

// Reaplica la selección guardada de la jornada (usado al cargar/refrescar).
function aplicarSeleccionJornada(){
  const j=getJornada();
  if(!j) return;
  const selCh=document.getElementById('sel-chofer');
  if(selCh && [...selCh.options].some(o=>o.value===j.chofer)){ selCh.value=j.chofer; activeChofer=j.chofer; }
  if(j.bodega && BODEGAS[j.bodega]){ activeBodega=j.bodega; const sb=document.getElementById('sel-bodega'); if(sb) sb.value=j.bodega; }
  buildLiqChips(true);
  if(j.liqs && j.liqs.length){ activeLiqs=new Set(j.liqs); buildLiqChips(false); }
}

// Cierre de liquidación: libera la selección (avance se conserva).
function cerrarLiquidacion(){
  const j=getJornada();
  if(!j){ actualizarUIJornada(); return; }
  const pend=DATA.reduce((n,d,i)=> n + ((completed.has(i)||porCobrar.has(i)||quemados.has(i)||anulados.has(i))?0:1), 0);
  let msg=`¿Cerrar la liquidación de ${j.chofer} (${j.fecha})?`;
  if(pend>0) msg+=`\n\n⚠️ Quedan ${pend} cliente(s) sin marcar. Se cerrará de todos modos.`;
  msg+='\n\nDespués podrás elegir otra ruta, o volver a esta (tu avance queda guardado) para registrar las fotos de los depósitos.';
  if(!confirm(msg)) return;
  setJornada(null);
  _ultimaSigModalJornada=null;
  actualizarUIJornada();
  if(confirm('¿Registrar ahora el Cuadre de guía (dinero recaudado + fotos de depósito)?')){
    abrirCuadre();
  }
}
function guardarRutaHoy(){
  saveLocalState();
  loadHistorialPanel();
  alert('✅ Ruta guardada en el historial local');
}
function abrirHistorial(){
  loadHistorialPanel();
  document.getElementById('hist-panel').classList.add('open');
  document.getElementById('hist-overlay').style.display='block';
}
function cerrarHistorial(){
  document.getElementById('hist-panel').classList.remove('open');
  document.getElementById('hist-overlay').style.display='none';
}
function loadHistorialPanel(){
  const list=document.getElementById('hist-list');
  if(!list)return;
  const keys=[];
  for(let i=0;i<localStorage.length;i++){
    const k=localStorage.key(i);
    if(k&&k.startsWith('mapaHist_'))keys.push(k);
  }
  if(!keys.length){list.innerHTML='<div style="color:#475569;font-size:.72rem;text-align:center;padding:20px">Sin historial guardado</div>';return;}
  keys.sort().reverse();
  list.innerHTML=keys.map(k=>{
    try{
      const s=JSON.parse(localStorage.getItem(k));
      const vis=(s.completed||[]).length, xc=(s.porCobrar||[]).length;
      const quem=(s.quemados||[]).length, anulC=(s.anulados||[]).length;
      const savedAt=s.savedAt?new Date(s.savedAt).toLocaleString('es-EC'):'—';
      return `<div class="hist-item" onclick="verHistorial('${k}')">
        <div class="hist-date">📅 ${s.fecha} — ${s.chofer}</div>
        <div class="hist-meta">✅${vis} 🟠${xc} 🔥${quem} ❌${anulC} · ${savedAt}</div>
        <button onclick="event.stopPropagation();borrarHistorial('${k}')" style="margin-top:4px;background:#7f1d1d;border:none;color:#fca5a5;padding:2px 7px;border-radius:5px;font-size:.58rem;cursor:pointer">🗑 Borrar</button>
      </div>`;
    }catch{return '';}
  }).join('');
}
function verHistorial(k){
  try{
    const s=JSON.parse(localStorage.getItem(k));
    alert(s.summary||'Sin resumen disponible');
  }catch{alert('No se pudo cargar el historial');}
}
function borrarHistorial(k){
  if(!confirm('¿Borrar este registro del historial?'))return;
  localStorage.removeItem(k);
  loadHistorialPanel();
}

let primeraCarga=true;
function aplicarFechaDesdeURL(){
  const params=new URLSearchParams(window.location.search);
  const fecha=params.get('fecha');
  const selFecha=document.getElementById('sel-fecha');
  if(fecha && [...selFecha.options].some(o=>o.value===fecha)){
    selFecha.value=fecha; activeFecha=fecha;
  }
}
function aplicarChoferBodegaDesdeURL(){
  const params=new URLSearchParams(window.location.search);
  const chofer=params.get('chofer'), bodega=params.get('bodega');
  if(chofer){
    const selCh=document.getElementById('sel-chofer');
    if([...selCh.options].some(o=>o.value===chofer)){
      selCh.value=chofer; activeChofer=chofer; buildLiqChips(true);
    }
  }
  if(bodega && BODEGAS[bodega]){
    activeBodega=bodega;
    document.getElementById('sel-bodega').value=bodega;
  }
}
async function loadAndRender(){
  try{
    // Si venimos del resumen con ?fecha=... en la URL, ya sabemos qué día pedir,
    // así que lanzamos AMBAS consultas en paralelo (fechas + datos) en vez de una tras otra.
    const params=new URLSearchParams(window.location.search);
    const fechaURL=params.get('fecha');
    // Chofer con jornada activa: su mapa manda sobre la URL y se mantiene fijo.
    const jornadaAct=(esRolChofer() && getJornada() && getJornada().iniciada) ? getJornada() : null;
    const fechaForzada=fechaURL || (jornadaAct ? jornadaAct.fecha : '');
    if(primeraCarga && fechaForzada){
      activeFecha=fechaForzada;
      const [fechas, rows]=await Promise.all([ fetchFechas(), fetchData(fechaForzada) ]);
      FECHAS_DISPONIBLES=fechas;
      buildFechaSelector();
      ALL_ROWS=rows;
      buildChoferSelector();
      if(jornadaAct) aplicarSeleccionJornada(); else aplicarChoferBodegaDesdeURL();
      primeraCarga=false;
    } else {
      FECHAS_DISPONIBLES=await fetchFechas();
      buildFechaSelector();
      if(primeraCarga) aplicarFechaDesdeURL();
      ALL_ROWS=await fetchData(activeFecha);
      buildChoferSelector();
      if(primeraCarga){ aplicarChoferBodegaDesdeURL(); primeraCarga=false; }
      if(jornadaAct) aplicarSeleccionJornada(); // refresco: mantener fija la selección de la jornada
    }
    if(!GEO_LOADED){ try{ GEO_OVERRIDES=await fetchGeo(); GEO_LOADED=true; }catch(e){} }
    if(!CANAL_LOADED){ try{ CANAL_MAP=await fetchCanales(); CANAL_LOADED=true; }catch(e){} }
    aplicarGeoOverrides(ALL_ROWS);
    aplicarCanalCategoria(ALL_ROWS);
    applyFiltersAndDraw();
    document.getElementById('ultima-act').textContent=`Act: ${new Date().toLocaleTimeString('es-EC',{hour:'2-digit',minute:'2-digit'})}`;
    document.getElementById('overlay').classList.add('hidden');
    actualizarUIJornada();
  }catch(err){
    document.getElementById('load-src').textContent='';
    const em=document.getElementById('error-msg');
    em.style.display='block';
    em.innerHTML=`❌ Error al cargar datos:<br><b>${err.message}</b><br><br>Verifica que el Apps Script esté publicado<br>con acceso <b>"Cualquier persona"</b>.`;
    console.error(err);
  }
}
