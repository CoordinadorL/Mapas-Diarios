// ═══════════════════════════════════════════════════════════
// MAPA-RENDER.JS — dibujar el mapa: filtros + orden de ruta, marcador de
// bodega, colores por vendedor, ícono de cada cliente (makeIcon), limpiar y
// redibujar marcadores/líneas, y los botones de vista (Ruta/Números/
// Cluster/Día/Leyenda). Cuarto módulo separado de mapa_live_F150.html.
//
// makeIcon() y draw() siguen llamando a buildPopup() (todavía en el script
// principal, se moverá en un módulo posterior junto con los estados de
// entrega) -- funciona igual porque todo comparte el mismo scope global.
// ═══════════════════════════════════════════════════════════

function drawBodegaMarker(){
  if(bodegaMarker){map.removeLayer(bodegaMarker);bodegaMarker=null;}
  if(!activeBodega) return; // sin bodega seleccionada, no se dibuja marcador
  const bodega=BODEGAS[activeBodega];
  if(!bodega) return;
  bodegaMarker=L.marker([bodega.lat,bodega.lng],{
    icon:L.divIcon({className:'',html:`<div style="background:#0f172a;border:2.5px solid #fbbf24;width:30px;height:30px;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:15px;box-shadow:0 2px 8px rgba(0,0,0,.5)">🏭</div>`,iconSize:[30,30],iconAnchor:[15,15]}),
    zIndexOffset:900
  }).addTo(map).bindPopup(`<b>🏭 Bodega ${bodega.nombre}</b><br>Punto de partida de la ruta`);
}

// ── FILTRAR + OPTIMIZAR ────────────────────────────────────
function applyFiltersAndDraw(){
  // Limpiar TODOS los estados (no solo completed) para no mezclar datos entre camiones.
  completed.clear();porCobrar.clear();quemados.clear();anulados.clear();devParcial.clear();notas.clear();retencionSet.clear();quemadoParcial.clear();metodoPago.clear();
  activeVendedor='ALL';
  const noData=document.getElementById('no-data');
  if(!activeChofer){
    DATA=[];clearMap();drawBodegaMarker();
    noData.querySelector('p').textContent='Selecciona un camión para ver su ruta';
    noData.style.display='block';
    updateStats();updateProgress();
    return;
  }
  if(!activeBodega){
    DATA=[];clearMap();drawBodegaMarker();
    noData.querySelector('p').textContent='Selecciona la bodega desde la que carga el camión';
    noData.style.display='block';
    updateStats();updateProgress();
    return;
  }
  let filtered=ALL_ROWS.filter(r=>r.fecha===activeFecha&&r.chofer===activeChofer);
  const hasLiq=filtered.some(r=>r.liq);
  if(hasLiq&&activeLiqs.size&&!activeLiqs.has('__ALL__'))filtered=filtered.filter(r=>activeLiqs.has(r.liq));
  if(!filtered.length){DATA=[];clearMap();drawBodegaMarker();noData.querySelector('p').textContent='Selecciona una fecha, camión y al menos una liquidación';noData.style.display='block';updateStats();updateProgress();return;}
  noData.style.display='none';
  const pts=filtered.map(r=>({lat:r.lat,lng:r.lng}));
  const bodega=BODEGAS[activeBodega];
  DATA=nearestNeighborFrom(pts,bodega.lat,bodega.lng).map(i=>filtered[i]);
  // loadLocalState() ANTES de construir nada: restaura completed/porCobrar/etc
  // desde el caché de este camión+fecha (recién se limpiaron arriba). Antes
  // iba al final, después de buildPanel() -- pero buildPanel() ya dispara su
  // propio guardado (updatePanel -> saveLocalState) con los Sets todavía
  // vacíos, así que sobreescribía el avance guardado con nada ANTES de que
  // loadLocalState() alcanzara a leerlo: recargar la misma ruta (mismo
  // camión+fecha) borraba el progreso local en vez de restaurarlo, salvo que
  // el poll al servidor (cada 12s, necesita señal) lo corrigiera después.
  // refreshMarkerIcon/updatePanel dentro de loadLocalState() son no-op seguros
  // aquí (todavía no existen marcadores ni filas del panel), así que no hay
  // problema en llamarla antes de construir la UI -- al revés, así construye
  // todo ya con el estado correcto desde el primer dibujo.
  loadLocalState();
  buildColorMap(DATA);buildVendedorBtns(DATA);buildLegend(DATA);
  updateStats();updateProgress();updateBanner();buildPanel();
  resetVendedorBtns();
  draw('ALL');
  updateBottomBar();
  const liqLabel=hasLiq&&activeLiqs.size?` | Liq: ${[...activeLiqs].sort().join(', ')}`:'';
  document.getElementById('sub-info').textContent=`${activeFecha} | ${activeChofer} | 🏭 ${bodega.nombre}${liqLabel}`;
  actualizarUIJornada();
  quizasPedirInicioJornada();
}

// ── MAPA ──────────────────────────────────────────────────
function buildColorMap(rows){colorMap={};[...new Set(rows.map(r=>r.vendedor))].sort().forEach((v,i)=>colorMap[v]=PALETTE[i%PALETTE.length]);}
function buildVendedorBtns(rows){
  const vs=[...new Set(rows.map(r=>r.vendedor))].sort();
  const con=document.getElementById('vendedor-btns');
  con.innerHTML=`<button class="fbtn on" data-v="ALL" style="border-color:#94a3b8;background:#94a3b8;color:#000" onclick="fv('ALL',this)">Todos</button> `;
  vs.forEach(v=>{const col=colorMap[v];const b=document.createElement('button');b.className='fbtn';b.dataset.v=v;b.style.cssText=`border-color:${col}`;b.textContent=v;b.onclick=function(){fv(v,this);};con.appendChild(b);con.appendChild(document.createTextNode(' '));});
}
function resetVendedorBtns(){document.querySelectorAll('.fbtn[data-v]').forEach(b=>{b.classList.remove('on');b.style.background='transparent';b.style.color='#fff';});const a=document.querySelector('.fbtn[data-v="ALL"]');if(a){a.classList.add('on');a.style.background='#94a3b8';a.style.color='#000';}}
function buildLegend(rows){const vs=[...new Set(rows.map(r=>r.vendedor))].sort();document.getElementById('legend-items').innerHTML=vs.map(v=>`<div class="li"><div class="ld" style="background:${colorMap[v]}"></div>${v}</div>`).join('');}

function makeIcon(vendorColor,num,isFirst,d,offsetY=0){
  if(!d)d={total:0,razon:'',vendedor:''};
  const realIdx=DATA.indexOf(d);
  const visited=completed.has(realIdx);
  const xc=!visited&&porCobrar.has(realIdx);
  const isNC=!visited&&!xc&&anulados.has(realIdx);
  const isQuemIcon=!visited&&!xc&&!isNC&&quemados.has(realIdx);
  const quemVal=quemadoParcial.has(realIdx)?quemadoParcial.get(realIdx):(isQuemIcon?d.total:0);
  const pendQuemaIcon=isQuemIcon?Math.max(0,d.total-quemVal):0;
  const tier=showNums?getTierEfectivo(d):'normal';
  let dotColor=vendorColor,ring='',pulse='',extraSize=0,tierIcon='';
  let labelBg='transparent',labelColor='',labelBorder='transparent';

  const isMayoristaIcon = d.canalCat==='MAYORISTA';

  if(isQuemIcon&&pendQuemaIcon>0.009){dotColor='#c2410c';ring='box-shadow:0 0 0 2px #fdba74,0 0 8px 3px rgba(249,115,22,.5);';}
  else if(visited||isQuemIcon){dotColor='#4b5563';ring='opacity:.5;';}
  else if(isNC){dotColor='#111827';ring='opacity:.4;border-color:#374151;';}
  else if(xc){dotColor='#f97316';ring='box-shadow:0 0 0 2px #fdba74,0 0 8px 3px rgba(249,115,22,.45);';}
  // Mayorista pendiente: morado siempre, sin importar el monto (identificación rápida en el mapa).
  else if(isMayoristaIcon){dotColor='#9333ea';ring='box-shadow:0 0 0 2px #d8b4fe,0 0 9px 3px rgba(147,51,234,.5);';}
  else if(tier==='high'){dotColor='#dc2626';ring='box-shadow:0 0 0 3px #fca5a5,0 0 14px 5px rgba(239,68,68,.5);';pulse='animation:pingRed 1.2s ease-in-out infinite;';extraSize=6;tierIcon='🔴';labelBg='#7f1d1d';labelColor='#fecaca';labelBorder='#f87171';}
  else if(tier==='medium'){dotColor='#ca8a04';ring='box-shadow:0 0 0 2px #fde68a,0 0 9px 3px rgba(234,179,8,.45);';extraSize=3;tierIcon='🟡';labelBg='#78350f';labelColor='#fef3c7';labelBorder='#fbbf24';}

  const size=isFirst?34+extraSize:27+extraSize;
  const fs=num>=100?'7px':num>=10?'8px':'9px';
  const inner=isFirst?`<div style="font-size:7px;line-height:1">★</div><div style="font-size:7px;font-weight:800">${num}</div>`:`<span style="font-size:${fs};font-weight:800">${visited?'✓':xc?'$':num}</span>`;
  const nombre=d.razon?d.razon.trim().split(/\s+/).slice(0,3).join(' '):'';
  const valorLine=tier!=='normal'&&!visited&&!isQuemIcon?`<div style="display:inline-block;background:${labelBg};border:1px solid ${labelBorder};color:${labelColor};font-size:9.5px;font-weight:800;padding:1px 6px;border-radius:5px;box-shadow:0 2px 6px rgba(0,0,0,.5);white-space:nowrap;">${tierIcon} $${d.total.toFixed(0)}</div>`:'';
  const pendLine=pendQuemaIcon>0.009?`<div style="display:inline-block;background:#7c2d12;border:1px solid #f97316;color:#fed7aa;font-size:9.5px;font-weight:800;padding:1px 6px;border-radius:5px;box-shadow:0 2px 6px rgba(0,0,0,.5);white-space:nowrap;">🔥 Pend $${pendQuemaIcon.toFixed(0)}</div>`:'';
  const nombreLine=showNums?`<div style="font-size:9px;font-weight:700;color:${darkMode?'#f1f5f9':'#1e293b'};text-shadow:${darkMode?'-1px -1px 0 #0f172a,1px -1px 0 #0f172a,-1px 1px 0 #0f172a,1px 1px 0 #0f172a':'-1px -1px 0 #fff,1px -1px 0 #fff,-1px 1px 0 #fff,1px 1px 0 #fff'};white-space:nowrap;max-width:130px;overflow:hidden;text-overflow:ellipsis;margin-top:${(valorLine||pendLine)?'2px':'0'};pointer-events:none;${visited?'text-decoration:line-through;opacity:.6;':''}">${nombre}</div>`:'';
  const connector=offsetY>0?`<div style="position:absolute;left:50%;top:${size+1}px;width:1px;height:${offsetY+2}px;background:rgba(148,163,184,.3);transform:translateX(-50%);pointer-events:none"></div>`:'';
  const label=showNums?`<div style="position:absolute;top:${size+3+offsetY}px;left:50%;transform:translateX(-50%);text-align:center;line-height:1.4;pointer-events:none;white-space:nowrap;z-index:10;">${valorLine}${pendLine}${nombreLine}</div>`:'';
  const totalH=size+46+offsetY;
  return L.divIcon({className:'',html:`<div style="position:relative;width:${size}px;height:${totalH}px;"><div style="background:${dotColor};width:${size}px;height:${size}px;border-radius:50%;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#fff;border:2px solid #fff;${ring}cursor:pointer;${pulse}">${inner}</div>${connector}${label}</div>`,iconSize:[size,totalH],iconAnchor:[size/2,size/2],popupAnchor:[0,-size/2-2]});
}

function clearMap(){
  allMarkers.forEach(m=>map.removeLayer(m));
  allLines.forEach(l=>map.removeLayer(l));
  if(clusterGroup){map.removeLayer(clusterGroup);clusterGroup=null;}
  allMarkers=[];allLines=[];
}

function draw(filter){
  clearMap();
  const fd=filter==='ALL'?DATA:DATA.filter(d=>d.vendedor===filter);
  drawBodegaMarker();
  if(bodegaLine){map.removeLayer(bodegaLine);bodegaLine=null;}
  if(!fd.length)return;

  const bodega=BODEGAS[activeBodega]||BODEGAS.riobamba;
  if(showRuta){
    bodegaLine=L.polyline([[bodega.lat,bodega.lng],[fd[0].lat,fd[0].lng]],{color:'#fbbf24',weight:3,opacity:.8,dashArray:'4,7'}).addTo(map);
  }

  if(showRuta&&fd.length>1){
    const line=L.polyline(fd.map(d=>[d.lat,d.lng]),{color:'#3b82f6',weight:3,opacity:.75,dashArray:'8,5'}).addTo(map);
    allLines.push(line);
    for(let i=0;i<fd.length-1;i++){
      const dist=haversine(fd[i].lat,fd[i].lng,fd[i+1].lat,fd[i+1].lng);
      if(dist<0.35){
        const mid=[(fd[i].lat+fd[i+1].lat)/2,(fd[i].lng+fd[i+1].lng)/2];
        const lbl=L.marker(mid,{icon:L.divIcon({className:'',html:`<div style="background:rgba(15,23,42,.8);color:#93c5fd;font-size:9px;padding:1px 4px;border-radius:4px;white-space:nowrap">${(dist*1000).toFixed(0)}m</div>`,iconAnchor:[18,8]})}).addTo(map);
        allLines.push(lbl);
      }
    }
  }

  LABEL_OFFSETS=computeLabelOffsets(DATA);

  if(useCluster){
    clusterGroup=L.markerClusterGroup({maxClusterRadius:50,showCoverageOnHover:false});
    fd.forEach(d=>{
      const ri=DATA.indexOf(d);
      const col=colorMap[d.vendedor]||'#888';
      const icon=makeIcon(col,ri+1,ri===0,d,0);
      const m=L.marker([d.lat,d.lng],{icon}).bindPopup(buildPopup(d,ri),{maxWidth:320,minWidth:285});
      clusterGroup.addLayer(m);
      allMarkers.push(m);
    });
    map.addLayer(clusterGroup);
  } else {
    fd.forEach(d=>{
      const ri=DATA.indexOf(d);
      const col=colorMap[d.vendedor]||'#888';
      const icon=makeIcon(col,ri+1,ri===0,d,LABEL_OFFSETS[ri]||0);
      const m=L.marker([d.lat,d.lng],{icon}).addTo(map).bindPopup(buildPopup(d,ri),{maxWidth:320,minWidth:285});
      allMarkers.push(m);
    });
  }
  map.fitBounds(L.latLngBounds([...fd.map(d=>[d.lat,d.lng]),[bodega.lat,bodega.lng]]),{padding:[40,40]});
}

// ── CONTROLES ─────────────────────────────────────────────
function fv(v,btn){
  activeVendedor=v;
  document.querySelectorAll('.fbtn[data-v]').forEach(b=>{b.classList.remove('on');b.style.background='transparent';b.style.color='#fff';});
  btn.classList.add('on');btn.style.background=btn.style.borderColor;btn.style.color=v==='ALL'?'#000':'#fff';
  draw(activeVendedor);
}
function toggleRuta(btn){
  showRuta=!showRuta;
  btn.style.background=showRuta?'#1d4ed8':'transparent';
  btn.style.borderColor=showRuta?'#3b82f6':'#475569';
  btn.style.color=showRuta?'#fff':'#64748b';
  draw(activeVendedor);
}
function toggleNums(btn){
  showNums=!showNums;
  btn.style.background=showNums?'#15803d':'transparent';
  btn.style.borderColor=showNums?'#22c55e':'#475569';
  btn.style.color=showNums?'#fff':'#64748b';
  draw(activeVendedor);
}
function toggleCluster(btn){
  useCluster=!useCluster;
  btn.classList.toggle('on',useCluster);
  draw(activeVendedor);
}
function toggleDark(btn){
  darkMode=!darkMode;
  if(tileLayer)map.removeLayer(tileLayer);
  tileLayer=L.tileLayer(darkMode?TILE_DARK:TILE_LIGHT,{attribution:false,maxZoom:19}).addTo(map);
  btn.textContent=darkMode?'🌙 Noche':'☀️ Día';
  btn.classList.toggle('on',darkMode);
  draw(activeVendedor);
}
function toggleLegend(){
  const lp=document.getElementById('legend-panel');
  if(!lp)return;
  lp.style.display = (lp.style.display==='none'||!lp.style.display) ? 'block' : 'none';
}
