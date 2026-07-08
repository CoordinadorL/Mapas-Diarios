// ═══════════════════════════════════════════════════════════
// CARGUE-PLANTILLAS.JS — geocercas guardadas con nombre, reusables día a día
// (sectores fijos). Cargar una plantilla dibuja ese polígono y le aplica el
// modo sumar/restar activo (cargarPlantillaComoGeocerca, en
// cargue-geocercas.js). Guardar toma la geocerca actualmente dibujada
// (cargueSeleccionActual.poligono) y le pide un nombre.
// ═══════════════════════════════════════════════════════════

let CARGUE_PLANTILLAS = []; // [{nombre, geojson, usuario}]

async function initCarguePlantillas(){
  await recargarCarguePlantillas();

  const sel = document.getElementById('cargue-sel-plantilla');
  if (sel) {
    sel.addEventListener('change', () => {
      const plantilla = CARGUE_PLANTILLAS.find(p => p.nombre === sel.value);
      if (plantilla && plantilla.geojson) cargarPlantillaComoGeocerca(plantilla.geojson);
      sel.value = '';
    });
  }

  const btnGuardar = document.getElementById('cargue-btn-guardar-plantilla');
  if (btnGuardar) btnGuardar.addEventListener('click', guardarPlantillaActual);
}

async function recargarCarguePlantillas(){
  CARGUE_PLANTILLAS = await fetchCarguePlantillas();
  const sel = document.getElementById('cargue-sel-plantilla');
  if (!sel) return;
  sel.innerHTML = '<option value="">— Cargar plantilla —</option>' +
    CARGUE_PLANTILLAS.map(p => `<option value="${p.nombre}">${p.nombre}</option>`).join('');
}

function guardarPlantillaActual(){
  const poligono = cargueSeleccionActual.poligono;
  if (!poligono || !poligono.length) { alert('Dibujá una geocerca antes de guardarla como plantilla.'); return; }
  const nombre = prompt('Nombre de la plantilla (ej. "Zona Norte Riobamba"):');
  if (!nombre || !nombre.trim()) return;
  guardarCarguePlantilla({ nombre: nombre.trim(), geojson: poligono });
  // Fire-and-forget (igual que guardarCargueAsignacion) -- recargamos la
  // lista igual, optimista, ya que no se puede leer confirmación del POST.
  setTimeout(recargarCarguePlantillas, 1500);
}
