# Adobe Catalog Service Panel

Panel web estático (HTML + CSS + JavaScript, sin dependencias ni build) para consultar **Adobe Catalog Service** vía GraphQL. Pensado como herramienta de diagnóstico para lanzar llamadas y visualizar respuestas de forma cómoda.

**Demo:** https://davidlopezroldan.github.io/adobe-catalog-service-client/

## Características

- **Proyectos:** la configuración se organiza en proyectos (selector en la parte superior del panel lateral y, a su lado, un menú de tres rayas ☰ con las opciones **Nuevo proyecto**, **Renombrar proyecto**, **Exportar proyecto**, **Importar proyecto** y **Eliminar proyecto**). Un proyecto agrupa sus **entornos** y su jerarquía **Website → Store → Store View**; todas las entidades dependen de su padre y los códigos son únicos entre hermanos. Al recargar la página se vuelve al último proyecto utilizado.
- **Exportar / importar proyectos** desde el menú ☰: *Exportar proyecto* descarga un JSON con el proyecto activo y todo lo que cuelga de él (entornos con su API key, customer groups, websites, stores y store views); no incluye ajustes, favoritos ni el orden guardado. *Importar proyecto* añade los proyectos del archivo sin tocar los existentes y con identificadores internos nuevos; si el nombre ya existe, pide otro (sugiere `Nombre (2)`) y, al cancelar, omite ese proyecto. Acepta tanto archivos de proyecto como archivos de "Exportar configuración" (solo toma sus proyectos). Los archivos exportados con la API key incluida deben compartirse con cuidado si usas claves propias.
- **Gestión de entornos (Environment IDs)** dentro de cada proyecto, persistidos en `localStorage`. Cada entorno tiene un label, un tipo (Staging o Producción) que determina automáticamente el endpoint usado y una **`x-api-key` opcional** (si se deja vacía se usa `search_gql`). Los entornos se pueden editar (label, ID, tipo y API key) con el icono de lápiz:
  - Staging: `https://catalog-service-sandbox.adobe.io/graphql`
  - Producción: `https://catalog-service.adobe.io/graphql`
- **Customer groups por entorno:** cada entorno puede tener una lista de customer groups (botón **Gestionar** de la sección Customer Group). Se añaden indicando el **ID** del grupo (el hash `sha1(<id>)` que espera Adobe se calcula automáticamente) o bien escribiendo el **hash** a mano, con un label opcional. El grupo seleccionado se envía en `Magento-Customer-Group`; con "Ninguno" (por defecto) la cabecera no se envía.
- **Gestión de Websites, Stores y Store Views** desde un modal de tres columnas (con label editable en websites y stores), también persistida en `localStorage` dentro del proyecto. Al seleccionar un website se filtran sus stores y al seleccionar una store, sus store views.
- **Headers activos** en el panel lateral: muestra en todo momento los headers que se envían con sus valores reales (incluido el customer group seleccionado y si la API key es la de por defecto).
- **Pestaña Productos:** búsqueda con `productSearch` por `phrase`, resultados en tarjetas con SKU y atributos, sección de facets y modal de detalle por producto. Los facets se abren en una modal con el botón "Filtrar" (junto a "Buscar productos", con el número de filtros aplicados). Sus buckets son clicables para filtrar la consulta (OR dentro de un facet, AND entre facets) y los filtros aplicados se muestran como chips con botón "Limpiar todo". Los facets no filtrables según `attributeMetadata.filterableInSearch` aparecen deshabilitados; los metadatos se cachean por entorno, website y store view. El botón "Ordenar" abre una modal con los atributos ordenables (`attributeMetadata.sortable`) y las opciones ASC/DESC; el orden se guarda en `localStorage` por entorno, se incluye al exportar/importar la configuración y se ignora (con un aviso en el botón) si el atributo deja de ser ordenable en el contexto actual.
- **Pestaña Productos por SKU:** consulta con el endpoint `products` (`skus`) a partir de uno o varios SKUs separados por coma o espacio. Muestra las mismas tarjetas y el modal de detalle, e indica los SKUs no encontrados. Este endpoint no tiene paginación ni facets.
- **Tipo de producto, opciones y variantes:** las tarjetas y el modal muestran si el producto es *Simple* o *Complex*. Al abrir un complejo, el modal carga bajo demanda sus **opciones** (query `products` con `options`): en bundle y grouped, una tabla por opción con SKU, nombre, cantidad, valor por defecto, stock y precio; en configurables, los valores de cada opción como chips. En configurables carga además sus **variantes** (query `variants`, 100 por página con botón "Cargar más") con las selecciones en texto legible (`Color: Black · Size: L`), stock y precio. Cada petición se puede ver en "Ver consulta GraphQL enviada".
- **Atributos favoritos:** una estrella en cada atributo (tarjetas y modal de detalle) lo marca como favorito y lo coloca el primero en las listas de atributos. Dentro de favoritos y no favoritos, los atributos con valor se muestran antes que los vacíos. Si el valor de un atributo es una URL (`http`/`https`), se muestra como enlace que se abre en una pestaña nueva. Son globales por nombre de atributo, persisten en `localStorage` y se incluyen al exportar/importar la configuración.
- **Pestaña Categorías:** árbol jerárquico (reconstruido desde el campo `path`) con expandir/colapsar todo y por nodo. Indica visualmente las categorías ocultas en menú (sin el rol `show_in_menu`). Cada categoría tiene un acceso directo para ver sus productos.
- **Pestaña Productos de Categorías:** lista los productos de una categoría (filtro `categoryIds` en `productSearch`). Se puede abrir desde el árbol de categorías o introduciendo directamente un Category ID.
- **Pestaña Metadatos:** carga `attributeMetadata` del contexto actual y lista en una tabla todos los atributos filtrables (`filterableInSearch`) y ordenables (`sortable`) con su label, `frontendInput`, si son numéricos y si son filtrables y/u ordenables, con resumen de totales, búsqueda por texto, filtros por capacidad y tipo de input, JSON crudo y consulta enviada.
- **Paginación** en ambas pestañas de productos (`page_size` + `current_page`), con controles de página encima de los resultados.
- **Ajustes** (icono de engranaje en la cabecera) con el tamaño de página (`page_size`, por defecto 500) persistido en `localStorage`.
- **Exportar / importar configuración** a un archivo JSON (proyectos con sus entornos, customer groups, websites, stores y store views, ajustes y últimas selecciones) para compartirla con el equipo. Los archivos exportados antes de existir los proyectos se importan como un "Proyecto por defecto".
- **Persistencia de las últimas selecciones** (proyecto, entorno, customer group, website, store, store view, último `phrase` y última category id) restauradas al recargar.
- **Navegación por hash de URL** (`#products`, `#products-by-sku`, `#categories`, `#category-products`, `#metadata`): la pestaña activa se mantiene al recargar y es enlazable.
- **JSON crudo** de cada respuesta, colapsado por defecto.
- **Consulta GraphQL enviada** de cada llamada, colapsada por defecto, con tres bloques: `# Headers` (los realmente enviados), `# Query` y `# Variables`.
- **Favicon** con el logotipo ACS de la cabecera (SVG e ICO con varios tamaños), icono para iOS y `theme-color` naranja.

## Headers enviados

Cada llamada incluye:

| Header | Valor |
| --- | --- |
| `magento-environment-id` | del entorno activo |
| `magento-website-code` | website seleccionado |
| `magento-store-code` | store seleccionada |
| `magento-store-view-code` | store view seleccionada |
| `magento-customer-group` | hash del customer group seleccionado (solo si hay uno seleccionado; si no, no se envía) |
| `x-api-key` | la del entorno activo, o `search_gql` si no tiene |

## Uso

Al ser una aplicación estática, basta con abrir `index.html` en el navegador.

1. Crea un **proyecto** (menú ☰ junto al selector de proyecto → *Nuevo proyecto*), o importa uno ya preparado con *Importar proyecto*.
2. Añade un entorno con su `Magento-Environment-Id`, su tipo (Staging / Producción) y, opcionalmente, su `x-api-key`.
3. Crea la jerarquía website → store → store view (botón **Gestionar** de la sección Website / Store / View) y selecciónala en el panel lateral.
4. Si lo necesitas, define los customer groups del entorno desde **Gestionar** en la sección Customer Group y selecciona el que quieras enviar.
5. Usa las pestañas **Productos**, **Productos por SKU**, **Categorías** o **Productos de Categorías** para lanzar consultas.
6. Desde **Ajustes** (engranaje en la cabecera) puedes cambiar el tamaño de página y exportar/importar tu configuración.

Si ya usabas la aplicación antes de los proyectos, tus entornos y websites se migran automáticamente a un "Proyecto por defecto" (cada website pasa a tener una store con su mismo código, que es lo que antes se enviaba como `Magento-Store-Code`).

## Estructura

```
index.html      Estructura de la interfaz
styles.css      Estilos
app.js          Lógica: estado, llamadas GraphQL y renderizado
media/icons/    Favicons e iconos de la aplicación
                (favicon.svg, favicon.ico, favicon-32.png,
                 favicon-512.png y apple-touch-icon.png)
```

## Changelog

### 2026-10-30
- Add configurable product variants (variants query with cursor pagination and readable selections) and split the modal into Opciones and Variantes
- Show bundle and grouped options by option with quantity, default, stock and price, and list configurable option values
- Group the project actions in a hamburger menu next to the project selector
- Add export and import of projects with their environments, customer groups, websites, stores and store views
- Show the headers actually sent in the "Ver consulta GraphQL enviada" sections, above the query and variables
- Add projects grouping environments and a Website > Store > Store View hierarchy, restoring the last used project on reload
- Add Store level between websites and store views, with optional label, sent as Magento-Store-Code
- Add per-environment customer groups with automatic SHA-1 hash from the group ID or a manual hash, sent as Magento-Customer-Group only when selected
- Add per-environment x-api-key, defaulting to search_gql when empty
- Show the real headers sent in the Headers activos section
- Migrate existing environments and websites to a default project and import pre-project config files

### 2026-10-29
- Add ACS favicon (SVG, ICO and PNG) and iOS touch icon in media/icons

### 2026-10-22
- Add Metadatos tab listing filterable and sortable attributes with their full metadata details
- Add Ordenar button to sort product search by sortable attributes, saved per environment
- Move facets into a modal opened from a new Filtrar button next to the search button
- Add clickable facets to filter product search with applied filter chips
- Cache attribute metadata per environment, website and store view to disable non-filterable facets

### 2026-10-21
- Show URL attribute values as links opened in a new tab
- Sort attributes with value before empty ones within favorites and non-favorites
- Edit and sort environments, edit website labels, two-line environment items
- Add favorite attributes pinned first in attribute lists
- Show product type badge and associated simple products in modal
- Add Products by SKU tab using the products endpoint

### 2026-07-29
- Show sent GraphQL query, fix query format, add level field to categories

### 2026-07-22
- Reorder category node, always show list button with yellow hover
- Show urlPath in category tree nodes

### 2026-06-30
- Update README with new features
- Sync active tab with URL hash
- Persist last used selections in localStorage
- Export/import configuration via JSON file
- Add pagination to product search tabs
- Implement "Category Products" tab
- Add README with demo link
- Categories tab with collapsible tree and menu-visibility indicators

### 2026-06-26
- Product detail modal on card click
- Initial commit — Adobe Catalog Service panel
