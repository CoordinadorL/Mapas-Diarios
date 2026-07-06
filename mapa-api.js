// ═══════════════════════════════════════════════════════════
// MAPA-API.JS — lectura de datos desde el backend (Apps Script): fetch con
// timeout, JSONP (evita CORS/proxies), fechas disponibles, correcciones de
// ubicación (GEO), catálogo de canales, y el mapeo de filas crudas del
// Sheet a los objetos que usa el resto del mapa. Tercer módulo separado de
// mapa_live_F150.html -- se carga antes que el script grande.
// ═══════════════════════════════════════════════════════════

// ── FETCH ─────────────────────────────────────────────────
async function fetchConTimeoutMapa(url, opts, ms){
  const ctrl=new AbortController();
  const timer=setTimeout(()=>ctrl.abort(), ms);
  try{ return await fetch(url, {...opts, signal:ctrl.signal}); }
  finally{ clearTimeout(timer); }
}
// JSONP: carga la respuesta del Apps Script con un <script>, sin CORS ni proxies (vía más confiable).
function jsonpMapa(qs, ms){
  ms=ms||25000;
  return new Promise((resolve,reject)=>{
    const cb='__cbm'+Date.now()+Math.floor(Math.random()*100000);
    const script=document.createElement('script');
    let done=false;
    const limpiar=()=>{ try{delete window[cb];}catch(e){window[cb]=undefined;} if(script.parentNode)script.parentNode.removeChild(script); };
    const timer=setTimeout(()=>{ if(done)return; done=true; limpiar(); reject(new Error('Tiempo agotado')); }, ms);
    window[cb]=(data)=>{ if(done)return; done=true; clearTimeout(timer); limpiar();
      if(data && data.auth===false){ sesionExpirada(); reject(new Error(data.error||'Sesión expirada')); return; }
      resolve(data); };
    script.onerror=()=>{ if(done)return; done=true; clearTimeout(timer); limpiar(); reject(new Error('Error de red')); };
    script.src=API_URL+'?'+qs+'&callback='+cb+'&token='+encodeURIComponent(getToken())+'&t='+Date.now();
    document.head.appendChild(script);
  });
}
// Lista liviana de fechas disponibles (solo strings, no trae todas las columnas)
async function fetchFechas(){
  // Solo JSONP directo (sin proxies de terceros, que verían token y datos).
  const r=await jsonpMapa('tipo=fechas',25000);
  return Array.isArray(r)?r:[];
}
// Correcciones de ubicación guardadas por los transportistas (hoja GEO).
async function fetchGeo(){
  try{
    const rows=await jsonpMapa('tipo=geo',20000);
    const m={};
    if(Array.isArray(rows)){
      // Ordenar por Timestamp ascendente → la última corrección por código gana (historial).
      rows.sort((a,b)=>String(a.Timestamp||'').localeCompare(String(b.Timestamp||''))).forEach(r=>{
        const c=String(r.CodigoCliente||'').trim();
        const la=parseFloat(r.Latitud), lo=parseFloat(r.Longitud);
        if(c && !isNaN(la) && !isNaN(lo)) m[c]={lat:la,lng:lo};
      });
    }
    return m;
  }catch(e){ return GEO_OVERRIDES||{}; }
}
// Catálogo de canales (hoja CANALES): canal crudo -> 'MAYORISTA' | 'COBERTURA'.
async function fetchCanales(){
  try{
    const rows=await jsonpMapa('tipo=canales',20000);
    const m={};
    if(Array.isArray(rows)) rows.forEach(r=>{
      const canal=String(r.canal||r.Canal||'').trim().toUpperCase();
      const desc=String(r['DESCRIPCIÓN']||r.DESCRIPCION||r.descripcion||'').trim().toUpperCase();
      if(canal && desc) m[canal]=desc;
    });
    return m;
  }catch(e){ return CANAL_MAP||{}; }
}
async function fetchData(fecha){
  document.getElementById('load-src').textContent='Consultando Google Apps Script...';
  const qs='tipo=mapa'+(fecha?('&fecha='+encodeURIComponent(fecha)):'');
  let raw;
  // Solo JSONP directo (sin proxies de terceros).
  try{ raw=await jsonpMapa(qs,25000); }
  catch(e){ throw new Error('Sin conexión con el Sheet.'); }
  if(!Array.isArray(raw)||!raw.length)throw new Error('Sin datos en el Sheet');
  return raw.map(row=>{
    const retStr=String(gf(row,'Retención en la Fuente','Retencion en la Fuente','retencion_fuente','Retencion','retencion')||'').trim().toUpperCase();
    const hasRet = retStr==='SI';
    const sumaTotal=pn(gf(row,'Suma de Total','Suma Total','total','Total'));
    const sumaNeta=pn(gf(row,'Suma Neta','suma_neta','neta'));
    // Retención 2% se calcula sobre Suma Neta solo si hasRet
    const retencionVal = hasRet ? parseFloat((sumaNeta*0.02).toFixed(2)) : 0;
    return {
      fecha:ff(gf(row,'Fecha Liq','fecha_liq','fecha')),
      chofer:String(gf(row,'Chofer','chofer')).trim(),
      liq:String(gf(row,'Num de Liquidación','Num de Liquidacion','num_liquidacion','liquidacion')||'').trim(),
      vendedor:String(gf(row,'vendedor','Vendedor')).trim(),
      codigo:String(gf(row,'CodigoCliente','Codigo Cliente','codigo_cliente')),
      razon:String(gf(row,'Razon','razon','Razón')),
      dir:String(gf(row,'Direccion','direccion','Dirección')),
      lng:pn(gf(row,'longitud_x','Longitud','lng','lon')),
      lat:pn(gf(row,'latitud_y','Latitud','lat')),
      peso:pn(gf(row,'Suma de Peso','peso','Peso')),
      sumaNeta:sumaNeta,
      total:sumaTotal,      // Suma de Total → valor que se muestra en el resumen del cliente
      hasRet:hasRet,        // true si columna dice SI
      retencionVal:retencionVal,  // monto 2% sobre Suma Neta
      nota:'',
      canalRaw:String(gf(row,'canal','Canal')||'').trim(),
      canalCat:'', // se resuelve en aplicarCanalCategoria() con el catálogo de la hoja CANALES
      ventana:String(gf(row,'Ventana horaria','ventana_horaria','Ventana Horaria')||'').trim(),
    };
  }).filter(r=>r.lat!==0&&r.lng!==0&&r.fecha&&r.chofer);
}
