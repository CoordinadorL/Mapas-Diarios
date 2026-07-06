// ═══════════════════════════════════════════════════════════
// MAPA-CUADRE-FOTOS.JS — cuadre de guía (efectivo a depositar) y fotos de
// depósito: comprimir, agregar/quitar, enviar al backend. Sexto módulo
// separado de mapa_live_F150.html.
// ═══════════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════════════
// CUADRE DE GUÍA — resumen de cierre + fotos de depósito
// ══════════════════════════════════════════════════════════════
let cuadreFotos=[]; // array de dataURL (base64) ya comprimidas, listas para enviar
let cuadreEnviando=false; // mientras se envía el cuadre, se pausa el polling para no expulsar la sesión

function calcMontoRecaudadoSistema(){
  let entVal=0;
  DATA.forEach((d,i)=>{
    if(completed.has(i)) entVal += devParcial.has(i)?devParcial.get(i):d.total;
    else if(quemados.has(i)) entVal += Math.min(quemadoParcial.has(i)?quemadoParcial.get(i):d.total, d.total); // lo quemado también es recaudado
  });
  return entVal;
}
// Solo el EFECTIVO recaudado (lo que el transportista debe depositar en el banco).
function calcEfectivoSistema(){
  let ef=0;
  DATA.forEach((d,i)=>{
    let amt=0;
    if(completed.has(i)) amt=devParcial.has(i)?devParcial.get(i):d.total;
    else if(quemados.has(i)) amt=Math.min(quemadoParcial.has(i)?quemadoParcial.get(i):d.total, d.total);
    else return;
    if((metodoPago.get(i)||'EFECTIVO')==='EFECTIVO') ef+=amt; // sin método = efectivo por defecto
  });
  return ef;
}
const MAX_FOTOS_CUADRE=30;
function actualizarContadorFotos(){ const c=document.getElementById('cuadre-fotos-count'); if(c) c.textContent='('+cuadreFotos.length+')'; }

async function abrirCuadre(){
  if(!activeFecha||!activeChofer){
    alert('Selecciona primero la fecha y el camión.');
    return;
  }
  document.getElementById('cuadre-overlay').classList.add('show');
  document.getElementById('cuadre-sub').textContent=`${activeChofer} · ${activeFecha}`;
  document.getElementById('cuadre-monto-sistema').textContent='$'+calcMontoRecaudadoSistema().toFixed(2);
  document.getElementById('cuadre-efectivo').textContent='$'+calcEfectivoSistema().toFixed(2);
  document.getElementById('cuadre-observaciones').value='';
  document.getElementById('cuadre-thumbs').innerHTML='';
  document.getElementById('cuadre-msg').textContent=' ';
  cuadreFotos=[];
  actualizarContadorFotos();
  document.getElementById('cuadre-estado-prev-wrap').innerHTML='<div style="text-align:center;padding:8px;color:#64748b;font-size:.7rem">Consultando si ya enviaste un cuadre hoy...</div>';
  try{
    const rows=await jsonpMapa(`tipo=cuadre&fecha=${encodeURIComponent(activeFecha)}&chofer=${encodeURIComponent(activeChofer)}`,20000);
    if(Array.isArray(rows)&&rows.length){
      const r=rows[rows.length-1];
      const estado=String(r['Estado']||'PENDIENTE').toUpperCase();
      const claseEstado=estado==='APROBADO'?'aprobado':estado==='DIFERENCIA'?'diferencia':'';
      const etiqueta=estado==='APROBADO'?'✅ Aprobado por Cartera':estado==='DIFERENCIA'?'⚠️ Cartera marcó una diferencia':'⏳ Pendiente de revisión por Cartera';
      const nota=r['NotaCartera']?`<div style="margin-top:4px">Nota de Cartera: ${r['NotaCartera']}</div>`:'';
      document.getElementById('cuadre-estado-prev-wrap').innerHTML=`
        <div class="cuadre-estado-prev ${claseEstado}">
          Ya enviaste un cuadre hoy — efectivo registrado <b>$${Number(r['MontoDeclarado']||0).toFixed(2)}</b><br>
          ${etiqueta}${nota}<br>
          <span style="opacity:.8">Puedes agregar más fotos; se actualizará el mismo registro.</span>
        </div>`;
      document.getElementById('cuadre-observaciones').value=r['Observaciones']||'';
    } else {
      document.getElementById('cuadre-estado-prev-wrap').innerHTML='';
    }
  }catch(err){
    document.getElementById('cuadre-estado-prev-wrap').innerHTML='';
  }
}
function cerrarCuadre(){
  document.getElementById('cuadre-overlay').classList.remove('show');
}

function comprimirImagen(file, maxW=1100, calidad=0.72){
  return new Promise((resolve,reject)=>{
    const reader=new FileReader();
    reader.onload=(ev)=>{
      const img=new Image();
      img.onload=()=>{
        let w=img.width, h=img.height;
        if(w>maxW){ h=Math.round(h*maxW/w); w=maxW; }
        const canvas=document.createElement('canvas');
        canvas.width=w; canvas.height=h;
        canvas.getContext('2d').drawImage(img,0,0,w,h);
        resolve(canvas.toDataURL('image/jpeg',calidad));
      };
      img.onerror=()=>reject(new Error('No se pudo leer la imagen'));
      img.src=ev.target.result;
    };
    reader.onerror=()=>reject(new Error('No se pudo leer el archivo'));
    reader.readAsDataURL(file);
  });
}

async function agregarFotos(fileList){
  const msg=document.getElementById('cuadre-msg');
  msg.style.color='#93c5fd';
  msg.textContent='Comprimiendo fotos...';
  for(const file of fileList){
    if(cuadreFotos.length>=MAX_FOTOS_CUADRE){ alert('Máximo '+MAX_FOTOS_CUADRE+' fotos por cuadre.'); break; }
    try{
      const dataUrl=await comprimirImagen(file);
      cuadreFotos.push(dataUrl);
      const thumb=document.createElement('div');
      thumb.className='cuadre-thumb';
      const idx=cuadreFotos.length-1;
      thumb.innerHTML=`<img src="${dataUrl}"><button class="rm" onclick="quitarFoto(${idx})">✕</button>`;
      document.getElementById('cuadre-thumbs').appendChild(thumb);
    }catch(err){ console.warn('Error comprimiendo foto:',err); }
  }
  actualizarContadorFotos();
  msg.textContent=' ';
  document.getElementById('cuadre-fotos-input').value='';
}
function quitarFoto(idx){
  cuadreFotos.splice(idx,1);
  // re-render thumbs con índices correctos
  const wrap=document.getElementById('cuadre-thumbs');
  wrap.innerHTML='';
  cuadreFotos.forEach((dataUrl,i)=>{
    const thumb=document.createElement('div');
    thumb.className='cuadre-thumb';
    thumb.innerHTML=`<img src="${dataUrl}"><button class="rm" onclick="quitarFoto(${i})">✕</button>`;
    wrap.appendChild(thumb);
  });
  actualizarContadorFotos();
}

async function enviarCuadre(){
  const montoDeclarado=calcEfectivoSistema(); // el efectivo a depositar lo calcula el sistema (ya no se digita)
  const observaciones=document.getElementById('cuadre-observaciones').value.trim();
  const msg=document.getElementById('cuadre-msg');
  if(montoDeclarado>0 && !cuadreFotos.length){
    if(!confirm('No agregaste fotos del depósito. ¿Enviar el cuadre de todos modos?')) return;
  }
  const btn=document.getElementById('cuadre-submit-btn');
  btn.disabled=true;
  msg.style.color='#93c5fd';
  msg.textContent='Enviando...';
  const sesion=getSesion();
  cuadreEnviando=true; // pausa el polling para que no cierre la sesión mientras suben las fotos
  try{
    const res=await fetchConTimeoutMapa(API_URL,{
      method:'POST',
      mode:'cors',
      headers:{'Content-Type':'text/plain;charset=utf-8'},
      body:JSON.stringify({
        tipo:'cuadre',
        token:(sesion&&sesion.token)||'',
        fecha:activeFecha, chofer:activeChofer, bodega:activeBodega,
        montoDeclarado, montoSistema:calcMontoRecaudadoSistema(),
        observaciones, fotos:cuadreFotos,
        usuario:(sesion&&sesion.usuario)||activeChofer,
        rol:(sesion&&sesion.rol)||''
      })
    },60000); // más tiempo: subir varias fotos a Drive puede tardar
    const data=await res.json().catch(()=>({ok:true})); // si no se puede leer, asumimos éxito silencioso
    if(data && data.auth===false){ sesionExpirada(); return; }
    if(data && data.error) throw new Error(data.error);
    msg.style.color='#4ade80';
    msg.textContent='✅ Cuadre enviado correctamente';
    setTimeout(()=>{ cerrarCuadre(); btn.disabled=false; },1200);
  }catch(err){
    msg.style.color='#f87171';
    msg.textContent='❌ No se pudo enviar: '+(err.message||'revisa tu conexión')+'. Tus fotos siguen aquí, intenta de nuevo.';
    btn.disabled=false;
  }finally{
    cuadreEnviando=false;
  }
}
