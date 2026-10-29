# Adobe Catalog Service Panel

Panel web estático (HTML + CSS + JavaScript, sin dependencias ni build) para consultar **Adobe Catalog Service** vía GraphQL. Pensado como herramienta de diagnóstico para lanzar llamadas y visualizar respuestas de forma cómoda.

**Demo:** https://davidlopezroldan.github.io/adobe-catalog-service-client/

## Características

- **Gestión de entornos (Environment IDs)** persistidos en `localStorage`. Cada entorno tiene un label y un tipo (Staging o Producción) que determina automáticamente el endpoint usado. Los entornos se pueden editar (label, ID y tipo) con el icono de lápiz:
  - Staging: `https://catalog-service-sandbox.adobe.io/graphql`
  - Producción: `https://catalog-service.adobe.io/graphql`
- **Gestión de Websites y Store Views** desde un modal (con edición del label de cada website), también persistida en `localStorage`. Al seleccionar un website se filtran sus store views asociadas.
- **Pestaña Productos:** búsqueda con `productSearch` por `phrase`, resultados en tarjetas con SKU y atributos, sección de facets y modal de detalle por producto. Los facets se abren en una modal con el botón "Filtrar" (junto a "Buscar productos", con el número de filtros aplicados). Sus buckets son clicables para filtrar la consulta (OR dentro de un facet, AND entre facets) y los filtros aplicados se muestran como chips con botón "Limpiar todo". Los facets no filtrables según `attributeMetadata.filterableInSearch` aparecen deshabilitados; los metadatos se cachean por entorno, website y store view. El botón "Ordenar" abre una modal con los atributos ordenables (`attributeMetadata.sortable`) y las opciones ASC/DESC; el orden se guarda en `localStorage` por entorno, se incluye al exportar/importar la configuración y se ignora (con un aviso en el botón) si el atributo deja de ser ordenable en el contexto actual.
- **Pestaña Productos por SKU:** consulta con el endpoint `products` (`skus`) a partir de uno o varios SKUs separados por coma o espacio. Muestra las mismas tarjetas y el modal de detalle, e indica los SKUs no encontrados. Este endpoint no tiene paginación ni facets.
- **Tipo de producto y simples asociados:** las tarjetas y el modal muestran si el producto es *Simple* o *Complex*. Al abrir un complejo, el modal carga bajo demanda (query `products` con `options`) sus productos simples asociados.
- **Atributos favoritos:** una estrella en cada atributo (tarjetas y modal de detalle) lo marca como favorito y lo coloca el primero en las listas de atributos. Dentro de favoritos y no favoritos, los atributos con valor se muestran antes que los vacíos. Si el valor de un atributo es una URL (`http`/`https`), se muestra como enlace que se abre en una pestaña nueva. Son globales por nombre de atributo, persisten en `localStorage` y se incluyen al exportar/importar la configuración.
- **Pestaña Categorías:** árbol jerárquico (reconstruido desde el campo `path`) con expandir/colapsar todo y por nodo. Indica visualmente las categorías ocultas en menú (sin el rol `show_in_menu`). Cada categoría tiene un acceso directo para ver sus productos.
- **Pestaña Productos de Categorías:** lista los productos de una categoría (filtro `categoryIds` en `productSearch`). Se puede abrir desde el árbol de categorías o introduciendo directamente un Category ID.
- **Pestaña Metadatos:** carga `attributeMetadata` del contexto actual y lista en una tabla todos los atributos filtrables (`filterableInSearch`) y ordenables (`sortable`) con su label, `frontendInput`, si son numéricos y si son filtrables y/u ordenables, con resumen de totales, búsqueda por texto, filtros por capacidad y tipo de input, JSON crudo y consulta enviada.
- **Paginación** en ambas pestañas de productos (`page_size` + `current_page`), con controles de página encima de los resultados.
- **Ajustes** (icono de engranaje en la cabecera) con el tamaño de página (`page_size`, por defecto 500) persistido en `localStorage`.
- **Exportar / importar configuración** a un archivo JSON (entornos, websites/store views, ajustes y últimas selecciones) para compartirla con el equipo.
- **Persistencia de las últimas selecciones** (entorno, website, store view, último `phrase` y última category id) restauradas al recargar.
- **Navegación por hash de URL** (`#products`, `#products-by-sku`, `#categories`, `#category-products`, `#metadata`): la pestaña activa se mantiene al recargar y es enlazable.
- **JSON crudo** de cada respuesta, colapsado por defecto.
- **Favicon** con el logotipo ACS de la cabecera (SVG e ICO con varios tamaños), icono para iOS y `theme-color` naranja.

## Headers enviados

Cada llamada incluye:

| Header | Valor |
| --- | --- |
| `Magento-Environment-Id` | del entorno activo |
| `Magento-Store-Code` | website seleccionado |
| `Magento-Website-Code` | website seleccionado |
| `Magento-store-view-code` | store view seleccionada |
| `x-api-key` | `search_gql` (fijo) |

## Uso

Al ser una aplicación estática, basta con abrir `index.html` en el navegador.

1. Añade un entorno con su `Magento-Environment-Id` y su tipo (Staging / Producción).
2. Selecciona website y store view (gestionables desde el botón **Gestionar**).
3. Usa las pestañas **Productos**, **Productos por SKU**, **Categorías** o **Productos de Categorías** para lanzar consultas.
4. Desde **Ajustes** (engranaje en la cabecera) puedes cambiar el tamaño de página y exportar/importar tu configuración.

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
