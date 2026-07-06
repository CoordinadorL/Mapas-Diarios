// ═══════════════════════════════════════════════════════════
// MAPA-POPUPS-ESTADO.JS — el popup de cada cliente en el mapa (buildPopup) y
// TODAS las funciones que cambian su estado: entregado, por cobrar, quemado,
// anulado, devolucion parcial, retencion, forma de pago -- y la sincronizacion
// con el backend (syncAvance, pollAvanceRemoto). Octavo y ultimo modulo
// separado de mapa_live_F150.html -- el mas grande y el mas delicado, es la
// logica que los choferes usan decenas de veces al dia.
// ═══════════════════════════════════════════════════════════

// Genera los 2 cuadros inline de quema parcial: cuánto se quema y la diferencia pendiente automática
function quemaRowHtml(idx, total, defaultQuemado){
  // Igual que la devolución parcial: se escribe lo QUEMADO (recaudado) y la NC (diferencia) sale sola.
  const q = Number(defaultQuemado)||0;
  const nc = Math.max(0, total - q);
  return `<div id="quema-row-${idx}" style="display:none;gap:3px;align-items:center;margin-top:4px;flex-wrap:wrap">
    <div style="flex:1;position:relative">
      <span style="position:absolute;left:4px;top:50%;transform:translateY(-50%);font-size:.58rem;color:#c2410c;pointer-events:none">🔥 $</span>
      <input id="quema-val-${idx}" type="number" step="0.01" min="0" max="${total}" value="${q?q.toFixed(2):''}" placeholder="0.00"
        oninput="calcQuemaInline(${idx},${total})"
        style="width:100%;padding:3px 3px 3px 26px;font-size:.62rem;background:#fff7ed;border:1.5px solid #f97316;border-radius:6px;color:#c2410c;font-weight:700;outline:none">
    </div>
    <div style="flex:1;position:relative">
      <span style="position:absolute;left:4px;top:50%;transform:translateY(-50%);font-size:.55rem;color:#dc2626;pointer-events:none">NC $</span>
      <input id="quema-nc-${idx}" type="number" readonly value="${nc.toFixed(2)}"
        style="width:100%;padding:3px 3px 3px 30px;font-size:.62rem;background:#fef2f2;border:1.5px solid #dc2626;border-radius:6px;color:#dc2626;font-weight:700;outline:none">
    </div>
    <div style="flex-basis:100%">
      <div style="font-size:.55rem;color:#64748b;font-weight:700;text-align:center;margin:2px 0">¿Cómo pagó lo quemado?</div>
      ${metodoBtnsHtml('confirmarQuema', idx)}
    </div>
  </div>`;
}
function buildPopup(d,idx){
  const color = colorMap[d.vendedor] || '#888';
  const tier = getTierEfectivo(d);
  const isFirst = idx === 0;
  const dn = idx < DATA.length-1 ? haversine(d.lat,d.lng,DATA[idx+1].lat,DATA[idx+1].lng) : null;
  const distInfo = dn!=null
    ? `<div class="pc-km">➡️ Siguiente: ${(dn*1000).toFixed(0)} m</div>`
    : `<div class="pc-km">🏁 Último punto de la ruta</div>`;
  const liqBadge = d.liq ? `<div class="pc-liq">📋 Liq. ${d.liq}</div>` : '';
  const canalBadge = d.canalCat==='MAYORISTA'
    ? `<div class="pc-liq" style="background:#7c3aed">🟣 MAYORISTA</div>`
    : d.canalCat==='COBERTURA'
      ? `<div class="pc-liq" style="background:#334155">COBERTURA</div>`
      : '';
  const ventanaInfo = d.ventana
    ? `<div style="font-size:.68rem;color:#c4b5fd;background:#1e1b4b;border-left:3px solid #7c3aed;padding:3px 8px;border-radius:4px;margin-top:4px">🕐 Ventana horaria: ${d.ventana}</div>`
    : '';
  const tierBadge = tier!=='normal'
    ? `<span style="background:${tier==='high'?'#dc2626':'#ca8a04'};color:#fff;font-size:.55rem;font-weight:700;padding:1px 6px;border-radius:10px;margin-left:4px">${tier==='high'?'🔴 DROP ALTO':'🟡 DROP MEDIO'}</span>`
    : '';
  const gmapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${d.lat},${d.lng}&travelmode=driving`;
  const wazeUrl  = `https://waze.com/ul?ll=${d.lat},${d.lng}&navigate=yes`;

  // Retención: SOLO se calcula y refleja si el cliente está autorizado desde el Sheet (d.hasRet).
  // El toggle manual ya NO habilita valores para clientes no autorizados — solo muestra alerta.
  const tieneRet = d.hasRet;
  const retBadge = tieneRet ? `<span class="ret-badge">⚠️ RET 2%</span>` : '';
  const retInfo  = tieneRet
    ? `<div style="font-size:.65rem;color:#818cf8;background:#1e1b4b;padding:3px 8px;border-radius:5px;margin-top:3px">
        ⚠️ Retención 2%: Suma Neta $${d.sumaNeta?d.sumaNeta.toFixed(2):'—'}
        → RET: <b style="color:#f87171">$${d.retencionVal?d.retencionVal.toFixed(2):'—'}</b>
        → Neto: <b style="color:#4ade80">$${(d.sumaNeta&&d.retencionVal)?(d.sumaNeta-d.retencionVal).toFixed(2):'—'}</b>
      </div>`
    : '';

  // Estados
  const isEnt  = completed.has(idx);
  const isXC   = !isEnt && porCobrar.has(idx);
  const isQuem = !isEnt && !isXC && quemados.has(idx);
  const isAnul = !isEnt && !isXC && !isQuem && anulados.has(idx);
  const isDev  = devParcial.has(idx);
  const devVal = isDev ? devParcial.get(idx) : d.total;
  const quemVal = quemadoParcial.has(idx) ? quemadoParcial.get(idx) : (isQuem ? d.total : 0);
  const pendienteQuema = isQuem ? Math.max(0, d.total - quemVal) : 0;

  let estadoBadge = '';
  if(isEnt)  estadoBadge = `<span style="background:#14532d;color:#4ade80;font-size:.55rem;font-weight:700;padding:1px 7px;border-radius:10px;margin-left:4px">✅ ENTREGADO</span>`;
  if(isXC)   estadoBadge = `<span style="background:#431407;color:#fb923c;font-size:.55rem;font-weight:700;padding:1px 7px;border-radius:10px;margin-left:4px">🟠 POR COBRAR</span>`;
  if(isQuem) estadoBadge = pendienteQuema>0.009
    ? `<span style="background:#7c2d12;color:#fed7aa;font-size:.55rem;font-weight:700;padding:1px 7px;border-radius:10px;margin-left:4px">🔥 QUEMADO PARCIAL</span>`
    : `<span style="background:#7f1d1d;color:#fca5a5;font-size:.55rem;font-weight:700;padding:1px 7px;border-radius:10px;margin-left:4px">🔥 QUEMADO</span>`;
  if(isAnul) estadoBadge = `<span style="background:#1e1b4b;color:#c7d2fe;font-size:.55rem;font-weight:700;padding:1px 7px;border-radius:10px;margin-left:4px">❌ ANULADO</span>`;
  if(isDev && isEnt) estadoBadge = `<span style="background:#065f46;color:#6ee7b7;font-size:.55rem;font-weight:700;padding:1px 7px;border-radius:10px;margin-left:4px">💰 PAGO PARCIAL</span>`;

  const motivoAnul = isAnul ? `<div style="font-size:.65rem;color:#818cf8;margin-top:3px">Motivo: ${anulados.get(idx)}</div>` : '';
  const devInfo = isDev
    ? `<div style="background:#f0fdf4;border-left:3px solid #16a34a;padding:5px 8px;margin-top:6px;border-radius:4px">
        <div style="font-size:.68rem;color:#166534;font-weight:700">💰 Devolución parcial</div>
        <div style="font-size:.72rem;color:#14532d;margin-top:2px">Pagado: <b>$${Number(devVal).toFixed(2)}</b> &nbsp;|&nbsp; NC: <b style="color:#dc2626">$${(d.total-Number(devVal)).toFixed(2)}</b></div>
      </div>`
    : '';
  const quemInfo = isQuem
    ? `<div style="background:${pendienteQuema>0.009?'#fff7ed':'#fef2f2'};border-left:3px solid ${pendienteQuema>0.009?'#f97316':'#7f1d1d'};padding:5px 8px;margin-top:6px;border-radius:4px">
        <div style="font-size:.68rem;color:#7c2d12;font-weight:700">🔥 Quema de NC</div>
        <div style="font-size:.72rem;color:#7c2d12;margin-top:2px">Recaudado: <b>$${quemVal.toFixed(2)}</b>${pendienteQuema>0.009?` &nbsp;|&nbsp; NC: <b style="color:#dc2626">$${pendienteQuema.toFixed(2)}</b>`:''}</div>
      </div>`
    : '';
  const notaInfo = notas.has(idx)
    ? `<div style="font-size:.68rem;color:#93c5fd;border-left:3px solid #3b82f6;padding:3px 8px;margin-top:4px;border-radius:4px">📝 ${notas.get(idx)}</div>`
    : '';

  // Botones de acción
  let actionsHtml = '';
  if(isEnt || isXC || isQuem || isAnul){
    if(isAnul){
      actionsHtml = '<div style="display:flex;gap:4px">'
        +'<button class="pc-btn" style="flex:1;background:#14532d;color:#4ade80;font-size:.6rem;padding:5px" onclick="showMetodoEntrega('+idx+')">✅ Entregar</button>'
        +'<button class="pc-btn" style="flex:1;background:#7f1d1d;color:#fca5a5;font-size:.6rem;padding:5px" onclick="showQuemaParcial('+idx+','+d.total+')">🔥 Quemar</button>'
        +'<button class="pc-btn" style="flex:1;background:#334155;color:#94a3b8;font-size:.6rem;padding:5px" onclick="resetEstado('+idx+')">↩</button>'
        +'</div>'
        +'<div id="metodo-row-'+idx+'" style="display:none;margin-top:4px"><div style="font-size:.56rem;color:#64748b;font-weight:700;text-align:center;margin-bottom:2px">¿Cómo pagó?</div>'+metodoBtnsHtml('entregarConMetodo', idx)+'</div>'
        + quemaRowHtml(idx, d.total, 0);
    } else if(isQuem && pendienteQuema>0.009){
      actionsHtml = '<div style="display:flex;gap:4px">'
        +'<button class="pc-btn" style="flex:1;background:#c2410c;color:#fff;font-size:.6rem;padding:5px" onclick="showQuemaParcial('+idx+','+d.total+')">🔥 Quemar pendiente</button>'
        +'<button class="pc-btn" style="flex:1;background:#334155;color:#94a3b8;font-size:.6rem;padding:5px" onclick="resetEstado('+idx+')">↩</button>'
        +'</div>'
        + quemaRowHtml(idx, d.total, quemVal);
    } else {
      actionsHtml = '<button class="pc-btn" style="background:#334155;color:#94a3b8;width:100%" onclick="resetEstado('+idx+')">↩ Desmarcar / Cambiar estado</button>';
    }
  } else {
    // Retención inline: botón compacto + 2 cuadros readonly automáticos + cobro de diferencia
  const retVal2 = tieneRet ? (d.sumaNeta * 0.02) : 0;
  const netoCobrar = tieneRet ? (d.total - retVal2) : 0;
  const retBtn = tieneRet
    ? `<div style="display:flex;gap:3px;align-items:center;margin-top:3px">
        <button onclick="toggleRetencion(${idx})"
          style="background:#1e1b4b;border:1px solid #4338ca;color:#a5b4fc;padding:3px 7px;border-radius:7px;font-size:.58rem;font-weight:700;cursor:pointer;white-space:nowrap;flex-shrink:0">⚠️ Ret 2%</button>
        <div style="flex:1;position:relative">
          <span style="position:absolute;left:4px;top:50%;transform:translateY(-50%);font-size:.55rem;color:#7c3aed;pointer-events:none">RET</span>
          <input readonly value="$${retVal2.toFixed(2)}"
            style="width:100%;padding:3px 3px 3px 26px;font-size:.62rem;background:#f5f3ff;border:1.5px solid #7c3aed;border-radius:6px;color:#7c3aed;font-weight:700;outline:none">
        </div>
        <div style="flex:1;position:relative">
          <span style="position:absolute;left:4px;top:50%;transform:translateY(-50%);font-size:.55rem;color:#15803d;pointer-events:none">✓</span>
          <input readonly value="$${netoCobrar.toFixed(2)}"
            style="width:100%;padding:3px 3px 3px 18px;font-size:.62rem;background:#f0fdf4;border:1.5px solid #16a34a;border-radius:6px;color:#15803d;font-weight:700;outline:none">
        </div>
      </div>
      <button onclick="confirmarCobroRetencion(${idx})"
        style="background:#15803d;border:none;color:#fff;padding:4px 7px;border-radius:7px;font-size:.6rem;font-weight:700;cursor:pointer;width:100%;margin-top:3px">✅ Cobrar diferencia $${netoCobrar.toFixed(2)}</button>`
    : `<button onclick="toggleRetencion(${idx})" title="Este cliente NO está autorizado para retención en el Sheet"
        style="background:#78350f;border:1.5px solid #f59e0b;color:#fde68a;padding:3px 7px;border-radius:7px;font-size:.58rem;font-weight:700;cursor:pointer;white-space:nowrap;margin-top:3px;width:100%">⚠️ Ret 2% — No autorizado</button>`;
    actionsHtml = `
    <div style="display:flex;gap:4px;margin-bottom:3px">
      <button class="pc-btn pc-btn-done"    onclick="showMetodoEntrega(${idx})" style="flex:1;padding:5px 2px;font-size:.65rem">✅ Entregar</button>
      <button class="pc-btn pc-btn-xc"      onclick="togglePorCobrar(${idx})"   style="flex:1;padding:5px 2px;font-size:.65rem">💲 XC</button>
      <button class="pc-btn pc-btn-anulado" onclick="showAnuladoMenu(${idx})"    style="flex:1;padding:5px 2px;font-size:.65rem">NC ❌</button>
    </div>
    <div id="metodo-row-${idx}" style="display:none;margin-bottom:3px">
      <div style="font-size:.56rem;color:#64748b;font-weight:700;text-align:center;margin-bottom:2px">¿Cómo pagó?</div>
      ${metodoBtnsHtml('entregarConMetodo', idx)}
    </div>
    <div id="anulado-menu-${idx}" style="display:none;margin-bottom:3px">
      <select class="motivo-select" onchange="marcarAnulado(${idx},this.value)">
        <option value="">— Motivo anulación —</option>
        <option>Negocio cerrado</option><option>Rechazado comercial</option>
        <option>Cliente sin dinero</option><option>Diferencia de precios</option>
        <option>No realiza pedido</option><option>Pedido cruzado</option>
        <option>Fuera de ruta</option><option>Descuento o crédito no formalizado</option>
        <option>Pedido incompleto</option><option>Error de facturación</option>
        <option>Producto en mal estado</option><option>Sin motivo</option>
      </select>
    </div>
    <div style="display:flex;gap:3px;align-items:center;margin-bottom:3px">
      <button onclick="showDevParcial(${idx},${d.total})"
        style="background:#065f46;border:none;color:#6ee7b7;padding:3px 7px;border-radius:7px;font-size:.58rem;font-weight:700;cursor:pointer;white-space:nowrap;flex-shrink:0">💰 Dev.</button>
      <div style="flex:1;display:none;gap:2px;align-items:center;flex-wrap:wrap" id="dev-row-${idx}">
        <div style="flex:1;position:relative">
          <span style="position:absolute;left:4px;top:50%;transform:translateY(-50%);font-size:.58rem;color:#dc2626;pointer-events:none">NC $</span>
          <input id="dev-nc-${idx}" type="number" step="0.01" min="0" max="${d.total}" value="0"
            oninput="calcDevInline(${idx},${d.total})"
            placeholder="0.00"
            style="width:100%;padding:3px 3px 3px 24px;font-size:.62rem;background:#fef2f2;border:1.5px solid #dc2626;border-radius:6px;color:#dc2626;font-weight:700;outline:none">
        </div>
        <div style="flex:1;position:relative">
          <span style="position:absolute;left:4px;top:50%;transform:translateY(-50%);font-size:.58rem;color:#15803d;pointer-events:none">✓ $</span>
          <input id="dev-cobra-${idx}" type="number" readonly
            value="${d.total.toFixed(2)}"
            style="width:100%;padding:3px 3px 3px 22px;font-size:.62rem;background:#f0fdf4;border:1.5px solid #16a34a;border-radius:6px;color:#15803d;font-weight:700;outline:none">
        </div>
        <div id="dev-ok-${idx}" style="display:none;flex-basis:100%">
          <div style="font-size:.55rem;color:#64748b;font-weight:700;text-align:center;margin:2px 0">¿Cómo pagó lo cobrado?</div>
          ${metodoBtnsHtml('confirmarDev', idx)}
        </div>
      </div>
    </div>
    <div style="display:flex;gap:4px;align-items:center;margin-bottom:2px">
      <textarea id="nota-input-${idx}" rows="1" placeholder="📝 Nota..." style="flex:1;background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:3px 6px;font-size:.65rem;resize:none;color:#334155;font-family:inherit">${notas.has(idx)?notas.get(idx):''}</textarea>
      <button class="nota-save-btn" onclick="saveNota(${idx})" style="flex:0 0 auto;padding:3px 7px;font-size:.6rem">💾</button>
    </div>
    ${retBtn}`;
  }

  return `<div class="pc">
<div class="pc-head">
  <div class="pc-code">
    <div class="pc-num" style="background:${tier==='high'?'#dc2626':tier==='medium'?'#ca8a04':color}">${idx+1}</div>
    <div>
      <div class="pc-title">${isFirst?'★ INICIO — ':''}${d.vendedor} ${tierBadge}${retBadge}${estadoBadge}</div>
      <div class="pc-sub">${d.chofer}</div>
    </div>
  </div>
  <div style="display:flex;flex-direction:column;align-items:flex-end;gap:2px;flex-shrink:0">${liqBadge}${canalBadge}</div>
</div>
<div class="pc-body">
  <div class="pc-row"><span class="pc-key">Fecha Liq</span><span class="pc-val">${d.fecha}</span></div>
  <div class="pc-row"><span class="pc-key">Código</span><span class="pc-val">${d.codigo}</span></div>
  <div class="pc-row"><span class="pc-key">Razón</span><span class="pc-val">${d.razon}</span></div>
  <div class="pc-row"><span class="pc-key">Dirección</span><span class="pc-val">${d.dir}</span></div>
  ${ventanaInfo}
  ${motivoAnul}${devInfo}${quemInfo}${retInfo}${notaInfo}
</div>
<div class="pc-foot">
  <div class="pc-metric"><div class="mv">${d.peso.toFixed(2)}</div><div class="ml">kg</div></div>
  <div class="pc-metric"><div class="mv" style="color:${tier==='high'?'#dc2626':tier==='medium'?'#ca8a04':'#1e40af'}">$${d.total.toFixed(0)}</div><div class="ml">Total</div></div>
  <div class="pc-metric"><div class="mv">#${idx+1}</div><div class="ml">Orden</div></div>
</div>
${distInfo}
<div class="pc-actions">
  <button class="pc-btn pc-btn-nav" onclick="window.open('${gmapsUrl}','_blank')">🗺️ Google Maps</button>
  <button class="pc-btn pc-btn-waze" onclick="window.open('${wazeUrl}','_blank')">🚗 Waze</button>
</div>
<div style="padding:4px 8px 6px">${actionsHtml}</div>
<div class="pc-coords">📍 ${d.lat.toFixed(5)}, ${d.lng.toFixed(5)}
  <button onclick="mostrarGeoOpciones(${idx})" style="margin-left:6px;background:#334155;color:#e2e8f0;border:none;border-radius:6px;padding:2px 8px;font-size:.58rem;font-weight:700;cursor:pointer">📍 Corregir ubicación</button>
  <div id="geo-opciones-${idx}" style="display:none;gap:5px;justify-content:center;margin-top:5px">
    <button onclick="geoDesdeGPS(${idx})" style="background:#1d4ed8;color:#fff;border:none;border-radius:6px;padding:4px 9px;font-size:.6rem;font-weight:700;cursor:pointer">📡 Usar mi GPS</button>
    <button onclick="geoArrastrar(${idx})" style="background:#7c3aed;color:#fff;border:none;border-radius:6px;padding:4px 9px;font-size:.6rem;font-weight:700;cursor:pointer">✋ Arrastrar pin</button>
  </div>
</div>
</div>`;
}



// clearMap y draw ahora viven en mapa-render.js.

// ── SYNC CON SHEET "AVANCE" ─────────────────────────────────
// Antes, los cambios de estado (entregado, por cobrar, quemado, anulado...)
// solo se guardaban en localStorage del navegador y NUNCA se enviaban al
// Apps Script, por eso la pestaña AVANCE del Sheet nunca se actualizaba.
function estadoActualDe(idx){
  const d=DATA[idx];
  if(!d) return {estado:'PENDIENTE',monto:0,motivo:''};
  if(completed.has(idx)){
    if(devParcial.has(idx)) return {estado:'ENTREGADO_PARCIAL',monto:devParcial.get(idx),motivo:''};
    return {estado:'ENTREGADO',monto:d.total,motivo:''};
  }
  if(porCobrar.has(idx))  return {estado:'POR_COBRAR',monto:d.total,motivo:''};
  if(quemados.has(idx)){
    const q=quemadoParcial.has(idx)?quemadoParcial.get(idx):d.total;
    return {estado:'QUEMADO',monto:q,motivo:''};
  }
  if(anulados.has(idx))   return {estado:'ANULADO',monto:0,motivo:anulados.get(idx)||''};
  return {estado:'PENDIENTE',monto:0,motivo:''};
}
async function syncAvance(idx){
  const d=DATA[idx];
  if(!d) return;
  const {estado,monto,motivo}=estadoActualDe(idx);
  const sesion=getSesion();
  const payload={
    tipo:'avance',
    token:(sesion&&sesion.token)||'',
    fecha:d.fecha,
    chofer:d.chofer,
    codigoCliente:d.codigo,
    estado, monto, motivo,
    metodoPago:(metodoPago.get(idx)||''),
    usuario:(sesion&&sesion.usuario)||d.chofer,
    rol:(sesion&&sesion.rol)||'reparto',
    bodega:activeBodega
  };
  const clave='avance|'+d.fecha+'|'+d.chofer+'|'+d.codigo;
  try{
    await fetchConTimeoutMapa(API_URL,{
      method:'POST',
      mode:'no-cors', // Apps Script no siempre responde con headers CORS en POST; no necesitamos leer la respuesta
      headers:{'Content-Type':'text/plain;charset=utf-8'}, // evita preflight OPTIONS que Apps Script no maneja
      body:JSON.stringify(payload)
    }, 12000);
    // Si había un intento viejo pendiente de este mismo cliente, ya no hace falta.
    if(SYNC_QUEUE.some(it=>it.clave===clave)){ SYNC_QUEUE=SYNC_QUEUE.filter(it=>it.clave!==clave); guardarSyncQueue(); }
  }catch(err){
    console.warn('Sin conexión: el avance se guardó localmente y se reintentará enviar automáticamente.',err);
    encolarSync(clave, payload);
  }
}

// Sincronización casi-en-tiempo-real: cada cierto tiempo revisa si OTRO dispositivo
// (chofer o ayudante) trabajando la misma fecha+camión marcó algún cliente,
// y aplica esos cambios localmente para que ambos vean lo mismo y no se dupliquen datos.
let ultimoPollAvance=0;
async function pollAvanceRemoto(){
  if(cuadreEnviando) return; // no sincronizar mientras se envía un cuadre (evita cerrar sesión a mitad)
  if(!activeFecha||!activeChofer||!DATA.length) return;
  try{
    const rows=await jsonpMapa(`tipo=avance&fecha=${encodeURIComponent(activeFecha)}&chofer=${encodeURIComponent(activeChofer)}`,20000);
    if(!Array.isArray(rows)) return;
    let changed=false;
    rows.forEach(row=>{
      const codigo=String(row.CodigoCliente||'').trim();
      const idx=DATA.findIndex(d=>d.codigo===codigo);
      if(idx<0) return;
      // Si este cliente tiene un cambio local aún sin enviar (cola offline), no lo pisamos
      // con el dato viejo del servidor -- se sincronizará cuando la cola se vacíe.
      if(SYNC_QUEUE.some(it=>it.clave==='avance|'+activeFecha+'|'+activeChofer+'|'+codigo)) return;
      const estado=String(row.Estado||'').toUpperCase();
      const monto=parseFloat(row.Monto)||0;
      const motivo=row.Motivo||'';
      const before=JSON.stringify(estadoActualDe(idx));
      completed.delete(idx); porCobrar.delete(idx); quemados.delete(idx); anulados.delete(idx); devParcial.delete(idx); quemadoParcial.delete(idx);
      if(estado==='ENTREGADO'){ completed.add(idx); }
      else if(estado==='ENTREGADO_PARCIAL'){ completed.add(idx); devParcial.set(idx,monto); }
      else if(estado==='POR_COBRAR'){ porCobrar.add(idx); }
      else if(estado==='QUEMADO'){ quemados.add(idx); quemadoParcial.set(idx, monto||DATA[idx].total); }
      else if(estado==='ANULADO'){ anulados.set(idx, motivo); }
      const met=String(row.MetodoPago||'').toUpperCase();
      if(met && (estado==='ENTREGADO'||estado==='ENTREGADO_PARCIAL'||estado==='QUEMADO')) metodoPago.set(idx, met);
      // Si el servidor no devuelve método (transición sin la columna aún), se conserva el local.
      const after=JSON.stringify(estadoActualDe(idx));
      if(before!==after) changed=true;
    });
    if(changed){
      DATA.forEach((_,i)=>refreshMarkerIcon(i));
      updateProgress();updateStats();updatePanel();updateBottomBar();
      saveLocalState();
      console.log('🔄 Ruta sincronizada: otro dispositivo actualizó el avance');
    }
  }catch(err){
    console.warn('No se pudo sincronizar avance remoto:',err);
  }
}


// ── VISITADOS / ENTREGADOS ─────────────────────────────────

function togglePorCobrar(idx){
  if(porCobrar.has(idx)){
    porCobrar.delete(idx);
  } else {
    porCobrar.add(idx);
    completed.delete(idx); // si estaba entregado, quitar esa marca
  }
  refreshMarkerIcon(idx);
  updateProgress();updateStats();updatePanel();
  map.closePopup();
  syncAvance(idx);
}


// ── NUEVOS ESTADOS ───────────────────────────────────────


function quemarDesdeNC(idx, reopenPopup=true){ const d=DATA[idx]; anulados.delete(idx); quemados.add(idx); completed.delete(idx); porCobrar.delete(idx); if(d) quemadoParcial.set(idx, d.total); refreshMarkerIcon(idx); updateProgress();updateStats();updatePanel();saveLocalState(); syncAvance(idx); if(reopenPopup){ const m=allMarkers[idx]; if(m){m.setPopupContent(buildPopup(DATA[idx],idx));m.openPopup();} } }
function entregarDesdeNC(idx, reopenPopup=true){ anulados.delete(idx); completed.add(idx); porCobrar.delete(idx); quemados.delete(idx); quemadoParcial.delete(idx); refreshMarkerIcon(idx); updateProgress();updateStats();updatePanel();saveLocalState(); syncAvance(idx); if(reopenPopup){ const m=allMarkers[idx]; if(m){m.setPopupContent(buildPopup(DATA[idx],idx));m.openPopup();} } }
function resetEstado(idx){
  completed.delete(idx); porCobrar.delete(idx);
  quemados.delete(idx); anulados.delete(idx); devParcial.delete(idx); quemadoParcial.delete(idx);
  refreshMarkerIcon(idx); updateProgress(); updateStats(); updatePanel();
  map.closePopup();
  syncAvance(idx);
}

function marcarQuemado(idx){
  const d=DATA[idx];
  quemados.add(idx);
  completed.delete(idx); porCobrar.delete(idx); anulados.delete(idx);
  if(d) quemadoParcial.set(idx, d.total);
  refreshMarkerIcon(idx); updateProgress(); updateStats(); updatePanel();
  map.closePopup();
  syncAvance(idx);
}

function showAnuladoMenu(idx){
  const m=document.getElementById('anulado-menu-'+idx);
  if(m) m.style.display=m.style.display==='none'?'block':'none';
}

function marcarAnulado(idx, motivo, reopenPopup=true){
  if(!motivo)return;
  anulados.set(idx, motivo);
  completed.delete(idx); porCobrar.delete(idx); quemados.delete(idx); quemadoParcial.delete(idx);
  refreshMarkerIcon(idx); updateProgress(); updateStats(); updatePanel();
  syncAvance(idx);
  if(reopenPopup){
    const m=allMarkers[idx];
    if(m){m.setPopupContent(buildPopup(DATA[idx],idx));m.openPopup();}
  }
}

function showDevParcial(idx, total){
  const row = document.getElementById('dev-row-'+idx);
  if(!row) return;
  const visible = row.style.display === 'flex';
  if(visible){
    row.style.display = 'none';
    const nc = document.getElementById('dev-nc-'+idx);
    const cobra = document.getElementById('dev-cobra-'+idx);
    const ok = document.getElementById('dev-ok-'+idx);
    if(nc) nc.value = '0';
    if(cobra) cobra.value = total.toFixed(2);
    if(ok) ok.style.display = 'none';
  } else {
    row.style.display = 'flex';
    setTimeout(()=>{ const nc=document.getElementById('dev-nc-'+idx); if(nc)nc.focus(); }, 60);
  }
}


function calcDevInline(idx, total){
  const ncInput = document.getElementById('dev-nc-'+idx);
  const cobraInput = document.getElementById('dev-cobra-'+idx);
  const okBtn = document.getElementById('dev-ok-'+idx);
  if(!ncInput||!cobraInput) return;
  const nc = Math.min(parseFloat(ncInput.value)||0, total);
  const cobra = Math.max(0, total - nc);
  cobraInput.value = cobra.toFixed(2);
  if(okBtn) okBtn.style.display = nc > 0 ? 'block' : 'none';
}

function showQuemaParcial(idx, total){
  const row = document.getElementById('quema-row-'+idx);
  if(!row) return;
  const visible = row.style.display === 'flex';
  row.style.display = visible ? 'none' : 'flex';
  if(!visible){ setTimeout(()=>{ const el=document.getElementById('quema-val-'+idx); if(el) el.focus(); }, 60); }
}
function calcQuemaInline(idx, total){
  const qEl = document.getElementById('quema-val-'+idx);
  const ncEl = document.getElementById('quema-nc-'+idx);
  if(!qEl||!ncEl) return;
  const q = Math.min(Math.max(parseFloat(qEl.value)||0, 0), total);
  ncEl.value = Math.max(0, total - q).toFixed(2);
}
function confirmarQuema(idx, metodo){
  const d = DATA[idx]; if(!d) return;
  const qEl = document.getElementById('quema-val-'+idx);
  const q = Math.min(Math.max(parseFloat(qEl?qEl.value:0)||0, 0), d.total);
  quemadoParcial.set(idx, q);
  quemados.add(idx);
  if(metodo) metodoPago.set(idx, metodo);
  anulados.delete(idx); completed.delete(idx); porCobrar.delete(idx); devParcial.delete(idx);
  refreshMarkerIcon(idx); updateProgress(); updateStats(); updatePanel();
  saveLocalState(); syncAvance(idx);
  const m=allMarkers[idx];
  if(m){m.setPopupContent(buildPopup(DATA[idx],idx));m.openPopup();}
}

// ── FORMAS DE PAGO ─────────────────────────────────────────
// Genera 4 botones (efectivo/transferencia/cheque/crédito) que llaman a fn(idx,'METODO').
function metodoBtnsHtml(fn, idx){
  return `<div style="display:flex;gap:3px">`
    + Object.keys(METODOS).map(m=>`<button onclick="${fn}(${idx},'${m}')" style="flex:1;background:${METODOS[m].color};border:none;color:#fff;padding:5px 2px;border-radius:6px;font-size:.55rem;font-weight:700;cursor:pointer;white-space:nowrap">${METODOS[m].lbl}</button>`).join('')
    + `</div>`;
}
function showMetodoEntrega(idx){
  const row=document.getElementById('metodo-row-'+idx);
  if(!row) return;
  row.style.display = row.style.display==='block' ? 'none' : 'block';
}
// Entrega completa con forma de pago (crédito = entregado, paga después → no es efectivo).
function entregarConMetodo(idx, metodo){
  metodoPago.set(idx, metodo);
  completed.add(idx);
  porCobrar.delete(idx); quemados.delete(idx); anulados.delete(idx); quemadoParcial.delete(idx); devParcial.delete(idx);
  refreshMarkerIcon(idx); updateProgress(); updateStats(); updatePanel();
  saveLocalState(); syncAvance(idx);
  map.closePopup();
}

function confirmarDev(idx, metodo){
  const d=DATA[idx]; if(!d)return;
  const cobraEl = document.getElementById('dev-cobra-'+idx);
  let pagado = cobraEl ? (parseFloat(cobraEl.value)||d.total) : d.total;
  devParcial.set(idx, pagado);
  completed.add(idx);
  if(metodo) metodoPago.set(idx, metodo);
  porCobrar.delete(idx); quemados.delete(idx); anulados.delete(idx); quemadoParcial.delete(idx);
  refreshMarkerIcon(idx); updateProgress(); updateStats(); updatePanel();
  saveLocalState();
  syncAvance(idx);
  map.closePopup();
}

// 3. NOTAS POR CLIENTE (se llaman desde buildPopup)
// ══════════════════════════════════════════════════════════════

function toggleRetencion(idx){
  const d = DATA[idx];
  if(!d) return;
  if(!d.hasRet){
    // Cliente NO autorizado en el Sheet ("Agentes de Retención") — se bloquea sin mensaje emergente.
    return;
  }
  // Cliente autorizado: refresca la vista (los valores ya se calculan automáticamente desde d.hasRet)
  refreshMarkerIcon(idx);
  saveLocalState();
  const m=allMarkers[idx];
  if(m){m.setPopupContent(buildPopup(DATA[idx],idx));m.openPopup();}
}
function confirmarCobroRetencion(idx){
  const d = DATA[idx];
  if(!d || !d.hasRet) return; // seguridad: solo clientes autorizados pueden cobrar la diferencia
  const retVal = d.retencionVal || parseFloat((d.sumaNeta*0.02).toFixed(2));
  const netoCobrar = d.total - retVal;
  devParcial.set(idx, netoCobrar);
  completed.add(idx);
  porCobrar.delete(idx); quemados.delete(idx); anulados.delete(idx);
  refreshMarkerIcon(idx); updateProgress(); updateStats(); updatePanel();
  saveLocalState();
  syncAvance(idx);
  const m=allMarkers[idx];
  if(m){m.setPopupContent(buildPopup(DATA[idx],idx));m.openPopup();}
}
function saveNota(idx){
  const input = document.getElementById(`nota-input-${idx}`);
  if(!input) return;
  const val = input.value.trim();
  if(val) notas.set(idx, val); else notas.delete(idx);
  // Refresh popup
  const m = allMarkers[idx];
  if(m){ m.setPopupContent(buildPopup(DATA[idx], idx)); m.openPopup(); }
  saveLocalState();
}
