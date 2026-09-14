/* ══════════════════════════════════════════════════════════
   Buscador de catálogo offline
   Diego Agudelo — godeloz@gmail.com
   ══════════════════════════════════════════════════════════ */

'use strict';

const VERSION_APP = '2.0';

const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));

/* ─────────── Estado ─────────── */

const estado = {
  libros: [],           // catálogo normalizado en memoria
  indice: new Map(),    // clave → libro, para reconectar las listas
  editoriales: [],
  listas: [],           // [{id, nombre, creada, items:[…]}] — viven aparte del catálogo
  guardadas: new Set(), // claves presentes en alguna lista
  config: { nombre: '', acento: '#C42F6A', mapeo: null, archivo: '', fecha: null },
  campo: 'todo',
  consulta: '',
  filtroEditorial: null,
  visibles: 60,
  resultados: [],
  borrador: null,
  fichaActual: null,
  listaAbierta: null
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

const ICONO_CORAZON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20s-7-4.4-7-9.2A4 4 0 0 1 12 8a4 4 0 0 1 7 2.8C19 15.6 12 20 12 20z"/></svg>';
const ICONO_CHECK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
const ICONO_FLECHA = '<svg class="lista-guardada__flecha" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>';

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
  if (!tokens || !tokens.length) return escaparHTML(texto);
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

/** Identidad estable de un libro, para que las listas sobrevivan a un catálogo nuevo. */
function claveLibro(l) {
  if (l.i) return 'isbn:' + l.i;
  return 'tt:' + normalizar(l.t) + '|' + normalizar(l.e);
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
    for (const alias of SINONIMOS[campo]) {
      const i = norm.indexOf(alias);
      if (i !== -1 && !usados.has(i)) { elegido = i; break; }
    }
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
    sel.innerHTML = '<option value="">— No mostrar —</option>' +
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
  const ocultos = Object.keys(ETIQUETAS).filter(k => k !== 'titulo' && !b.mapeo[k]);
  cont.innerHTML =
    `Primer registro:<br><strong>${escaparHTML(v(b.mapeo.titulo))}</strong><br>` +
    `${escaparHTML(v(b.mapeo.autor))} · ${escaparHTML(v(b.mapeo.editorial))}<br>` +
    `Precio: <strong>${precio != null ? escaparHTML(formatearPrecio(precio)) : '—'}</strong> · ` +
    `ISBN: ${escaparHTML(v(b.mapeo.isbn))}` +
    (ocultos.length
      ? `<br><br>No se mostrará: ${ocultos.map(k => escaparHTML(ETIQUETAS[k][0])).join(', ')}.`
      : '');
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
      clave: claveLibro(l),
      todo: nt + ' ' + na + ' ' + ne + ' ' + normalizar(l.c) + ' ' + (l.i || '').toLowerCase()
    });
  });

  estado.indice = new Map();
  for (const l of estado.libros) if (!estado.indice.has(l.clave)) estado.indice.set(l.clave, l);

  const cuenta = new Map();
  for (const l of estado.libros) {
    if (!l.e) continue;
    cuenta.set(l.e, (cuenta.get(l.e) || 0) + 1);
  }
  estado.editoriales = Array.from(cuenta, ([nombre, cantidad]) => ({
    nombre, cantidad, color: colorEditorial(nombre), norm: normalizar(nombre)
  })).sort((a, b) => b.cantidad - a.cantidad || a.nombre.localeCompare(b.nombre, 'es'));

  // El escáner y el filtro por ISBN solo tienen sentido si el CSV trae esa columna
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

/** Marca de un libro dentro de una lista (o de un resultado del catálogo). */
function tarjetaLibro(l, tokens, opciones) {
  const o = opciones || {};
  const color = colorEditorial(l.e);
  const precio = formatearPrecio(l.p);
  const guardado = estado.guardadas.has(l.clave || claveLibro(l));
  const extras = [];
  if (l.c) extras.push(escaparHTML(l.c));
  if (l.x) extras.push(escaparHTML(l.x) + ' en existencia');
  if (l.i && estado.campo === 'isbn') extras.push('ISBN ' + escaparHTML(l.i));

  return (
    `<article class="libro${o.ausente ? ' libro--ausente' : ''}" style="--franja:${color}">` +
      `<div class="libro__franja"></div>` +
      `<button class="libro__cuerpo" data-clave="${escaparHTML(l.clave || claveLibro(l))}"${o.origen ? ` data-origen="${escaparHTML(o.origen)}"` : ''}>` +
        `<span class="libro__datos">` +
          `<span class="libro__titulo">${resaltar(l.t, tokens)}</span>` +
          (l.a ? `<span class="libro__autor">${resaltar(l.a, tokens)}</span>` : '') +
          (l.e ? `<span class="libro__editorial">${resaltar(l.e, tokens)}</span>` : '') +
          (extras.length ? `<span class="libro__extra">${extras.join(' · ')}</span>` : '') +
          (o.ausente ? `<span class="libro__ausente">No está en el catálogo actual</span>` : '') +
        `</span>` +
        (precio
          ? `<span class="libro__precio">${escaparHTML(precio)}</span>`
          : `<span class="libro__precio libro__precio--vacio">Sin precio</span>`) +
      `</button>` +
      `<button class="libro__corazon${guardado ? ' is-guardado' : ''}" ` +
        `data-guardar="${escaparHTML(l.clave || claveLibro(l))}" ` +
        `aria-label="${guardado ? 'Quitar de mis listas' : 'Guardar en una lista'}" ` +
        `aria-pressed="${guardado}">${ICONO_CORAZON}</button>` +
    `</article>`
  );
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
  for (let i = 0; i < hasta; i++) filas.push(tarjetaLibro(estado.resultados[i], tokens, { origen: 'catalogo' }));

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

/* ─────────── Listas ───────────
   Viven en su propia clave de IndexedDB: sobreviven a cambiar de catálogo
   y a borrarlo. Cada ítem guarda una copia de los datos del libro, así que
   una lista sigue siendo legible aunque ese título ya no esté en el CSV. */

function recalcularGuardadas() {
  estado.guardadas = new Set();
  for (const lista of estado.listas) for (const it of lista.items) estado.guardadas.add(it.clave);
}

async function persistirListas() {
  recalcularGuardadas();
  try { await guardar('listas', estado.listas); }
  catch (e) { flotante('No se pudieron guardar las listas'); }
}

function nuevoId() {
  return 'l' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function crearLista(nombre) {
  const lista = { id: nuevoId(), nombre: nombre.trim() || 'Lista sin nombre', creada: Date.now(), items: [] };
  estado.listas.push(lista);
  return lista;
}

function libroPorClave(clave) {
  if (estado.indice.has(clave)) return { libro: estado.indice.get(clave), ausente: false };
  for (const lista of estado.listas) {
    const it = lista.items.find(i => i.clave === clave);
    if (it) return { libro: it, ausente: true };
  }
  return null;
}

function alternarEnLista(listaId, libro) {
  const lista = estado.listas.find(l => l.id === listaId);
  if (!lista) return false;
  const clave = libro.clave || claveLibro(libro);
  const i = lista.items.findIndex(it => it.clave === clave);
  if (i !== -1) { lista.items.splice(i, 1); return false; }
  lista.items.push({
    clave, t: libro.t, a: libro.a, e: libro.e, p: libro.p,
    i: libro.i, c: libro.c, x: libro.x, agregado: Date.now()
  });
  return true;
}

function totalLista(lista) {
  let suma = 0, conPrecio = 0;
  for (const it of lista.items) {
    const actual = estado.indice.get(it.clave);
    const p = actual ? actual.p : it.p;
    if (p != null) { suma += p; conPrecio++; }
  }
  return { suma, conPrecio };
}

function pintarListas() {
  const cont = $('#listaDeListas');
  const meta = $('#metaListas');
  const vacio = $('#vacioListas');

  if (!estado.listas.length) {
    cont.innerHTML = ''; meta.textContent = '';
    vacio.hidden = false;
    return;
  }
  vacio.hidden = true;

  const totalLibros = estado.guardadas.size;
  meta.textContent = `${estado.listas.length} ${estado.listas.length === 1 ? 'lista' : 'listas'} · ` +
    `${totalLibros.toLocaleString('es-CO')} ${totalLibros === 1 ? 'libro' : 'libros'}`;

  cont.innerHTML = '<div class="lista">' + estado.listas.map(l => {
    const { suma, conPrecio } = totalLista(l);
    const detalle = l.items.length
      ? `${l.items.length} ${l.items.length === 1 ? 'libro' : 'libros'}` +
        (conPrecio ? ` · ${formatearPrecio(suma)}` : '')
      : 'Vacía';
    return `<button class="lista-guardada" data-lista="${escaparHTML(l.id)}">` +
      `<span class="lista-guardada__nombre">${escaparHTML(l.nombre)}</span>` +
      `<span class="lista-guardada__conteo">${escaparHTML(detalle)}</span>` +
      ICONO_FLECHA +
    `</button>`;
  }).join('') + '</div>';
}

function abrirLista(id) {
  const lista = estado.listas.find(l => l.id === id);
  if (!lista) return;
  estado.listaAbierta = id;
  $('#vistaListas').hidden = true;
  $('#vistaListaAbierta').hidden = false;
  pintarListaAbierta();
  window.scrollTo(0, 0);
}

function cerrarLista() {
  estado.listaAbierta = null;
  $('#vistaListaAbierta').hidden = true;
  $('#vistaListas').hidden = false;
  pintarListas();
}

function pintarListaAbierta() {
  const lista = estado.listas.find(l => l.id === estado.listaAbierta);
  if (!lista) return cerrarLista();

  $('#nombreListaAbierta').textContent = lista.nombre;

  const { suma, conPrecio } = totalLista(lista);
  $('#metaListaAbierta').textContent = lista.items.length
    ? `${lista.items.length} ${lista.items.length === 1 ? 'libro' : 'libros'}` +
      (conPrecio ? ` · ${formatearPrecio(suma)}` +
        (conPrecio < lista.items.length ? ` (${lista.items.length - conPrecio} sin precio)` : '') : '')
    : '';

  const cont = $('#librosDeLista');
  if (!lista.items.length) {
    cont.innerHTML = '<div class="vacio"><p class="vacio__titulo">Lista vacía</p>' +
      '<p class="vacio__texto">Busca un libro y toca el corazón para agregarlo aquí.</p></div>';
    return;
  }

  const ordenados = lista.items.slice().sort((a, b) => b.agregado - a.agregado);
  cont.innerHTML = '<div class="lista">' + ordenados.map(it => {
    const actual = estado.indice.get(it.clave);
    return tarjetaLibro(actual || it, null, { ausente: !actual, origen: 'lista' });
  }).join('') + '</div>';
}

function textoDeLista(lista) {
  const lineas = [lista.nombre, ''];
  for (const it of lista.items) {
    const actual = estado.indice.get(it.clave);
    const l = actual || it;
    const precio = formatearPrecio(l.p);
    lineas.push(`• ${l.t}${l.a ? ' — ' + l.a : ''}${l.e ? ' (' + l.e + ')' : ''}${precio ? ' · ' + precio : ''}`);
  }
  const { suma, conPrecio } = totalLista(lista);
  if (conPrecio) lineas.push('', `Total: ${formatearPrecio(suma)}`);
  return lineas.join('\n');
}

/* ─────────── Ficha del libro ─────────── */

function abrirFicha(clave) {
  const hallazgo = libroPorClave(clave);
  if (!hallazgo) return;
  const l = hallazgo.libro;
  estado.fichaActual = l;

  const color = colorEditorial(l.e);
  const precio = formatearPrecio(l.p);
  const guardado = estado.guardadas.has(clave);

  const datos = [];
  if (l.i) datos.push(['ISBN', l.i]);
  if (l.c) datos.push(['Categoría', l.c]);
  if (l.x) datos.push(['Existencias', l.x]);

  const enListas = estado.listas.filter(li => li.items.some(it => it.clave === clave)).map(li => li.nombre);
  if (enListas.length) datos.push([enListas.length === 1 ? 'En la lista' : 'En las listas', enListas.join(', ')]);

  $('#fichaCuerpo').innerHTML =
    `<h2 class="ficha__titulo" id="fichaTitulo">${escaparHTML(l.t)}</h2>` +
    (l.a ? `<p class="ficha__autor">${escaparHTML(l.a)}</p>` : '') +
    (l.e ? `<p class="ficha__editorial" style="--franja:${color}">${escaparHTML(l.e)}</p>` : '') +
    (precio
      ? `<p class="ficha__precio">${escaparHTML(precio)}</p>`
      : `<p class="ficha__precio ficha__precio--vacio">Sin precio en el catálogo</p>`) +
    (hallazgo.ausente
      ? `<p class="libro__ausente">Este título ya no está en el catálogo cargado. Los datos son los del momento en que lo guardaste.</p>`
      : '') +
    (datos.length
      ? `<dl class="ficha__datos">` + datos.map(([k, v]) =>
          `<div><dt>${escaparHTML(k)}</dt><dd>${escaparHTML(v)}</dd></div>`).join('') + `</dl>`
      : '') +
    `<div class="ficha__acciones">` +
      `<button class="boton boton--primario" id="fichaGuardar">${guardado ? 'Cambiar de lista' : 'Guardar en lista'}</button>` +
      `<button class="boton" data-cerrar="hojaFicha">Cerrar</button>` +
    `</div>`;

  abrirHoja('hojaFicha');
}

/* ─────────── Hojas ─────────── */

function abrirHoja(id) {
  const h = $('#' + id);
  if (h) h.hidden = false;
}

function cerrarHoja(id) {
  const h = $('#' + id);
  if (h) h.hidden = true;
}

let libroParaGuardar = null;

function abrirSelectorListas(libro) {
  libroParaGuardar = libro;
  $('#listasSub').textContent = libro.t;
  $('#entradaNuevaLista').value = '';
  pintarOpcionesListas();
  $('#hojaListas').classList.add('hoja--encima');
  abrirHoja('hojaListas');
}

function pintarOpcionesListas() {
  const cont = $('#opcionesListas');
  const clave = libroParaGuardar ? (libroParaGuardar.clave || claveLibro(libroParaGuardar)) : null;

  if (!estado.listas.length) {
    cont.innerHTML = '<p class="hoja__sub">Todavía no tienes listas. Crea la primera abajo.</p>';
    return;
  }

  cont.innerHTML = estado.listas.map(l => {
    const dentro = l.items.some(it => it.clave === clave);
    return `<button class="opcion-lista${dentro ? ' is-dentro' : ''}" data-opcion="${escaparHTML(l.id)}" aria-pressed="${dentro}">` +
      `<span class="opcion-lista__marca">${ICONO_CHECK}</span>` +
      `<span class="opcion-lista__nombre">${escaparHTML(l.nombre)}</span>` +
      `<span class="opcion-lista__conteo">${l.items.length}</span>` +
    `</button>`;
  }).join('');
}

/** Refresca corazones y contadores sin repintar toda la lista de resultados. */
function refrescarCorazones() {
  $$('.libro__corazon').forEach(b => {
    const guardado = estado.guardadas.has(b.dataset.guardar);
    b.classList.toggle('is-guardado', guardado);
    b.setAttribute('aria-pressed', String(guardado));
    b.setAttribute('aria-label', guardado ? 'Quitar de mis listas' : 'Guardar en una lista');
  });
}

/* ─────────── Menú de una lista ─────────── */

function abrirMenuLista() {
  const lista = estado.listas.find(l => l.id === estado.listaAbierta);
  if (!lista) return;

  const hoja = document.createElement('div');
  hoja.className = 'hoja hoja--encima';
  hoja.innerHTML =
    `<div class="hoja__fondo" data-salir></div>` +
    `<div class="hoja__panel" role="dialog" aria-modal="true">` +
      `<div class="hoja__asa" data-salir></div>` +
      `<div class="hoja__cuerpo">` +
        `<h2 class="hoja__titulo">${escaparHTML(lista.nombre)}</h2>` +
        `<p class="hoja__sub">${lista.items.length} ${lista.items.length === 1 ? 'libro' : 'libros'}</p>` +
        `<div class="nueva-lista">` +
          `<input type="text" class="entrada-texto" id="nuevoNombreLista" maxlength="40" value="${escaparHTML(lista.nombre)}">` +
          `<button class="boton boton--primario" data-accion="renombrar">Renombrar</button>` +
        `</div>` +
        `<button class="boton boton--ancho" data-accion="copiar">Copiar la lista como texto</button>` +
        `<button class="boton boton--ancho boton--peligro" data-accion="eliminar">Eliminar la lista</button>` +
        `<button class="boton boton--ancho" data-salir>Cancelar</button>` +
      `</div>` +
    `</div>`;

  document.body.appendChild(hoja);

  hoja.addEventListener('click', async ev => {
    if (ev.target.closest('[data-salir]')) return hoja.remove();
    const b = ev.target.closest('[data-accion]');
    if (!b) return;

    if (b.dataset.accion === 'renombrar') {
      const nombre = hoja.querySelector('#nuevoNombreLista').value.trim();
      if (!nombre) return flotante('Ponle un nombre a la lista');
      lista.nombre = nombre;
      await persistirListas();
      pintarListaAbierta();
      hoja.remove();
      flotante('Lista renombrada');
    }

    if (b.dataset.accion === 'copiar') {
      const texto = textoDeLista(lista);
      try {
        await navigator.clipboard.writeText(texto);
        flotante('Lista copiada');
      } catch (e) {
        const area = document.createElement('textarea');
        area.value = texto;
        document.body.appendChild(area);
        area.select();
        try { document.execCommand('copy'); flotante('Lista copiada'); }
        catch (e2) { flotante('No se pudo copiar'); }
        area.remove();
      }
      hoja.remove();
    }

    if (b.dataset.accion === 'eliminar') {
      if (!confirm(`Se eliminará la lista «${lista.nombre}» y sus ${lista.items.length} libros. ¿Continuar?`)) return;
      estado.listas = estado.listas.filter(l => l.id !== lista.id);
      await persistirListas();
      hoja.remove();
      cerrarLista();
      refrescarCorazones();
      flotante('Lista eliminada');
    }
  });
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
  fijarFiltroEditorial(null);
  fijarCampo('isbn');

  const valor = encontrado ? encontrado.i : codigo;
  $('#entradaBusqueda').value = valor;
  estado.consulta = valor;
  $('#botonLimpiar').hidden = false;
  buscar();
  irA('buscar');

  if (encontrado) abrirFicha(encontrado.clave);
  else flotante('Ese ISBN no está en el catálogo');
}

/* ─────────── Interfaz general ─────────── */

function irA(seccion) {
  $$('.seccion').forEach(s => s.classList.toggle('is-activa', s.id === 'seccion-' + seccion));
  $$('.nav__tab').forEach(t => {
    const activa = t.dataset.seccion === seccion;
    t.classList.toggle('is-activa', activa);
    if (activa) t.setAttribute('aria-current', 'page'); else t.removeAttribute('aria-current');
  });
  if (seccion === 'listas') { cerrarLista(); }
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
  const instalada = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
  if (instalada) return 'La aplicación ya está instalada en este dispositivo.';
  if (esIOS) return 'En iPhone o iPad: toca el botón Compartir en Safari y elige «Añadir a pantalla de inicio».';
  return 'En Android: abre el menú del navegador (⋮) y elige «Instalar aplicación» o «Añadir a pantalla de inicio».';
}

/* ─────────── Actualización de la app ─────────── */

let trabajadorEnEspera = null;

function mostrarBarraActualizacion(trabajador) {
  trabajadorEnEspera = trabajador;
  $('#barraActualizacion').hidden = false;
}

async function buscarActualizacion() {
  if (!navigator.onLine) return flotante('Sin conexión: conéctate a wifi para actualizar');
  flotante('Buscando actualización…');
  try {
    if ('serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg) await reg.update();
    }
  } catch (e) { /* recargamos igual */ }
  setTimeout(() => window.location.reload(), 600);
}

function registrarTrabajador() {
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register('sw.js');

      reg.addEventListener('updatefound', () => {
        const nuevo = reg.installing;
        if (!nuevo) return;
        nuevo.addEventListener('statechange', () => {
          if (nuevo.state === 'installed' && navigator.serviceWorker.controller) {
            mostrarBarraActualizacion(nuevo);
          }
        });
      });

      // Revisa una vez por hora, por si la app queda abierta todo el día
      setInterval(() => reg.update().catch(() => {}), 60 * 60 * 1000);
    } catch (e) { /* sigue funcionando sin offline */ }
  });
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
  $('#ayudaVersion').textContent =
    `Versión ${VERSION_APP}. Al abrir la app con internet se actualiza sola; sin señal usa la última versión guardada.`;

  try {
    const listas = await leer('listas');
    if (Array.isArray(listas)) estado.listas = listas;
  } catch (e) { /* primera vez */ }
  recalcularGuardadas();

  try {
    const libros = await leer('libros');
    if (libros && libros.length) cargarEnMemoria(libros);
    else { actualizarCabecera(); pintarResultados([]); pintarEditoriales(); }
  } catch (e) {
    actualizarCabecera(); pintarResultados([]);
  }

  pintarListas();
  pintarEstadoCatalogo();
  registrarTrabajador();
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

/* Resultados: abrir ficha o guardar en lista */
function manejarClicLibros(ev) {
  const corazon = ev.target.closest('.libro__corazon');
  if (corazon) {
    const hallazgo = libroPorClave(corazon.dataset.guardar);
    if (hallazgo) abrirSelectorListas(hallazgo.libro);
    return;
  }
  const cuerpo = ev.target.closest('.libro__cuerpo');
  if (cuerpo) abrirFicha(cuerpo.dataset.clave);
}

$('#listaResultados').addEventListener('click', manejarClicLibros);
$('#librosDeLista').addEventListener('click', manejarClicLibros);

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

/* Listas */
$('#botonNuevaLista').addEventListener('click', async () => {
  const nombre = prompt('Nombre de la lista nueva:', '');
  if (nombre === null) return;
  const lista = crearLista(nombre);
  await persistirListas();
  pintarListas();
  abrirLista(lista.id);
});

$('#listaDeListas').addEventListener('click', ev => {
  const b = ev.target.closest('.lista-guardada');
  if (b) abrirLista(b.dataset.lista);
});

$('#volverListas').addEventListener('click', cerrarLista);
$('#menuLista').addEventListener('click', abrirMenuLista);

/* Hoja: selector de listas */
$('#opcionesListas').addEventListener('click', async ev => {
  const b = ev.target.closest('.opcion-lista');
  if (!b || !libroParaGuardar) return;
  const agregado = alternarEnLista(b.dataset.opcion, libroParaGuardar);
  await persistirListas();
  pintarOpcionesListas();
  refrescarCorazones();
  pintarListas();
  if (estado.listaAbierta) pintarListaAbierta();
  flotante(agregado ? 'Guardado' : 'Quitado de la lista');
});

$('#botonCrearYGuardar').addEventListener('click', async () => {
  const entrada = $('#entradaNuevaLista');
  const nombre = entrada.value.trim();
  if (!nombre) return flotante('Ponle un nombre a la lista');
  const lista = crearLista(nombre);
  if (libroParaGuardar) alternarEnLista(lista.id, libroParaGuardar);
  await persistirListas();
  entrada.value = '';
  pintarOpcionesListas();
  refrescarCorazones();
  pintarListas();
  flotante(`Guardado en «${lista.nombre}»`);
});

$('#entradaNuevaLista').addEventListener('keydown', ev => {
  if (ev.key === 'Enter') $('#botonCrearYGuardar').click();
});

/* Cierre de hojas */
document.addEventListener('click', ev => {
  const c = ev.target.closest('[data-cerrar]');
  if (!c) return;
  const id = c.dataset.cerrar;
  cerrarHoja(id);
  if (id === 'hojaListas') {
    $('#hojaListas').classList.remove('hoja--encima');
    libroParaGuardar = null;
    if (estado.fichaActual) abrirFicha(estado.fichaActual.clave || claveLibro(estado.fichaActual));
  }
  if (id === 'hojaFicha') estado.fichaActual = null;
});

$('#fichaCuerpo').addEventListener('click', ev => {
  if (ev.target.closest('#fichaGuardar') && estado.fichaActual) {
    abrirSelectorListas(estado.fichaActual);
  }
});

/* Escáner */
$('#botonEscanear').addEventListener('click', abrirEscaner);
$('#escanerCerrar').addEventListener('click', cerrarEscaner);

document.addEventListener('keydown', ev => {
  if (ev.key !== 'Escape') return;
  cerrarEscaner();
  if (!$('#hojaListas').hidden) {
    cerrarHoja('hojaListas');
    $('#hojaListas').classList.remove('hoja--encima');
  } else if (!$('#hojaFicha').hidden) {
    cerrarHoja('hojaFicha');
    estado.fichaActual = null;
  }
});

/* Catálogo */
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
  if (!confirm('Se borrará el catálogo guardado en este teléfono. Tus listas se conservan. ¿Continuar?')) return;
  await eliminar('libros');
  estado.config.archivo = ''; estado.config.fecha = null;
  await guardar('config', estado.config);
  estado.libros = []; estado.editoriales = []; estado.resultados = []; estado.indice = new Map();
  fijarFiltroEditorial(null);
  actualizarCabecera();
  pintarResultados([]);
  pintarEditoriales();
  pintarListas();
  if (estado.listaAbierta) pintarListaAbierta();
  pintarEstadoCatalogo();
  $('#avisoArchivo').hidden = true;
  flotante('Catálogo borrado');
});

/* Actualización */
$('#botonBuscarActualizacion').addEventListener('click', buscarActualizacion);

$('#botonActualizar').addEventListener('click', () => {
  $('#barraActualizacion').hidden = true;
  if (trabajadorEnEspera) {
    navigator.serviceWorker.addEventListener('controllerchange', () => window.location.reload(), { once: true });
    trabajadorEnEspera.postMessage('SALTAR');
    setTimeout(() => window.location.reload(), 1200);
  } else {
    window.location.reload();
  }
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

iniciar();
