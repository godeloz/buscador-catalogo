# Buscador de catálogo — versión offline

App web para consultar el catálogo de una librería sin conexión a internet.
Una sola instalación sirve para cualquier librería: cada teléfono carga su
propio CSV y lo guarda localmente.

---

## Archivos

```
buscador-catalogo/
├── index.html                  ← la app
├── styles.css
├── app.js
├── manifest.json               ← nombre, color e iconos al instalarla
├── sw.js                       ← service worker: hace posible el uso offline
├── vendor/
│   ├── papaparse.min.js        ← lector de CSV
│   └── zxing.min.js            ← lector de códigos de barras
├── icons/
│   ├── icon-192.png
│   ├── icon-512.png
│   ├── icon-maskable-512.png
│   └── apple-touch-icon.png    ← el que usa iPhone
├── ejemplo-catalogo.csv        ← para probar (precios de ejemplo, no reales)
└── README.md
```

---

## Publicar en GitHub Pages

El service worker exige HTTPS. GitHub Pages lo da gratis.

1. Crea un repositorio nuevo (público) en GitHub, por ejemplo `buscador-catalogo`.
2. Sube **el contenido** de esta carpeta a la raíz del repositorio — que `index.html`
   quede arriba del todo, no dentro de otra carpeta.
3. Settings → Pages → Source: `Deploy from a branch` → rama `main`, carpeta `/ (root)`.
4. En 1–2 minutos queda en `https://TUUSUARIO.github.io/buscador-catalogo/`.

Esa URL es la única que necesitan todas las librerías.

### Al publicar cambios

`index.html`, `styles.css`, `app.js` y `manifest.json` se piden **a la red primero**:
cada vez que alguien abre la app con internet, recibe la última versión publicada.
No hay que hacer nada más.

Solo si cambias algo dentro de `vendor/` o `icons/` hay que subir la versión en `sw.js`,
porque esos archivos se sirven desde el caché:

```js
const VERSION = 'buscador-v3';   // v2 → v3
```

Conviene subir también `VERSION_APP` en `app.js`, que es lo que la gente ve
en Catálogo → Versión e instalación.

Quien tenga la app abierta cuando publiques verá una barra abajo con el aviso
y un botón para actualizar. También hay un botón **Buscar actualización** en
la sección Catálogo.

---

## Instalar en el teléfono

Una sola vez, con internet:

- **Android / Chrome** — abre la URL. Aparece «Instalar aplicación»; si no,
  menú ⋮ → *Instalar aplicación*.
- **iPhone / Safari** — abre la URL, toca Compartir (□↑) → *Añadir a pantalla de inicio*.
  iOS no muestra aviso automático: hay que hacerlo a mano.

Queda un icono en la pantalla de inicio y la app abre sin barra del navegador.

---

## Cargar el catálogo

1. Sección **Catálogo** → *Elegir archivo CSV*.
2. La app detecta sola las columnas. Si el archivo usa nombres distintos,
   se corrigen en *Revisar columnas* — una sola vez por librería.
3. *Guardar catálogo*. Desde ahí funciona sin conexión.

La única columna obligatoria es el título. Las demás se activan si están:

| Columna | Efecto si falta |
|---|---|
| Autor | No aparece bajo el título |
| Editorial | Franja gris y sección Editoriales vacía |
| Precio | Muestra «Sin precio» |
| ISBN | Se ocultan el escáner y el filtro por ISBN |
| Categoría, Existencias | No se muestran |

Cualquier campo puede quedar en **No mostrar**, aunque el CSV sí tenga esa columna:
sirve para ocultar datos que no quieres enseñar al público (existencias, por ejemplo).

Formatos de precio reconocidos: `77.623`, `$77.623`, `77623`, `15.000,00`, `45,000.50`.

### Actualizar

Repetir la carga reemplaza el catálogo anterior. Lo que necesita wifi no es la
app sino que el CSV llegue al teléfono (correo, Drive, WhatsApp). Una vez el
archivo está en el dispositivo, la carga funciona con o sin señal.

---

## Escanear códigos de barras

El botón de la cámara lee EAN-13, EAN-8, UPC-A y UPC-E, y busca ese ISBN en el
catálogo guardado. No consulta internet. Si el catálogo trae ISBN-10, la app
convierte el EAN-13 escaneado para que igual coincida.

La primera vez el navegador pide permiso de cámara. En iPhone solo funciona en
Safari o en la app instalada, no dentro de otros navegadores.

---

## Cambiar el icono

Los cuatro PNG de `icons/` salen de `herramientas/icono-original.png`. Para
cambiarlos, reemplaza ese archivo y ejecuta:

```bash
python3 herramientas/iconos.py
```

El script se encarga de lo que cada sistema exige: rellena en blanco las zonas
recortadas, genera una versión opaca y sin esquinas para iOS —que recorta el
icono por su cuenta— y otra con el dibujo reducido al 48 % para el recorte
circular de algunos lanzadores de Android.

---

## Listas

Toca el corazón de cualquier resultado para guardarlo. Puedes tener varias listas
a la vez (pedidos, apartados, novedades) y un mismo libro en más de una. Cada lista
muestra el total sumado y se puede copiar como texto para pegarla en WhatsApp o
en un correo.

**Las listas viven aparte del catálogo.** Se guardan en su propia bodega del
teléfono, así que sobreviven a cargar un CSV nuevo y a borrar el catálogo. Cada
libro guardado conserva una copia de sus datos: si desaparece del inventario, la
lista lo sigue mostrando con el precio que tenía, marcado como «No está en el
catálogo actual». Si el título vuelve a aparecer en un CSV posterior, se reconecta
solo y vuelve a mostrar el precio vigente.

El enlace entre lista y catálogo se hace por ISBN; si el libro no tiene, se usa la
combinación de título y editorial.

---

## Notas

- El catálogo se guarda en IndexedDB, en el propio teléfono. Nadie ve el
  catálogo de otra librería.
- En iOS, si una app instalada no se abre en varias semanas, el sistema puede
  limpiar sus datos. Con uso diario durante una feria no es un problema.
- Probado hasta ~12.000 títulos sin pérdida de fluidez.
- El nombre de la librería y el color se cambian en la sección Catálogo, sin tocar código.

---

Aplicación web desarrollada por Diego Agudelo — godeloz@gmail.com
