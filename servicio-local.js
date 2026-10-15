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
    const opciones={ method:metodo, headers:{'X-Opaustro':'1'}, signal:ctrl.signal, cache:'no-store' };
    if(metodo==='POST'){ opciones.headers['Content-Type']='application/json'; opciones.body=JSON.stringify(cuerpo||{}); }
    const r=await fetch(SERVICIO_URL+ruta, opciones);
    return await r.json();
  } finally { clearTimeout(timer); }
}

// Manda una accion y muestra el error (si lo hay) en una ventanita.
async function accion(ruta, cuerpo, ms){
  let r;
  try{ r=await llamarServicio('POST', ruta, cuerpo, ms); }
  catch(e){ await mostrarModal({titulo:'Sin conexión con la PC', texto:'No se pudo hablar con el programa de la PC. Revisa que "SERVICIO MAPAS.bat" esté abierto.', tipo:'error'}); return null; }
  if(r && r.ok===false && r.error && !r.ya_avisado){ await mostrarModal({titulo:'Aviso', texto:r.error, tipo:'aviso'}); }
  if(typeof refrescarYa==='function') refrescarYa();
  return r;
}

// ── Ventanita (modal): avisos, preguntas Si/No ──
let _modalAbierto=false;
function mostrarModal({titulo, texto, tipo, botones}){
  return new Promise(resolve=>{
    _modalAbierto=true;
    const fondo=document.createElement('div'); fondo.className='modal-fondo';
    const caja=document.createElement('div'); caja.className='modal-caja '+(tipo||'info');
    const h=document.createElement('h3'); h.textContent=titulo||'';
    const p=document.createElement('div'); p.className='modal-texto'; p.textContent=texto||'';
    const pie=document.createElement('div'); pie.className='modal-pie';
    (botones||[{texto:'Aceptar', valor:true, principal:true}]).forEach(b=>{
      const btn=document.createElement('button'); btn.type='button';
      btn.className='btn '+(b.principal?'btn-principal':'btn-sec');
      btn.textContent=b.texto;
      btn.onclick=async ()=>{
        if(b.accion){ await b.accion(); if(b.seguirAbierto) return; }
        fondo.remove(); _modalAbierto=false; resolve(b.valor);
      };
      pie.appendChild(btn);
    });
    caja.appendChild(h); caja.appendChild(p); caja.appendChild(pie);
    fondo.appendChild(caja); document.body.appendChild(fondo);
    const principal=pie.querySelector('.btn-principal'); if(principal) principal.focus();
  });
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
async function atenderAvisosYPregunta(prefijo, estado, extras){
  if(_modalAbierto) return;
  const aviso=(estado.avisos||[]).find(a=>!_avisosMostrados.has(a.id));
  if(aviso){
    _avisosMostrados.add(aviso.id);
    const botones=(extras?extras(aviso):[]).concat([{texto:'Aceptar', valor:true, principal:true}]);
    await mostrarModal({titulo:aviso.titulo, texto:aviso.texto, tipo:aviso.tipo, botones});
    try{ await llamarServicio('POST', prefijo+'/aviso_visto', {id:aviso.id}); }catch(e){}
    refrescarYa();
    return;
  }
  const p=estado.pregunta;
  if(p && _preguntaMostrada!==p.id){
    _preguntaMostrada=p.id;
    const si=await mostrarModal({titulo:p.titulo, texto:p.texto, tipo:'pregunta',
      botones:[{texto:'No', valor:false}, {texto:'Sí', valor:true, principal:true}]});
    try{ await llamarServicio('POST', prefijo+'/responder', {id:p.id, si}); }catch(e){}
    refrescarYa();
  }
}

// ── Consulta periodica del estado ──
// render(estado) dibuja; sinServicio() muestra el aviso de "solo en la PC".
let _consultaTimer=null, _consultando=false, _ultimoEstado=null;
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
