// ═══════════════════════════════════════════════════════════
// PAGO-TRANSPORTES.JS — "Pago a transportes" (pago-transportes.html).
//
// Lo que antes era una pestaña por día en el Excel bimestral
// CAMIONES-AYUDANTES-FRECUENCIAS: una fila por camión (o cargue) y día de
// entrega. Kilos, facturas y $ llegan solos al publicar la ruta del día
// (generador de rutas de la PC de logística); aquí se completa lo demás.
//
// Backend: PagoTransportes.gs (tipos pago_*), por JSONP como Cargues.
// Las columnas calculadas (ruta, valor de ruta, nombre, % de retorno, pago,
// valor a cancelar) se calculan aquí con las MISMAS reglas que las fórmulas
// del Excel (calcularFila). El backend solo guarda lo escrito.
//
// En la PC de logística, la página además habla con el servicio local
// (servicio-local.js → C:\MAPA-RUTAS\servicio_web.py) para mostrar cómo va
// la sincronización con el Excel, y le entrega la "clave de PC" la primera
// vez (la pide al backend con la sesión de coordinador/admin).
// ═══════════════════════════════════════════════════════════

const MESES=['ENERO','FEBRERO','MARZO','ABRIL','MAYO','JUNIO','JULIO','AGOSTO','SEPTIEMBRE','OCTUBRE','NOVIEMBRE','DICIEMBRE'];
const DIAS_CORTOS=['DOM','LUN','MAR','MIÉ','JUE','VIE','SÁB'];
const PREFIJOS_HOJA=['DMG','LNS','MTS','MCL','JVS','VNS','SBD']; // por getDay(): domingo=0
const LIMITE_RETORNO=0.03;

const estado={
  cat:{tarifas:[], transportistas:[], lineas:[]},
  dias:[], dia:null, filas:[], porId:{}, marcadas:new Set(),
  guardando:0, consolidado:[], ultimaSync:null
};

// ── Backend (JSONP) ──────────────────────────────────────────
function api(params, ms){
  ms=ms||30000;
  return new Promise((resolve, reject)=>{
    const cb='__cbp'+Date.now()+Math.floor(Math.random()*100000);
    const script=document.createElement('script');
    let listo=false;
    const limpiar=()=>{ try{ delete window[cb]; }catch(e){ window[cb]=undefined; } if(script.parentNode) script.parentNode.removeChild(script); };
    const timer=setTimeout(()=>{ if(listo) return; listo=true; limpiar(); reject(new Error('La web tardó demasiado en responder.')); }, ms);
    window[cb]=(data)=>{
      if(listo) return; listo=true; clearTimeout(timer); limpiar();
      if(data && data.auth===false){ sesionExpirada(); reject(new Error(data.error||'Sesión expirada')); return; }
      resolve(data||{});
    };
    script.onerror=()=>{ if(listo) return; listo=true; clearTimeout(timer); limpiar(); reject(new Error('Sin conexión con la web.')); };
    const qs=Object.keys(params).map(k=>encodeURIComponent(k)+'='+encodeURIComponent(params[k]===undefined||params[k]===null?'':params[k])).join('&');
    script.src=API_URL+'?'+qs+'&callback='+cb+'&token='+encodeURIComponent(getToken())+'&t='+Date.now();
    document.head.appendChild(script);
  });
}
async function apiOk(params, ms){
  const r=await api(params, ms);
  if(!r || r.ok===false){ const e=new Error((r&&r.error)||'La web no aceptó el pedido.'); e.respuesta=r; throw e; }
  return r;
}

// ── Utilidades ───────────────────────────────────────────────
const vacio=v=>v===undefined||v===null||String(v).trim()==='';
const num=v=>{ if(vacio(v)) return 0; const n=Number(String(v).replace(',','.')); return isNaN(n)?0:n; };
const dinero=v=>(v===null||v===undefined||isNaN(v))?'—':'$'+Number(v).toLocaleString('es-EC',{minimumFractionDigits:2,maximumFractionDigits:2});
const numero=(v,d)=>(v===null||v===undefined||v===''||isNaN(v))?'':Number(v).toLocaleString('es-EC',{maximumFractionDigits:d===undefined?2:d});
const pct=v=>(v===null||isNaN(v))?'—':(v*100).toLocaleString('es-EC',{maximumFractionDigits:2})+'%';
function hoyISO(){ const d=new Date(); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
function fechaDe(iso){ const [y,m,d]=String(iso).split('-').map(Number); return new Date(y,m-1,d); }
function fechaLarga(iso){ const d=fechaDe(iso); return DIAS_CORTOS[d.getDay()]+' '+String(d.getDate()).padStart(2,'0')+'/'+String(d.getMonth()+1).padStart(2,'0')+'/'+d.getFullYear(); }
function nombreHoja(iso){ const d=fechaDe(iso); return PREFIJOS_HOJA[d.getDay()]+String(d.getDate()).padStart(2,'0')+'-'+String(d.getMonth()+1).padStart(2,'0'); }
function sumarDias(iso, n){ const d=fechaDe(iso); d.setDate(d.getDate()+n); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }

// ── Reglas (las mismas del Excel) ────────────────────────────
// Tarifa de un COD que rige en una fecha: la última versión con
// vigente_desde <= fecha (o la más vieja, si todas son posteriores).
function tarifaDe(cod, fecha){
  cod=String(cod||'').trim().toUpperCase();
  if(!cod) return null;
  const versiones=estado.cat.tarifas.filter(t=>String(t.cod).toUpperCase()===cod)
    .sort((a,b)=>String(a.vigente_desde).localeCompare(String(b.vigente_desde)));
  if(!versiones.length) return null;
  const ya=versiones.filter(t=>String(t.vigente_desde)<=String(fecha||hoyISO()));
  return ya.length?ya[ya.length-1]:versiones[0];
}
// D tarifa actual, E nueva tarifa, F 6 llantas, I = D-20, J = E-20.
function valoresTarifa(t){
  const D=num(t.tarifa_actual), E=D*(1+num(t.pct_nueva)), F=D*(1+num(t.pct_6));
  return {D, E, F, I:D-20, J:E-20, ruta:t.ruta};
}
function codOriginal(f){
  if(f.origen!=='carga' || !f.clave_carga) return '';
  return String(f.clave_carga).split(' CARGUE ')[0].trim().toUpperCase();
}
function nombreTransportista(cod){
  const t=estado.cat.transportistas.find(x=>String(x.tag).toUpperCase()===String(cod||'').toUpperCase());
  return t?t.nombre:'';
}
function calcularFila(f){
  const t=tarifaDe(f.cod_frec, f.fecha_entrega);
  const v=t?valoresTarifa(t):null;
  const C=vacio(f.ajuste)?0:Number(f.ajuste);
  const M=num(f.monto), N=num(f.retorno);
  let G;
  if(!C) G=0;
  else if(!v) G=null;
  else G=C===1?v.E:(C===2?v.F:v.J);
  const P=M?N/M:0;
  let S;
  if(!C) S=0;
  else if(G===null) S=null;
  else if(P<=LIMITE_RETORNO+1e-9 || String(f.sin_sancion).toUpperCase()==='SI') S=G;
  else S=(C===3?v.I:v.D);
  const cod=String(f.cod_camion||'').toUpperCase();
  const nombre=nombreTransportista(cod) || (cod && cod===codOriginal(f) ? f.nombre_carga : '') || '';
  const d=f.fecha_entrega?fechaDe(f.fecha_entrega):null;
  return {
    mes:d?MESES[d.getMonth()]:'', ruta:v?v.ruta:(vacio(f.cod_frec)?'-':'¿COD?'), G, nombre,
    O:M-N, P, Q:C?'':'NO', S, sancionado:(S!==null&&G!==null&&S<G-0.005), sinTarifa:!!(C&&!v)
  };
}

// ── Columnas del día (mismo orden que la pestaña del Excel: A..V) ──
const COLS=[
  {k:'mes', l:'A', t:'MES', calc:true},
  {k:'fecha_entrega', l:'B', t:'FECHA', tipo:'fecha'},
  {k:'ajuste', l:'C', t:'AJUSTE', tipo:'ajuste'},
  {k:'linea', l:'D', t:'LÍNEA', tipo:'linea'},
  {k:'cod_frec', l:'E', t:'COD DE FRECUENCIA', tipo:'cod'},
  {k:'ruta', l:'F', t:'RUTA', calc:true},
  {k:'G', l:'G', t:'VALOR DE RUTA', calc:true, din:true},
  {k:'cod_camion', l:'H', t:'CÓDIGO DE CAMIÓN', tipo:'camion'},
  {k:'nombre', l:'I', t:'NOMBRE', calc:true},
  {k:'chofer_adicional', l:'J', t:'CHOFER INTERNO / ADICIONAL', tipo:'texto'},
  {k:'kgs', l:'K', t:'KGS', tipo:'numero'},
  {k:'facturas', l:'L', t:'N° DE FACTURAS', tipo:'numero'},
  {k:'monto', l:'M', t:'MONTO $', tipo:'numero'},
  {k:'retorno', l:'N', t:'RETORNO $', tipo:'numero'},
  {k:'O', l:'O', t:'TOTAL ENTREGADO', calc:true, din:true},
  {k:'P', l:'P', t:'% DE RETORNO', calc:true, pct:true},
  {k:'Q', l:'Q', t:'PAGO', calc:true},
  {k:'sin_sancion', l:'R', t:'NO SANCIONAR', tipo:'si'},
  {k:'S', l:'S', t:'VALOR A CANCELAR', calc:true, din:true},
  {k:'n_ayudantes', l:'T', t:'N° AYUDANTES', tipo:'numero'},
  {k:'ayudantes', l:'U', t:'NOMBRES DE AYUDANTES', tipo:'texto', largo:true},
  {k:'observaciones', l:'V', t:'OBSERVACIONES', tipo:'texto', largo:true},
];

function opcion(valor, texto, actual){
  const o=document.createElement('option'); o.value=valor; o.textContent=texto;
  if(String(valor).toUpperCase()===String(actual===undefined||actual===null?'':actual).toUpperCase()) o.selected=true;
  return o;
}
function codsVigentes(fecha){
  const cods=[...new Set(estado.cat.tarifas.map(t=>String(t.cod).toUpperCase()))].sort();
  return cods.map(c=>({cod:c, t:tarifaDe(c, fecha)}));
}

function editor(col, f){
  const valor=f[col.k];
  let e;
  if(col.tipo==='ajuste'){
    e=document.createElement('select'); e.className='w-chico';
    ['', '0', '1', '2', '3'].forEach(v=>e.appendChild(opcion(v, v===''?'—':v, valor)));
  } else if(col.tipo==='si'){
    e=document.createElement('select'); e.className='w-chico';
    e.appendChild(opcion('', '—', valor)); e.appendChild(opcion('SI', 'SI', valor));
  } else if(col.tipo==='linea'){
    e=document.createElement('select'); e.className='w-cod';
    e.appendChild(opcion('', '—', valor));
    const lineas=estado.cat.lineas.slice();
    if(!vacio(valor) && !lineas.some(l=>l.toUpperCase()===String(valor).toUpperCase())) lineas.push(String(valor));
    lineas.forEach(l=>e.appendChild(opcion(l, l, valor)));
  } else if(col.tipo==='cod'){
    e=document.createElement('select'); e.className='w-cod';
    e.appendChild(opcion('', '—', valor));
    const cods=codsVigentes(f.fecha_entrega);
    if(!vacio(valor) && !cods.some(c=>c.cod===String(valor).toUpperCase())) cods.push({cod:String(valor).toUpperCase(), t:null});
    cods.forEach(c=>e.appendChild(opcion(c.cod, c.cod+(c.t&&c.t.ruta?' · '+c.t.ruta:''), valor)));
  } else if(col.tipo==='fecha'){
    e=document.createElement('input'); e.type='date'; e.className='w-fecha'; e.value=valor||'';
  } else if(col.tipo==='camion'){
    e=document.createElement('input'); e.type='text'; e.className='w-cod'; e.value=valor||'';
    e.setAttribute('list','dl-transportistas'); e.style.textTransform='uppercase';
  } else if(col.tipo==='numero'){
    e=document.createElement('input'); e.type='text'; e.inputMode='decimal'; e.className='w-num';
    e.value=vacio(valor)?'':String(Math.round(Number(valor)*100)/100);
  } else {
    e=document.createElement('input'); e.type='text'; e.className=col.largo?'w-largo':'w-texto'; e.value=valor||'';
  }
  e.dataset.campo=col.k;
  e.addEventListener('change', ()=>guardarCampo(f.id, col.k, e));
  return e;
}

// ── Día ──────────────────────────────────────────────────────
async function cargarCatalogos(){
  const r=await apiOk({tipo:'pago_catalogos'});
  estado.cat={tarifas:r.tarifas||[], transportistas:r.transportistas||[], lineas:r.lineas||[]};
  const dl=document.getElementById('dl-transportistas');
  dl.innerHTML='';
  estado.cat.transportistas.forEach(t=>{ const o=document.createElement('option'); o.value=t.tag; o.label=t.nombre; dl.appendChild(o); });
}

async function cargarDias(){
  const r=await apiOk({tipo:'pago_dias'});
  estado.dias=r.dias||[];
  const sel=document.getElementById('sel-dia');
  sel.innerHTML='';
  if(estado.dia && !estado.dias.some(d=>d.fecha===estado.dia)) estado.dias.unshift({fecha:estado.dia, filas:0});
  estado.dias.forEach(d=>{
    sel.appendChild(opcion(d.fecha, fechaLarga(d.fecha)+'  ·  '+nombreHoja(d.fecha)+'  ·  '+d.filas+' camiones', estado.dia));
  });
}

async function abrirDia(fecha, silencioso){
  estado.dia=fecha;
  try{ localStorage.setItem('pago_dia', fecha); }catch(e){}
  document.getElementById('inp-dia').value=fecha;
  const info=document.getElementById('dia-info');
  if(!silencioso) info.textContent='Cargando...';
  try{
    const r=await apiOk({tipo:'pago_filas', fecha});
    estado.filas=(r.filas||[]).sort((a,b)=>num(a.orden)-num(b.orden));
    estado.porId={}; estado.filas.forEach(f=>{ estado.porId[f.id]=f; });
    estado.marcadas=new Set([...estado.marcadas].filter(id=>estado.porId[id]));
    if(!estado.dias.some(d=>d.fecha===fecha)) await cargarDias();
    else document.getElementById('sel-dia').value=fecha;
    pintarDia();
  } catch(e){
    info.textContent='No se pudo cargar el día: '+e.message;
  }
}

function pintarDia(){
  const tabla=document.getElementById('tabla-dia');
  tabla.innerHTML='';
  const info=document.getElementById('dia-info');
  info.textContent=estado.filas.length
    ? `${fechaLarga(estado.dia)} — pestaña ${nombreHoja(estado.dia)} en el Excel — ${estado.filas.length} filas.`
    : `${fechaLarga(estado.dia)}: todavía no hay camiones. Llegan solos al publicar la ruta del día; o agrega uno con "Cargue adicional".`;
  const thead=document.createElement('thead');
  const trh=document.createElement('tr');
  const th0=el('th','col-fija'); th0.innerHTML='<small>&nbsp;</small>'; trh.appendChild(th0);
  COLS.forEach(c=>{ const th=document.createElement('th'); th.innerHTML='<small>'+c.l+'</small>'; th.appendChild(document.createTextNode(c.t)); trh.appendChild(th); });
  trh.appendChild(el('th', null, ''));
  thead.appendChild(trh); tabla.appendChild(thead);
  const tbody=document.createElement('tbody');
  estado.filas.forEach(f=>tbody.appendChild(filaDia(f)));
  tabla.appendChild(tbody);
  const tfoot=document.createElement('tfoot');
  tfoot.appendChild(document.createElement('tr'));
  tabla.appendChild(tfoot);
  pintarTotales();
  actualizarBotonIntercambio();
}

function filaDia(f){
  const tr=document.createElement('tr'); tr.className='fila-dia'; tr.dataset.id=f.id;
  if(estado.marcadas.has(f.id)) tr.classList.add('marcada');
  if(f.fuera_de_ruta==='SI') tr.classList.add('quitada');
  const c=calcularFila(f);
  // Columna fija: casilla para intercambiar + etiquetas.
  const td0=el('td','col-fija');
  const chk=document.createElement('input'); chk.type='checkbox'; chk.checked=estado.marcadas.has(f.id);
  chk.title='Marcar para intercambiar transportistas';
  chk.addEventListener('change', ()=>{ if(chk.checked) estado.marcadas.add(f.id); else estado.marcadas.delete(f.id); tr.classList.toggle('marcada', chk.checked); actualizarBotonIntercambio(); });
  td0.appendChild(chk);
  // Quién es la fila, siempre a la vista aunque la tabla se desplace a la derecha.
  const quien=el('span', 'quien');
  quien.appendChild(el('b', null, ' '+(f.cod_camion||'(sin camión)')));
  if(c.nombre) quien.appendChild(el('small', null, ' '+String(c.nombre).replace(/^[A-Z]{1,3}\d{1,4}\s*-?\s*/i,'')));
  td0.appendChild(quien);
  const cargue=String(f.clave_carga||'').split(' CARGUE ')[1];
  if(cargue) td0.appendChild(el('span','etq cargue','CARGUE '+cargue));
  if(f.origen==='manual') td0.appendChild(el('span','etq adic','adicional'));
  const orig=codOriginal(f);
  if(orig && orig!==String(f.cod_camion||'').toUpperCase()) td0.appendChild(el('span','etq camb','era '+orig));
  if(f.fuera_de_ruta==='SI') td0.appendChild(el('span','etq fuera','ya no está en la ruta'));
  if(f.editado_carga==='SI') td0.appendChild(el('span','etq corr','kg/$ corregidos'));
  tr.appendChild(td0);
  COLS.forEach(col=>{
    const td=document.createElement('td');
    if(col.calc){
      td.className='calc'+(col.din?' dinero':'')+(col.pct?' num':'');
      td.dataset.calc=col.k;
      pintarCalculada(td, col, c);
    } else {
      if(col.tipo==='numero') td.className='num';
      td.appendChild(editor(col, f));
    }
    tr.appendChild(td);
  });
  const tdb=document.createElement('td');
  const b=el('button','btn btn-peligro btn-cargue','🗑'); b.type='button'; b.title='Quitar esta fila';
  b.addEventListener('click', ()=>eliminarFila(f.id));
  tdb.appendChild(b); tr.appendChild(tdb);
  return tr;
}

function pintarCalculada(td, col, c){
  const v=c[col.k];
  td.classList.remove('sancion');
  if(col.din) td.textContent=dinero(v);
  else if(col.pct) td.textContent=pct(v);
  else td.textContent=v===null||v===undefined?'':v;
  if(col.k==='S' && c.sancionado){ td.classList.add('sancion'); td.title='Sancionado: la devolución pasa del 3%'; }
  if(col.k==='P' && v>LIMITE_RETORNO+1e-9) td.classList.add('sancion');
  if(col.k==='G' && c.sinTarifa){ td.textContent='¿COD?'; td.title='Falta el COD de frecuencia (o no existe en Tarifas)'; }
  if(col.k==='nombre' && !v) td.textContent='—';
}

function refrescarFila(id){
  const f=estado.porId[id];
  const tr=document.querySelector(`#tabla-dia tr[data-id="${id}"]`);
  if(!f || !tr) return;
  const c=calcularFila(f);
  COLS.forEach(col=>{ if(col.calc){ const td=tr.querySelector(`td[data-calc="${col.k}"]`); if(td) pintarCalculada(td, col, c); } });
  pintarTotales();
}

function totalesDe(filas){
  const t={kgs:0, facturas:0, monto:0, retorno:0, G:0, S:0, faltan:0};
  filas.forEach(f=>{
    const c=calcularFila(f);
    t.kgs+=num(f.kgs); t.facturas+=num(f.facturas); t.monto+=num(f.monto); t.retorno+=num(f.retorno);
    if(c.G===null||c.S===null) t.faltan++; else { t.G+=c.G; t.S+=c.S; }
  });
  return t;
}

function pintarTotales(){
  const t=totalesDe(estado.filas);
  const tfoot=document.querySelector('#tabla-dia tfoot');
  if(tfoot){
    const tr=document.createElement('tr');
    tr.appendChild(el('td','col-fija','TOTAL'));
    COLS.forEach(col=>{
      const td=document.createElement('td');
      const v={G:dinero(t.G), kgs:numero(t.kgs), facturas:numero(t.facturas,0), monto:dinero(t.monto), retorno:dinero(t.retorno),
        O:dinero(t.monto-t.retorno), P:pct(t.monto?t.retorno/t.monto:0), S:dinero(t.S)}[col.k];
      if(v!==undefined){ td.textContent=v; td.style.textAlign='right'; }
      tr.appendChild(td);
    });
    tr.appendChild(document.createElement('td'));
    tfoot.innerHTML=''; tfoot.appendChild(tr);
  }
  document.getElementById('dia-totales').innerHTML=
    `<span>Valor de rutas: <b>${dinero(t.G)}</b></span><span>A cancelar: <b>${dinero(t.S)}</b></span>`+
    `<span>Diferencia (sanciones): <b>${dinero(t.G-t.S)}</b></span>`+
    (t.faltan?`<span style="color:#b00020">⚠ ${t.faltan} fila(s) con ajuste pero sin COD de frecuencia válido</span>`:'');
}

async function guardarCampo(id, campo, input){
  const f=estado.porId[id];
  if(!f) return;
  let valor=input.value;
  if(campo==='cod_camion'){ valor=valor.trim().toUpperCase(); input.value=valor; }
  const anterior=f[campo];
  input.classList.remove('error'); input.classList.add('guardando');
  estado.guardando++;
  try{
    const r=await api({tipo:'pago_guardar', id, campo, valor, anterior:vacio(anterior)?'':anterior});
    if(r.fila){ Object.assign(f, r.fila); }
    if(!r.ok){
      input.classList.add('error');
      if(r.conflicto) restaurarInput(input, f, campo);
      mostrarToast('⚠️ '+(r.error||'No se pudo guardar.'), 6000);
    }
  } catch(e){
    input.classList.add('error');
    restaurarInput(input, f, campo);
    mostrarToast('⚠️ No se guardó: '+e.message, 6000);
  } finally {
    estado.guardando--;
    input.classList.remove('guardando');
  }
  if(campo==='cod_frec' || campo==='fecha_entrega' || campo==='cod_camion'){
    // Cambian etiquetas o el día: se vuelve a dibujar la fila entera.
    if(campo==='fecha_entrega' && f.fecha_entrega!==estado.dia){
      mostrarToast('La fila pasó al '+fechaLarga(f.fecha_entrega)+' (en el Excel sigue en su pestaña).', 5000);
    }
    const tr=document.querySelector(`#tabla-dia tr[data-id="${id}"]`);
    if(tr){ const nuevo=filaDia(f); tr.replaceWith(nuevo); }
    pintarTotales();
  } else refrescarFila(id);
}
function restaurarInput(input, f, campo){
  const v=f[campo];
  input.value=vacio(v)?'':(input.inputMode==='decimal'?String(Math.round(Number(v)*100)/100):String(v));
}

function actualizarBotonIntercambio(){
  const b=document.getElementById('b-intercambiar');
  b.disabled=estado.marcadas.size!==2;
  b.textContent=estado.marcadas.size===2?'⇄ Intercambiar las 2 marcadas':'⇄ Intercambiar transportistas';
}

async function intercambiar(){
  const [a,b]=[...estado.marcadas].map(id=>estado.porId[id]);
  if(!a||!b) return;
  const ca=calcularFila(a), cb=calcularFila(b);
  const si=await mostrarModal({titulo:'Intercambiar transportistas', tipo:'pregunta',
    texto:`Fila 1: ${a.cod_camion||'—'} — ${a.cod_frec||'sin COD'} ${ca.ruta!=='-'?ca.ruta:''} — ${numero(a.kgs)} kg — ${dinero(num(a.monto))}\n`+
      `Fila 2: ${b.cod_camion||'—'} — ${b.cod_frec||'sin COD'} ${cb.ruta!=='-'?cb.ruta:''} — ${numero(b.kgs)} kg — ${dinero(num(b.monto))}\n\n`+
      `Se intercambian los CÓDIGOS DE CAMIÓN (y el chofer adicional): ${a.cod_camion||'—'} queda en la fila 2 y ${b.cod_camion||'—'} en la fila 1. La ruta, los kilos y el dinero se quedan en su fila.`,
    botones:[{texto:'Cancelar', valor:false}, {texto:'Intercambiar', valor:true, principal:true}]});
  if(!si) return;
  try{
    const r=await apiOk({tipo:'pago_intercambiar', id1:a.id, id2:b.id, cod1:a.cod_camion||'', cod2:b.cod_camion||''});
    (r.filas||[]).forEach(x=>Object.assign(estado.porId[x.id], x));
    estado.marcadas.clear();
    pintarDia();
    mostrarToast('✅ Transportistas intercambiados');
  } catch(e){
    if(e.respuesta && e.respuesta.filas) e.respuesta.filas.forEach(x=>estado.porId[x.id]&&Object.assign(estado.porId[x.id], x));
    pintarDia();
    await mostrarModal({titulo:'No se intercambió', texto:e.message, tipo:'aviso'});
  }
}

// Ventanita con campos (los avisos de servicio-local.js solo tienen texto).
function formulario({titulo, texto, campos, aceptar}){
  return new Promise(resolve=>{
    const fondo=el('div','modal-fondo'); const caja=el('div','modal-caja pregunta');
    caja.appendChild(el('h3',null,titulo));
    if(texto) caja.appendChild(el('div','modal-texto',texto));
    const inputs={};
    campos.forEach(c=>{
      const w=el('div','campo-form'); w.appendChild(el('label',null,c.t));
      let i;
      if(c.opciones){ i=document.createElement('select'); c.opciones.forEach(o=>i.appendChild(opcion(o.v, o.t, c.valor))); }
      else { i=document.createElement('input'); i.type=c.tipo||'text'; i.value=c.valor===undefined||c.valor===null?'':c.valor; if(c.lista) i.setAttribute('list', c.lista); }
      if(c.soloLectura) i.disabled=true;
      if(c.ayuda) w.appendChild(el('div','ayuda',c.ayuda));
      w.insertBefore(i, w.children[1]||null);
      inputs[c.k]=i; caja.appendChild(w);
    });
    const pie=el('div','modal-pie');
    const cancelar=el('button','btn btn-sec','Cancelar'); cancelar.type='button';
    const ok=el('button','btn btn-principal',aceptar||'Guardar'); ok.type='button';
    const cerrar=v=>{ fondo.remove(); resolve(v); };
    cancelar.onclick=()=>cerrar(null);
    ok.onclick=()=>{ const v={}; Object.keys(inputs).forEach(k=>v[k]=inputs[k].value); cerrar(v); };
    caja.addEventListener('keydown', ev=>{ if(ev.key==='Enter' && ev.target.tagName==='INPUT') ok.click(); if(ev.key==='Escape') cancelar.click(); });
    pie.appendChild(cancelar); pie.appendChild(ok); caja.appendChild(pie);
    fondo.appendChild(caja); document.body.appendChild(fondo);
    const primero=caja.querySelector('input:not([disabled]),select:not([disabled])'); if(primero) primero.focus();
  });
}

async function cargueAdicional(){
  const v=await formulario({titulo:'Cargue adicional', aceptar:'Agregar',
    texto:`Una fila más para el ${fechaLarga(estado.dia)} (por ejemplo, un cargue que salió a último minuto). Luego completa en la tabla ruta, kilos, facturas y $.`,
    campos:[{k:'cod', t:'Código de camión', lista:'dl-transportistas', ayuda:'Ej. F150 (puedes dejarlo vacío y escribirlo después)'}]});
  if(!v) return;
  try{
    const r=await apiOk({tipo:'pago_fila_nueva', fecha_entrega:estado.dia, cod_camion:String(v.cod||'').trim().toUpperCase()});
    await abrirDia(estado.dia, true);
    await cargarDias();
    const tr=document.querySelector(`#tabla-dia tr[data-id="${r.fila.id}"]`);
    if(tr){ tr.scrollIntoView({block:'center'}); const i=tr.querySelector('[data-campo="cod_frec"]'); if(i) i.focus(); }
    mostrarToast('✅ Cargue adicional agregado');
  } catch(e){ await mostrarModal({titulo:'No se agregó', texto:e.message, tipo:'aviso'}); }
}

async function eliminarFila(id){
  const f=estado.porId[id]; if(!f) return;
  const c=calcularFila(f);
  const si=await mostrarModal({titulo:'Quitar fila', tipo:'pregunta',
    texto:`¿Quitar ${f.cod_camion||'(sin camión)'} ${c.nombre?'— '+c.nombre:''} del ${fechaLarga(f.fecha_entrega)}?\n\n`+
      (f.origen==='carga'?'Ojo: si se vuelve a publicar la ruta de ese día con este camión, vuelve a aparecer.\n':'')+
      'En el Excel la fila queda vacía en la próxima sincronización.',
    botones:[{texto:'Cancelar', valor:false}, {texto:'Quitar', valor:true, principal:true}]});
  if(!si) return;
  try{
    await apiOk({tipo:'pago_fila_eliminar', id});
    estado.marcadas.delete(id);
    await abrirDia(estado.dia, true);
    cargarDias().catch(()=>{});
  } catch(e){ await mostrarModal({titulo:'No se quitó', texto:e.message, tipo:'aviso'}); }
}

// ── Descargar a Excel (para usarlo en otra PC) ───────────────
let _xlsxCargando=null;
function cargarXLSX(){
  if(window.XLSX) return Promise.resolve();
  if(_xlsxCargando) return _xlsxCargando;
  _xlsxCargando=new Promise((resolve, reject)=>{
    const s=document.createElement('script');
    s.src='https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
    s.onload=()=>resolve(); s.onerror=()=>{ _xlsxCargando=null; reject(new Error('No se pudo cargar el generador de Excel.')); };
    document.head.appendChild(s);
  });
  return _xlsxCargando;
}
function filasParaExcel(filas){
  const enc=COLS.map(c=>c.t);
  const datos=filas.map(f=>{
    const c=calcularFila(f);
    return COLS.map(col=>{
      if(col.calc){ const v=c[col.k]; return (v===null||v===undefined)?'':(typeof v==='number'?Math.round(v*10000)/10000:v); }
      if(col.k==='fecha_entrega') return f.fecha_entrega?fechaDe(f.fecha_entrega):'';
      const v=f[col.k]; if(vacio(v)) return '';
      return ['kgs','facturas','monto','retorno','ajuste','n_ayudantes'].includes(col.k)?Number(v):v;
    });
  });
  return [enc].concat(datos);
}
async function descargarDia(){
  try{ await cargarXLSX(); }catch(e){ mostrarToast('⚠️ '+e.message, 5000); return; }
  const wb=XLSX.utils.book_new();
  const ws=XLSX.utils.aoa_to_sheet(filasParaExcel(estado.filas), {cellDates:true});
  XLSX.utils.book_append_sheet(wb, ws, nombreHoja(estado.dia));
  XLSX.writeFile(wb, `PAGO TRANSPORTES ${nombreHoja(estado.dia)}.xlsx`);
}

// ── Consolidado ──────────────────────────────────────────────
async function verConsolidado(){
  const desde=document.getElementById('con-desde').value, hasta=document.getElementById('con-hasta').value;
  const info=document.getElementById('con-info');
  if(!desde||!hasta){ info.textContent='Elige las dos fechas.'; return; }
  info.textContent='Cargando...';
  try{
    const r=await apiOk({tipo:'pago_filas', desde, hasta}, 60000);
    estado.consolidado=(r.filas||[]).sort((a,b)=>String(a.fecha_entrega).localeCompare(String(b.fecha_entrega))||num(a.orden)-num(b.orden));
  } catch(e){ info.textContent='No se pudo cargar: '+e.message; return; }
  const grupos={};
  estado.consolidado.forEach(f=>{
    const cod=String(f.cod_camion||'(sin camión)').toUpperCase();
    const g=grupos[cod]||(grupos[cod]={cod, nombre:'', dias:new Set(), filas:[]});
    g.filas.push(f); g.dias.add(f.fecha_entrega);
    if(!g.nombre) g.nombre=calcularFila(f).nombre;
  });
  const lista=Object.values(grupos).sort((a,b)=>a.cod.localeCompare(b.cod));
  const tabla=document.getElementById('tabla-con'); tabla.innerHTML='';
  const enc=['Código','Nombre','Días','Filas','Kgs','Monto $','Retorno $','% retorno','Valor de ruta','A cancelar','Diferencia'];
  const thead=document.createElement('thead'); const trh=document.createElement('tr');
  enc.forEach(t=>trh.appendChild(el('th',null,t))); thead.appendChild(trh); tabla.appendChild(thead);
  const tbody=document.createElement('tbody');
  const T={kgs:0, monto:0, retorno:0, G:0, S:0, filas:0};
  lista.forEach(g=>{
    const t=totalesDe(g.filas);
    T.kgs+=t.kgs; T.monto+=t.monto; T.retorno+=t.retorno; T.G+=t.G; T.S+=t.S; T.filas+=g.filas.length;
    const tr=document.createElement('tr');
    [g.cod, g.nombre||'—', g.dias.size, g.filas.length, numero(t.kgs), dinero(t.monto), dinero(t.retorno),
     pct(t.monto?t.retorno/t.monto:0), dinero(t.G), dinero(t.S), dinero(t.G-t.S)].forEach((v,i)=>{
      const td=el('td', i>=2?'num':null, v); tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  const trT=document.createElement('tr');
  ['TOTAL','',new Set(estado.consolidado.map(f=>f.fecha_entrega)).size, T.filas, numero(T.kgs), dinero(T.monto), dinero(T.retorno),
   pct(T.monto?T.retorno/T.monto:0), dinero(T.G), dinero(T.S), dinero(T.G-T.S)].forEach((v,i)=>{
    const td=el('td', i>=2?'num':null, v); td.style.fontWeight='800'; td.style.background='#e2ebf3'; trT.appendChild(td);
  });
  tbody.appendChild(trT);
  tabla.appendChild(tbody);
  info.textContent=`${estado.consolidado.length} filas entre ${fechaLarga(desde)} y ${fechaLarga(hasta)}.`;
}
async function descargarConsolidado(){
  if(!estado.consolidado.length){ mostrarToast('Primero toca "Ver".'); return; }
  try{ await cargarXLSX(); }catch(e){ mostrarToast('⚠️ '+e.message, 5000); return; }
  const wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.table_to_sheet(document.getElementById('tabla-con'), {raw:false}), 'RESUMEN');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(filasParaExcel(estado.consolidado), {cellDates:true}), 'CONSOLIDADO');
  XLSX.writeFile(wb, `PAGO TRANSPORTES ${document.getElementById('con-desde').value} a ${document.getElementById('con-hasta').value}.xlsx`);
}

// ── Tarifas ──────────────────────────────────────────────────
function pintarTarifas(){
  const hoy=hoyISO();
  const tabla=document.getElementById('tabla-tarifas'); tabla.innerHTML='';
  const enc=['COD','RUTA','ÚLTIMA DISTANCIA','TARIFA ACTUAL (D)','% NUEVA','NUEVA TARIFA (E)','% 6 LLANTAS','6 LLANTAS (F)','AJUSTE 3 (J)','SANCIÓN AJ. 3 (I)','RIGE DESDE',''];
  const thead=document.createElement('thead'); const trh=document.createElement('tr');
  enc.forEach(t=>trh.appendChild(el('th',null,t))); thead.appendChild(trh); tabla.appendChild(thead);
  const tbody=document.createElement('tbody');
  codsVigentes(hoy).forEach(({cod, t})=>{
    const v=valoresTarifa(t);
    const versiones=estado.cat.tarifas.filter(x=>String(x.cod).toUpperCase()===cod).length;
    const futura=estado.cat.tarifas.some(x=>String(x.cod).toUpperCase()===cod && String(x.vigente_desde)>hoy);
    const tr=document.createElement('tr');
    [cod, t.ruta||'', t.distancia||'', dinero(v.D), pct(num(t.pct_nueva)), dinero(v.E), pct(num(t.pct_6)), dinero(v.F), dinero(v.J), dinero(v.I),
     (String(t.vigente_desde)<='2000-01-01'?'—':fechaLarga(t.vigente_desde))+(futura?' (hay un cambio programado)':'')].forEach((x,i)=>{
      tr.appendChild(el('td', (i>=3&&i<=9)?'num':null, x));
    });
    const td=document.createElement('td');
    const b=el('button','btn btn-cargue','✏️ Cambiar'); b.type='button'; b.onclick=()=>editarTarifa(cod);
    td.appendChild(b);
    if(versiones>1){ const h=el('button','btn btn-cargue','Historial ('+versiones+')'); h.type='button'; h.style.marginLeft='4px'; h.onclick=()=>historialTarifa(cod); td.appendChild(h); }
    tr.appendChild(td);
    tbody.appendChild(tr);
  });
  tabla.appendChild(tbody);
  const chips=document.getElementById('chips-lineas'); chips.innerHTML='';
  estado.cat.lineas.forEach(l=>{
    const c=el('span','chip',l); const x=el('button',null,'✕'); x.type='button'; x.title='Quitar';
    x.onclick=async ()=>{
      const si=await mostrarModal({titulo:'Quitar línea', texto:`¿Quitar la línea ${l} de la lista? (Las filas que ya la tienen no cambian.)`, tipo:'pregunta', botones:[{texto:'Cancelar',valor:false},{texto:'Quitar',valor:true,principal:true}]});
      if(si) guardarLinea(l, 'quitar');
    };
    c.appendChild(x); chips.appendChild(c);
  });
}
function historialTarifa(cod){
  const versiones=estado.cat.tarifas.filter(x=>String(x.cod).toUpperCase()===cod).sort((a,b)=>String(a.vigente_desde).localeCompare(String(b.vigente_desde)));
  mostrarModal({titulo:'Historial de '+cod, tipo:'info', texto:versiones.map(t=>
    `Desde ${String(t.vigente_desde)<='2000-01-01'?'el inicio':fechaLarga(t.vigente_desde)}: tarifa ${dinero(num(t.tarifa_actual))}, ${pct(num(t.pct_nueva))} / ${pct(num(t.pct_6))}`+(t.modificado_por?`  (${t.modificado_por})`:'')).join('\n')});
}
async function editarTarifa(cod){
  const t=cod?tarifaDe(cod, hoyISO()):null;
  const v=await formulario({titulo:cod?'Cambiar tarifa '+cod:'Nueva ruta',
    texto:cod?'El cambio rige para las entregas desde la fecha que elijas; los días anteriores no cambian.':'',
    campos:[
      {k:'cod', t:'COD', valor:cod||'', soloLectura:!!cod},
      {k:'ruta', t:'Ruta', valor:t?t.ruta:''},
      {k:'distancia', t:'Última distancia recorrida', valor:t?t.distancia:''},
      {k:'tarifa_actual', t:'Tarifa actual $', valor:t?t.tarifa_actual:'', tipo:'number'},
      {k:'pct_nueva', t:'% de incremento (nueva tarifa)', valor:t?Math.round(num(t.pct_nueva)*1000)/10:3, tipo:'number', ayuda:'3 o 3,5'},
      {k:'pct_6', t:'% de incremento (6 llantas)', valor:t?Math.round(num(t.pct_6)*1000)/10:4, tipo:'number', ayuda:'Normalmente 4 (si el anterior es 3) o 4,5'},
      {k:'vigente_desde', t:'Rige desde la fecha de entrega', valor:hoyISO(), tipo:'date'},
    ]});
  if(!v) return;
  try{
    const r=await apiOk({tipo:'pago_tarifa_guardar', cod:cod||v.cod, ruta:v.ruta, distancia:v.distancia, tarifa_actual:v.tarifa_actual,
      pct_nueva:num(v.pct_nueva)/100, pct_6:num(v.pct_6)/100, vigente_desde:v.vigente_desde});
    estado.cat.tarifas=r.tarifas||estado.cat.tarifas;
    pintarTarifas(); mostrarToast('✅ Tarifa guardada');
    if(estado.dia) pintarDia();
  } catch(e){ await mostrarModal({titulo:'No se guardó', texto:e.message, tipo:'aviso'}); }
}
async function guardarLinea(linea, accion){
  try{
    const r=await apiOk({tipo:'pago_linea_guardar', linea, accion:accion||'agregar'});
    estado.cat.lineas=r.lineas||[];
    pintarTarifas();
  } catch(e){ await mostrarModal({titulo:'No se guardó', texto:e.message, tipo:'aviso'}); }
}

// ── Transportistas ───────────────────────────────────────────
function pintarTransportistas(){
  const filtro=document.getElementById('inp-buscar-transp').value.trim().toUpperCase();
  const tabla=document.getElementById('tabla-transp'); tabla.innerHTML='';
  const thead=document.createElement('thead'); const trh=document.createElement('tr');
  ['Código','Nombre',''].forEach(t=>trh.appendChild(el('th',null,t))); thead.appendChild(trh); tabla.appendChild(thead);
  const tbody=document.createElement('tbody');
  estado.cat.transportistas.filter(t=>!filtro || (t.tag+' '+t.nombre).toUpperCase().includes(filtro))
    .sort((a,b)=>String(a.tag).localeCompare(String(b.tag))).forEach(t=>{
      const tr=document.createElement('tr');
      tr.appendChild(el('td',null,t.tag)); tr.appendChild(el('td',null,t.nombre));
      const td=document.createElement('td'); const b=el('button','btn btn-cargue','✏️'); b.type='button'; b.onclick=()=>editarTransportista(t);
      td.appendChild(b); tr.appendChild(td); tbody.appendChild(tr);
    });
  tabla.appendChild(tbody);
}
async function editarTransportista(t){
  const v=await formulario({titulo:t?'Cambiar transportista '+t.tag:'Nuevo transportista',
    campos:[{k:'tag', t:'Código (ej. F150)', valor:t?t.tag:'', soloLectura:!!t},
            {k:'nombre', t:'Nombre (como sale en la columna NOMBRE, ej. "F150-BETUN JHONATAN")', valor:t?t.nombre:''}]});
  if(!v) return;
  try{
    const r=await apiOk({tipo:'pago_transportista_guardar', tag:t?t.tag:v.tag, nombre:v.nombre});
    estado.cat.transportistas=r.transportistas||estado.cat.transportistas;
    pintarTransportistas(); await cargarCatalogos();
    mostrarToast('✅ Guardado');
  } catch(e){ await mostrarModal({titulo:'No se guardó', texto:e.message, tipo:'aviso'}); }
}

// ── Excel de la PC de logística (servicio local) ─────────────
let _claveEntregada=false;
function renderServicio(e){
  try{ localStorage.setItem('pago_pc_excel','1'); }catch(err){}
  const pill=document.getElementById('pill-servicio'); pill.classList.remove('oculto');
  document.getElementById('b-conectar-pc').classList.add('oculto');
  const card=document.getElementById('card-excel'); card.classList.remove('oculto');
  const est=document.getElementById('excel-estado');
  const rol=(getSesion()||{}).rol;
  if(!e.tiene_clave){
    if(['admin','coordinador'].includes(rol) && !_claveEntregada){ _claveEntregada=true; entregarClave(); }
    est.textContent=['admin','coordinador'].includes(rol)?'Configurando esta PC...':'Esta PC todavía no está configurada: ábrela una vez con usuario coordinador o admin.';
    est.className='excel-estado';
    return;
  }
  const u=e.ultima;
  let txt=e.sincronizando?'⏳ Sincronizando con el Excel...':(u?`Última sincronización ${u.hora}: ${u.mensaje}`:'Primera sincronización en menos de un minuto...');
  if(u && u.archivo) txt+=`\nArchivo: ${u.archivo}`;
  txt+=`\nSe sincroniza sola cada ${e.minutos||5} minutos.`;
  est.textContent=txt; est.style.whiteSpace='pre-line';
  est.className='excel-estado'+(u&&!u.ok&&!e.sincronizando?' mal':'');
  document.getElementById('b-sincronizar').disabled=!!e.sincronizando;
  const av=document.getElementById('excel-avisos');
  if((e.avisos_sync||[]).length){
    av.classList.remove('oculto'); av.innerHTML='<b>Cambios del Excel que no se aplicaron (ganó la web):</b>';
    const ul=document.createElement('ul'); e.avisos_sync.forEach(a=>ul.appendChild(el('li',null,a))); av.appendChild(ul);
    const b=el('button','btn btn-cargue','Entendido'); b.type='button'; b.style.marginTop='6px';
    b.onclick=()=>accion('/pago/limpiar_avisos'); av.appendChild(b);
  } else av.classList.add('oculto');
  // Al terminar una sincronización, el día puede traer cambios hechos en el Excel.
  if(u && estado.ultimaSync && u.hora!==estado.ultimaSync && !estado.guardando && !document.activeElement.closest('#tabla-dia')){
    abrirDia(estado.dia, true);
  }
  estado.ultimaSync=u?u.hora:null;
}
function sinServicio(){
  document.getElementById('card-excel').classList.add('oculto');
  document.getElementById('pill-servicio').classList.add('oculto');
  document.getElementById('b-conectar-pc').classList.remove('oculto');
}
async function entregarClave(){
  try{
    const r=await apiOk({tipo:'pago_clave_pc'});
    const s=await llamarServicio('POST', '/pago/clave', {clave:r.clave});
    if(s && s.ok===false) throw new Error(s.error);
    mostrarToast('✅ Esta PC quedó lista para sincronizar el Excel');
  } catch(e){
    _claveEntregada=false;
    mostrarToast('⚠️ No se pudo configurar la PC: '+e.message, 6000);
  }
  refrescarYa();
}
function conectarPC(){
  iniciarConsulta('/pago/estado', renderServicio, sinServicio);
}

// ── Pestañas e inicio ───────────────────────────────────────
function mostrarPestana(nombre){
  document.querySelectorAll('.pestanas button').forEach(b=>b.classList.toggle('activa', b.dataset.pestana===nombre));
  ['dia','consolidado','tarifas','transportistas'].forEach(p=>document.getElementById('p-'+p).classList.toggle('oculto', p!==nombre));
  if(nombre==='tarifas') pintarTarifas();
  if(nombre==='transportistas') pintarTransportistas();
}

document.addEventListener('DOMContentLoaded', async ()=>{
  document.querySelectorAll('.pestanas button').forEach(b=>b.addEventListener('click', ()=>mostrarPestana(b.dataset.pestana)));
  document.getElementById('sel-dia').addEventListener('change', e=>abrirDia(e.target.value));
  document.getElementById('inp-dia').addEventListener('change', e=>{ if(e.target.value) abrirDia(e.target.value); });
  document.getElementById('b-recargar').addEventListener('click', async ()=>{ await cargarCatalogos(); await cargarDias(); abrirDia(estado.dia); });
  document.getElementById('b-adicional').addEventListener('click', cargueAdicional);
  document.getElementById('b-intercambiar').addEventListener('click', intercambiar);
  document.getElementById('b-excel-dia').addEventListener('click', descargarDia);
  document.getElementById('b-sincronizar').addEventListener('click', ()=>accion('/pago/sincronizar'));
  document.getElementById('b-conectar-pc').addEventListener('click', conectarPC);
  document.getElementById('b-con-buscar').addEventListener('click', verConsolidado);
  document.getElementById('b-con-excel').addEventListener('click', descargarConsolidado);
  document.getElementById('b-tarifa-nueva').addEventListener('click', ()=>editarTarifa(null));
  document.getElementById('b-linea').addEventListener('click', ()=>{ const i=document.getElementById('inp-linea'); if(i.value.trim()){ guardarLinea(i.value.trim()); i.value=''; } });
  document.getElementById('b-transp-nuevo').addEventListener('click', ()=>editarTransportista(null));
  document.getElementById('inp-buscar-transp').addEventListener('input', pintarTransportistas);
  const hoy=hoyISO();
  document.getElementById('con-desde').value=sumarDias(hoy, -30);
  document.getElementById('con-hasta').value=sumarDias(hoy, 7);

  // Solo se busca el servicio de la PC si este navegador ya lo encontró antes
  // (o con el enlace "¿Esta es la PC del Excel?"): así, en otras PCs, Chrome
  // no pide permiso de "red local" sin motivo.
  let esPC=false; try{ esPC=localStorage.getItem('pago_pc_excel')==='1'; }catch(e){}
  if(esPC) conectarPC();

  try{
    await cargarCatalogos();
    await cargarDias();
    let dia=null; try{ dia=localStorage.getItem('pago_dia'); }catch(e){}
    if(!dia || !estado.dias.some(d=>d.fecha===dia)) dia=estado.dias.length?estado.dias[0].fecha:hoy;
    await abrirDia(dia);
  } catch(e){
    document.getElementById('dia-info').textContent='No se pudo cargar: '+e.message;
  }
  // Refresco suave cada minuto (otros usuarios / el Excel), si no se está escribiendo.
  setInterval(()=>{
    if(document.hidden || estado.guardando || document.querySelector('.modal-fondo')) return;
    if(document.activeElement && document.activeElement.closest && document.activeElement.closest('#tabla-dia')) return;
    if(!document.getElementById('p-dia').classList.contains('oculto') && estado.dia) abrirDia(estado.dia, true);
  }, 60000);
});
