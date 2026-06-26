// ===== CONSTANTS =====

const ENDPOINTS = {
  staging: 'https://catalog-service-sandbox.adobe.io/graphql',
  production: 'https://catalog-service.adobe.io/graphql',
};

const API_KEY = 'search_gql';

// Default websites/store views loaded on first run
const DEFAULT_WEBSITE_STORE_MAP = {};

const LS_KEY = 'catalogService.environments';
const LS_WS_KEY = 'catalogService.websites';

// ===== STATE =====
let environments = [];
let activeEnvironment = null;

// websites: { [code]: { label: string, storeViews: string[] } }
let websites = {};
let selectedWebsiteCode = null; // for the manager modal

// ===== DOM REFS =====
const $ = (id) => document.getElementById(id);

// ===== LOCAL STORAGE =====

function loadEnvironments() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    environments = raw ? JSON.parse(raw) : [];
  } catch {
    environments = [];
  }
}

function saveEnvironments() {
  localStorage.setItem(LS_KEY, JSON.stringify(environments));
}

// ===== WEBSITES LOCAL STORAGE =====

function loadWebsites() {
  try {
    const raw = localStorage.getItem(LS_WS_KEY);
    if (raw) {
      websites = JSON.parse(raw);
    } else {
      // First run: load defaults
      websites = JSON.parse(JSON.stringify(DEFAULT_WEBSITE_STORE_MAP));
      saveWebsites();
    }
  } catch {
    websites = JSON.parse(JSON.stringify(DEFAULT_WEBSITE_STORE_MAP));
  }
}

function saveWebsites() {
  localStorage.setItem(LS_WS_KEY, JSON.stringify(websites));
}

// ===== ENVIRONMENT MANAGEMENT =====

function renderEnvironments() {
  const list = $('env-list');
  list.innerHTML = '';

  if (environments.length === 0) {
    list.innerHTML = '<div class="env-empty">No hay entornos guardados</div>';
    activeEnvironment = null;
    updateActiveEnvDisplay();
    return;
  }

  environments.forEach((env, index) => {
    const isProduction = env.type === 'production';
    const typeBadge = isProduction
      ? `<span class="env-type-badge production">PROD</span>`
      : `<span class="env-type-badge staging">STG</span>`;

    const item = document.createElement('div');
    item.className = 'env-item' + (activeEnvironment && activeEnvironment.id === env.id ? ' active' : '');
    item.innerHTML = `
      <div class="env-item-label" title="${env.label}">${env.label}</div>
      <div style="display:flex;align-items:center;gap:5px">
        ${typeBadge}
        <div class="env-item-id" title="${env.environmentId}">${env.environmentId}</div>
      </div>
      <button class="env-item-delete" title="Eliminar entorno" data-index="${index}">&#x2715;</button>
    `;

    // Click to select
    item.addEventListener('click', (e) => {
      if (e.target.closest('.env-item-delete')) return;
      activeEnvironment = env;
      renderEnvironments();
      updateActiveEnvDisplay();
    });

    // Delete button
    item.querySelector('.env-item-delete').addEventListener('click', (e) => {
      e.stopPropagation();
      if (activeEnvironment && activeEnvironment.id === env.id) {
        activeEnvironment = null;
      }
      environments.splice(index, 1);
      saveEnvironments();
      renderEnvironments();
      updateActiveEnvDisplay();
    });

    list.appendChild(item);
  });

  // Auto-select first if none active
  if (!activeEnvironment && environments.length > 0) {
    activeEnvironment = environments[0];
    renderEnvironments();
  }

  updateActiveEnvDisplay();
}

function updateActiveEnvDisplay() {
  const display = $('active-env-display');
  if (activeEnvironment) {
    const isProduction = activeEnvironment.type === 'production';
    const typeBadge = isProduction
      ? `<span class="env-type-badge production">PROD</span>`
      : `<span class="env-type-badge staging">STG</span>`;
    const url = isProduction ? ENDPOINTS.production : ENDPOINTS.staging;

    display.innerHTML = `
      <div class="label">Entorno activo</div>
      <div style="display:flex;align-items:center;gap:6px;margin:3px 0">${typeBadge}<div class="name" style="margin:0">${activeEnvironment.label}</div></div>
      <div class="eid">${activeEnvironment.environmentId}</div>
      <div style="font-size:10px;color:var(--color-text-muted);margin-top:4px;font-family:var(--font-mono);word-break:break-all">${url}</div>
    `;
    display.style.display = 'block';

    // Update header badge
    const badge = $('env-badge');
    if (isProduction) {
      badge.textContent = 'Producción';
      badge.className = 'env-badge production';
    } else {
      badge.textContent = 'Staging';
      badge.className = 'env-badge staging';
    }
  } else {
    display.innerHTML = `<div class="label" style="color:var(--color-error)">Ningún entorno seleccionado</div>`;
    display.style.display = 'block';

    const badge = $('env-badge');
    badge.textContent = '—';
    badge.className = 'env-badge staging';
  }
}

function initEnvironmentManager() {
  loadEnvironments();
  renderEnvironments();

  // Toggle add form
  $('btn-add-env').addEventListener('click', () => {
    const form = $('env-add-form');
    form.classList.toggle('visible');
    if (form.classList.contains('visible')) {
      $('new-env-label').focus();
      $('btn-add-env').textContent = '✕ Cancelar';
    } else {
      $('btn-add-env').textContent = '+ Añadir entorno';
    }
  });

  // Save new env
  $('btn-save-env').addEventListener('click', () => {
    const label = $('new-env-label').value.trim();
    const envId = $('new-env-id').value.trim();
    const type = $('new-env-type').value;

    if (!label) {
      showFieldError($('new-env-label'), 'El label es requerido');
      return;
    }
    if (!envId) {
      showFieldError($('new-env-id'), 'El Environment ID es requerido');
      return;
    }

    const newEnv = {
      id: Date.now().toString(),
      label,
      environmentId: envId,
      type,
    };

    environments.push(newEnv);
    saveEnvironments();
    activeEnvironment = newEnv;

    // Reset form
    $('new-env-label').value = '';
    $('new-env-id').value = '';
    $('new-env-type').value = 'staging';
    $('env-add-form').classList.remove('visible');
    $('btn-add-env').textContent = '+ Añadir entorno';

    renderEnvironments();
  });

  // Allow Enter key in form fields
  [$('new-env-label'), $('new-env-id')].forEach((input) => {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') $('btn-save-env').click();
    });
  });
}

function showFieldError(input, msg) {
  input.style.borderColor = 'var(--color-error)';
  input.focus();
  setTimeout(() => {
    input.style.borderColor = '';
  }, 2000);
}

// ===== ENDPOINT (derived from active environment) =====

function getEndpoint() {
  if (activeEnvironment && activeEnvironment.type === 'production') {
    return ENDPOINTS.production;
  }
  return ENDPOINTS.staging;
}

// ===== WEBSITE / STORE VIEW SELECTOR (sidebar) =====

function initWebsiteSelector() {
  const websiteSelect = $('website-select');
  websiteSelect.addEventListener('change', () => {
    populateSidebarStoreViews(websiteSelect.value);
  });
  populateSidebarWebsites();
}

function populateSidebarWebsites() {
  const websiteSelect = $('website-select');
  const previousValue = websiteSelect.value;
  websiteSelect.innerHTML = '';

  const codes = Object.keys(websites).sort();

  if (codes.length === 0) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = '-- Sin websites --';
    websiteSelect.appendChild(opt);
    populateSidebarStoreViews('');
    return;
  }

  codes.forEach((code) => {
    const opt = document.createElement('option');
    opt.value = code;
    const label = websites[code].label ? `${code} — ${websites[code].label}` : code;
    opt.textContent = label;
    websiteSelect.appendChild(opt);
  });

  // Restore previous selection if still exists
  if (previousValue && websites[previousValue]) {
    websiteSelect.value = previousValue;
  }

  populateSidebarStoreViews(websiteSelect.value);
}

function populateSidebarStoreViews(websiteCode) {
  const storeViewSelect = $('store-view-select');
  const previousValue = storeViewSelect.value;
  storeViewSelect.innerHTML = '';

  const views = websiteCode && websites[websiteCode]
    ? websites[websiteCode].storeViews
    : [];

  if (views.length === 0) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = '-- Sin store views --';
    storeViewSelect.appendChild(opt);
    return;
  }

  views.forEach((view) => {
    const opt = document.createElement('option');
    opt.value = view;
    opt.textContent = view;
    storeViewSelect.appendChild(opt);
  });

  if (previousValue && views.includes(previousValue)) {
    storeViewSelect.value = previousValue;
  }
}

// ===== WEBSITE MANAGER MODAL =====

function initWebsiteManager() {
  $('btn-open-ws-manager').addEventListener('click', openWsModal);
  $('btn-close-ws-modal').addEventListener('click', closeWsModal);
  $('ws-modal-overlay').addEventListener('click', (e) => {
    if (e.target === $('ws-modal-overlay')) closeWsModal();
  });

  // Add website
  $('btn-save-ws').addEventListener('click', addWebsite);
  $('new-ws-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') addWebsite(); });
  $('new-ws-label').addEventListener('keydown', (e) => { if (e.key === 'Enter') addWebsite(); });

  // Add store view
  $('btn-save-sv').addEventListener('click', addStoreView);
  $('new-sv-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') addStoreView(); });

  // Close with Escape
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeWsModal();
  });
}

function openWsModal() {
  selectedWebsiteCode = null;
  renderWsManager();
  $('ws-modal-overlay').style.display = 'flex';
  document.body.style.overflow = 'hidden';
}

function closeWsModal() {
  $('ws-modal-overlay').style.display = 'none';
  document.body.style.overflow = '';
  // Refresh sidebar selectors in case something changed
  populateSidebarWebsites();
}

function renderWsManager() {
  renderWebsiteList();
  renderStoreViewPanel();
}

function renderWebsiteList() {
  const list = $('ws-list');
  const codes = Object.keys(websites).sort();
  $('ws-count').textContent = codes.length;

  list.innerHTML = '';

  if (codes.length === 0) {
    list.innerHTML = '<div class="ws-empty">No hay websites configurados</div>';
    return;
  }

  codes.forEach((code) => {
    const ws = websites[code];
    const isSelected = code === selectedWebsiteCode;
    const item = document.createElement('div');
    item.className = 'ws-item' + (isSelected ? ' active' : '');

    item.innerHTML = `
      <div class="ws-item-info">
        <div class="ws-item-code">${escHtml(code)}</div>
        ${ws.label ? `<div class="ws-item-label">${escHtml(ws.label)}</div>` : ''}
      </div>
      <span class="ws-item-sv-count" title="${ws.storeViews.length} store view(s)">${ws.storeViews.length} SV</span>
      <button class="env-item-delete ws-delete-btn" title="Eliminar website" data-code="${escHtml(code)}">&#x2715;</button>
    `;

    item.addEventListener('click', (e) => {
      if (e.target.closest('.ws-delete-btn')) return;
      selectedWebsiteCode = code;
      renderWsManager();
    });

    item.querySelector('.ws-delete-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      delete websites[code];
      saveWebsites();
      if (selectedWebsiteCode === code) selectedWebsiteCode = null;
      renderWsManager();
    });

    list.appendChild(item);
  });
}

function renderStoreViewPanel() {
  const svList = $('sv-list');
  const svContext = $('sv-website-label');
  const svForm = $('sv-add-form');

  svList.innerHTML = '';

  if (!selectedWebsiteCode) {
    svContext.textContent = 'Selecciona un website para ver sus store views';
    svContext.style.display = 'block';
    svForm.style.display = 'none';
    $('sv-count').textContent = '0';
    return;
  }

  const ws = websites[selectedWebsiteCode];
  svContext.innerHTML = `Store views de <strong>${escHtml(selectedWebsiteCode)}</strong>${ws.label ? ` — ${escHtml(ws.label)}` : ''}`;
  svContext.style.display = 'block';
  svForm.style.display = 'block';
  $('new-sv-code').value = '';

  const views = ws.storeViews || [];
  $('sv-count').textContent = views.length;

  if (views.length === 0) {
    svList.innerHTML = '<div class="ws-empty">Sin store views. Añade una abajo.</div>';
    return;
  }

  views.forEach((view, idx) => {
    const item = document.createElement('div');
    item.className = 'ws-item';
    item.innerHTML = `
      <div class="ws-item-info">
        <div class="ws-item-code">${escHtml(view)}</div>
      </div>
      <button class="env-item-delete sv-delete-btn" title="Eliminar store view" data-idx="${idx}">&#x2715;</button>
    `;

    item.querySelector('.sv-delete-btn').addEventListener('click', () => {
      websites[selectedWebsiteCode].storeViews.splice(idx, 1);
      saveWebsites();
      renderStoreViewPanel();
      $('ws-count'); // update count badge on ws side too
      renderWebsiteList();
    });

    svList.appendChild(item);
  });
}

function addWebsite() {
  const codeInput = $('new-ws-code');
  const labelInput = $('new-ws-label');
  const code = codeInput.value.trim();
  const label = labelInput.value.trim();

  if (!code) {
    showFieldError(codeInput, 'El código es requerido');
    return;
  }
  if (websites[code]) {
    showFieldError(codeInput, 'Ya existe ese website code');
    return;
  }

  websites[code] = { label, storeViews: [] };
  saveWebsites();
  codeInput.value = '';
  labelInput.value = '';
  selectedWebsiteCode = code;
  renderWsManager();
}

function addStoreView() {
  if (!selectedWebsiteCode) return;
  const input = $('new-sv-code');
  const code = input.value.trim();

  if (!code) {
    showFieldError(input, 'El código es requerido');
    return;
  }
  if (websites[selectedWebsiteCode].storeViews.includes(code)) {
    showFieldError(input, 'Ya existe esa store view');
    return;
  }

  websites[selectedWebsiteCode].storeViews.push(code);
  saveWebsites();
  input.value = '';
  renderStoreViewPanel();
  renderWebsiteList();
}

// ===== TABS =====

function initTabs() {
  const tabBtns = document.querySelectorAll('.tab-btn');
  const tabPanels = document.querySelectorAll('.tab-panel');

  tabBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      if (btn.classList.contains('disabled')) return;

      tabBtns.forEach((b) => b.classList.remove('active'));
      tabPanels.forEach((p) => p.classList.remove('active'));

      btn.classList.add('active');
      const target = btn.dataset.tab;
      const panel = document.getElementById('panel-' + target);
      if (panel) panel.classList.add('active');
    });
  });
}

// ===== BUILD HEADERS =====

function buildHeaders() {
  const website = $('website-select').value;
  const storeView = $('store-view-select').value;
  const envId = activeEnvironment ? activeEnvironment.environmentId : '';

  return {
    'Content-Type': 'application/json',
    'Magento-Environment-Id': envId,
    'Magento-Store-Code': website,
    'Magento-Website-Code': website,
    'Magento-store-view-code': storeView,
    'x-api-key': API_KEY,
  };
}

// ===== VALIDATE BEFORE CALL =====

function validateConfig() {
  const errors = [];

  if (!activeEnvironment) {
    errors.push('No hay ningún entorno seleccionado. Añade y selecciona un Environment ID en el panel izquierdo.');
  }

  const website = $('website-select').value;
  if (!website) {
    errors.push('Selecciona un Website Code.');
  }

  const storeView = $('store-view-select').value;
  if (!storeView) {
    errors.push('Selecciona un Store View Code.');
  }

  return errors;
}

// ===== GRAPHQL FETCH =====

async function graphqlFetch(query, variables = {}) {
  const endpoint = getEndpoint();
  const headers = buildHeaders();

  const response = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({ query, variables }),
  });

  const json = await response.json();

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  return json;
}

// ===== PRODUCTS TAB =====

const PRODUCT_SEARCH_QUERY = `
query ProductSearch($phrase: String!) {
  productSearch(phrase: $phrase) {
    items {
      productView {
        sku
        name
        attributes {
          label
          name
          roles
          value
        }
      }
    }
    facets {
      attribute
      title
      type
      buckets {
        title
      }
    }
  }
}
`.trim();

function initProductsTab() {
  const searchBtn = $('btn-product-search');
  const phraseInput = $('product-phrase');

  searchBtn.addEventListener('click', () => runProductSearch());

  phraseInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') runProductSearch();
  });
}

async function runProductSearch() {
  const phrase = $('product-phrase').value.trim();

  // Clear previous results
  $('products-results').innerHTML = '';
  $('products-facets').innerHTML = '';
  $('products-raw-pre').textContent = '';
  $('products-raw-container').style.display = 'none';
  $('products-error').style.display = 'none';
  $('products-loading').classList.remove('visible');
  $('products-initial-state').style.display = 'none';

  // Validate config
  const configErrors = validateConfig();
  if (configErrors.length > 0) {
    showProductError(configErrors.map((e) => `• ${e}`).join('\n'));
    return;
  }

  if (!phrase) {
    showProductError('Introduce un texto en el campo "Phrase" para buscar productos.');
    return;
  }

  // Show loading
  $('products-loading').classList.add('visible');
  $('btn-product-search').disabled = true;

  try {
    const data = await graphqlFetch(PRODUCT_SEARCH_QUERY, { phrase });

    $('products-loading').classList.remove('visible');
    $('btn-product-search').disabled = false;

    // Show raw JSON
    $('products-raw-pre').textContent = JSON.stringify(data, null, 2);
    $('products-raw-container').style.display = 'block';

    if (data.errors && data.errors.length > 0) {
      const msgs = data.errors.map((e) => e.message).join('\n');
      showProductError('Error GraphQL:\n' + msgs);
      return;
    }

    const result = data?.data?.productSearch;
    if (!result) {
      showProductError('La respuesta no contiene datos de productSearch.');
      return;
    }

    renderProducts(result);

  } catch (err) {
    $('products-loading').classList.remove('visible');
    $('btn-product-search').disabled = false;
    showProductError('Error de red o del servidor:\n' + err.message);
  }
}

function showProductError(msg) {
  const el = $('products-error');
  el.style.display = 'flex';
  el.querySelector('.error-text').textContent = msg;
}

function renderProducts(result) {
  const items = result.items || [];
  const facets = result.facets || [];

  // Summary
  const summary = $('products-results-summary');
  if (items.length === 0) {
    summary.innerHTML = '';
    $('products-results').innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">&#x1F50D;</div>
        <p>No se encontraron productos para la búsqueda.</p>
      </div>
    `;
  } else {
    summary.innerHTML = `
      <div class="results-count"><strong>${items.length}</strong> producto${items.length !== 1 ? 's' : ''} encontrado${items.length !== 1 ? 's' : ''}</div>
    `;
    renderProductCards(items);
  }

  // Facets
  renderFacets(facets);
}

function renderProductCards(items) {
  const container = $('products-results');
  const grid = document.createElement('div');
  grid.className = 'product-grid';

  items.forEach((item) => {
    const pv = item.productView;
    if (!pv) return;

    const card = document.createElement('div');
    card.className = 'product-card product-card-clickable';
    card.title = 'Ver detalle del producto';

    const attrsHtml = buildAttrsHtml(pv.attributes || []);

    card.innerHTML = `
      <div class="product-card-header">
        <div class="product-card-info">
          <div class="product-name">${escHtml(pv.name || '—')}</div>
          <div style="margin-top:5px"><span class="product-sku">${escHtml(pv.sku || '—')}</span></div>
        </div>
        <span class="product-card-open-hint">Ver detalle ›</span>
      </div>
      <div class="product-attrs">
        <button class="product-attrs-toggle" type="button">
          <span>Atributos</span>
          <span class="tag tag-info">${(pv.attributes || []).length}</span>
          <span class="attrs-chevron">&#x25BA;</span>
        </button>
        <div class="attrs-body" style="display:none">
          ${attrsHtml}
        </div>
      </div>
    `;

    // Open product modal on card click (but not on the attrs toggle)
    card.addEventListener('click', (e) => {
      if (e.target.closest('.product-attrs-toggle')) return;
      openProductModal(pv);
    });

    // Toggle attributes
    const toggleBtn = card.querySelector('.product-attrs-toggle');
    const attrsBody = card.querySelector('.attrs-body');
    const chevron = card.querySelector('.attrs-chevron');

    toggleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = attrsBody.style.display !== 'none';
      attrsBody.style.display = isOpen ? 'none' : 'block';
      chevron.classList.toggle('open', !isOpen);
    });

    grid.appendChild(card);
  });

  container.appendChild(grid);
}

function buildAttrsHtml(attributes) {
  if (!attributes || attributes.length === 0) {
    return '<p style="font-size:12px;color:var(--color-text-muted);padding:8px 0;">Sin atributos</p>';
  }

  const rows = attributes.map((attr) => {
    const roles = Array.isArray(attr.roles)
      ? attr.roles.map((r) => `<span class="attrs-role">${escHtml(r)}</span>`).join(' ')
      : escHtml(attr.roles || '');

    return `
      <tr>
        <td title="${escHtml(attr.name || '')}">${escHtml(attr.label || attr.name || '—')}</td>
        <td>
          <div>${escHtml(attr.value || '—')}</div>
          ${roles ? `<div style="margin-top:3px">${roles}</div>` : ''}
        </td>
      </tr>
    `;
  }).join('');

  return `<table class="attrs-table"><tbody>${rows}</tbody></table>`;
}

function renderFacets(facets) {
  const container = $('products-facets');

  if (!facets || facets.length === 0) {
    container.innerHTML = '';
    return;
  }

  const titleEl = document.createElement('div');
  titleEl.className = 'section-title';
  titleEl.textContent = `Facets (${facets.length})`;
  container.appendChild(titleEl);

  const grid = document.createElement('div');
  grid.className = 'facets-grid';

  facets.forEach((facet) => {
    const card = document.createElement('div');
    card.className = 'facet-card';

    const buckets = (facet.buckets || []).map((b) =>
      `<span class="facet-bucket">${escHtml(b.title || '—')}</span>`
    ).join('');

    card.innerHTML = `
      <div class="facet-title">${escHtml(facet.title || '—')}</div>
      <div class="facet-attr">${escHtml(facet.attribute || '—')}</div>
      <div><span class="facet-type">${escHtml(facet.type || '—')}</span></div>
      ${buckets ? `<div class="facet-buckets">${buckets}</div>` : ''}
    `;

    grid.appendChild(card);
  });

  container.appendChild(grid);
}

// ===== UTILS =====

function escHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ===== PRODUCT DETAIL MODAL =====

function initProductModal() {
  $('btn-close-product-modal').addEventListener('click', closeProductModal);
  $('product-modal-overlay').addEventListener('click', (e) => {
    if (e.target === $('product-modal-overlay')) closeProductModal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && $('product-modal-overlay').style.display !== 'none') {
      closeProductModal();
    }
  });
}

function openProductModal(pv) {
  $('product-modal-title').textContent = pv.name || pv.sku || 'Detalle del producto';
  $('product-modal-content').innerHTML = buildProductModalContent(pv);
  $('product-modal-overlay').style.display = 'flex';
  document.body.style.overflow = 'hidden';
}

function closeProductModal() {
  $('product-modal-overlay').style.display = 'none';
  document.body.style.overflow = '';
}

function buildProductModalContent(pv) {
  const attrs = pv.attributes || [];

  // Group attributes by role for a richer display
  const attrRows = attrs.map((attr) => {
    const roles = Array.isArray(attr.roles)
      ? attr.roles.map((r) => `<span class="attrs-role">${escHtml(r)}</span>`).join(' ')
      : (attr.roles ? `<span class="attrs-role">${escHtml(attr.roles)}</span>` : '');
    return `
      <tr>
        <td class="pmd-attr-name" title="${escHtml(attr.name || '')}">${escHtml(attr.label || attr.name || '—')}</td>
        <td class="pmd-attr-value">${escHtml(attr.value || '—')}</td>
        <td class="pmd-attr-roles">${roles}</td>
      </tr>
    `;
  }).join('');

  const attrsSection = attrs.length > 0
    ? `
      <div class="pmd-section">
        <div class="pmd-section-title">Atributos <span class="tab-pill">${attrs.length}</span></div>
        <div class="pmd-table-wrap">
          <table class="pmd-attrs-table">
            <thead>
              <tr>
                <th>Label</th>
                <th>Valor</th>
                <th>Roles</th>
              </tr>
            </thead>
            <tbody>${attrRows}</tbody>
          </table>
        </div>
      </div>
    `
    : `<div class="pmd-section"><p class="pmd-empty">Sin atributos disponibles.</p></div>`;

  return `
    <div class="pmd-hero">
      <div class="pmd-hero-main">
        <div class="pmd-name">${escHtml(pv.name || '—')}</div>
        <div class="pmd-sku-row">
          <span class="pmd-sku-label">SKU</span>
          <span class="product-sku">${escHtml(pv.sku || '—')}</span>
        </div>
      </div>
    </div>
    ${attrsSection}
  `;
}

// ===== INIT =====

document.addEventListener('DOMContentLoaded', () => {
  loadWebsites();
  initEnvironmentManager();
  initWebsiteSelector();
  initWebsiteManager();
  initTabs();
  initProductsTab();
  initProductModal();
});
