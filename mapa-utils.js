// ═══════════════════════════════════════════════════════════
// MAPA-UTILS.JS — funciones puras sin efectos secundarios (sin DOM, sin red,
// sin variables globales mutables) usadas por mapa_live_F150.html: distancia
// entre puntos, orden de ruta (TSP greedy), parseo de datos del Sheet, y
// clasificación de montos. Primer módulo separado del script principal --
// se carga ANTES del <script> grande para que sus funciones ya existan
// cuando el resto del código las use.
// ═══════════════════════════════════════════════════════════

function haversine(a,b,c,d){const R=6371,dL=(c-a)*Math.PI/180,dG=(d-b)*Math.PI/180,x=Math.sin(dL/2)**2+Math.cos(a*Math.PI/180)*Math.cos(c*Math.PI/180)*Math.sin(dG/2)**2;return R*2*Math.asin(Math.sqrt(x));}
function nearestNeighbor(pts){if(!pts.length)return[];const v=new Array(pts.length).fill(false);const r=[0];v[0]=true;for(let i=0;i<pts.length-1;i++){const l=r[r.length-1];let b=-1,bd=Infinity;for(let j=0;j<pts.length;j++){if(!v[j]){const d=haversine(pts[l].lat,pts[l].lng,pts[j].lat,pts[j].lng);if(d<bd){bd=d;b=j;}}}v[b]=true;r.push(b);}return r;}
// Igual que nearestNeighbor(), pero el punto de partida es externo (la bodega seleccionada)
// en vez de tomar arbitrariamente el primer cliente de la lista.
function nearestNeighborFrom(pts, startLat, startLng){
  if(!pts.length)return[];
  const v=new Array(pts.length).fill(false);
  const r=[];
  let curLat=startLat, curLng=startLng;
  for(let s=0;s<pts.length;s++){
    let best=-1,bestD=Infinity;
    for(let j=0;j<pts.length;j++){
      if(!v[j]){
        const d=haversine(curLat,curLng,pts[j].lat,pts[j].lng);
        if(d<bestD){bestD=d;best=j;}
      }
    }
    v[best]=true; r.push(best); curLat=pts[best].lat; curLng=pts[best].lng;
  }
  return r;
}
function nk(k){return k.trim().toLowerCase().replace(/\s+/g,'_')}
function gf(row,...cs){for(const c of cs){if(row[c]!==undefined&&row[c]!=='')return row[c];const n=nk(c);for(const k of Object.keys(row))if(nk(k)===n)return row[k];}return'';}
function pn(v){if(typeof v==='number')return v;return parseFloat(String(v).replace(/[^0-9.\-]/g,''))||0;}
function ff(v){if(!v)return'';if(v instanceof Date){const y=v.getFullYear(),m=String(v.getMonth()+1).padStart(2,'0'),d=String(v.getDate()).padStart(2,'0');return`${y}-${m}-${d}`;}const s=String(v).trim();const m1=s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);if(m1)return`${m1[3]}-${m1[2].padStart(2,'0')}-${m1[1].padStart(2,'0')}`;return s.slice(0,10);}
function getTier(t){return t>=TIER_HIGH?'high':t>=TIER_MEDIUM?'medium':'normal';}
// El resaltado rojo/amarillo por monto (drop alto/medio) es SOLO para clientes COBERTURA.
// Los MAYORISTA siempre se identifican en morado, sin importar el monto (ver makeIcon).
function getTierEfectivo(d){ return d.canalCat==='COBERTURA' ? getTier(d.total) : 'normal'; }

function computeLabelOffsets(arr){
  const off={};const DEG=0.0008;
  for(let i=0;i<arr.length;i++){off[i]=0;let c=0;for(let j=0;j<i;j++){if(Math.abs(arr[i].lat-arr[j].lat)<DEG&&Math.abs(arr[i].lng-arr[j].lng)<DEG)c++;}off[i]=c*18;}
  return off;
}
