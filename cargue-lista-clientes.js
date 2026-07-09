// ═══════════════════════════════════════════════════════════
// CARGUE-LISTA-CLIENTES.JS — lista con checkbox de TODOS los pedidos que
// pasan el filtro actual (fecha+vendedor+línea), agrupada por código de
// vendedor (colapsable, <details>/<summary> nativo) con buscador en vivo --
// alternativa a dibujar una geocerca o clickear en el mapa: marcar/desmarcar
// un cliente llama a alternarClienteEnSeleccion(); el checkbox del grupo
// ("seleccionar todos de este vendedor") llama a seleccionarVarios() -- ambas
// en cargue-geocercas.js, que es quien de verdad guarda la selección.
// Se vuelve a pintar cada vez que cambia el filtro (cargue-historial.js) o
// la selección (cargue-geocercas.js, para reflejar clics hechos en el mapa
// o en la geocerca).
// ═══════════════════════════════════════════════════════════

let cargueListaPedidosActual = []; // último set filtrado por fecha/vendedor/línea (sin aplicar el buscador)

function initCargueListaBusqueda(){
  const input = document.getElementById('cargue-lista-buscar');
  if (input) input.addEventListener('input', renderizarListaConBusqueda);
}

function renderListaClientes(pedidosFiltrados){
  cargueListaPedidosActual = pedidosFiltrados;
  renderizarListaConBusqueda();
}

function renderizarListaConBusqueda(){
  const filtro = (document.getElementById('cargue-lista-buscar')?.value || '').trim().toLowerCase();
  const cont = document.getElementById('cargue-lista-clientes');
  const count = document.getElementById('cargue-lista-count');
  if (!cont) return;

  const porVendedor = {};
  cargueListaPedidosActual.forEach(p => {
    if (filtro && !(p.cliente.toLowerCase().includes(filtro) || p.vendedor.toLowerCase().includes(filtro) || p.pedido.toLowerCase().includes(filtro))) return;
    (porVendedor[p.vendedor] = porVendedor[p.vendedor] || []).push(p);
  });
  const vendedores = Object.keys(porVendedor).sort();
  const totalMostrado = vendedores.reduce((s, v) => s + porVendedor[v].length, 0);
  if (count) count.textContent = String(totalMostrado);

  if (!vendedores.length) {
    cont.innerHTML = `<li class="vacio">${cargueListaPedidosActual.length ? 'Nada coincide con la búsqueda.' : 'No hay pedidos con estos filtros.'}</li>`;
    return;
  }

  cont.innerHTML = vendedores.map(v => {
    const totalVendedor = porVendedor[v].reduce((s, p) => s + p.ventasTotal, 0);
    const todosMarcados = porVendedor[v].every(p => estaSeleccionado(p.pedido));
    return `
    <li class="grupo-vendedor">
      <details ${filtro || vendedores.length <= 3 ? 'open' : ''}>
        <summary>
          <input type="checkbox" class="chk-vendedor-todos" data-vendedor="${v}" ${todosMarcados ? 'checked' : ''} title="Seleccionar todos los clientes de ${v}">
          ${v} <span class="contador-grupo">(${porVendedor[v].length}) — $${totalVendedor.toFixed(2)}</span>
        </summary>
        <ul>
          ${porVendedor[v].map(p => `
            <li>
              <label class="chk-cliente">
                <input type="checkbox" data-pedido="${p.pedido}" ${estaSeleccionado(p.pedido) ? 'checked' : ''}>
                <span>${p.cliente} — $${p.ventasTotal.toFixed(2)}</span>
              </label>
            </li>`).join('')}
        </ul>
      </details>
    </li>
  `;
  }).join('');

  cont.querySelectorAll('.chk-cliente input[data-pedido]').forEach(chk => {
    chk.addEventListener('change', () => alternarClienteEnSeleccion(chk.dataset.pedido));
  });
  cont.querySelectorAll('.chk-vendedor-todos').forEach(chk => {
    chk.addEventListener('click', (e) => e.stopPropagation()); // no abrir/cerrar el <details>
    chk.addEventListener('change', () => {
      const pedidos = cargueListaPedidosActual.filter(p => p.vendedor === chk.dataset.vendedor).map(p => p.pedido);
      seleccionarVarios(pedidos, chk.checked);
    });
  });
}

// Solo actualiza el estado "checked" (lo llama cargue-geocercas.js tras un
// cambio de selección por geocerca/clic en el mapa, sin recalcular ni
// repintar todo).
function actualizarChecksListaClientes(){
  const cont = document.getElementById('cargue-lista-clientes');
  if (!cont) return;
  cont.querySelectorAll('.chk-cliente input[data-pedido]').forEach(chk => {
    chk.checked = estaSeleccionado(chk.dataset.pedido);
  });
  cont.querySelectorAll('.chk-vendedor-todos').forEach(chk => {
    const pedidosDelVendedor = cargueListaPedidosActual.filter(p => p.vendedor === chk.dataset.vendedor);
    chk.checked = pedidosDelVendedor.length > 0 && pedidosDelVendedor.every(p => estaSeleccionado(p.pedido));
  });
}
