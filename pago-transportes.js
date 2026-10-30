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
  guardando:0, consolidado:[], ultimaSync:null, cortes:[], hoyServidor:null, totalCorte:null
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
  // Importada del Excel de un corte anterior: ruta, valor de ruta y valor a
  // cancelar son los que tenía ese Excel (la tarifa de ese momento).
  if(f.origen==='historico') return calcularHistorica(f);
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

function calcularHistorica(f){
  const G=num(f.valor_ruta_hist), S=num(f.valor_cancelar_hist), M=num(f.monto), N=num(f.retorno);
  const cod=String(f.cod_camion||'').toUpperCase();
  const d=f.fecha_entrega?fechaDe(f.fecha_entrega):null;
  return {
    mes:d?MESES[d.getMonth()]:'', ruta:f.ruta_hist||'-', G, nombre:nombreTransportista(cod)||f.nombre_carga||'',
    O:M-N, P:M?N/M:0, Q:G?'':'NO', S, sancionado:S<G-0.005, sinTarifa:false
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
  pintarCorteDia();
  if(corteCerrado(estado.dia)){
    tabla.querySelectorAll('input,select,button').forEach(x=>{ x.disabled=true; });
  }
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
  if(f.origen==='historico') td0.appendChild(el('span','etq hist','del Excel anterior'));
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
      if(r.conflicto || r.cerrado) restaurarInput(input, f, campo);
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
  const enc=['CORTE'].concat(COLS.map(c=>c.t));
  const datos=filas.map(f=>{
    const c=calcularFila(f);
    const corte=corteDe(f.fecha_entrega);
    return [corte?corte.nombre:''].concat(COLS.map(col=>{
      if(col.calc){ const v=c[col.k]; return (v===null||v===undefined)?'':(typeof v==='number'?Math.round(v*10000)/10000:v); }
      if(col.k==='fecha_entrega') return f.fecha_entrega?fechaDe(f.fecha_entrega):'';
      const v=f[col.k]; if(vacio(v)) return '';
      return ['kgs','facturas','monto','retorno','ajuste','n_ayudantes'].includes(col.k)?Number(v):v;
    }));
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

// ── Cortes ───────────────────────────────────────────────────
// Del 26 de un mes al 25 del siguiente, por fecha de entrega:
// 26/09/2026 - 25/10/2026 = "SEPTIEMBRE-OCTUBRE 2026" (id "2026-10").
// Igual que _pagoCorteDe (PagoTransportes.gs) y corte_de (pago_excel.py).
const DIA_CORTE=25;
function corteDe(iso){
  const m=String(iso||'').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if(!m) return null;
  let y1=Number(m[1]), m1=Number(m[2]);
  if(Number(m[3])<=DIA_CORTE){ m1-=1; if(m1===0){ m1=12; y1-=1; } }
  let y2=y1, m2=m1+1;
  if(m2===13){ m2=1; y2+=1; }
  const dd=n=>String(n).padStart(2,'0');
  return {id:y2+'-'+dd(m2), nombre:MESES[m1-1]+'-'+MESES[m2-1]+' '+y2,
          desde:y1+'-'+dd(m1)+'-'+dd(DIA_CORTE+1), hasta:y2+'-'+dd(m2)+'-'+dd(DIA_CORTE)};
}
function corteGuardado(id){ return estado.cortes.find(c=>c.id===id)||null; }
function corteCerrado(iso){
  const c=corteDe(iso); if(!c) return false;
  const g=corteGuardado(c.id);
  return !!(g && String(g.estado).toUpperCase()==='CERRADO');
}
const fechaCorta=iso=>{ const d=fechaDe(iso); return String(d.getDate()).padStart(2,'0')+'/'+String(d.getMonth()+1).padStart(2,'0')+'/'+d.getFullYear(); };

async function cargarCortes(){
  const r=await apiOk({tipo:'pago_cortes'});
  estado.cortes=r.cortes||[];
  estado.hoyServidor=r.hoy||hoyISO();
  const sel=document.getElementById('sel-corte');
  const actual=sel.value;
  sel.innerHTML='';
  estado.cortes.forEach(c=>{
    const cerrado=String(c.estado).toUpperCase()==='CERRADO';
    sel.appendChild(opcion(c.id, `${c.nombre}  ·  ${fechaCorta(c.desde)} al ${fechaCorta(c.hasta)}  ·  ${cerrado?'🔒 cerrado':'abierto'}`, actual));
  });
  sel.appendChild(opcion('rango', 'Otro rango de fechas...', actual));
  if(!actual || ![...sel.options].some(o=>o.value===actual)){
    const hoyC=corteDe(estado.hoyServidor);
    sel.value=(estado.cortes.find(c=>hoyC && c.id===hoyC.id)||estado.cortes[0]||{id:'rango'}).id;
  }
  // Recordatorio: un corte que ya terminó, con filas, y sigue abierto.
  const pendiente=estado.cortes.filter(c=>String(c.estado).toUpperCase()!=='CERRADO' && c.hasta<estado.hoyServidor && num(c.filas_vivas)>0);
  const aviso=document.getElementById('aviso-corte-pendiente');
  if(pendiente.length){
    aviso.classList.remove('oculto');
    aviso.innerHTML='';
    aviso.appendChild(el('h3',null,'Corte por cerrar'));
    aviso.appendChild(el('div','ayuda',pendiente.map(c=>`El corte ${c.nombre} terminó el ${fechaCorta(c.hasta)}: revisa las devoluciones y ciérralo para archivarlo.`).join('\n')));
  } else aviso.classList.add('oculto');
}

function pintarCorteDia(){
  const caja=document.getElementById('dia-corte');
  const c=corteDe(estado.dia);
  if(!c){ caja.textContent=''; return; }
  const cerrado=corteCerrado(estado.dia);
  caja.className='corte-dia'+(cerrado?' cerrado':'');
  caja.textContent=`Corte ${c.nombre} (${fechaCorta(c.desde)} al ${fechaCorta(c.hasta)})`+(cerrado?' · 🔒 cerrado y archivado: solo lectura':'');
  document.getElementById('b-adicional').disabled=cerrado;
  if(cerrado) document.getElementById('b-intercambiar').disabled=true;
}

function rangoElegido(){
  const v=document.getElementById('sel-corte').value;
  if(v==='rango') return {id:null, desde:document.getElementById('con-desde').value, hasta:document.getElementById('con-hasta').value};
  const c=corteDe(v+'-'+String(DIA_CORTE).padStart(2,'0'));
  return c?Object.assign({}, c, corteGuardado(c.id)||{}):null;
}

async function verConsolidado(){
  const sel=document.getElementById('sel-corte');
  document.getElementById('rango-libre').classList.toggle('oculto', sel.value!=='rango');
  const r0=rangoElegido();
  const info=document.getElementById('con-info');
  const est=document.getElementById('corte-estado');
  const bCerrar=document.getElementById('b-corte-cerrar'), bReabrir=document.getElementById('b-corte-reabrir');
  bCerrar.classList.add('oculto'); bReabrir.classList.add('oculto'); est.textContent='';
  if(!r0 || !r0.desde || !r0.hasta){ info.textContent='Elige las dos fechas.'; return; }
  const {desde, hasta}=r0;
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
  const total=totalesDe(estado.consolidado);
  estado.totalCorte={filas:estado.consolidado.length, G:total.G, S:total.S};
  estado.corteVisto={id:r0.id||null, nombre:r0.nombre||'', desde, hasta, cerrado:String(r0.estado||'').toUpperCase()==='CERRADO'};
  estado.gruposCorte={};
  lista.forEach(g=>{ estado.gruposCorte[g.cod]=g; });
  // Por transportista (lo que se le paga en el corte). Cada fila guarda los
  // números crudos (para ordenar, filtrar y totalizar) y su código (resumen).
  tablaFiltrable('tabla-con', COLS_CORTE, lista.map(g=>{
    const t=totalesDe(g.filas);
    return {clave:g.cod, v:[g.cod, g.nombre||'—', g.dias.size, g.filas.length, t.kgs, t.monto, t.retorno,
      t.monto?t.retorno/t.monto:0, t.G, t.S, t.G-t.S]};
  }), {
    total:filas=>{
      const s=i=>filas.reduce((a,f)=>a+(Number(f.v[i])||0),0);
      const dias=new Set(); filas.forEach(f=>estado.gruposCorte[f.clave].dias.forEach(d=>dias.add(d)));
      return ['TOTAL','',dias.size, s(3), s(4), s(5), s(6), s(5)?s(6)/s(5):0, s(8), s(9), s(10)];
    },
    alClic:clave=>pintarResumenTransportista(clave, true),
  });
  // Por día (una fila por pestaña del Excel).
  const porDia={};
  estado.consolidado.forEach(f=>{ (porDia[f.fecha_entrega]=porDia[f.fecha_entrega]||[]).push(f); });
  tablaFiltrable('tabla-con-dias', COLS_DIAS, Object.keys(porDia).sort().map(d=>{
    const t=totalesDe(porDia[d]);
    return {clave:d, v:[d, nombreHoja(d), porDia[d].length, t.kgs, t.monto, t.G, t.S, t.G-t.S]};
  }), {
    total:filas=>{ const s=i=>filas.reduce((a,f)=>a+(Number(f.v[i])||0),0); return ['TOTAL','',s(2), s(3), s(4), s(5), s(6), s(7)]; },
  });
  // El resumen abierto se actualiza con los datos nuevos (o se cierra si en
  // este corte ese transportista no tiene filas).
  pintarResumenTransportista(estado.transpElegido && estado.gruposCorte[estado.transpElegido] ? estado.transpElegido : null);
  info.textContent=`${estado.consolidado.length} filas entre ${fechaLarga(desde)} y ${fechaLarga(hasta)}.`+(total.faltan?` ⚠ ${total.faltan} fila(s) con ajuste pero sin COD de frecuencia válido.`:'');
  // Estado del corte y botones.
  if(r0.id){
    const rol=(getSesion()||{}).rol;
    const cerrado=String(r0.estado||'').toUpperCase()==='CERRADO';
    if(cerrado){
      est.textContent=`🔒 Corte cerrado y archivado`+(r0.cerrado_por?` por ${r0.cerrado_por}`:'')+(r0.cerrado_ts?` el ${new Date(Number(r0.cerrado_ts)).toLocaleString('es-EC').replace(/\.$/,'')}`:'')+
        `. Al cerrarlo: ${numero(r0.filas,0)} filas · valor de rutas ${dinero(num(r0.total_valor_ruta))} · a cancelar ${dinero(num(r0.total_a_cancelar))}.`;
      if(rol==='admin') bReabrir.classList.remove('oculto');
    } else {
      est.textContent=(r0.hasta<estado.hoyServidor?'Corte terminado, todavía abierto: ':'Corte en curso: ')+`del ${fechaLarga(r0.desde)} al ${fechaLarga(r0.hasta)}.`;
      if(['admin','coordinador'].includes(rol)) bCerrar.classList.remove('oculto');
    }
  }
}
// ── Tablas de Cortes: ordenar y filtrar ─────────────────────────
// Columnas: t = título, f = cómo se muestra el número crudo, num = filtro numérico.
const COLS_CORTE=[
  {t:'Código'}, {t:'Nombre'}, {t:'Días', num:true, f:v=>numero(v,0)}, {t:'Filas', num:true, f:v=>numero(v,0)},
  {t:'Kgs', num:true, f:v=>numero(v)}, {t:'Monto $', num:true, f:dinero}, {t:'Retorno $', num:true, f:dinero},
  {t:'% retorno', num:true, f:pct, pct:true}, {t:'Valor de ruta', num:true, f:dinero}, {t:'A cancelar', num:true, f:dinero},
  {t:'Diferencia', num:true, f:dinero},
];
const COLS_DIAS=[
  {t:'Fecha', f:fechaLarga}, {t:'Pestaña'}, {t:'Camiones', num:true, f:v=>numero(v,0)}, {t:'Kgs', num:true, f:v=>numero(v)},
  {t:'Monto $', num:true, f:dinero}, {t:'Valor de ruta', num:true, f:dinero}, {t:'A cancelar', num:true, f:dinero},
  {t:'Diferencia', num:true, f:dinero},
];
// Filtros y orden se recuerdan por tabla (al cambiar de corte siguen puestos).
const vistaTablas={};

function textoCelda(col, v){ return col.f ? col.f(v) : (v===null||v===undefined?'':String(v)); }
function sinTildes(s){ return String(s).normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase(); }

// Filtro numérico: ">100", "<5", ">=1", "<=0", "10-50", "=0", "!=0", o un
// número (igual). En % retorno se escribe en porcentaje (">3" = más de 3%).
// Devuelve null si no es una expresión numérica (entonces se busca como texto).
function filtroNumerico(txt, esPct){
  const s=String(txt).trim().replace(/\s+/g,'').replace(/[$%]/g,'');
  // "13.741,10" y "13741,10" (como se muestran) o "13741.10"; "1.5" es 1,5.
  const n=x=>{
    let t=String(x);
    if(t.includes(',')) t=t.replace(/\./g,'').replace(',','.');
    else if(/^-?\d{1,3}(\.\d{3})+$/.test(t)) t=t.replace(/\./g,'');
    const v=Number(t); return isNaN(v)?NaN:(esPct?v/100:v);
  };
  let m;
  if((m=s.match(/^(>=|<=|!=|<>|>|<|=)(-?[\d.,]+)$/))){
    const k=n(m[2]); if(isNaN(k)) return null;
    const e=1e-9;
    return {'>':v=>v>k+e, '<':v=>v<k-e, '>=':v=>v>=k-e, '<=':v=>v<=k+e, '=':v=>Math.abs(v-k)<0.005, '!=':v=>Math.abs(v-k)>=0.005, '<>':v=>Math.abs(v-k)>=0.005}[m[1]];
  }
  if((m=s.match(/^(-?[\d.,]+)-(-?[\d.,]+)$/))){
    const a=n(m[1]), b=n(m[2]); if(isNaN(a)||isNaN(b)) return null;
    return v=>v>=Math.min(a,b)-1e-9 && v<=Math.max(a,b)+1e-9;
  }
  return null;
}

function tablaFiltrable(idTabla, cols, filas, opciones){
  const vista=vistaTablas[idTabla]||(vistaTablas[idTabla]={filtros:{}, orden:null});
  vista.cols=cols; vista.filas=filas; vista.opciones=opciones||{};
  const tabla=document.getElementById(idTabla); tabla.innerHTML='';
  const thead=document.createElement('thead');
  const trh=document.createElement('tr');
  cols.forEach((c,i)=>{
    const th=el('th', 'ordenable'+(c.num?' num':''), c.t);
    th.title='Ordenar';
    th.appendChild(el('span','flecha',''));
    th.addEventListener('click', ()=>{
      const o=vista.orden;
      vista.orden=(!o||o.i!==i)?{i, dir:1}:(o.dir===1?{i, dir:-1}:null);
      pintarCuerpoFiltrable(idTabla);
    });
    trh.appendChild(th);
  });
  const trf=document.createElement('tr'); trf.className='fila-filtro';
  cols.forEach((c,i)=>{
    const th=document.createElement('th');
    const inp=document.createElement('input'); inp.type='text';
    inp.placeholder=c.num?'ej. >0':'filtrar…';
    inp.value=vista.filtros[i]||'';
    inp.addEventListener('input', ()=>{ vista.filtros[i]=inp.value; pintarCuerpoFiltrable(idTabla); });
    th.appendChild(inp); trf.appendChild(th);
  });
  thead.appendChild(trh); thead.appendChild(trf); tabla.appendChild(thead);
  tabla.appendChild(document.createElement('tbody'));
  pintarCuerpoFiltrable(idTabla);
}

function filasVisibles(idTabla){
  const vista=vistaTablas[idTabla];
  const conds=vista.cols.map((c,i)=>{
    const txt=String(vista.filtros[i]||'').trim();
    if(!txt) return null;
    const fn=c.num?filtroNumerico(txt, c.pct):null;
    if(fn) return f=>fn(Number(f.v[i])||0);
    const buscado=sinTildes(txt);
    return f=>sinTildes(textoCelda(c, f.v[i])).includes(buscado);
  });
  let filas=vista.filas.filter(f=>conds.every(cond=>!cond||cond(f)));
  if(vista.orden){
    const {i, dir}=vista.orden, c=vista.cols[i];
    filas=filas.slice().sort((a,b)=>{
      const x=a.v[i], y=b.v[i];
      return dir*(c.num ? (Number(x)||0)-(Number(y)||0) : String(x).localeCompare(String(y), 'es', {numeric:true}));
    });
  }
  return filas;
}

function pintarCuerpoFiltrable(idTabla){
  const vista=vistaTablas[idTabla];
  const tabla=document.getElementById(idTabla);
  const tbody=tabla.querySelector('tbody'); tbody.innerHTML='';
  const visibles=filasVisibles(idTabla);
  // Flechas de orden y marca de filtros activos.
  tabla.querySelectorAll('thead tr:first-child th').forEach((th,i)=>{
    th.querySelector('.flecha').textContent=vista.orden&&vista.orden.i===i?(vista.orden.dir===1?'▲':'▼'):'';
  });
  tabla.querySelectorAll('tr.fila-filtro input').forEach((inp,i)=>{
    const txt=String(vista.filtros[i]||'').trim();
    inp.classList.toggle('activo', !!txt);
    inp.classList.toggle('mal', !!txt && !!vista.cols[i].num && /^[<>=!]/.test(txt) && !filtroNumerico(txt, vista.cols[i].pct));
  });
  const hayFiltro=Object.values(vista.filtros).some(t=>String(t||'').trim());
  const bQuitar=document.querySelector(`[data-quitar-filtros="${idTabla}"]`);
  if(bQuitar) bQuitar.classList.toggle('oculto', !hayFiltro && !vista.orden);
  visibles.forEach(f=>{
    const tr=document.createElement('tr');
    tr.dataset.clave=f.clave;
    vista.cols.forEach((c,i)=>tr.appendChild(el('td', c.num?'num':null, textoCelda(c, f.v[i]))));
    if(vista.opciones.alClic){
      tr.classList.add('clic-transp');
      if(estado.transpElegido===f.clave) tr.classList.add('elegida');
      tr.addEventListener('click', ()=>vista.opciones.alClic(f.clave));
    }
    tbody.appendChild(tr);
  });
  if(!visibles.length){
    const tr=document.createElement('tr'); const td=el('td',null, vista.filas.length?'Ningún dato con esos filtros.':'Sin datos en este corte.');
    td.colSpan=vista.cols.length; td.style.color='#64748b'; tr.appendChild(td); tbody.appendChild(tr);
  }
  if(vista.opciones.total && vista.filas.length){
    const tot=vista.opciones.total(visibles);
    const tr=document.createElement('tr'); tr.className='fila-total';
    tot.forEach((v,i)=>{
      const c=vista.cols[i];
      let txt=i===0 ? (hayFiltro?`TOTAL (${visibles.length} de ${vista.filas.length})`:'TOTAL') : (v===''?'':textoCelda(c, v));
      if(i===0 && c.f===fechaLarga) txt=hayFiltro?`TOTAL (${visibles.length} de ${vista.filas.length})`:'TOTAL';
      tr.appendChild(el('td', c.num?'num':null, txt));
    });
    tbody.appendChild(tr);
  }
}

// Hoja de Excel con TODAS las filas de una tabla de Cortes (sin filtros) + TOTAL.
function hojaDeTabla(idTabla){
  const vista=vistaTablas[idTabla];
  const cols=vista.cols;
  const valor=(c,v)=>c.f===fechaLarga?fechaLarga(v):v;
  const aoa=[cols.map(c=>c.t)].concat(vista.filas.map(f=>cols.map((c,i)=>valor(c, f.v[i]))));
  if(vista.opciones.total && vista.filas.length) aoa.push(vista.opciones.total(vista.filas).map((v,i)=>i===0?'TOTAL':v));
  const hoja=XLSX.utils.aoa_to_sheet(aoa);
  // Formato de cada columna numérica ($, % o número).
  cols.forEach((c,i)=>{
    if(!c.num) return;
    const z=c.pct?'0.00%':(c.f===dinero?'"$"#,##0.00':'#,##0.##');
    for(let r=1;r<aoa.length;r++){
      const ref=XLSX.utils.encode_cell({r, c:i});
      if(hoja[ref] && typeof hoja[ref].v==='number') hoja[ref].z=z;
    }
  });
  return hoja;
}

function quitarFiltros(idTabla){
  const vista=vistaTablas[idTabla]; if(!vista) return;
  vista.filtros={}; vista.orden=null;
  tablaFiltrable(idTabla, vista.cols, vista.filas, vista.opciones);
}

// ── Resumen de un transportista (para mandárselo cuando factura) ──
function datosResumen(cod){
  const g=estado.gruposCorte&&estado.gruposCorte[cod];
  if(!g) return null;
  const t=totalesDe(g.filas);
  const filas=g.filas.slice().sort((a,b)=>String(a.fecha_entrega).localeCompare(String(b.fecha_entrega))||num(a.orden)-num(b.orden))
    .map(f=>{ const c=calcularFila(f); return {fecha:f.fecha_entrega, ruta:c.ruta, cod_frec:f.cod_frec||'', kgs:num(f.kgs), monto:num(f.monto),
      retorno:num(f.retorno), P:c.P, G:c.G, S:c.S, sancionado:c.sancionado}; });
  return {cod, nombre:g.nombre||nombreTransportista(cod)||'', dias:g.dias.size, filas, t,
    sanciones:filas.filter(f=>f.sancionado).length, corte:estado.corteVisto||{}};
}

function nombreCorteTexto(c){
  return (c.nombre?`Corte ${c.nombre} · `:'')+(c.desde&&c.hasta?`${fechaCorta(c.desde)} al ${fechaCorta(c.hasta)}`:'');
}

function pintarResumenTransportista(cod, desdeClic){
  estado.transpElegido=cod||null;
  document.querySelectorAll('#tabla-con tbody tr').forEach(tr=>tr.classList.toggle('elegida', !!cod && tr.dataset.clave===cod));
  const caja=document.getElementById('resumen-transp');
  caja.innerHTML='';
  const d=cod?datosResumen(cod):null;
  if(!d){
    caja.appendChild(el('div','vacio','👆 Toca un transportista en la tabla "Por transportista" para ver aquí su resumen del corte (valor de ruta, diferencia y valor a cancelar) y enviárselo cuando tenga que facturar.'));
    return;
  }
  const cab=el('div','cab');
  const quien=el('div'); quien.appendChild(el('b',null,`${d.cod} · ${d.nombre||'—'}`));
  quien.appendChild(el('small',null,nombreCorteTexto(d.corte)+(d.corte.cerrado?' · 🔒 cerrado':'')));
  const x=el('button','cerrar','✕'); x.type='button'; x.title='Cerrar'; x.onclick=()=>pintarResumenTransportista(null);
  cab.appendChild(quien); cab.appendChild(x); caja.appendChild(cab);
  const cifras=el('div','cifras');
  [['Valor de ruta', d.t.G, ''], ['Diferencia', d.t.G-d.t.S, ''], ['A cancelar', d.t.S, 'final']].forEach(([t,v,cl])=>{
    const c=el('div','cifra'+(cl?' '+cl:'')); c.appendChild(el('span',null,t)); c.appendChild(el('b',null,dinero(v))); cifras.appendChild(c);
  });
  caja.appendChild(cifras);
  caja.appendChild(el('div','datos',
    `${d.dias} día(s) · ${d.filas.length} ruta(s) · ${numero(d.t.kgs)} kg · Monto ${dinero(d.t.monto)} · Retorno ${dinero(d.t.retorno)} (${pct(d.t.monto?d.t.retorno/d.t.monto:0)})`+
    (d.sanciones?` · ${d.sanciones} día(s) con sanción por retorno mayor a 3%`:'')));
  if(d.t.faltan) caja.appendChild(el('div','nota',`⚠ ${d.t.faltan} fila(s) con ajuste pero sin COD de frecuencia válido: no están sumadas.`));
  if(!d.corte.cerrado && d.corte.id) caja.appendChild(el('div','nota','Corte todavía abierto: los valores pueden cambiar hasta que se cierre.'));
  const botones=el('div','fila');
  const b1=el('button','btn btn-principal','📋 Copiar para WhatsApp'); b1.type='button';
  b1.onclick=()=>copiarTexto(textoResumenWhatsApp(d), '✅ Resumen copiado: pégalo en WhatsApp.');
  const b2=el('button','btn','🖨️ Imprimir / PDF'); b2.type='button'; b2.onclick=()=>imprimirResumen(d);
  botones.appendChild(b1); botones.appendChild(b2); caja.appendChild(botones);
  // Detalle por día (plegado).
  const det=document.createElement('details');
  det.appendChild(el('summary',null,`Detalle por día (${d.filas.length})`));
  const tb=document.createElement('table');
  const h=document.createElement('tr'); ['Mes','Fecha','Ruta','% ret.','Valor ruta','A cancelar'].forEach(t=>h.appendChild(el('th',null,t)));
  tb.appendChild(h);
  d.filas.forEach(f=>{
    const tr=document.createElement('tr');
    [MESES[fechaDe(f.fecha).getMonth()], fechaLarga(f.fecha), f.ruta, pct(f.P), dinero(f.G), dinero(f.S)].forEach((v,i)=>{ const td=el('td', i>=3?'num':null, v); if(i===5&&f.sancionado) td.className='num sancion'; tr.appendChild(td); });
    tb.appendChild(tr);
  });
  det.appendChild(tb); caja.appendChild(det);
  if(desdeClic){
    // Las gráficas de gerencia pasan a ese transportista.
    if(estado.historico){ document.getElementById('sel-analisis').value=cod; pintarAnalisis(); }
    const r=caja.getBoundingClientRect();
    if(r.top<0 || r.top>window.innerHeight-80) caja.scrollIntoView({behavior:'smooth', block:'start'});
  }
}

function textoResumenWhatsApp(d){
  const lineas=[
    '*OPAUSTRO LOGÍSTICA — Resumen de pago de transporte*',
    `Transportista: ${d.cod}${d.nombre?' · '+d.nombre:''}`,
    nombreCorteTexto(d.corte),
    '',
    `Días trabajados: ${d.dias} (${d.filas.length} ruta${d.filas.length===1?'':'s'})`,
    `Valor de ruta: ${dinero(d.t.G)}`,
    `Diferencia (sanciones): ${dinero(d.t.G-d.t.S)}`,
    `*Valor a cancelar (a facturar): ${dinero(d.t.S)}*`,
    '',
    'Detalle:',
  ];
  d.filas.forEach(f=>lineas.push(`• ${fechaLarga(f.fecha)} · ${f.ruta} · ${dinero(f.S)}`+(f.sancionado?` (retorno ${pct(f.P)}: sanción ${dinero((f.G||0)-(f.S||0))})`:'')));
  if(!d.corte.cerrado && d.corte.id) lineas.push('', '_Corte todavía abierto: valores sujetos a cambios hasta el cierre._');
  return lineas.join('\n');
}

function imprimirResumen(d){
  const esc=s=>String(s===null||s===undefined?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const logo=new URL('logo-wordmark.png', location.href).href;
  const filas=d.filas.map(f=>`<tr><td>${esc(MESES[fechaDe(f.fecha).getMonth()])}</td><td>${esc(fechaLarga(f.fecha))}</td><td>${esc(f.ruta)}</td><td class="n">${esc(numero(f.kgs))}</td>`+
    `<td class="n">${esc(dinero(f.monto))}</td><td class="n">${esc(pct(f.P))}</td><td class="n">${esc(dinero(f.G))}</td>`+
    `<td class="n${f.sancionado?' s':''}">${esc(dinero(f.S))}</td></tr>`).join('');
  const html=`<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><title>Resumen ${esc(d.cod)} - ${esc(d.corte.nombre||'')}</title>
<style>body{font-family:'Segoe UI',Arial,sans-serif;color:#0f172a;margin:28px;font-size:13px}
.cab{display:flex;justify-content:space-between;align-items:center;border-bottom:3px solid #0b4f7a;padding-bottom:10px}
.cab img{height:46px}.cab div{text-align:right}h1{font-size:18px;margin:0;color:#0b4f7a}
.quien{margin:16px 0 8px;font-size:15px}.quien b{font-size:17px}
.cifras{display:flex;gap:10px;margin:12px 0}.cifra{flex:1;border:1.5px solid #c9dfee;border-radius:10px;padding:8px 10px}
.cifra span{display:block;font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase}.cifra b{font-size:17px}
.cifra.final{background:#0b4f7a;color:#fff;border-color:#0b4f7a}.cifra.final span{color:#cfe3f1}
table{width:100%;border-collapse:collapse;margin-top:10px}th,td{border-bottom:1px solid #e2e8f0;padding:5px 6px;text-align:left}
th{background:#f1f5f9;font-size:12px}.n{text-align:right}.s{color:#b91c1c;font-weight:700}
tfoot td{font-weight:800;background:#e2ebf3}.nota{margin-top:10px;color:#92400e;font-size:12px}
@media print{body{margin:12mm}}</style></head><body>
<div class="cab"><img src="${logo}" alt="OPAUSTRO"><div><h1>Resumen de pago de transporte</h1>${esc(nombreCorteTexto(d.corte))}</div></div>
<div class="quien">Transportista: <b>${esc(d.cod)}${d.nombre?' · '+esc(d.nombre):''}</b></div>
<div class="cifras"><div class="cifra"><span>Valor de ruta</span><b>${esc(dinero(d.t.G))}</b></div>
<div class="cifra"><span>Diferencia (sanciones)</span><b>${esc(dinero(d.t.G-d.t.S))}</b></div>
<div class="cifra final"><span>Valor a cancelar (a facturar)</span><b>${esc(dinero(d.t.S))}</b></div></div>
<div>${d.dias} día(s) trabajado(s) · ${d.filas.length} ruta(s) · ${esc(numero(d.t.kgs))} kg · Monto entregado ${esc(dinero(d.t.monto))} · Retorno ${esc(dinero(d.t.retorno))} (${esc(pct(d.t.monto?d.t.retorno/d.t.monto:0))})</div>
<table><thead><tr><th>Mes</th><th>Fecha</th><th>Ruta</th><th class="n">Kgs</th><th class="n">Monto $</th><th class="n">% retorno</th><th class="n">Valor de ruta</th><th class="n">A cancelar</th></tr></thead>
<tbody>${filas}</tbody><tfoot><tr><td>TOTAL</td><td></td><td></td><td class="n">${esc(numero(d.t.kgs))}</td><td class="n">${esc(dinero(d.t.monto))}</td>
<td class="n">${esc(pct(d.t.monto?d.t.retorno/d.t.monto:0))}</td><td class="n">${esc(dinero(d.t.G))}</td><td class="n">${esc(dinero(d.t.S))}</td></tr></tfoot></table>
${d.sanciones?`<div class="nota">En rojo: días con retorno mayor a 3% (se paga la tarifa con sanción).</div>`:''}
${!d.corte.cerrado&&d.corte.id?`<div class="nota">Corte todavía abierto: valores sujetos a cambios hasta el cierre.</div>`:''}
<script>window.onload=function(){setTimeout(function(){window.print();},300);};<\/script></body></html>`;
  const w=window.open('', '_blank');
  if(!w){ mostrarToast('El navegador bloqueó la ventana: permite ventanas emergentes para imprimir.', 5000); return; }
  w.document.open(); w.document.write(html); w.document.close();
}

// ── Análisis por corte (gerencia): gráficas mes a mes + comparación ──
// Se carga TODO lo que hay en la web (todos los cortes) una vez al entrar a
// Cortes, y se agrupa por corte (del 26 al 25). Con un transportista elegido
// (aquí o tocándolo en "Por transportista"), las gráficas son solo de él.
const COLOR_SERIE='#2a78d6', COLOR_SANCION='#eb6834', COLOR_LIMITE='#9ca3af';
const graficas={};

function cargarChart(){
  if(window.Chart) return Promise.resolve();
  return new Promise((resolve, reject)=>{
    const s=document.createElement('script');
    s.src='https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js';
    s.onload=()=>resolve(); s.onerror=()=>reject(new Error('No se pudo cargar la librería de gráficas (¿hay internet?).'));
    document.head.appendChild(s);
  });
}

async function cargarHistorico(forzar){
  if(estado.historico && !forzar){ pintarAnalisis(); return; }
  const info=document.getElementById('analisis-info');
  const desdes=estado.cortes.map(c=>c.desde).filter(Boolean).sort(), hastas=estado.cortes.map(c=>c.hasta).filter(Boolean).sort();
  if(!desdes.length){ info.textContent='Todavía no hay cortes con datos.'; return; }
  info.textContent='Cargando el histórico...';
  try{
    const [r]=await Promise.all([apiOk({tipo:'pago_filas', desde:desdes[0], hasta:hastas[hastas.length-1]}, 90000), cargarChart()]);
    estado.historico=r.filas||[];
  } catch(e){ info.textContent='No se pudo cargar el histórico: '+e.message; return; }
  // Opciones del selector: los transportistas que aparecen en el histórico.
  const sel=document.getElementById('sel-analisis'), actual=sel.value;
  const cods=[...new Set(estado.historico.map(f=>String(f.cod_camion||'').toUpperCase()).filter(Boolean))].sort();
  sel.innerHTML='';
  sel.appendChild(opcion('', 'Todos los transportistas', actual));
  cods.forEach(c=>{ const n=nombreTransportista(c); sel.appendChild(opcion(c, n&&n.toUpperCase().startsWith(c)?n:(c+(n?' · '+n:'')), actual)); });
  pintarAnalisis();
}

// Agrupa filas por corte y saca las métricas. cod: solo ese transportista ('' = todos).
function metricasPorCorte(filas, cod){
  const porCorte={};
  filas.forEach(f=>{
    if(cod && String(f.cod_camion||'').toUpperCase()!==cod) return;
    const c=corteDe(f.fecha_entrega); if(!c) return;
    (porCorte[c.id]=porCorte[c.id]||{id:c.id, nombre:c.nombre, filas:[]}).filas.push(f);
  });
  return Object.values(porCorte).sort((a,b)=>a.id.localeCompare(b.id)).map(g=>{
    const t=totalesDe(g.filas);
    return {id:g.id, nombre:g.nombre, corto:etiquetaCorte(g.nombre), dias:new Set(g.filas.map(f=>f.fecha_entrega)).size,
            rutas:g.filas.length, G:t.G, S:t.S, sancion:t.G-t.S, monto:t.monto, retorno:t.retorno,
            pRet:t.monto?t.retorno/t.monto:0, sancionados:g.filas.filter(f=>calcularFila(f).sancionado).length};
  });
}
// "SEPTIEMBRE-OCTUBRE 2026" -> "SEP-OCT 26"
function etiquetaCorte(nombre){
  const m=String(nombre||'').match(/^(\S+)-(\S+)\s+(\d{4})$/);
  return m?(m[1].slice(0,3)+'-'+m[2].slice(0,3)+' '+m[3].slice(2)):String(nombre||'');
}

function grafica(id, tipo, etiquetas, datasets, formato, extra){
  if(graficas[id]) graficas[id].destroy();
  const opciones={
    responsive:true, maintainAspectRatio:false, animation:false,
    interaction:{mode:'index', intersect:false},
    plugins:{
      legend:{display:datasets.length>1, labels:{boxWidth:10, boxHeight:10, color:'#334155', font:{size:11}}},
      tooltip:{callbacks:{label:c=>c.dataset.label+': '+formato(c.parsed.y)}},
    },
    scales:{
      x:{grid:{display:false}, ticks:{color:'#52514e', font:{size:11}}},
      y:{beginAtZero:true, grid:{color:'#eef0f2'}, border:{display:false}, ticks:{color:'#52514e', font:{size:11}, callback:v=>formato(v)}},
    },
  };
  if(extra && extra.tooltip) opciones.plugins.tooltip.callbacks.label=extra.tooltip;
  graficas[id]=new Chart(document.getElementById(id), {type:tipo, data:{labels:etiquetas, datasets}, options:opciones});
}

function pintarAnalisis(){
  if(!estado.historico || !window.Chart) return;
  const cod=document.getElementById('sel-analisis').value;
  const m=metricasPorCorte(estado.historico, cod);
  const quien=cod?(nombreTransportista(cod)||cod):'todos los transportistas';
  document.getElementById('analisis-info').textContent=m.length
    ? `${m.length} corte(s) con datos, de ${m[0].nombre} a ${m[m.length-1].nombre} · ${quien}.`+(m.length<3?' Las gráficas se completan a medida que se carguen los cortes anteriores.':'')
    : `Sin datos para ${quien}.`;
  const et=m.map(x=>x.corto);
  const barra=(label, datos, color)=>({label, data:datos, backgroundColor:color, borderRadius:{topLeft:4, topRight:4}, borderSkipped:'bottom', maxBarThickness:46});
  grafica('g-pago', 'bar', et, [barra('Valor a cancelar', m.map(x=>x.S), COLOR_SERIE)], dinero);
  grafica('g-dias', 'bar', et, [barra(cod?'Días trabajados':'Días con rutas', m.map(x=>x.dias), COLOR_SERIE)], v=>numero(v,0));
  document.getElementById('g-dias-sub').textContent=cod?'Días con al menos una ruta de este transportista.':'Días con al menos una ruta (de cualquier transportista).';
  grafica('g-retorno', 'line', et, [
    {label:'% de devolución', data:m.map(x=>x.pRet), borderColor:COLOR_SERIE, backgroundColor:COLOR_SERIE, borderWidth:2, pointRadius:4, pointHoverRadius:6, tension:0},
    {label:'Límite 3%', data:m.map(()=>LIMITE_RETORNO), borderColor:COLOR_LIMITE, borderDash:[5,4], borderWidth:1.5, pointRadius:0, pointHoverRadius:0},
  ], pct);
  grafica('g-sanciones', 'bar', et, [barra('Sanciones', m.map(x=>x.sancion), COLOR_SANCION)], dinero,
    {tooltip:c=>{ const x=m[c.dataIndex]; return 'Sanciones: '+dinero(x.sancion)+' ('+x.sancionados+' ruta'+(x.sancionados===1?'':'s')+')'; }});
  pintarComparacion();
}

// Por transportista: el corte elegido arriba contra el anterior, con una pista
// de por qué cambió (días, valor por día, sanciones).
const COLS_COMP=[
  {t:'Código'}, {t:'Nombre'},
  {t:'Días ant.', num:true, f:v=>numero(v,0)}, {t:'Días', num:true, f:v=>numero(v,0)},
  {t:'A cancelar ant.', num:true, f:dinero}, {t:'A cancelar', num:true, f:dinero},
  {t:'Diferencia $', num:true, f:v=>v<0?'-'+dinero(-v):(v>0?'+':'')+dinero(v)},
  {t:'Variación %', num:true, pct:true, f:v=>v===null?'nuevo':(v>0?'+':'')+pct(v)},
  {t:'% devolución', num:true, pct:true, f:pct}, {t:'Sanciones $', num:true, f:dinero}, {t:'Qué cambió'},
];
function pintarComparacion(){
  if(!estado.historico) return;
  const ids=[...new Set(estado.historico.map(f=>(corteDe(f.fecha_entrega)||{}).id).filter(Boolean))].sort();
  const elegido=document.getElementById('sel-corte').value;
  const act=ids.includes(elegido)?elegido:ids[ids.length-1];
  const ant=ids[ids.indexOf(act)-1];
  const nombre=id=>{ const c=estado.cortes.find(x=>x.id===id); return c?c.nombre:(id||''); };
  document.getElementById('titulo-comparacion').textContent=ant?`Comparación: ${nombre(act)} contra ${nombre(ant)}`:'Comparación con el corte anterior';
  const enCurso=String((estado.cortes.find(c=>c.id===act)||{}).hasta||'')>=String(estado.hoyServidor||'');
  document.getElementById('ayuda-comparacion').textContent=!ant
    ? 'Todavía no hay un corte anterior con datos para comparar: aparecerá al cargar los cortes anteriores.'
    : (enCurso?'⚠ El corte elegido sigue en curso: sus valores son parciales y van a subir hasta el día 25. ':'')+'Toca un título para ordenar (por ejemplo, Diferencia $); toca un transportista para ver sus gráficas.';
  const porCod=id=>{ const r={}; estado.historico.forEach(f=>{ const c=corteDe(f.fecha_entrega); if(!c||c.id!==id) return; const k=String(f.cod_camion||'').toUpperCase(); (r[k]=r[k]||[]).push(f); }); return r; };
  const A=act?porCod(act):{}, B=ant?porCod(ant):{};
  const cods=[...new Set([...Object.keys(A), ...Object.keys(B)])].sort();
  const filas=cods.map(k=>{
    const fa=A[k]||[], fb=B[k]||[];
    const ta=totalesDe(fa), tb=totalesDe(fb);
    const da=new Set(fa.map(f=>f.fecha_entrega)).size, db=new Set(fb.map(f=>f.fecha_entrega)).size;
    const dif=ta.S-tb.S, varPct=tb.S?dif/tb.S:(ta.S?null:0);
    const motivos=[];
    if(!fb.length && ant) motivos.push('no trabajó en el corte anterior');
    else if(!fa.length) motivos.push('no tiene rutas en este corte');
    else if(ant){
      if(da!==db) motivos.push((da>db?'+':'')+(da-db)+' día(s)');
      const pda=da?ta.S/da:0, pdb=db?tb.S/db:0;
      if(Math.abs(pda-pdb)>=1) motivos.push('valor por día '+(pda>pdb?'+':'')+dinero(pda-pdb));
    }
    if(ta.G-ta.S>0.005) motivos.push('sanción '+dinero(ta.G-ta.S));
    return {clave:k, v:[k, nombreTransportista(k)||'—', db, da, tb.S, ta.S, dif, varPct, ta.monto?ta.retorno/ta.monto:0, ta.G-ta.S, motivos.join(' · ')]};
  });
  tablaFiltrable('tabla-comparacion', COLS_COMP, filas, {
    total:fs=>{ const s=i=>fs.reduce((a,f)=>a+(Number(f.v[i])||0),0); const b=s(4); return ['TOTAL','', '', '', b, s(5), s(5)-b, b?(s(5)-b)/b:null, '', s(9), '']; },
    alClic:k=>{ document.getElementById('sel-analisis').value=k; pintarAnalisis(); document.getElementById('card-analisis').scrollIntoView({behavior:'smooth', block:'start'}); },
  });
}

async function cerrarCorte(){
  const c=rangoElegido(); if(!c||!c.id) return;
  const t=estado.totalCorte||{filas:0,G:0,S:0};
  const antes=c.hasta>=estado.hoyServidor;
  const si=await mostrarModal({titulo:'Cerrar y archivar el corte '+c.nombre, tipo:'pregunta',
    texto:`Del ${fechaLarga(c.desde)} al ${fechaLarga(c.hasta)}:\n${t.filas} filas · valor de rutas ${dinero(t.G)} · a cancelar ${dinero(t.S)} · diferencia ${dinero(t.G-t.S)}.\n\n`+
      'Al cerrarlo queda archivado: ya no se puede cambiar nada de esos días (ni en la web, ni en el Excel, ni volviendo a publicar la ruta). Solo un admin lo puede reabrir.'+
      (antes?`\n\n⚠️ El corte todavía no termina (termina el ${fechaLarga(c.hasta)}). ¿Cerrarlo igual?`:''),
    botones:[{texto:'Cancelar', valor:false}, {texto:'Cerrar corte', valor:true, principal:true}]});
  if(!si) return;
  try{
    const r=await apiOk({tipo:'pago_corte_cerrar', id:c.id, filas:t.filas, total_valor_ruta:Math.round(t.G*100)/100,
      total_a_cancelar:Math.round(t.S*100)/100, antes_de_tiempo:antes?'SI':''});
    estado.cortes=r.cortes||estado.cortes;
    await cargarCortes(); await verConsolidado(); pintarCorteDia();
    if(estado.dia && corteCerrado(estado.dia)) pintarDia();
    mostrarToast('🔒 Corte '+c.nombre+' cerrado y archivado');
  } catch(e){ await mostrarModal({titulo:'No se cerró', texto:e.message, tipo:'aviso'}); }
}
async function reabrirCorte(){
  const c=rangoElegido(); if(!c||!c.id) return;
  const si=await mostrarModal({titulo:'Reabrir el corte '+c.nombre, tipo:'pregunta',
    texto:'Se podrán volver a cambiar sus días (en la web y en el Excel). Úsalo solo para corregir algo del pago ya cerrado.',
    botones:[{texto:'Cancelar', valor:false}, {texto:'Reabrir', valor:true, principal:true}]});
  if(!si) return;
  try{
    await apiOk({tipo:'pago_corte_reabrir', id:c.id});
    await cargarCortes(); await verConsolidado(); pintarCorteDia();
    if(estado.dia) pintarDia();
    mostrarToast('🔓 Corte '+c.nombre+' reabierto');
  } catch(e){ await mostrarModal({titulo:'No se reabrió', texto:e.message, tipo:'aviso'}); }
}
async function descargarConsolidado(){
  if(!estado.consolidado.length){ mostrarToast('No hay filas en ese corte.'); return; }
  try{ await cargarXLSX(); }catch(e){ mostrarToast('⚠️ '+e.message, 5000); return; }
  const c=rangoElegido();
  const wb=XLSX.utils.book_new();
  // Desde los datos (no desde la pantalla): siempre el corte COMPLETO aunque
  // haya filtros puestos, y con números de verdad (no texto) para Excel.
  XLSX.utils.book_append_sheet(wb, hojaDeTabla('tabla-con'), 'RESUMEN');
  XLSX.utils.book_append_sheet(wb, hojaDeTabla('tabla-con-dias'), 'POR DIA');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(filasParaExcel(estado.consolidado), {cellDates:true}), 'CONSOLIDADO');
  XLSX.writeFile(wb, `PAGO TRANSPORTES ${c&&c.id?'CORTE '+c.nombre:(c.desde+' a '+c.hasta)}.xlsx`);
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
  // Lo mismo en la pestaña Cortes (botón + estado corto).
  const bCon=document.getElementById('b-con-sincronizar');
  bCon.classList.remove('oculto'); bCon.disabled=!!e.sincronizando;
  bCon.textContent=e.sincronizando?'⏳ Sincronizando...':'🔄 Sincronizar con el Excel';
  document.getElementById('corte-sync').textContent=e.sincronizando?'Sincronizando con el Excel...':(u?`Última sincronización con el Excel: ${u.hora}.`:'');
  document.getElementById('b-con-historico').classList.toggle('oculto', !['admin','coordinador'].includes(rol));
  const av=document.getElementById('excel-avisos');
  if((e.avisos_sync||[]).length){
    av.classList.remove('oculto'); av.innerHTML='<b>Cambios del Excel que no se aplicaron (ganó la web):</b>';
    const ul=document.createElement('ul'); e.avisos_sync.forEach(a=>ul.appendChild(el('li',null,a))); av.appendChild(ul);
    const b=el('button','btn btn-cargue','Entendido'); b.type='button'; b.style.marginTop='6px';
    b.onclick=()=>accion('/pago/limpiar_avisos'); av.appendChild(b);
  } else av.classList.add('oculto');
  // Al terminar una sincronización, el día puede traer cambios hechos en el Excel.
  if(u && estado.ultimaSync!==null && u.hora!==estado.ultimaSync && !estado.guardando && !document.activeElement.closest('#tabla-dia')){
    // Pueden haber llegado días nuevos (la primera carga, o la ruta publicada):
    // si el día que se ve está vacío, se pasa al más reciente.
    cargarDias().then(()=>{
      const dia=(!estado.filas.length && estado.dias.length && estado.dias[0].filas)?estado.dias[0].fecha:estado.dia;
      abrirDia(dia, true);
      // Si se está mirando Cortes, también se refrescan sus tablas y gráficas.
      const enCortes=!document.getElementById('p-consolidado').classList.contains('oculto');
      cargarCortes().then(()=>{ if(enCortes){ estado.historico=null; return verConsolidado().then(()=>cargarHistorico()); } }).catch(()=>{});
    }).catch(()=>{});
  }
  estado.ultimaSync=u?u.hora:'';
}
function sinServicio(){
  document.getElementById('card-excel').classList.add('oculto');
  document.getElementById('b-con-sincronizar').classList.add('oculto');
  document.getElementById('b-con-historico').classList.add('oculto');
  document.getElementById('corte-sync').textContent='';
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

// ── Cortes anteriores (Excel viejos de la PC -> web) ─────────
// El servicio de la PC lee los Excel de los cortes anteriores a la web
// (pago_historico.py) y los sube uno por uno, CERRADOS y con los valores
// del Excel. Aquí se muestran sus totales para revisarlos antes.
async function importarHistorico(){
  const fondo=el('div','modal-fondo'); const caja=el('div','modal-caja pregunta modal-ancho');
  caja.appendChild(el('h3',null,'📥 Importar cortes anteriores'));
  caja.appendChild(el('div','modal-texto','Los Excel de los cortes que se hicieron a mano, para que las gráficas tengan historia. '+
    'Cada corte entra cerrado (solo lectura) con la ruta, el valor de ruta y el valor a cancelar que tiene su Excel. '+
    'Los archivos solo se leen: no se cambian.'));
  const cuerpo=el('div','hist-cuerpo'); caja.appendChild(cuerpo);
  const pie=el('div','modal-pie');
  const bRevisar=el('button','btn btn-sec','🔄 Volver a leer los archivos'); bRevisar.type='button';
  const bCerrar=el('button','btn btn-principal','Cerrar'); bCerrar.type='button';
  pie.appendChild(bRevisar); pie.appendChild(bCerrar); caja.appendChild(pie);
  fondo.appendChild(caja); document.body.appendChild(fondo);
  let timer=null, huboImportados=false, vivo=true;
  const terminar=()=>{
    vivo=false; clearTimeout(timer); fondo.remove();
    // Al cerrar se refresca Cortes (y sus gráficas) con lo que se importó.
    if(huboImportados){ estado.historico=null; cargarCortes().then(verConsolidado).then(()=>cargarHistorico()).catch(()=>{}); cargarDias().catch(()=>{}); }
  };
  bCerrar.onclick=terminar;
  const pintar=h=>{
    cuerpo.innerHTML='';
    if(h.leyendo){ cuerpo.appendChild(el('div','ayuda','⏳ Leyendo los Excel (puede tardar un minuto)...')); return; }
    if(h.error){ cuerpo.appendChild(el('div','hist-mal',h.error)); return; }
    const tabla=el('table','hist-tabla'); const thead=document.createElement('thead'); const trh=document.createElement('tr');
    ['Corte','Días','Rutas','Transp.','Monto $','Retorno $','% Dev.','Valor de ruta','A cancelar',''].forEach(t=>trh.appendChild(el('th',null,t)));
    thead.appendChild(trh); tabla.appendChild(thead);
    const tbody=document.createElement('tbody');
    (h.archivos||[]).forEach(a=>{
      const tr=document.createElement('tr'); const t=a.totales||{};
      const g=corteGuardado(a.corte_id);
      const yaImportado=!!g && String(g.cerrado_por||'').indexOf('IMPORTADO')===0;
      const cerradoWeb=!!g && String(g.estado).toUpperCase()==='CERRADO' && !yaImportado;
      const td0=el('td'); td0.appendChild(el('b',null,a.corte||a.archivo)); td0.appendChild(el('small',null,a.archivo)); tr.appendChild(td0);
      [t.dias, t.filas, t.transportistas].forEach(v=>tr.appendChild(el('td','n',v===undefined?'':numero(v,0))));
      [t.monto, t.retorno].forEach(v=>tr.appendChild(el('td','n',v===undefined?'':dinero(v))));
      tr.appendChild(el('td','n',t.monto?pct(t.retorno/t.monto):''));
      [t.valor_ruta, t.valor_cancelar].forEach(v=>tr.appendChild(el('td','n',v===undefined?'':dinero(v))));
      const td=el('td','hist-accion');
      if(a.estado==='importando') td.appendChild(el('span','etq cargue','⏳ Subiendo...'));
      else if(a.estado==='importado') td.appendChild(el('span','etq adic','✅ Importado'));
      else if(cerradoWeb) td.appendChild(el('span','etq camb','Cerrado en la web'));
      else if(a.cuadra){
        const b=el('button','btn '+(yaImportado?'btn-sec':'btn-principal'),yaImportado?'Volver a importar':'Importar'); b.type='button';
        b.onclick=async ()=>{
          if(yaImportado){
            const si=await mostrarModal({titulo:'Volver a importar '+a.corte, tipo:'pregunta',
              texto:'Se reemplaza lo que se importó antes de este corte por lo que tiene hoy su Excel.',
              botones:[{texto:'Cancelar', valor:false}, {texto:'Reemplazar', valor:true, principal:true}]});
            if(!si) return;
          }
          b.disabled=true;
          await accion('/pago/historico/importar', {corte_id:a.corte_id});
          seguir();
        };
        td.appendChild(b);
        if(yaImportado) td.appendChild(el('small',null,'ya está en la web'));
      }
      tr.appendChild(td); tbody.appendChild(tr);
      // Avisos de la lectura (filas movidas, saltadas...) y errores.
      const notas=[...(a.avisos||[])];
      if(a.problema) notas.unshift('⚠️ '+a.problema);
      if(a.estado==='error' && a.mensaje) notas.unshift('⚠️ No se importó: '+a.mensaje);
      if(a.estado==='importado' && a.mensaje) notas.unshift('✅ '+a.mensaje);
      if(notas.length){
        const trn=document.createElement('tr'); trn.className='hist-notas';
        const tdn=el('td'); tdn.colSpan=10;
        const ul=document.createElement('ul'); notas.forEach(n=>ul.appendChild(el('li',null,n))); tdn.appendChild(ul);
        trn.appendChild(tdn); tbody.appendChild(trn);
      }
    });
    tabla.appendChild(tbody); cuerpo.appendChild(tabla);
  };
  // Mientras se lee o se sube algo, se consulta cada 1,5 s.
  const seguir=async ()=>{
    clearTimeout(timer);
    if(!vivo) return;
    let h;
    try{ h=await llamarServicio('GET', '/pago/historico'); }
    catch(e){ cuerpo.innerHTML=''; cuerpo.appendChild(el('div','hist-mal','No se pudo hablar con el programa de la PC.')); return; }
    if(!vivo) return;
    const ocupado=h.leyendo || (h.archivos||[]).some(a=>a.estado==='importando');
    if((h.archivos||[]).some(a=>a.estado==='importado')) huboImportados=true;
    if(huboImportados && !ocupado) await cargarCortes().catch(()=>{});   // para "ya está en la web"
    if(!vivo) return;
    pintar(h);
    bRevisar.disabled=ocupado;
    if(ocupado) timer=setTimeout(seguir, 1500);
  };
  bRevisar.onclick=async ()=>{ await accion('/pago/historico/revisar'); seguir(); };
  // La primera vez (o si la lista quedó vacía) se leen los archivos.
  cuerpo.appendChild(el('div','ayuda','⏳ Buscando los archivos...'));
  let h0=null; try{ h0=await llamarServicio('GET', '/pago/historico'); }catch(e){}
  if(!h0 || (!h0.leyendo && !(h0.archivos||[]).length)) await accion('/pago/historico/revisar');
  seguir();
}

// ── Pestañas e inicio ───────────────────────────────────────
function mostrarPestana(nombre){
  document.querySelectorAll('.pestanas button').forEach(b=>b.classList.toggle('activa', b.dataset.pestana===nombre));
  ['dia','consolidado','tarifas','transportistas'].forEach(p=>document.getElementById('p-'+p).classList.toggle('oculto', p!==nombre));
  if(nombre==='consolidado') cargarCortes().then(verConsolidado).then(()=>cargarHistorico()).catch(e=>{ document.getElementById('con-info').textContent='No se pudo cargar: '+e.message; });
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
  document.getElementById('sel-corte').addEventListener('change', ()=>verConsolidado().then(pintarComparacion));
  document.getElementById('sel-analisis').addEventListener('change', pintarAnalisis);
  document.getElementById('b-con-sincronizar').addEventListener('click', ()=>accion('/pago/sincronizar'));
  document.getElementById('b-con-historico').addEventListener('click', importarHistorico);
  document.getElementById('b-corte-cerrar').addEventListener('click', cerrarCorte);
  document.getElementById('b-corte-reabrir').addEventListener('click', reabrirCorte);
  document.getElementById('b-con-excel').addEventListener('click', descargarConsolidado);
  document.querySelectorAll('[data-quitar-filtros]').forEach(b=>b.addEventListener('click', ()=>quitarFiltros(b.dataset.quitarFiltros)));
  pintarResumenTransportista(null);
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
    await cargarCortes();
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
