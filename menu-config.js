// ═══════════════════════════════════════════════════════════
// MENU-CONFIG.JS — opciones del menú de Inicio (inicio.html).
//
// Para AGREGAR un menú nuevo: copiar uno de los bloques { ... } de abajo,
// pegarlo donde quieras que aparezca y cambiarle los datos. Nada más.
//
//   titulo       → texto grande del botón
//   descripcion  → texto chico debajo del título
//   icono        → un emoji
//   destino      → página a abrir (ej. 'cargue.html' o un link https://...).
//                  null = "Próximamente": se ve en el menú pero no abre nada.
//   nuevaPestana → true = abre en otra pestaña (para sitios fuera de esta app)
//   nota         → aviso que aparece al tocarlo (opcional)
//   soloPC       → true = marca "Solo en la PC" (programas que corren en la PC)
//   roles        → (opcional, para más adelante) lista de roles que lo ven,
//                  ej. ['admin','bodega']. Sin "roles" lo ven todos.
// ═══════════════════════════════════════════════════════════

const MENU_INICIO = [
  {
    titulo: 'GENERAR CARGUES',
    descripcion: 'Armar y revisar los cargues de los camiones',
    icono: '🚚',
    destino: 'cargue.html',
  },
  {
    titulo: 'GENERAR MAPAS',
    descripcion: 'Generar y publicar la ruta del día · ver el mapa',
    icono: '🗺️',
    destino: 'mapas.html',
  },
  {
    titulo: 'MY MAPS',
    descripcion: 'Subir la ruta a Google My Maps · links de los mapas',
    icono: '📍',
    destino: 'mymaps.html',
  },
  {
    titulo: 'PEDIDOS A PROVEEDORES',
    descripcion: 'Pedido sugerido por proveedor',
    icono: '📦',
    destino: 'http://localhost:5177',
    nuevaPestana: true,
    soloPC: true,
    nota: 'Si no abre, primero ejecuta "Iniciar tablero.bat" en C:\\AUT PEDIDOS\\AUT PEDIDOS y vuelve a tocar el botón.',
  },
  {
    titulo: 'PAGO A TRANSPORTES',
    descripcion: 'Resumen diario por transportista · tarifas · sanciones',
    icono: '💵',
    destino: 'pago-transportes.html',
    roles: ['admin', 'coordinador', 'cartera'],
  },
];
