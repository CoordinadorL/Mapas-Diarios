// ═══════════════════════════════════════════════════════════
// SERVICIO-LOCAL.JS — lo comun de "Generar mapas" (mapas.html) y "My Maps"
// (mymaps.html): sesion, conexion con el servicio de la PC
// (C:\MAPA-RUTAS\servicio_web.py, abierto con "SERVICIO MAPAS.bat"), y las
// ventanitas de avisos y preguntas.
//
// El trabajo pesado (leer el Excel base, publicar, el robot de My Maps) lo
// hace ese servicio en la PC de logistica; estas paginas solo muestran como
// va y le mandan lo que el usuario elige. En otro equipo, el servicio no
// esta y la pagina lo dice.
// ═══════════════════════════════════════════════════════════

const SERVICIO_URL = 'http://127.0.0.1:5178';
const DURACION_SESION_MS = 16*60*60*1000; // igual que TOKEN_TTL_MS del backend

// ── Sesion: sin sesion vigente, al login ──
(function(){
  let s=null;
  try{ s=JSON.parse(localStorage.getItem('sesionActiva')||'null'); }catch(e){}
  if(!s || !s.token || (s.ts && Date.now()-s.ts >= DURACION_SESION_MS)){
    try{ localStorage.removeItem('sesionActiva'); }catch(e){}
    window.location.replace('login.html');
  }
})();

if('serviceWorker' in navigator){
  window.addEventListener('load',()=>{
    navigator.serviceWorker.register('sw.js').then(reg=>{
      setInterval(()=>reg.update().catch(()=>{}), 5*60*1000);
    }).catch(()=>{});
  });
}

// ── Llamadas al servicio ──
// X-Opaustro + JSON: el navegador pregunta antes (preflight), y el servicio
// solo contesta a esta app.
async function llamarServicio(metodo, ruta, cuerpo, ms){
  const ctrl=new AbortController();
  const timer=setTimeout(()=>ctrl.abort(), ms||15000);
  try{
    // targetAddressSpace: le dice a Chrome que es un pedido a esta misma PC
    // (pide permiso "acceso a la red local" una vez); otros navegadores lo ignoran.
    const opciones={ method:metodo, headers:{'X-Opaustro':'1'}, signal:ctrl.signal, cache:'no-store', targetAddressSpace:'loopback' };
    if(metodo==='POST'){ opciones.headers['Content-Type']='application/json'; opciones.body=JSON.stringify(cuerpo||{}); }
    const r=await fetch(SERVICIO_URL+ruta, opciones);
    return await r.json();
  } finally { clearTimeout(timer); }
}

// Manda una accion y muestra el error (si lo hay) en una ventanita.
// Mientras viaja un pedido, el MISMO pedido (misma ruta y mismos datos) no se
// manda otra vez (doble clic); uno distinto (otra fecha, otro dia) si.
const _accionesEnCurso=new Set();
async function accion(ruta, cuerpo, ms){
  const clave=ruta+' '+JSON.stringify(cuerpo||{});
  if(_accionesEnCurso.has(clave)) return null;
  _accionesEnCurso.add(clave);
  let r=null;
  try{
    try{ r=await llamarServicio('POST', ruta, cuerpo, ms); }
    catch(e){ await mostrarModal({titulo:'Sin conexión con la PC', texto:'No se pudo hablar con el programa de la PC. Revisa que el servicio esté abierto ("SERVICIO MAPAS.bat").', tipo:'error'}); return null; }
    if(r && r.ok===false && r.error && !r.ya_avisado){ await mostrarModal({titulo:'Aviso', texto:r.error, tipo:'aviso'}); }
  } finally {
    _accionesEnCurso.delete(clave);
  }
  if(typeof refrescarYa==='function') refrescarYa();
  return r;
}

// ── Ventanita (modal): avisos, preguntas Si/No ──
// Devuelve una promesa con el valor del boton tocado; promesa.cerrar() la
// cierra desde afuera (resuelve undefined), p.ej. si la pregunta ya se
// contesto en otra pestana.
let _modales=0;
function mostrarModal({titulo, texto, tipo, botones}){
  let cerrar=()=>{};
  const promesa=new Promise(resolve=>{
    _modales++;
    const fondo=document.createElement('div'); fondo.className='modal-fondo';
    const caja=document.createElement('div'); caja.className='modal-caja '+(tipo||'info');
    const h=document.createElement('h3'); h.textContent=titulo||'';
    const p=document.createElement('div'); p.className='modal-texto'; p.textContent=texto||'';
    const pie=document.createElement('div'); pie.className='modal-pie';
    const terminar=valor=>{ if(!fondo.isConnected) return; fondo.remove(); _modales--; resolve(valor); };
    cerrar=()=>terminar(undefined);
    (botones||[{texto:'Aceptar', valor:true, principal:true}]).forEach(b=>{
      const btn=document.createElement('button'); btn.type='button';
      btn.className='btn '+(b.principal?'btn-principal':'btn-sec');
      btn.textContent=b.texto;
      btn.onclick=async ()=>{
        if(b.accion){ await b.accion(); if(b.seguirAbierto) return; }
        terminar(b.valor);
      };
      pie.appendChild(btn);
    });
    caja.appendChild(h); caja.appendChild(p); caja.appendChild(pie);
    fondo.appendChild(caja); document.body.appendChild(fondo);
    const principal=pie.querySelector('.btn-principal'); if(principal) principal.focus();
  });
  promesa.cerrar=cerrar;
  return promesa;
}

let toastTimer=null;
function mostrarToast(texto, ms){
  let t=document.getElementById('toast');
  if(!t){ t=document.createElement('div'); t.id='toast'; document.body.appendChild(t); }
  t.textContent=texto; t.classList.add('visible');
  clearTimeout(toastTimer); toastTimer=setTimeout(()=>t.classList.remove('visible'), ms||3000);
}

async function copiarTexto(texto, aviso){
  try{ await navigator.clipboard.writeText(texto); mostrarToast(aviso||'✅ Copiado'); return true; }
  catch(e){
    // Sin permiso de portapapeles: se muestra para copiar a mano.
    await mostrarModal({titulo:'Copia este texto', texto, tipo:'info'});
    return false;
  }
}

// ── Avisos y preguntas que deja el servicio (las ventanas de mensaje) ──
// prefijo: '/generador' o '/mymaps'. extras(aviso) arma botones adicionales.
let _avisosMostrados=new Set();
let _preguntaMostrada=null;
let _modalServicio=null;   // la ventanita abierta de un aviso/pregunta del servicio: {tipo, id, cerrar}
async function atenderAvisosYPregunta(prefijo, estado, extras){
  // Si la ventanita abierta ya no corresponde (se contesto o se vio en otra
  // pestana), se cierra sola, sin mandar nada.
  if(_modalServicio){
    const m=_modalServicio;
    const sigue=m.tipo==='pregunta' ? !!(estado.pregunta && estado.pregunta.id===m.id)
                                    : (estado.avisos||[]).some(a=>a.id===m.id);
    if(!sigue) m.cerrar();
    return;
  }
  if(_modales>0) return;
  const aviso=(estado.avisos||[]).find(a=>!_avisosMostrados.has(a.id));
  if(aviso){
    _avisosMostrados.add(aviso.id);
    const botones=(extras?extras(aviso):[]).concat([{texto:'Aceptar', valor:true, principal:true}]);
    const ventana=mostrarModal({titulo:aviso.titulo, texto:aviso.texto, tipo:aviso.tipo, botones});
    _modalServicio={tipo:'aviso', id:aviso.id, cerrar:ventana.cerrar};
    const valor=await ventana;
    _modalServicio=null;
    if(valor!==undefined){ try{ await llamarServicio('POST', prefijo+'/aviso_visto', {id:aviso.id}); }catch(e){} }
    refrescarYa();
    return;
  }
  const p=estado.pregunta;
  if(p && _preguntaMostrada!==p.id){
    _preguntaMostrada=p.id;
    const ventana=mostrarModal({titulo:p.titulo, texto:p.texto, tipo:'pregunta',
      botones:[{texto:'No', valor:false}, {texto:'Sí', valor:true, principal:true}]});
    _modalServicio={tipo:'pregunta', id:p.id, cerrar:ventana.cerrar};
    const si=await ventana;
    _modalServicio=null;
    if(si===undefined){ refrescarYa(); return; }      // se contesto en otra pestana
    let r=null;
    try{ r=await llamarServicio('POST', prefijo+'/responder', {id:p.id, si}); }
    catch(e){
      // No llego la respuesta: la pregunta sigue abierta en la PC, asi que se
      // vuelve a mostrar en la proxima consulta para poder contestarla.
      _preguntaMostrada=null;
      r={ok:false, error:'No se pudo hablar con el programa de la PC para contestar. La pregunta va a volver a salir: contéstala de nuevo.'};
    }
    if(r && r.ok===false && r.error && r.error!=='Esa pregunta ya no está vigente.'){
      await mostrarModal({titulo:'Aviso', texto:r.error, tipo:'aviso'});
    }
    refrescarYa();
  }
}

// ── Consulta periodica del estado ──
// render(estado) dibuja; sinServicio() muestra el aviso de "solo en la PC".
let _consultaTimer=null, _consultando=false, _ultimoEstado=null, _instancia=null;
let _ruta=null, _render=null, _sinServicio=null;
function iniciarConsulta(rutaEstado, render, sinServicio){
  _ruta=rutaEstado; _render=render; _sinServicio=sinServicio;
  refrescarYa();
}
async function refrescarYa(){
  if(!_ruta) return;
  clearTimeout(_consultaTimer);
  if(_consultando){ _consultaTimer=setTimeout(refrescarYa, 300); return; }
  _consultando=true;
  let estado=null;
  try{ estado=await llamarServicio('GET', _ruta, null, 8000); }catch(e){ estado=null; }
  _consultando=false;
  pintarPillServicio(!!estado, estado&&estado.prueba);
  if(!estado || estado.ok===false){ _ultimoEstado=null; _sinServicio(); _consultaTimer=setTimeout(refrescarYa, 5000); return; }
  // Sin 'instancia' = servicio de una version anterior: cuenta como otra.
  const instancia=estado.instancia||'-';
  if(_instancia!==null && instancia!==_instancia){
    // El servicio se reinicio (por ejemplo al prender la PC): sus avisos y
    // preguntas vuelven a empezar en 1 y la pagina tiene que volver a "abrirse".
    _avisosMostrados=new Set(); _preguntaMostrada=null; _logN=0; _logPrimero=null;
    const log=document.getElementById('log'); if(log) log.textContent='';
    if(_modalServicio) _modalServicio.cerrar();
    if(typeof window.alReiniciarServicio==='function') window.alReiniciarServicio();
  }
  _instancia=instancia;
  _ultimoEstado=estado;
  _render(estado);
  const activo=estado.ocupado||estado.trabajando||estado.pregunta||(estado.avisos||[]).length;
  _consultaTimer=setTimeout(refrescarYa, document.hidden?10000:(activo?1000:3000));
}
document.addEventListener('visibilitychange', ()=>{ if(!document.hidden) refrescarYa(); });

function pintarPillServicio(conectado, prueba){
  const pill=document.getElementById('pill-servicio');
  if(!pill) return;
  pill.className='pill '+(conectado?'ok':'no');
  pill.textContent=conectado?(prueba?'● PC conectada (PRUEBA)':'● PC conectada'):'● PC sin conectar';
}

// Registro (log) del servicio: solo agrega lo nuevo y baja al final. Si el
// servicio lo limpio (al empezar una subida) o recorto, se redibuja entero.
let _logN=0, _logPrimero=null;
function pintarLog(lineas){
  const el=document.getElementById('log');
  if(!el) return;
  if(!lineas.length){ if(_logN){ el.textContent=''; _logN=0; _logPrimero=null; } return; }
  if(lineas[0].n!==_logPrimero || lineas[lineas.length-1].n<_logN){ el.textContent=''; _logN=0; _logPrimero=lineas[0].n; }
  const nuevas=lineas.filter(l=>l.n>_logN);
  if(!nuevas.length) return;
  el.textContent+=(el.textContent?'\n':'')+nuevas.map(l=>l.t).join('\n');
  _logN=lineas[lineas.length-1].n;
  el.scrollTop=el.scrollHeight;
}

function el(tag, clase, texto){
  const e=document.createElement(tag);
  if(clase) e.className=clase;
  if(texto!==undefined && texto!==null) e.textContent=texto;
  return e;
}
