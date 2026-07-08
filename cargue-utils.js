// ═══════════════════════════════════════════════════════════
// CARGUE-UTILS.JS — funciones puras sin efectos secundarios (sin DOM, sin
// red, sin variables globales mutables) usadas por cargue.html: parseo de
// filas crudas del Sheet y punto-en-polígono para la geocerca. Primer
// módulo del proyecto Mapa de Cargue -- se carga antes que el resto.
// ═══════════════════════════════════════════════════════════

// Mismos helpers de mapa-utils.js (gf/pn/ff), duplicados a propósito: este
// módulo no depende del script de mapas de entrega, son proyectos separados.
function gfCargue(row, ...cs) {
  for (const c of cs) {
    if (row[c] !== undefined && row[c] !== '') return row[c];
    const n = c.trim().toLowerCase().replace(/\s+/g, '_');
    for (const k of Object.keys(row)) if (k.trim().toLowerCase().replace(/\s+/g, '_') === n) return row[k];
  }
  return '';
}
function pnCargue(v) { if (typeof v === 'number') return v; return parseFloat(String(v).replace(/[^0-9.\-]/g, '')) || 0; }
function ffCargue(v) {
  if (!v) return '';
  if (v instanceof Date) { const y = v.getFullYear(), m = String(v.getMonth() + 1).padStart(2, '0'), d = String(v.getDate()).padStart(2, '0'); return `${y}-${m}-${d}`; }
  const s = String(v).trim();
  const m1 = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m1) return `${m1[3]}-${m1[2].padStart(2, '0')}-${m1[1].padStart(2, '0')}`;
  return s.slice(0, 10);
}

// Código de vendedor a partir del texto crudo de la columna "Vendedor" de
// CARGUE_PEDIDOS -- puede venir como solo el código ("F131") o como código y
// nombre juntos ("F131-HARO JEFFERSON", con espacios inconsistentes antes o
// después del guion según quién lo tipeó). Se queda con el prefijo
// alfanumérico inicial, que es la parte que sí es consistente.
function extraerCodigoVendedor(v) {
  const m = String(v || '').trim().match(/^([A-Za-z0-9]+)/);
  return m ? m[1] : '';
}

// Catálogo de líneas (E-F-G de "Cod Camión") -> lookup por CÓDIGO de
// vendedor (columna E), no por el nombre completo (columna F): el nombre
// tiene el mismo problema de espacios inconsistentes que "Vendedor" en
// CARGUE_PEDIDOS, y comparar por nombre completo fallaba silenciosamente
// (0 pedidos al filtrar por línea). El código es la parte confiable.
// Es solo clasificación/filtro visual -- no restringe qué se puede
// agrupar en un mismo camión.
function construirLineasMap(rows) {
  const m = {};
  rows.forEach(r => { if (r.codigo) m[r.codigo] = r.linea; });
  return m;
}
function aplicarLineaVendedor(pedidos, lineasMap) {
  return pedidos.map(p => ({ ...p, linea: lineasMap[extraerCodigoVendedor(p.vendedor)] || '' }));
}

// Punto-en-polígono (ray casting). poligono = array de [lat,lng] (formato
// Leaflet). No depende de turf.js ni de ninguna librería externa.
function puntoEnPoligono(lat, lng, poligono) {
  let dentro = false;
  for (let i = 0, j = poligono.length - 1; i < poligono.length; j = i++) {
    const [latI, lngI] = poligono[i];
    const [latJ, lngJ] = poligono[j];
    const cruza = (lngI > lng) !== (lngJ > lng) &&
      (lat < (latJ - latI) * (lng - lngI) / (lngJ - lngI) + latI);
    if (cruza) dentro = !dentro;
  }
  return dentro;
}
