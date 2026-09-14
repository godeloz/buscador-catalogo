/* ══════════════════════════════════════════════════════════
   Buscador de catálogo offline
   Diego Agudelo — godeloz@gmail.com
   ══════════════════════════════════════════════════════════ */

'use strict';

const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));

/* ─────────── Estado ─────────── */

const estado = {
  libros: [],           // catálogo normalizado en memoria
  editoriales: [],      // [{nombre, cantidad, color}]
  config: { nombre: '', acento: '#C42F6A', mapeo: null, archivo: '', fecha: null },
  campo: 'todo',
  consulta: '',
  filtroEditorial: null,
  visibles: 60,
  resultados: [],
  borrador: null        // datos del CSV en revisión
};

const PASO = 60;

const PALETA_FRANJAS = [
  '#4C4FD1', '#0E7C86', '#B06A21', '#A6357A', '#2F6B4F', '#C05A3C',
  '#6B4FB0', '#1F6FB2', '#8A8F1E', '#B33951', '#3E7A2E', '#7A5230'
];

const PRESETS = [
  { nombre: 'Frambuesa', valor: '#C42F6A' },
  { nombre: 'Índigo', valor: '#4C4FD1' },
  { nombre: 'Teal', valor: '#0E7C86' },
  { nombre: 'Ciruela', valor: '#8E3A76' },
  { nombre: 'Bosque', valor: '#2F6B4F' },
  { nombre: 'Ocre', valor: '#B06A21' },
  { nombre: 'Grafito', valor: '#44454A' }
];

/* ─────────── Almacenamiento (IndexedDB) ─────────── */

const DB_NOMBRE = 'buscador-catalogo';
const ALMACEN = 'kv';
let _db = null;

function abrirDB() {
  if (_db) return Promise.resolve(_db);
  return new Promise((ok, mal) => {
    const req = indexedDB.open(DB_NOMBRE, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(ALMACEN)) db.createObjectStore(ALMACEN);
    };
    req.onsuccess = () => { _db = req.result; ok(_db); };
    req.onerror = () => mal(req.error);
  });
}

async function guardar(clave, valor) {
  const db = await abrirDB();
  return new Promise((ok, mal) => {
    const tx = db.transaction(ALMACEN, 'readwrite');
    tx.objectStore(ALMACEN).put(valor, clave);
    tx.oncomplete = ok;
    tx.onerror = () => mal(tx.error);
  });
}

async function leer(clave) {
  const db = await abrirDB();
  return new Promise((ok, mal) => {
    const tx = db.transaction(ALMACEN, 'readonly');
    const req = tx.objectStore(ALMACEN).get(clave);
    req.onsuccess = () => ok(req.result);
    req.onerror = () => mal(req.error);
  });
}

async function eliminar(clave) {
  const db = await abrirDB();
  return new Promise((ok, mal) => {
    const tx = db.transaction(ALMACEN, 'readwrite');
    tx.objectStore(ALMACEN).delete(clave);
    tx.oncomplete = ok;
    tx.onerror = () => mal(tx.error);
  });
}

/* ─────────── Utilidades de texto ─────────── */

function normalizar(s) {
  return String(s == null ? '' : s)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().trim();
}

/** Normaliza conservando la longitud, para poder resaltar sobre el original. */
function normalizarAlineado(s) {
  let salida = '';
  for (const c of s) {
    const n = c.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    salida += (n.length === 1 ? n : c.toLowerCase());
  }
  return salida;
}

function escaparHTML(s) {
  return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function resaltar(texto, tokens) {
  if (!texto) return '';
  if (!tokens.length) return escaparHTML(texto);
  const base = normalizarAlineado(texto);
  const marcas = new Array(texto.length).fill(false);
  for (const t of tokens) {
    if (!t) continue;
    let desde = 0, i;
    while ((i = base.indexOf(t, desde)) !== -1) {
      for (let k = i; k < i + t.length && k < marcas.length; k++) marcas[k] = true;
      desde = i + t.length;
    }
  }
  let salida = '', dentro = false;
  for (let i = 0; i < texto.length; i++) {
    if (marcas[i] && !dentro) { salida += '<mark>'; dentro = true; }
    else if (!marcas[i] && dentro) { salida += '</mark>'; dentro = false; }
    salida += escaparHTML(texto[i]);
  }
  if (dentro) salida += '</mark>';
  return salida;
}

function colorEditorial(nombre) {
  const n = normalizar(nombre);
  if (!n) return '#A1A1A6';
  let h = 5381;
  for (let i = 0; i < n.length; i++) h = ((h << 5) + h + n.charCodeAt(i)) >>> 0;
  return PALETA_FRANJAS[h % PALETA_FRANJAS.length];
}

/* ─────────── Precios ─────────── */

function analizarPrecio(v) {
  if (v == null) return null;
  let s = String(v).trim();
  if (!s) return null;
  s = s.replace(/[^\d.,-]/g, '');
  if (!s || s === '-') return null;

  const hayComa = s.includes(','), hayPunto = s.includes('.');
  if (hayComa && hayPunto) {
    s = (s.lastIndexOf(',') > s.lastIndexOf('.'))
      ? s.replace(/\./g, '').replace(',', '.')
      : s.replace(/,/g, '');
  } else if (hayComa) {
    const p = s.split(',');
    s = (p.length === 2 && p[1].length <= 2) ? s.replace(',', '.') : s.replace(/,/g, '');
  } else if (hayPunto) {
    const p = s.split('.');
    const esDecimal = p.length === 2 && p[1].length <= 2 && p[0].length <= 3;
    if (!esDecimal) s = s.replace(/\./g, '');
  }
  const n = parseFloat(s);
  return isFinite(n) && n >= 0 ? n : null;
}

const fmtPrecio = new Intl.NumberFormat('es-CO', {
  style: 'currency', currency: 'COP', maximumFractionDigits: 0
});

function formatearPrecio(n) {
  if (n == null) return null;
  return fmtPrecio.format(n).replace(/\s/g, ' ');
}

/* ─────────── ISBN ─────────── */

function normalizarISBN(v) {
  return String(v == null ? '' : v).replace(/[^0-9Xx]/g, '').toUpperCase();
}

/** De EAN-13 (978/979) a ISBN-10, para catálogos que guardan el formato viejo. */
function ean13aIsbn10(ean) {
  if (!/^97[89]\d{10}$/.test(ean)) return null;
  const cuerpo = ean.slice(3, 12);
  let suma = 0;
  for (let i = 0; i < 9; i++) suma += (10 - i) * Number(cuerpo[i]);
  const resto = (11 - (suma % 11)) % 11;
  return cuerpo + (resto === 10 ? 'X' : String(resto));
}

/* ─────────── Detección de columnas ─────────── */

const SINONIMOS = {
  titulo:      ['titulo', 'título', 'title', 'nombre', 'nombre del producto', 'producto', 'descripcion', 'descripción', 'libro', 'obra'],
  autor:       ['autor', 'autores', 'author', 'authors', 'escritor'],
  editorial:   ['editorial', 'editoriales', 'sello', 'publisher', 'marca', 'proveedor', 'edit'],
  precio:      ['precio', 'precio venta', 'precio de venta', 'precio publico', 'precio público', 'pvp', 'valor', 'price', 'venta', 'precio unitario'],
  isbn:        ['isbn', 'isbn13', 'isbn-13', 'ean', 'ean13', 'codigo de barras', 'código de barras', 'codigo barras', 'sku', 'referencia', 'codigo', 'código'],
  categoria:   ['categoria', 'categoría', 'materia', 'materias', 'genero', 'género', 'tema', 'thema', 'seccion', 'sección', 'coleccion', 'colección'],
  existencias: ['existencias', 'existencia', 'stock', 'cantidad', 'unidades', 'disponibles', 'inventario', 'saldo']
};

const ETIQUETAS = {
  titulo: ['Título', 'Obligatorio'],
  autor: ['Autor', 'Opcional'],
  editorial: ['Editorial', 'Opcional — define el color de la franja'],
  precio: ['Precio', 'Opcional'],
  isbn: ['ISBN', 'Opcional — necesario para escanear'],
  categoria: ['Categoría', 'Opcional'],
  existencias: ['Existencias', 'Opcional']
};

function detectarColumnas(encabezados) {
  const norm = encabezados.map(h => normalizar(h));
  const mapeo = {};
  const usados = new Set();

  for (const campo of Object.keys(SINONIMOS)) {
    let elegido = -1;
    // 1) coincidencia exacta
    for (const alias of SINONIMOS[campo]) {
      const i = norm.indexOf(alias);
      if (i !== -1 && !usados.has(i)) { elegido = i; break; }
    }
    // 2) coincidencia parcial
    if (elegido === -1) {
      for (const alias of SINONIMOS[campo]) {
        const i = norm.findIndex((h, idx) => !usados.has(idx) && h.includes(alias));
        if (i !== -1) { elegido = i; break; }
      }
    }
    if (elegido !== -1) { mapeo[campo] = encabezados[elegido]; usados.add(elegido); }
    else mapeo[campo] = null;
  }
  return mapeo;
}

/* ─────────── Lectura del CSV ─────────── */

function leerTextoArchivo(archivo) {
  return new Promise((ok, mal) => {
    const fr = new FileReader();
    fr.onerror = () => mal(new Error('No se pudo leer el archivo.'));
    fr.onload = () => {
      const buffer = fr.result;
      let texto = new TextDecoder('utf-8').decode(buffer);
      // Los exportes de algunos sistemas vienen en Latin-1: se delatan con  o Ã
      if (/\uFFFD|Ã[¡©­³±\u00ba]/.test(texto)) {
        try { texto = new TextDecoder('windows-1252').decode(buffer); } catch (e) { /* se queda en utf-8 */ }
      }
      ok(texto.replace(/^\uFEFF/, ''));
    };
    fr.readAsArrayBuffer(archivo);
  });
}

async function procesarArchivo(archivo) {
  avisoArchivo('Leyendo archivo…', 'ok');
  let texto;
  try { texto = await leerTextoArchivo(archivo); }
  catch (e) { return avisoArchivo('No se pudo abrir el archivo. Verifica que sea un CSV.'); }

  const res = Papa.parse(texto, { header: true, skipEmptyLines: 'greedy', dynamicTyping: false });
  const filas = res.data || [];
  const encabezados = (res.meta && res.meta.fields ? res.meta.fields : []).filter(h => h && h.trim());

  if (!encabezados.length || !filas.length) {
    return avisoArchivo('El archivo no tiene filas legibles. Debe ser un CSV con una fila de encabezados.');
  }

  const previo = estado.config.mapeo;
  const sirvePrevio = previo && Object.values(previo).every(c => !c || encabezados.includes(c)) && previo.titulo;
  const mapeo = sirvePrevio ? Object.assign({}, previo) : detectarColumnas(encabezados);

  estado.borrador = { filas, encabezados, mapeo, archivo: archivo.name };
  avisoArchivo(`${filas.length.toLocaleString('es-CO')} filas leídas. Revisa las columnas antes de guardar.`, 'ok');
  pintarMapeo();
}

function pintarMapeo() {
  const b = estado.borrador;
  if (!b) return;
  const cont = $('#camposMapeo');
  cont.innerHTML = '';

  for (const campo of Object.keys(ETIQUETAS)) {
    const [etiqueta, nota] = ETIQUETAS[campo];
    const fila = document.createElement('div');
    fila.className = 'mapeo';

    const lab = document.createElement('label');
    lab.setAttribute('for', 'sel-' + campo);
    lab.innerHTML = `${escaparHTML(etiqueta)}<small>${escaparHTML(nota)}</small>`;

    const sel = document.createElement('select');
    sel.id = 'sel-' + campo;
    sel.innerHTML = '<option value="">— ninguna —</option>' +
      b.encabezados.map(h => `<option value="${escaparHTML(h)}">${escaparHTML(h)}</option>`).join('');
    sel.value = b.mapeo[campo] || '';
    sel.addEventListener('change', () => {
      b.mapeo[campo] = sel.value || null;
      pintarPrevisualizacion();
    });

    fila.append(lab, sel);
    cont.appendChild(fila);
  }

  pintarPrevisualizacion();
  $('#bloqueMapeo').hidden = false;
  $('#bloqueMapeo').scrollIntoView({ block: 'start', behavior: 'smooth' });
}

function pintarPrevisualizacion() {
  const b = estado.borrador;
  const cont = $('#previsualizacion');
  if (!b || !b.mapeo.titulo) {
    cont.innerHTML = 'Elige al menos la columna de <strong>Título</strong> para continuar.';
    return;
  }
  const f = b.filas.find(f => String(f[b.mapeo.titulo] || '').trim()) || b.filas[0];
  const v = c => (c && f[c] != null && String(f[c]).trim()) ? String(f[c]).trim() : '—';
  const precio = analizarPrecio(f[b.mapeo.precio]);
  cont.innerHTML =
    `Primer registro:<br><strong>${escaparHTML(v(b.mapeo.titulo))}</strong><br>` +
    `${escaparHTML(v(b.mapeo.autor))} · ${escaparHTML(v(b.mapeo.editorial))}<br>` +
    `Precio: <strong>${precio != null ? escaparHTML(formatearPrecio(precio)) : '—'}</strong> · ` +
    `ISBN: ${escaparHTML(v(b.mapeo.isbn))}`;
}

async function confirmarCatalogo() {
  const b = estado.borrador;
  if (!b) return;
  if (!b.mapeo.titulo) return avisoArchivo('Falta indicar cuál columna tiene el título.');

  const m = b.mapeo;
  const libros = [];
  for (const f of b.filas) {
    const titulo = String(f[m.titulo] == null ? '' : f[m.titulo]).trim();
    if (!titulo) continue;
    const campo = c => (c && f[c] != null) ? String(f[c]).trim() : '';
    libros.push({
      t: titulo,
      a: campo(m.autor),
      e: campo(m.editorial),
      p: analizarPrecio(f[m.precio]),
      i: normalizarISBN(campo(m.isbn)),
      c: campo(m.categoria),
      x: campo(m.existencias)
    });
  }

  if (!libros.length) return avisoArchivo('Ninguna fila tiene título. Revisa la columna elegida.');

  estado.config.mapeo = m;
  estado.config.archivo = b.archivo;
  estado.config.fecha = Date.now();

  try {
    await guardar('libros', libros);
    await guardar('config', estado.config);
  } catch (e) {
    return avisoArchivo('No se pudo guardar en este dispositivo. Es posible que no haya espacio disponible.');
  }

  estado.borrador = null;
  $('#bloqueMapeo').hidden = true;
  $('#entradaArchivo').value = '';
  cargarEnMemoria(libros);
  avisoArchivo(`Catálogo guardado: ${libros.length.toLocaleString('es-CO')} títulos disponibles sin conexión.`, 'ok');
  flotante('Catálogo guardado');
  pintarEstadoCatalogo();
}

/* ─────────── Indexado en memoria ─────────── */

function cargarEnMemoria(libros) {
  estado.libros = libros.map(l => {
    const nt = normalizar(l.t), na = normalizar(l.a), ne = normalizar(l.e);
    return Object.assign({}, l, {
      nt, na, ne,
      ni: l.i || '',
      todo: nt + ' ' + na + ' ' + ne + ' ' + normalizar(l.c) + ' ' + (l.i || '').toLowerCase()
    });
  });

  const cuenta = new Map();
  for (const l of estado.libros) {
    if (!l.e) continue;
    cuenta.set(l.e, (cuenta.get(l.e) || 0) + 1);
  }
  estado.editoriales = Array.from(cuenta, ([nombre, cantidad]) => ({
    nombre, cantidad, color: colorEditorial(nombre), norm: normalizar(nombre)
  })).sort((a, b) => b.cantidad - a.cantidad || a.nombre.localeCompare(b.nombre, 'es'));

  // Oculta el chip de ISBN si el catálogo no trae esa columna
  const hayIsbn = estado.libros.some(l => l.i);
  $('.chip[data-campo="isbn"]').hidden = !hayIsbn;
  $('#botonEscanear').hidden = !hayIsbn;
  if (!hayIsbn && estado.campo === 'isbn') fijarCampo('todo');

  actualizarCabecera();
  buscar();
  pintarEditoriales();
}

/* ─────────── Búsqueda ─────────── */

function buscar() {
  const q = normalizar(estado.consulta);
  const tokens = q.split(/\s+/).filter(Boolean);
  const campo = estado.campo;
  const filtro = estado.filtroEditorial ? normalizar(estado.filtroEditorial) : null;

  let base = estado.libros;
  if (filtro) base = base.filter(l => l.ne === filtro);

  if (!tokens.length) {
    estado.resultados = filtro ? base.slice() : [];
    if (filtro) estado.resultados.sort((a, b) => a.t.localeCompare(b.t, 'es'));
  } else {
    const clave = { todo: 'todo', titulo: 'nt', autor: 'na', editorial: 'ne', isbn: 'ni' }[campo];
    const res = [];
    for (const l of base) {
      const objetivo = campo === 'isbn' ? l.ni.toLowerCase() : l[clave];
      if (!objetivo) continue;
      let cumple = true;
      for (const t of tokens) { if (!objetivo.includes(t)) { cumple = false; break; } }
      if (!cumple) continue;
      const puntaje = l.nt.startsWith(q) ? 0 : (l.nt.includes(q) ? 1 : 2);
      res.push({ l, puntaje });
    }
    res.sort((a, b) => a.puntaje - b.puntaje || a.l.t.localeCompare(b.l.t, 'es'));
    estado.resultados = res.map(r => r.l);
  }

  estado.visibles = PASO;
  pintarResultados(tokens);
}

function pintarResultados(tokens) {
  const lista = $('#listaResultados');
  const meta = $('#metaResultados');
  const vacio = $('#vacioBuscar');
  const total = estado.resultados.length;

  if (!estado.libros.length) {
    lista.innerHTML = ''; meta.textContent = '';
    $('#botonMas').hidden = true;
    vacio.hidden = false;
    $('#vacioTitulo').textContent = 'Aún no hay catálogo';
    $('#vacioTexto').innerHTML = 'Ve a <strong>Catálogo</strong> y carga el archivo CSV de tu inventario. Después podrás buscar sin conexión.';
    return;
  }

  if (!estado.consulta.trim() && !estado.filtroEditorial) {
    lista.innerHTML = ''; meta.textContent = '';
    $('#botonMas').hidden = true;
    vacio.hidden = false;
    $('#vacioTitulo').textContent = 'Busca un libro';
    $('#vacioTexto').innerHTML = `Escribe un título, un autor o una editorial. ${estado.libros.length.toLocaleString('es-CO')} títulos disponibles sin conexión.`;
    return;
  }

  vacio.hidden = true;

  if (!total) {
    lista.innerHTML = '';
    meta.textContent = '';
    $('#botonMas').hidden = true;
    vacio.hidden = false;
    $('#vacioTitulo').textContent = 'Sin resultados';
    $('#vacioTexto').textContent = 'Revisa la escritura o prueba con menos palabras. También puedes cambiar el campo de búsqueda arriba.';
    return;
  }

  meta.textContent = total === 1 ? '1 resultado' : `${total.toLocaleString('es-CO')} resultados`;

  const hasta = Math.min(estado.visibles, total);
  const filas = [];
  for (let i = 0; i < hasta; i++) {
    const l = estado.resultados[i];
    const color = colorEditorial(l.e);
    const precio = formatearPrecio(l.p);
    const extras = [];
    if (l.c) extras.push(escaparHTML(l.c));
    if (l.x) extras.push(escaparHTML(l.x) + ' en existencia');
    if (l.i && estado.campo === 'isbn') extras.push('ISBN ' + escaparHTML(l.i));

    filas.push(
      `<article class="libro" style="--franja:${color}">` +
        `<div class="libro__franja"></div>` +
        `<div class="libro__datos">` +
          `<h3 class="libro__titulo">${resaltar(l.t, tokens)}</h3>` +
          (l.a ? `<p class="libro__autor">${resaltar(l.a, tokens)}</p>` : '') +
          (l.e ? `<p class="libro__editorial">${resaltar(l.e, tokens)}</p>` : '') +
          (extras.length ? `<p class="libro__extra">${extras.join(' · ')}</p>` : '') +
        `</div>` +
        (precio
          ? `<div class="libro__precio">${escaparHTML(precio)}</div>`
          : `<div class="libro__precio libro__precio--vacio">Sin precio</div>`) +
      `</article>`
    );
  }

  lista.innerHTML = `<div class="lista">${filas.join('')}</div>`;
  $('#botonMas').hidden = hasta >= total;
}

function fijarCampo(campo) {
  estado.campo = campo;
  $$('#chipsCampo .chip').forEach(c => c.classList.toggle('is-activo', c.dataset.campo === campo));
  buscar();
}

function fijarFiltroEditorial(nombre) {
  estado.filtroEditorial = nombre;
  const caja = $('#filtroActivo');
  if (nombre) {
    caja.hidden = false;
    $('#filtroActivoTexto').textContent = nombre;
  } else {
    caja.hidden = true;
  }
  buscar();
}

/* ─────────── Editoriales ─────────── */

function pintarEditoriales() {
  const q = normalizar($('#entradaEditoriales').value);
  const lista = q ? estado.editoriales.filter(e => e.norm.includes(q)) : estado.editoriales;
  const cont = $('#listaEditoriales');
  const meta = $('#metaEditoriales');

  if (!estado.editoriales.length) {
    cont.innerHTML = '';
    meta.textContent = estado.libros.length
      ? 'El catálogo cargado no tiene columna de editorial.'
      : 'Carga un catálogo para ver las editoriales.';
    return;
  }

  meta.textContent = `${lista.length.toLocaleString('es-CO')} de ${estado.editoriales.length.toLocaleString('es-CO')} editoriales`;

  cont.innerHTML = '<div class="lista">' + lista.map(e =>
    `<button class="editorial" style="--franja:${e.color}" data-editorial="${escaparHTML(e.nombre)}">` +
      `<span class="editorial__franja"></span>` +
      `<span class="editorial__nombre">${escaparHTML(e.nombre)}</span>` +
      `<span class="editorial__conteo">${e.cantidad.toLocaleString('es-CO')}</span>` +
    `</button>`
  ).join('') + '</div>';
}

/* ─────────── Escáner ─────────── */

let lectorCodigo = null;

async function abrirEscaner() {
  if (!estado.libros.length) return flotante('Primero carga un catálogo');
  if (typeof ZXing === 'undefined') return flotante('El escáner no está disponible');

  const caja = $('#escaner');
  caja.hidden = false;
  $('#escanerEstado').textContent = 'Apunta al código de barras';
  $('#escanerPie').textContent = 'Busca el ISBN en el catálogo guardado.';

  try {
    const hints = new Map();
    hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, [
      ZXing.BarcodeFormat.EAN_13, ZXing.BarcodeFormat.EAN_8,
      ZXing.BarcodeFormat.UPC_A, ZXing.BarcodeFormat.UPC_E
    ]);
    lectorCodigo = new ZXing.BrowserMultiFormatReader(hints, 400);
    await lectorCodigo.decodeFromConstraints(
      { video: { facingMode: { ideal: 'environment' } } },
      $('#escanerVideo'),
      (resultado) => { if (resultado) manejarCodigo(resultado.getText()); }
    );
  } catch (e) {
    const denegado = e && (e.name === 'NotAllowedError' || e.name === 'SecurityError');
    $('#escanerEstado').textContent = denegado ? 'Sin permiso de cámara' : 'No se pudo abrir la cámara';
    $('#escanerPie').textContent = denegado
      ? 'Activa el permiso de cámara para este sitio en los ajustes del navegador.'
      : 'Revisa que ningún otro programa esté usando la cámara.';
  }
}

function cerrarEscaner() {
  if (lectorCodigo) { try { lectorCodigo.reset(); } catch (e) {} lectorCodigo = null; }
  $('#escaner').hidden = true;
}

function manejarCodigo(texto) {
  const codigo = normalizarISBN(texto);
  if (!codigo) return;

  const alternativo = ean13aIsbn10(codigo);
  const encontrado = estado.libros.find(l => l.i && (l.i === codigo || (alternativo && l.i === alternativo)));

  cerrarEscaner();

  if (encontrado) {
    fijarFiltroEditorial(null);
    fijarCampo('isbn');
    $('#entradaBusqueda').value = encontrado.i;
    estado.consulta = encontrado.i;
    $('#botonLimpiar').hidden = false;
    buscar();
    flotante(encontrado.t);
  } else {
    fijarFiltroEditorial(null);
    fijarCampo('isbn');
    $('#entradaBusqueda').value = codigo;
    estado.consulta = codigo;
    $('#botonLimpiar').hidden = false;
    buscar();
    flotante('Ese ISBN no está en el catálogo');
  }
  irA('buscar');
}

/* ─────────── Interfaz general ─────────── */

function irA(seccion) {
  $$('.seccion').forEach(s => s.classList.toggle('is-activa', s.id === 'seccion-' + seccion));
  $$('.nav__tab').forEach(t => {
    const activa = t.dataset.seccion === seccion;
    t.classList.toggle('is-activa', activa);
    if (activa) t.setAttribute('aria-current', 'page'); else t.removeAttribute('aria-current');
  });
  window.scrollTo(0, 0);
}

let temporizadorFlotante = null;
function flotante(texto) {
  const caja = $('#avisoFlotante');
  caja.textContent = texto;
  caja.hidden = false;
  clearTimeout(temporizadorFlotante);
  temporizadorFlotante = setTimeout(() => { caja.hidden = true; }, 2600);
}

function avisoArchivo(texto, tipo) {
  const caja = $('#avisoArchivo');
  caja.textContent = texto;
  caja.className = 'aviso' + (tipo === 'ok' ? ' aviso--ok' : '');
  caja.hidden = false;
}

function actualizarCabecera() {
  $('#nombreLibreria').textContent = estado.config.nombre || 'Buscador de catálogo';
  document.title = estado.config.nombre || 'Buscador de catálogo';
  $('#conteoCatalogo').textContent = estado.libros.length
    ? `${estado.libros.length.toLocaleString('es-CO')} títulos`
    : '';
}

function aplicarAcento(color) {
  document.documentElement.style.setProperty('--acento', color);
  const r = parseInt(color.slice(1, 3), 16), g = parseInt(color.slice(3, 5), 16), b = parseInt(color.slice(5, 7), 16);
  document.documentElement.style.setProperty('--acento-suave', `rgba(${r},${g},${b},.10)`);
  $$('#paleta button').forEach(x => x.setAttribute('aria-pressed', String(x.dataset.color === color)));
}

function pintarPaleta() {
  const cont = $('#paleta');
  cont.innerHTML = PRESETS.map(p =>
    `<button data-color="${p.valor}" style="background:${p.valor}" aria-label="${p.nombre}" aria-pressed="false"></button>`
  ).join('');
  cont.addEventListener('click', async ev => {
    const b = ev.target.closest('button');
    if (!b) return;
    estado.config.acento = b.dataset.color;
    aplicarAcento(b.dataset.color);
    await guardar('config', estado.config);
  });
}

function pintarEstadoCatalogo() {
  const caja = $('#tarjetaEstado');
  if (!estado.libros.length) {
    caja.innerHTML = '<p class="tarjeta-estado__vacio">Sin catálogo cargado</p>';
    return;
  }
  const f = estado.config.fecha ? new Date(estado.config.fecha) : null;
  const fecha = f ? f.toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric' }) +
    ', ' + f.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' }) : '—';
  const conPrecio = estado.libros.filter(l => l.p != null).length;
  const conIsbn = estado.libros.filter(l => l.i).length;
  caja.innerHTML =
    '<dl>' +
    `<dt>Títulos</dt><dd>${estado.libros.length.toLocaleString('es-CO')}</dd>` +
    `<dt>Editoriales</dt><dd>${estado.editoriales.length.toLocaleString('es-CO')}</dd>` +
    `<dt>Con precio</dt><dd>${conPrecio.toLocaleString('es-CO')}</dd>` +
    `<dt>Con ISBN</dt><dd>${conIsbn.toLocaleString('es-CO')}</dd>` +
    `<dt>Archivo</dt><dd>${escaparHTML(estado.config.archivo || '—')}</dd>` +
    `<dt>Actualizado</dt><dd>${escaparHTML(fecha)}</dd>` +
    '</dl>';
}

function textoInstalacion() {
  const ua = navigator.userAgent;
  const esIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const instalada = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  if (instalada) return 'La aplicación ya está instalada en este dispositivo.';
  if (esIOS) return 'En iPhone o iPad: toca el botón Compartir en Safari y elige «Añadir a pantalla de inicio».';
  return 'En Android: abre el menú del navegador (⋮) y elige «Instalar aplicación» o «Añadir a pantalla de inicio».';
}

/* ─────────── Arranque ─────────── */

async function iniciar() {
  pintarPaleta();

  try {
    const cfg = await leer('config');
    if (cfg) Object.assign(estado.config, cfg);
  } catch (e) { /* primera vez */ }

  aplicarAcento(estado.config.acento);
  $('#entradaNombre').value = estado.config.nombre || '';
  $('#ayudaInstalar').textContent = textoInstalacion();

  try {
    const libros = await leer('libros');
    if (libros && libros.length) cargarEnMemoria(libros);
    else { actualizarCabecera(); pintarResultados([]); pintarEditoriales(); }
  } catch (e) {
    actualizarCabecera(); pintarResultados([]);
  }

  pintarEstadoCatalogo();
}

/* ─────────── Eventos ─────────── */

$$('.nav__tab').forEach(t => t.addEventListener('click', () => irA(t.dataset.seccion)));

let temporizadorBusqueda = null;
$('#entradaBusqueda').addEventListener('input', ev => {
  estado.consulta = ev.target.value;
  $('#botonLimpiar').hidden = !ev.target.value;
  clearTimeout(temporizadorBusqueda);
  temporizadorBusqueda = setTimeout(buscar, estado.libros.length > 4000 ? 140 : 40);
});

$('#entradaBusqueda').addEventListener('search', () => {
  if (!$('#entradaBusqueda').value) { estado.consulta = ''; $('#botonLimpiar').hidden = true; buscar(); }
});

$('#botonLimpiar').addEventListener('click', () => {
  $('#entradaBusqueda').value = '';
  estado.consulta = '';
  $('#botonLimpiar').hidden = true;
  $('#entradaBusqueda').focus();
  buscar();
});

$('#chipsCampo').addEventListener('click', ev => {
  const c = ev.target.closest('.chip');
  if (c) fijarCampo(c.dataset.campo);
});

$('#filtroActivoQuitar').addEventListener('click', () => fijarFiltroEditorial(null));

$('#botonMas').addEventListener('click', () => {
  estado.visibles += PASO;
  const q = normalizar(estado.consulta).split(/\s+/).filter(Boolean);
  pintarResultados(q);
});

$('#listaEditoriales').addEventListener('click', ev => {
  const b = ev.target.closest('.editorial');
  if (!b) return;
  $('#entradaBusqueda').value = '';
  estado.consulta = '';
  $('#botonLimpiar').hidden = true;
  fijarCampo('todo');
  fijarFiltroEditorial(b.dataset.editorial);
  irA('buscar');
});

$('#entradaEditoriales').addEventListener('input', pintarEditoriales);

$('#botonEscanear').addEventListener('click', abrirEscaner);
$('#escanerCerrar').addEventListener('click', cerrarEscaner);
document.addEventListener('keydown', ev => { if (ev.key === 'Escape') cerrarEscaner(); });

$('#entradaArchivo').addEventListener('change', ev => {
  const f = ev.target.files && ev.target.files[0];
  if (f) procesarArchivo(f);
});

$('#botonConfirmar').addEventListener('click', confirmarCatalogo);

$('#botonCancelar').addEventListener('click', () => {
  estado.borrador = null;
  $('#bloqueMapeo').hidden = true;
  $('#entradaArchivo').value = '';
  $('#avisoArchivo').hidden = true;
});

let temporizadorNombre = null;
$('#entradaNombre').addEventListener('input', ev => {
  estado.config.nombre = ev.target.value.trim();
  actualizarCabecera();
  clearTimeout(temporizadorNombre);
  temporizadorNombre = setTimeout(() => guardar('config', estado.config), 400);
});

$('#botonBorrar').addEventListener('click', async () => {
  if (!confirm('Se borrará el catálogo guardado en este teléfono. ¿Continuar?')) return;
  await eliminar('libros');
  estado.config.archivo = ''; estado.config.fecha = null;
  await guardar('config', estado.config);
  estado.libros = []; estado.editoriales = []; estado.resultados = [];
  fijarFiltroEditorial(null);
  actualizarCabecera();
  pintarResultados([]);
  pintarEditoriales();
  pintarEstadoCatalogo();
  $('#avisoArchivo').hidden = true;
  flotante('Catálogo borrado');
});

/* Instalación en Android/Chrome */
let eventoInstalar = null;
window.addEventListener('beforeinstallprompt', ev => {
  ev.preventDefault();
  eventoInstalar = ev;
  $('#botonInstalar').hidden = false;
  $('#ayudaInstalar').textContent = 'Instálala para abrirla desde un icono, sin la barra del navegador.';
});
$('#botonInstalar').addEventListener('click', async () => {
  if (!eventoInstalar) return;
  eventoInstalar.prompt();
  await eventoInstalar.userChoice;
  eventoInstalar = null;
  $('#botonInstalar').hidden = true;
});

/* Service worker */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => { /* sigue funcionando sin offline */ });
  });
}

iniciar();
