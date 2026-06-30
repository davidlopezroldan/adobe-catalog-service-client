# Adobe Catalog Service Panel

Panel web estático (HTML + CSS + JavaScript, sin dependencias ni build) para consultar **Adobe Catalog Service** vía GraphQL. Pensado como herramienta de diagnóstico para lanzar llamadas y visualizar respuestas de forma cómoda.

**Demo:** https://davidlopezroldan.github.io/adobe-catalog-service-client/

## Características

- **Gestión de entornos (Environment IDs)** persistidos en `localStorage`. Cada entorno tiene un label y un tipo (Staging o Producción) que determina automáticamente el endpoint usado:
  - Staging: `https://catalog-service-sandbox.adobe.io/graphql`
  - Producción: `https://catalog-service.adobe.io/graphql`
- **Gestión de Websites y Store Views** desde un modal, también persistida en `localStorage`. Al seleccionar un website se filtran sus store views asociadas.
- **Pestaña Productos:** búsqueda con `productSearch` por `phrase`, resultados en tarjetas con SKU y atributos, sección de facets y modal de detalle por producto.
- **Pestaña Categorías:** árbol jerárquico (reconstruido desde el campo `path`) con expandir/colapsar todo y por nodo. Indica visualmente las categorías ocultas en menú (sin el rol `show_in_menu`). Cada categoría tiene un acceso directo para ver sus productos.
- **Pestaña Productos de Categorías:** lista los productos de una categoría (filtro `categoryIds` en `productSearch`). Se puede abrir desde el árbol de categorías o introduciendo directamente un Category ID.
- **Paginación** en ambas pestañas de productos (`page_size` + `current_page`), con controles de página encima de los resultados.
- **Ajustes** (icono de engranaje en la cabecera) con el tamaño de página (`page_size`, por defecto 500) persistido en `localStorage`.
- **Exportar / importar configuración** a un archivo JSON (entornos, websites/store views, ajustes y últimas selecciones) para compartirla con el equipo.
- **Persistencia de las últimas selecciones** (entorno, website, store view, último `phrase` y última category id) restauradas al recargar.
- **Navegación por hash de URL** (`#products`, `#categories`, `#category-products`): la pestaña activa se mantiene al recargar y es enlazable.
- **JSON crudo** de cada respuesta, colapsado por defecto.

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
3. Usa las pestañas **Productos**, **Categorías** o **Productos de Categorías** para lanzar consultas.
4. Desde **Ajustes** (engranaje en la cabecera) puedes cambiar el tamaño de página y exportar/importar tu configuración.

## Estructura

```
index.html    Estructura de la interfaz
styles.css    Estilos
app.js        Lógica: estado, llamadas GraphQL y renderizado
```
