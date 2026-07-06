// ═══════════════════════════════════════════════════════════
// MAPA-AUTH-SYNC.JS — sesión/login y cola de reintento offline.
// Segundo módulo separado de mapa_live_F150.html. Se carga ANTES que el
// script grande, igual que mapa-utils.js -- incluye el chequeo de sesión
// que antes corría al inicio del script (redirige a login.html si no hay
// sesión válida, o a resumen.html si el rol no puede ver el mapa).
// ═══════════════════════════════════════════════════════════

// ── SESIÓN / LOGIN ────────────────────────────────────────────
// Roles permitidos para ver y trabajar el mapa. "cartera" NO entra aquí
// (solo ve el resumen de rutas) — se redirige a resumen.html.
const ROLES_PERMITIDOS_MAPA = ['admin','bodega','coordinador','transportista','reparto'];
function getSesion(){
  try{ return JSON.parse(localStorage.getItem('sesionActiva')||'null'); }catch(e){ return null; }
}
// Token de sesión firmado por el servidor; se adjunta a cada petición.
function getToken(){ const s=getSesion(); return (s&&s.token)||''; }
let _redirigiendoLogin=false;
function sesionExpirada(){
  if(_redirigiendoLogin) return;
  _redirigiendoLogin=true;
  try{ localStorage.removeItem('sesionActiva'); }catch(e){}
  alert('Tu sesión expiró o no es válida. Ingresa de nuevo.');
  window.location.href='login.html';
}
(function chequearSesion(){
  const s=getSesion();
  if(!s || !s.rol){ window.location.href='login.html'; return; }
  if(!ROLES_PERMITIDOS_MAPA.includes(s.rol)){ window.location.href='resumen.html'; return; }
  document.addEventListener('DOMContentLoaded',()=>{
    const un=document.getElementById('user-name'), ur=document.getElementById('user-rol');
    if(un)un.textContent=s.usuario||'—';
    if(ur)ur.textContent=(s.rol||'—').toUpperCase();
    if(['admin','bodega','coordinador'].includes(s.rol)){
      const br=document.getElementById('btn-resumen');
      if(br)br.style.display='flex';
    }
    if(['transportista','reparto','admin','bodega','coordinador'].includes(s.rol)){
      const bc=document.getElementById('btn-cuadre');
      if(bc)bc.style.display='flex';
    }
  });
})();
function logout(){
  if(!confirm('¿Cerrar sesión?'))return;
  localStorage.removeItem('sesionActiva');
  localStorage.removeItem('jornadaActiva'); // no heredar el mapa fijo a otro usuario del mismo equipo
  window.location.href='login.html';
}

// ══════════════════════════════════════════════════════════════
// COLA DE REINTENTO OFFLINE — si un avance o una corrección de
// ubicación no se pudo enviar (sin señal), queda guardado aquí y se
// reintenta solo (al recuperar conexión, y cada 20s). Nunca se pierde
// silenciosamente: el usuario ve un contador de "sin enviar" mientras
// haya algo pendiente.
// ══════════════════════════════════════════════════════════════
let SYNC_QUEUE = (function(){ try{ return JSON.parse(localStorage.getItem('syncQueuePendiente')||'[]'); }catch(e){ return []; } })();
function guardarSyncQueue(){
  try{ localStorage.setItem('syncQueuePendiente', JSON.stringify(SYNC_QUEUE)); }catch(e){}
  actualizarIndicadorSync();
}
function actualizarIndicadorSync(){
  const n=SYNC_QUEUE.length;
  const item=document.getElementById('sync-indicator'), sep=document.getElementById('sync-sep'), cnt=document.getElementById('sync-count');
  if(!item) return;
  item.style.display = n>0 ? 'flex' : 'none';
  if(sep) sep.style.display = n>0 ? 'block' : 'none';
  if(cnt) cnt.textContent = n;
}
// Encola (o reemplaza, si ya había un intento pendiente del mismo cliente) un envío fallido.
function encolarSync(clave, payload){
  SYNC_QUEUE = SYNC_QUEUE.filter(it=>it.clave!==clave);
  SYNC_QUEUE.push({clave, payload, ts:Date.now()});
  guardarSyncQueue();
}
// Intenta reenviar todo lo pendiente. Se detiene en el primer fallo (probable falta de señal):
// no tiene caso insistir con el resto en ese mismo ciclo, se reintentará en el próximo.
async function vaciarSyncQueue(){
  if(!SYNC_QUEUE.length) return;
  for(const item of [...SYNC_QUEUE]){
    try{
      await fetchConTimeoutMapa(API_URL,{ method:'POST', mode:'no-cors', headers:{'Content-Type':'text/plain;charset=utf-8'}, body:JSON.stringify(item.payload) }, 12000);
      SYNC_QUEUE = SYNC_QUEUE.filter(it=>it.clave!==item.clave);
      guardarSyncQueue();
    }catch(err){ break; }
  }
}
