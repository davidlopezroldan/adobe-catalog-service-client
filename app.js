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
const LS_SETTINGS_KEY = 'catalogService.settings';
const LS_LAST_USED_KEY = 'catalogService.lastUsed';
const LS_FAV_ATTRS_KEY = 'catalogService.favoriteAttributes';

// Default application settings
const DEFAULT_SETTINGS = {
  resultLimit: 500, // productSearch page_size
};

// Last used selections/values, persisted so the panel restores them on reload
const DEFAULT_LAST_USED = {
  environmentId: null,   // activeEnvironment.id
  website: null,         // website code
  storeView: null,       // store view code
  productPhrase: '',     // Products tab phrase
  productSkus: '',       // Products by SKU tab SKUs
  categoryProductId: '', // Category Products tab category id
};

// ===== STATE =====
let environments = [];
let activeEnvironment = null;

// websites: { [code]: { label: string, storeViews: string[] } }
let websites = {};
let selectedWebsiteCode = null; // for the manager modal

// Application settings
let settings = { ...DEFAULT_SETTINGS };

// Last used selections/values
let lastUsed = { ...DEFAULT_LAST_USED };

// ===== DOM REFS =====
const $ = (id) => document.getElementById(id);

// ===== FAVORITE ATTRIBUTES =====

// Attribute names (attr.name) pinned to the top of every attribute list
let favoriteAttributes = new Set();

function loadFavoriteAttributes() {
  try {
    const raw = JSON.parse(localStorage.getItem(LS_FAV_ATTRS_KEY));
    favoriteAttributes = new Set(Array.isArray(raw) ? raw.filter((n) => typeof n === 'string') : []);
  } catch {
    favoriteAttributes = new Set();
  }
}

function saveFavoriteAttributes() {
  localStorage.setItem(LS_FAV_ATTRS_KEY, JSON.stringify([...favoriteAttributes]));
}

function toggleFavoriteAttribute(name) {
  if (favoriteAttributes.has(name)) favoriteAttributes.delete(name);
  else favoriteAttributes.add(name);
  saveFavoriteAttributes();
}

// Renders an attribute value; http(s) URLs become links opened in a new tab
function renderAttrValue(value) {
  const text = value == null ? '' : String(value).trim();
  if (!text) return '—';
  if (/^https?:\/\/\S+$/i.test(text)) {
    const safe = escHtml(text);
    return `<a class="attr-link" href="${safe}" target="_blank" rel="noopener noreferrer">${safe}</a>`;
  }
  return escHtml(String(value));
}

const hasAttrValue = (a) => a.value != null && String(a.value).trim() !== '';

// Favorites first; inside each group attributes with a value come before empty ones.
// The original order is kept within every sub-group.
function sortAttributesByFavorite(attrs) {
  const isFav = (a) => favoriteAttributes.has(a.name);
  return [
    ...attrs.filter((a) => isFav(a) && hasAttrValue(a)),
    ...attrs.filter((a) => isFav(a) && !hasAttrValue(a)),
    ...attrs.filter((a) => !isFav(a) && hasAttrValue(a)),
    ...attrs.filter((a) => !isFav(a) && !hasAttrValue(a)),
  ];
}

function buildFavButton(attr) {
  const isFav = favoriteAttributes.has(attr.name);
  const title = isFav ? 'Quitar de favoritos' : 'Marcar como favorito';
  return `<button type="button" class="attr-fav-btn${isFav ? ' active' : ''}" data-attr="${escHtml(attr.name || '')}" aria-pressed="${isFav}" title="${title}">${isFav ? '&#9733;' : '&#9734;'}</button>`;
}

// Attribute lists rendered inside product cards, to re-render them on favorite changes
const cardAttrsData = new WeakMap(); // .attrs-body element -> attributes[]
let currentModalPv = null;

function refreshAttributeViews() {
  document.querySelectorAll('.attrs-body').forEach((el) => {
    const attrs = cardAttrsData.get(el);
    if (attrs) el.innerHTML = buildAttrsHtml(attrs);
  });
  const modalAttrs = $('pmd-attrs-section');
  if (modalAttrs && currentModalPv) {
    modalAttrs.innerHTML = buildModalAttrsInner(currentModalPv.attributes || []);
  }
}

function initFavoriteAttributes() {
  loadFavoriteAttributes();
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.attr-fav-btn');
    if (!btn) return;
    e.stopPropagation(); // do not open the product modal from a card
    toggleFavoriteAttribute(btn.dataset.attr);
    refreshAttributeViews();
  });
}

// ===== LAST USED LOCAL STORAGE =====

function loadLastUsed() {
  try {
    const raw = localStorage.getItem(LS_LAST_USED_KEY);
    lastUsed = raw ? { ...DEFAULT_LAST_USED, ...JSON.parse(raw) } : { ...DEFAULT_LAST_USED };
  } catch {
    lastUsed = { ...DEFAULT_LAST_USED };
  }
}

function saveLastUsed() {
  localStorage.setItem(LS_LAST_USED_KEY, JSON.stringify(lastUsed));
}

// Update one key and persist
function setLastUsed(key, value) {
  lastUsed[key] = value;
  saveLastUsed();
}

// ===== SETTINGS LOCAL STORAGE =====

function loadSettings() {
  try {
    const raw = localStorage.getItem(LS_SETTINGS_KEY);
    settings = raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : { ...DEFAULT_SETTINGS };
  } catch {
    settings = { ...DEFAULT_SETTINGS };
  }
}

function saveSettings() {
  localStorage.setItem(LS_SETTINGS_KEY, JSON.stringify(settings));
}

// Returns a valid positive integer page_size, falling back to the default
function getResultLimit() {
  const n = parseInt(settings.resultLimit, 10);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_SETTINGS.resultLimit;
  return n;
}

// ===== SETTINGS MODAL =====

function initSettings() {
  loadSettings();

  $('btn-open-settings').addEventListener('click', openSettingsModal);
  $('btn-close-settings').addEventListener('click', closeSettingsModal);
  $('settings-modal-overlay').addEventListener('click', (e) => {
    if (e.target === $('settings-modal-overlay')) closeSettingsModal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && $('settings-modal-overlay').style.display !== 'none') {
      closeSettingsModal();
    }
  });

  $('btn-save-settings').addEventListener('click', () => {
    const input = $('setting-result-limit');
    const val = parseInt(input.value, 10);
    if (!Number.isFinite(val) || val < 1 || val > 10000) {
      input.style.borderColor = 'var(--color-error)';
      input.focus();
      setTimeout(() => { input.style.borderColor = ''; }, 2000);
      return;
    }
    settings.resultLimit = val;
    saveSettings();
    closeSettingsModal();
  });

  $('btn-reset-settings').addEventListener('click', () => {
    settings = { ...DEFAULT_SETTINGS };
    saveSettings();
    fillSettingsForm();
  });

  // Export / import configuration
  $('btn-export-config').addEventListener('click', exportConfig);
  $('btn-import-config').addEventListener('click', () => $('import-config-file').click());
  $('import-config-file').addEventListener('change', handleImportFile);
}

function fillSettingsForm() {
  $('setting-result-limit').value = getResultLimit();
}

function openSettingsModal() {
  fillSettingsForm();
  const msg = $('config-io-message');
  if (msg) { msg.style.display = 'none'; msg.textContent = ''; }
  $('settings-modal-overlay').style.display = 'flex';
  document.body.style.overflow = 'hidden';
}

function closeSettingsModal() {
  $('settings-modal-overlay').style.display = 'none';
  document.body.style.overflow = '';
}

// ===== CONFIG EXPORT / IMPORT =====

const CONFIG_EXPORT_VERSION = 1;

function exportConfig() {
  // Ask for the file name before exporting
  const defaultName = `catalog-service-config-${new Date().toISOString().slice(0, 10)}`;
  let name = window.prompt('Nombre del archivo de configuración:', defaultName);
  if (name === null) return; // cancelled
  name = name.trim();
  if (!name) name = defaultName;
  if (!name.toLowerCase().endsWith('.json')) name += '.json';

  const payload = {
    app: 'adobe-catalog-service-panel',
    version: CONFIG_EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    data: {
      environments: safeParse(localStorage.getItem(LS_KEY), []),
      websites: safeParse(localStorage.getItem(LS_WS_KEY), {}),
      settings: safeParse(localStorage.getItem(LS_SETTINGS_KEY), DEFAULT_SETTINGS),
      lastUsed: safeParse(localStorage.getItem(LS_LAST_USED_KEY), DEFAULT_LAST_USED),
      favoriteAttributes: safeParse(localStorage.getItem(LS_FAV_ATTRS_KEY), []),
    },
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  showConfigIoMessage('success', `Configuración exportada como "${name}".`);
}

function handleImportFile(e) {
  const file = e.target.files && e.target.files[0];
  // Allow re-importing the same file later
  e.target.value = '';
  if (!file) return;

  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(reader.result);
      applyImportedConfig(parsed);
    } catch (err) {
      showConfigIoMessage('error', 'El archivo no es un JSON válido.');
    }
  };
  reader.onerror = () => showConfigIoMessage('error', 'No se pudo leer el archivo.');
  reader.readAsText(file);
}

function applyImportedConfig(parsed) {
  // Accept either the wrapped format ({ data: {...} }) or a raw {environments,websites,settings}
  const data = parsed && parsed.data ? parsed.data : parsed;

  if (!data || typeof data !== 'object') {
    showConfigIoMessage('error', 'El archivo no contiene una configuración válida.');
    return;
  }

  const hasAny = ['environments', 'websites', 'settings', 'lastUsed', 'favoriteAttributes'].some((k) => k in data);
  if (!hasAny) {
    showConfigIoMessage('error', 'El archivo no contiene datos de configuración reconocibles.');
    return;
  }

  if (!window.confirm('Importar esta configuración reemplazará tus entornos, websites/store views y ajustes actuales. ¿Continuar?')) {
    return;
  }

  // Persist each section if present
  if ('environments' in data && Array.isArray(data.environments)) {
    localStorage.setItem(LS_KEY, JSON.stringify(data.environments));
  }
  if ('websites' in data && data.websites && typeof data.websites === 'object') {
    localStorage.setItem(LS_WS_KEY, JSON.stringify(data.websites));
  }
  if ('settings' in data && data.settings && typeof data.settings === 'object') {
    localStorage.setItem(LS_SETTINGS_KEY, JSON.stringify(data.settings));
  }
  if ('lastUsed' in data && data.lastUsed && typeof data.lastUsed === 'object') {
    localStorage.setItem(LS_LAST_USED_KEY, JSON.stringify(data.lastUsed));
  }
  if ('favoriteAttributes' in data && Array.isArray(data.favoriteAttributes)) {
    localStorage.setItem(LS_FAV_ATTRS_KEY, JSON.stringify(data.favoriteAttributes));
  }

  // Reload in-memory state from storage
  loadSettings();
  loadLastUsed();
  loadFavoriteAttributes();
  refreshAttributeViews();
  loadEnvironments();
  loadWebsites();

  // Refresh the whole UI to reflect the imported config
  activeEnvironment = null;
  selectedWebsiteCode = null;
  renderEnvironments();
  // Clear current DOM selections so the imported lastUsed takes effect
  $('website-select').value = '';
  $('store-view-select').value = '';
  populateSidebarWebsites();
  fillSettingsForm();

  // Restore last-used input values
  $('product-phrase').value = lastUsed.productPhrase || '';
  $('psku-skus').value = lastUsed.productSkus || '';
  $('cat-products-id').value = lastUsed.categoryProductId || '';

  showConfigIoMessage('success', 'Configuración importada correctamente.');
}

function safeParse(raw, fallback) {
  try {
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function showConfigIoMessage(type, msg) {
  const el = $('config-io-message');
  el.style.display = 'block';
  el.className = 'settings-io-message ' + type;
  el.textContent = msg;
}

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

// Internal id of the environment being edited (null when adding a new one)
let editingEnvId = null;

function resetEnvForm() {
  editingEnvId = null;
  $('new-env-label').value = '';
  $('new-env-id').value = '';
  $('new-env-type').value = 'staging';
  $('env-add-form').classList.remove('visible');
  $('btn-add-env').textContent = '+ Añadir entorno';
  $('btn-save-env').textContent = 'Guardar entorno';
}

function startEditEnvironment(env) {
  editingEnvId = env.id;
  $('new-env-label').value = env.label;
  $('new-env-id').value = env.environmentId;
  $('new-env-type').value = env.type === 'production' ? 'production' : 'staging';
  $('env-add-form').classList.add('visible');
  $('btn-add-env').textContent = '✕ Cancelar';
  $('btn-save-env').textContent = 'Guardar cambios';
  $('new-env-label').focus();
}

function renderEnvironments() {
  // Alphabetical by label (in place, so the delete index below stays consistent)
  environments.sort((a, b) => a.label.localeCompare(b.label, 'es', { sensitivity: 'base' }));

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
      <div class="env-item-main">
        <div class="env-item-meta">
          ${typeBadge}
          <div class="env-item-label" title="${escHtml(env.label)}">${escHtml(env.label)}</div>
        </div>
        <div class="env-item-id" title="${escHtml(env.environmentId)}">${escHtml(env.environmentId)}</div>
      </div>
      <button class="env-item-edit" title="Editar entorno">&#x270E;</button>
      <button class="env-item-delete" title="Eliminar entorno" data-index="${index}">&#x2715;</button>
    `;

    // Click to select
    item.addEventListener('click', (e) => {
      if (e.target.closest('.env-item-delete, .env-item-edit')) return;
      if (activeEnvironment !== env) resetFacetContext();
      activeEnvironment = env;
      setLastUsed('environmentId', env.id);
      renderEnvironments();
      updateActiveEnvDisplay();
    });

    // Edit button
    item.querySelector('.env-item-edit').addEventListener('click', (e) => {
      e.stopPropagation();
      startEditEnvironment(env);
    });

    // Delete button
    item.querySelector('.env-item-delete').addEventListener('click', (e) => {
      e.stopPropagation();
      if (activeEnvironment && activeEnvironment.id === env.id) {
        activeEnvironment = null;
      }
      if (editingEnvId === env.id) resetEnvForm();
      environments.splice(index, 1);
      saveEnvironments();
      renderEnvironments();
      updateActiveEnvDisplay();
    });

    list.appendChild(item);
  });

  // Select last-used environment if available, otherwise the first one
  if (!activeEnvironment && environments.length > 0) {
    const remembered = lastUsed.environmentId
      ? environments.find((e) => e.id === lastUsed.environmentId)
      : null;
    activeEnvironment = remembered || environments[0];
    if (activeEnvironment.id !== lastUsed.environmentId) {
      setLastUsed('environmentId', activeEnvironment.id);
    }
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
      <div style="display:flex;align-items:center;gap:6px;margin:3px 0">${typeBadge}<div class="name" style="margin:0">${escHtml(activeEnvironment.label)}</div></div>
      <div class="eid">${escHtml(activeEnvironment.environmentId)}</div>
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
    if (form.classList.contains('visible')) {
      resetEnvForm(); // cancel (also discards an edit in progress)
    } else {
      form.classList.add('visible');
      $('new-env-label').focus();
      $('btn-add-env').textContent = '✕ Cancelar';
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

    if (editingEnvId) {
      // Update in place so activeEnvironment (same object) stays selected
      const env = environments.find((e) => e.id === editingEnvId);
      if (env) {
        env.label = label;
        env.environmentId = envId;
        env.type = type;
        saveEnvironments();
      }
      resetEnvForm();
      renderEnvironments();
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

    resetEnvForm();

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
  const storeViewSelect = $('store-view-select');

  websiteSelect.addEventListener('change', () => {
    setLastUsed('website', websiteSelect.value);
    populateSidebarStoreViews(websiteSelect.value);
    resetFacetContext();
  });

  storeViewSelect.addEventListener('change', () => {
    setLastUsed('storeView', storeViewSelect.value);
    resetFacetContext();
  });

  populateSidebarWebsites();
}

function populateSidebarWebsites() {
  const websiteSelect = $('website-select');
  // Prefer the current DOM value, fall back to the last-used website
  const previousValue = websiteSelect.value || lastUsed.website || '';
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

  // Restore previous/last-used selection if it still exists
  if (previousValue && websites[previousValue]) {
    websiteSelect.value = previousValue;
  }

  // Keep lastUsed in sync with the effective selection
  if (websiteSelect.value) setLastUsed('website', websiteSelect.value);

  populateSidebarStoreViews(websiteSelect.value);
}

function populateSidebarStoreViews(websiteCode) {
  const storeViewSelect = $('store-view-select');
  // Prefer the current DOM value, fall back to the last-used store view
  const previousValue = storeViewSelect.value || lastUsed.storeView || '';
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

  // Keep lastUsed in sync with the effective selection
  if (storeViewSelect.value) setLastUsed('storeView', storeViewSelect.value);
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
  $('btn-cancel-ws-edit').addEventListener('click', resetWsForm);
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
  resetWsForm();
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

// Website code being edited (null when adding a new website). The code is the key, so only the label is editable.
let editingWsCode = null;

function resetWsForm() {
  editingWsCode = null;
  $('new-ws-code').value = '';
  $('new-ws-code').disabled = false;
  $('new-ws-label').value = '';
  $('btn-save-ws').textContent = 'Añadir website';
  $('btn-cancel-ws-edit').style.display = 'none';
}

function startEditWebsite(code) {
  editingWsCode = code;
  $('new-ws-code').value = code;
  $('new-ws-code').disabled = true;
  $('new-ws-label').value = websites[code].label || '';
  $('btn-save-ws').textContent = 'Guardar label';
  $('btn-cancel-ws-edit').style.display = 'block';
  $('new-ws-label').focus();
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
      <button class="env-item-edit ws-edit-btn" title="Editar label">&#x270E;</button>
      <button class="env-item-delete ws-delete-btn" title="Eliminar website" data-code="${escHtml(code)}">&#x2715;</button>
    `;

    item.addEventListener('click', (e) => {
      if (e.target.closest('.ws-delete-btn, .ws-edit-btn')) return;
      selectedWebsiteCode = code;
      renderWsManager();
    });

    item.querySelector('.ws-edit-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      startEditWebsite(code);
    });

    item.querySelector('.ws-delete-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      if (editingWsCode === code) resetWsForm();
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

  if (editingWsCode) {
    if (websites[editingWsCode]) {
      websites[editingWsCode].label = label;
      saveWebsites();
    }
    resetWsForm();
    renderWsManager();
    populateSidebarWebsites(); // refresh the sidebar selector with the new label
    return;
  }

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

function activateTab(tabName, updateHash = true) {
  const btn = document.querySelector(`.tab-btn[data-tab="${tabName}"]`);
  // Ignore unknown or disabled tabs
  if (!btn || btn.classList.contains('disabled')) return;

  const tabBtns = document.querySelectorAll('.tab-btn');
  const tabPanels = document.querySelectorAll('.tab-panel');

  tabBtns.forEach((b) => b.classList.remove('active'));
  tabPanels.forEach((p) => p.classList.remove('active'));

  btn.classList.add('active');
  const panel = document.getElementById('panel-' + tabName);
  if (panel) panel.classList.add('active');

  if (updateHash && location.hash !== `#${tabName}`) {
    location.hash = tabName;
  }
}

function initTabs() {
  const tabBtns = document.querySelectorAll('.tab-btn');

  tabBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      if (btn.classList.contains('disabled')) return;
      activateTab(btn.dataset.tab);
    });
  });

  // Sync with browser navigation (back/forward, manual hash edits)
  window.addEventListener('hashchange', () => {
    const tab = location.hash.replace(/^#/, '');
    if (tab) activateTab(tab, false);
  });

  // Activate the tab from the current URL hash on load
  const initialTab = location.hash.replace(/^#/, '');
  if (initialTab && document.querySelector(`.tab-btn[data-tab="${initialTab}"]:not(.disabled)`)) {
    activateTab(initialTab, false);
  }
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

// Formats the GraphQL payload sent to the API for display purposes
function formatSentQuery(query, variables) {
  const vars = JSON.stringify(variables, null, 2);
  return `# Query\n${query}\n\n# Variables\n${vars}`;
}

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

// ===== PAGINATION (shared) =====

// Builds pagination controls into `container`.
// pageInfo: { current_page, total_pages }
// onGo: function(page) called when the user picks a page
function renderPagination(container, pageInfo, totalCount, onGo) {
  container.innerHTML = '';

  const current = pageInfo && pageInfo.current_page ? pageInfo.current_page : 1;
  const totalPages = pageInfo && pageInfo.total_pages ? pageInfo.total_pages : 1;

  if (totalPages <= 1) {
    container.style.display = 'none';
    return;
  }
  container.style.display = 'flex';

  const makeBtn = (label, page, opts = {}) => {
    const btn = document.createElement('button');
    btn.className = 'page-btn' + (opts.active ? ' active' : '') + (opts.ellipsis ? ' page-ellipsis' : '');
    btn.innerHTML = label;
    if (opts.disabled || opts.ellipsis) {
      btn.disabled = true;
    } else {
      btn.addEventListener('click', () => onGo(page));
    }
    return btn;
  };

  // Prev
  container.appendChild(makeBtn(
    '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15 18 9 12 15 6"/></svg>',
    current - 1,
    { disabled: current <= 1 }
  ));

  // Page numbers with ellipsis (window around current)
  const pages = computePageList(current, totalPages);
  pages.forEach((p) => {
    if (p === '...') {
      container.appendChild(makeBtn('&hellip;', null, { ellipsis: true }));
    } else {
      container.appendChild(makeBtn(String(p), p, { active: p === current }));
    }
  });

  // Next
  container.appendChild(makeBtn(
    '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>',
    current + 1,
    { disabled: current >= totalPages }
  ));

  // Info label
  const info = document.createElement('span');
  info.className = 'page-info-label';
  info.textContent = `Página ${current} de ${totalPages}${totalCount != null ? ` · ${totalCount} resultados` : ''}`;
  container.appendChild(info);
}

// Returns an array like [1, '...', 4, 5, 6, '...', 20]
function computePageList(current, totalPages) {
  const delta = 2;
  const range = [];
  const result = [];
  let last;

  for (let i = 1; i <= totalPages; i++) {
    if (i === 1 || i === totalPages || (i >= current - delta && i <= current + delta)) {
      range.push(i);
    }
  }

  range.forEach((i) => {
    if (last) {
      if (i - last === 2) {
        result.push(last + 1);
      } else if (i - last > 2) {
        result.push('...');
      }
    }
    result.push(i);
    last = i;
  });

  return result;
}

// ===== PRODUCTS TAB =====

const PRODUCT_SEARCH_QUERY = `
query ProductSearch($phrase: String!, $pageSize: Int, $currentPage: Int, $filter: [SearchClauseInput!]) {
  productSearch(phrase: $phrase, page_size: $pageSize, current_page: $currentPage, filter: $filter) {
    total_count
    page_info {
      current_page
      page_size
      total_pages
    }
    items {
      productView {
        __typename
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
        __typename
        title
        ... on ScalarBucket {
          id
          count
        }
        ... on RangeBucket {
          from
          to
          count
        }
      }
    }
  }
}
`.trim();

// ===== ATTRIBUTE METADATA (cached per environment / website / store view) =====

const ATTRIBUTE_METADATA_QUERY = `
{
  attributeMetadata {
    filterableInSearch {
      attribute
      frontendInput
      label
      numeric
    }
    sortable {
      attribute
      frontendInput
      label
      numeric
    }
  }
}
`.trim();

// Map<contextKey, Promise<{filterable:Set<string>, sortable:Set<string>} | null>>
const attributeMetadataCache = new Map();

function getContextKey() {
  const envId = activeEnvironment ? activeEnvironment.environmentId : '';
  return `${envId}|${$('website-select').value}|${$('store-view-select').value}`;
}

// Resolves to null when the metadata cannot be loaded, so callers can degrade gracefully
function getAttributeMetadata() {
  const key = getContextKey();
  if (!attributeMetadataCache.has(key)) {
    const promise = graphqlFetch(ATTRIBUTE_METADATA_QUERY)
      .then((data) => {
        const meta = data?.data?.attributeMetadata;
        if (!meta) throw new Error('La respuesta no contiene attributeMetadata');
        const names = (list) => new Set((list || []).map((a) => a.attribute));
        return { filterable: names(meta.filterableInSearch), sortable: names(meta.sortable) };
      })
      .catch((err) => {
        console.warn('No se pudo cargar attributeMetadata:', err.message);
        attributeMetadataCache.delete(key);
        return null;
      });
    attributeMetadataCache.set(key, promise);
  }
  return attributeMetadataCache.get(key);
}

// ===== FACET FILTERS =====

// Map<attribute, {kind:'scalar'|'range', title, entries: Map<key,{label, value}>}>
// OR within an attribute, AND between attributes
const activeFacetFilters = new Map();

function buildSearchFilter() {
  const filter = [];
  activeFacetFilters.forEach((state, attribute) => {
    const values = [...state.entries.values()].map((e) => e.value);
    if (values.length === 0) return;
    if (state.kind === 'range') {
      const { from, to } = values[0];
      const range = {};
      if (from != null) range.from = from;
      if (to != null) range.to = to;
      filter.push({ attribute, range });
    } else {
      filter.push({ attribute, in: values });
    }
  });
  return filter;
}

function toggleFacetBucket(btn) {
  const { attribute, kind, facetTitle, label, value, from, to } = btn.dataset;
  const key = kind === 'range' ? `${from}-${to}` : value;
  let state = activeFacetFilters.get(attribute);

  if (state && state.entries.has(key)) {
    state.entries.delete(key);
    if (state.entries.size === 0) activeFacetFilters.delete(attribute);
  } else {
    if (!state || state.kind !== kind) {
      state = { kind, title: facetTitle, entries: new Map() };
      activeFacetFilters.set(attribute, state);
    }
    // A range facet only supports one range at a time
    if (kind === 'range') state.entries.clear();
    const parseBound = (v) => (v === '' || v == null ? null : Number(v));
    state.entries.set(key, {
      label,
      value: kind === 'range' ? { from: parseBound(from), to: parseBound(to) } : value,
    });
  }

  runProductSearch(1, true);
}

function removeFacetFilter(attribute, key) {
  const state = activeFacetFilters.get(attribute);
  if (!state) return;
  state.entries.delete(key);
  if (state.entries.size === 0) activeFacetFilters.delete(attribute);
  runProductSearch(1, true);
}

function isFacetBucketActive(attribute, key) {
  const state = activeFacetFilters.get(attribute);
  return !!state && state.entries.has(key);
}

// Context changed (environment, website or store view): filters, facets and metadata are no longer valid
function resetFacetContext() {
  activeFacetFilters.clear();
  attributeMetadataCache.clear();
  const facets = $('products-facets');
  const chips = $('products-active-filters');
  if (facets) facets.innerHTML = '';
  if (chips) chips.innerHTML = '';
  updateFilterButton();
}

function renderActiveFilters() {
  const container = $('products-active-filters');
  container.innerHTML = '';
  updateFilterButton();
  if (activeFacetFilters.size === 0) return;

  const chips = [];
  activeFacetFilters.forEach((state, attribute) => {
    state.entries.forEach((entry, key) => {
      chips.push(`
        <span class="filter-chip">
          <span class="filter-chip-facet">${escHtml(state.title || attribute)}:</span>
          ${escHtml(entry.label)}
          <button type="button" class="filter-chip-remove" title="Quitar filtro"
            data-attribute="${escHtml(attribute)}" data-key="${escHtml(key)}">&#x2715;</button>
        </span>
      `);
    });
  });

  container.innerHTML = `
    <div class="section-title">Filtros aplicados</div>
    <div class="active-filters">
      ${chips.join('')}
      <button type="button" class="filter-clear-all">Limpiar todo</button>
    </div>
  `;
}

function openFacetModal() {
  $('facet-modal-overlay').style.display = 'flex';
  document.body.style.overflow = 'hidden';
}

function closeFacetModal() {
  $('facet-modal-overlay').style.display = 'none';
  document.body.style.overflow = '';
}

// The "Filtrar" button needs facets (or applied filters) to be useful and shows how many values are applied
function updateFilterButton() {
  let applied = 0;
  activeFacetFilters.forEach((state) => { applied += state.entries.size; });
  const hasFacets = $('products-facets').children.length > 0;

  $('btn-product-filter').disabled = !hasFacets && applied === 0;
  $('btn-product-filter').title = hasFacets || applied > 0 ? '' : 'Realiza una búsqueda para ver los facets';

  const badge = $('product-filter-count');
  badge.textContent = applied;
  badge.style.display = applied > 0 ? 'inline-block' : 'none';
}

function initFacetFilters() {
  $('btn-product-filter').addEventListener('click', openFacetModal);
  $('btn-close-facet-modal').addEventListener('click', closeFacetModal);
  $('facet-modal-overlay').addEventListener('click', (e) => {
    if (e.target === $('facet-modal-overlay')) closeFacetModal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && $('facet-modal-overlay').style.display !== 'none') closeFacetModal();
  });

  $('products-active-filters').addEventListener('click', (e) => {
    const remove = e.target.closest('.filter-chip-remove');
    if (remove) {
      removeFacetFilter(remove.dataset.attribute, remove.dataset.key);
      return;
    }
    if (e.target.closest('.filter-clear-all')) {
      activeFacetFilters.clear();
      runProductSearch(1, true);
    }
  });

  $('products-facets').addEventListener('click', (e) => {
    const btn = e.target.closest('button.facet-bucket');
    if (btn && !btn.disabled) toggleFacetBucket(btn);
  });
}

function initProductsTab() {
  initFacetFilters();

  const searchBtn = $('btn-product-search');
  const phraseInput = $('product-phrase');

  // Restore last used phrase
  if (lastUsed.productPhrase) {
    phraseInput.value = lastUsed.productPhrase;
  }

  searchBtn.addEventListener('click', () => runProductSearch(1));

  phraseInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') runProductSearch(1);
  });
}

// Keeps the phrase used for the active search so pagination reuses it
let currentProductPhrase = '';

// keepState: reuse the stored phrase and facet filters (pagination, facet clicks)
async function runProductSearch(page = 1, keepState = false) {
  // On a fresh search (triggered by the user) read the input and drop the filters;
  // otherwise reuse the stored phrase.
  if (page === 1 && !keepState) {
    currentProductPhrase = $('product-phrase').value.trim();
    setLastUsed('productPhrase', currentProductPhrase);
    activeFacetFilters.clear();
  }
  const phrase = currentProductPhrase;

  // Clear previous results
  $('products-results').innerHTML = '';
  // Keep the facets while the modal is open (facet clicks, pagination); renderFacets replaces them
  if (!keepState) $('products-facets').innerHTML = '';
  renderActiveFilters();
  $('products-pagination').innerHTML = '';
  $('products-pagination').style.display = 'none';
  $('products-raw-pre').textContent = '';
  $('products-raw-container').style.display = 'none';
  $('products-query-pre').textContent = '';
  $('products-query-container').style.display = 'none';
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

  const variables = { phrase, pageSize: getResultLimit(), currentPage: page };
  const filter = buildSearchFilter();
  if (filter.length > 0) variables.filter = filter;

  // Metadata loads once per context and never rejects (null on failure)
  const metadataPromise = getAttributeMetadata();

  try {
    const data = await graphqlFetch(PRODUCT_SEARCH_QUERY, variables);
    const metadata = await metadataPromise;

    $('products-loading').classList.remove('visible');
    $('btn-product-search').disabled = false;

    // Show raw JSON
    $('products-raw-pre').textContent = JSON.stringify(data, null, 2);
    $('products-raw-container').style.display = 'block';

    // Show sent query
    $('products-query-pre').textContent = formatSentQuery(PRODUCT_SEARCH_QUERY, variables);
    $('products-query-container').style.display = 'block';

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

    renderProducts(result, metadata);

    // Scroll results back to top on page change
    const area = $('products-results').closest('.results-area');
    if (area) area.scrollTop = 0;

  } catch (err) {
    $('products-loading').classList.remove('visible');
    $('btn-product-search').disabled = false;
    showProductError('Error de red o del servidor:\n' + err.message);
  }
}

// ===== PRODUCTS BY SKU TAB (products endpoint) =====

const PRODUCTS_BY_SKU_QUERY = `query Products($skus: [String]!) {
  products(skus: $skus) {
    __typename
    sku
    name
    attributes {
      label
      name
      roles
      value
    }
  }
}`;

function initProductsBySkuTab() {
  const searchBtn = $('btn-psku-search');
  const skusInput = $('psku-skus');

  if (lastUsed.productSkus) {
    skusInput.value = lastUsed.productSkus;
  }

  searchBtn.addEventListener('click', runProductsBySku);

  skusInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') runProductsBySku();
  });
}

function showProductsBySkuError(msg) {
  const el = $('psku-error');
  el.style.display = 'flex';
  el.querySelector('.error-text').textContent = msg;
}

async function runProductsBySku() {
  const raw = $('psku-skus').value.trim();
  setLastUsed('productSkus', raw);
  const skus = [...new Set(raw.split(/[\s,;]+/).filter(Boolean))];

  // Clear previous results
  $('psku-results').innerHTML = '';
  $('psku-results-summary').innerHTML = '';
  $('psku-raw-pre').textContent = '';
  $('psku-raw-container').style.display = 'none';
  $('psku-query-pre').textContent = '';
  $('psku-query-container').style.display = 'none';
  $('psku-error').style.display = 'none';
  $('psku-loading').classList.remove('visible');
  $('psku-initial-state').style.display = 'none';

  const configErrors = validateConfig();
  if (configErrors.length > 0) {
    showProductsBySkuError(configErrors.map((e) => `• ${e}`).join('\n'));
    return;
  }

  if (skus.length === 0) {
    showProductsBySkuError('Introduce al menos un SKU en el campo "SKUs".');
    return;
  }

  $('psku-loading').classList.add('visible');
  $('btn-psku-search').disabled = true;

  const variables = { skus };

  try {
    const data = await graphqlFetch(PRODUCTS_BY_SKU_QUERY, variables);

    $('psku-loading').classList.remove('visible');
    $('btn-psku-search').disabled = false;

    $('psku-raw-pre').textContent = JSON.stringify(data, null, 2);
    $('psku-raw-container').style.display = 'block';

    $('psku-query-pre').textContent = formatSentQuery(PRODUCTS_BY_SKU_QUERY, variables);
    $('psku-query-container').style.display = 'block';

    if (data.errors && data.errors.length > 0) {
      showProductsBySkuError('Error GraphQL:\n' + data.errors.map((e) => e.message).join('\n'));
      return;
    }

    const products = data?.data?.products;
    if (!products) {
      showProductsBySkuError('La respuesta no contiene datos de products.');
      return;
    }

    renderProductsBySku(products.filter(Boolean), skus);
  } catch (err) {
    $('psku-loading').classList.remove('visible');
    $('btn-psku-search').disabled = false;
    showProductsBySkuError('Error de red o del servidor:\n' + err.message);
  }
}

function renderProductsBySku(products, requestedSkus) {
  const summary = $('psku-results-summary');

  if (products.length === 0) {
    summary.innerHTML = '';
    $('psku-results').innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">&#x1F50D;</div>
        <p>No se encontraron productos para los SKUs indicados.</p>
      </div>
    `;
    return;
  }

  const found = new Set(products.map((p) => (p.sku || '').toLowerCase()));
  const missing = requestedSkus.filter((s) => !found.has(s.toLowerCase()));

  summary.innerHTML = `
    <div class="results-count"><strong>${products.length}</strong> producto${products.length !== 1 ? 's' : ''} de ${requestedSkus.length} SKU${requestedSkus.length !== 1 ? 's' : ''} solicitado${requestedSkus.length !== 1 ? 's' : ''}${
      missing.length ? ` · no encontrados: ${escHtml(missing.join(', '))}` : ''
    }</div>
  `;
  renderProductCards(products.map((productView) => ({ productView })), 'psku-results');
}

function showProductError(msg) {
  const el = $('products-error');
  el.style.display = 'flex';
  el.querySelector('.error-text').textContent = msg;
  // Stale facets would not match the failed search
  $('products-facets').innerHTML = '';
  updateFilterButton();
}

function renderProducts(result, metadata = null) {
  const items = result.items || [];
  const facets = result.facets || [];
  const total = result.total_count != null ? result.total_count : items.length;
  const pageInfo = result.page_info || { current_page: 1, total_pages: 1, page_size: getResultLimit() };

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
    $('products-pagination').style.display = 'none';
  } else {
    const pageSize = pageInfo.page_size || getResultLimit();
    const from = (pageInfo.current_page - 1) * pageSize + 1;
    const to = from + items.length - 1;
    summary.innerHTML = `
      <div class="results-count"><strong>${total}</strong> producto${total !== 1 ? 's' : ''} en total · mostrando ${from}–${to}</div>
    `;
    renderProductCards(items);
    renderPagination($('products-pagination'), pageInfo, total, (p) => runProductSearch(p, true));
  }

  // Facets
  renderFacets(facets, metadata);
}

function renderProductCards(items, containerId = 'products-results') {
  const container = $(containerId);
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
          <div style="margin-top:5px"><span class="product-sku">${escHtml(pv.sku || '—')}</span> ${buildProductTypeBadge(pv)}</div>
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
      if (e.target.closest('.product-attrs-toggle, .attr-fav-btn, .attr-link')) return;
      openProductModal(pv);
    });

    // Toggle attributes
    const toggleBtn = card.querySelector('.product-attrs-toggle');
    const attrsBody = card.querySelector('.attrs-body');
    cardAttrsData.set(attrsBody, pv.attributes || []);
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

  const rows = sortAttributesByFavorite(attributes).map((attr) => {
    const roles = Array.isArray(attr.roles)
      ? attr.roles.map((r) => `<span class="attrs-role">${escHtml(r)}</span>`).join(' ')
      : escHtml(attr.roles || '');

    return `
      <tr>
        <td title="${escHtml(attr.name || '')}">${buildFavButton(attr)}${escHtml(attr.label || attr.name || '—')}</td>
        <td>
          <div>${renderAttrValue(attr.value)}</div>
          ${roles ? `<div style="margin-top:3px">${roles}</div>` : ''}
        </td>
      </tr>
    `;
  }).join('');

  return `<table class="attrs-table"><tbody>${rows}</tbody></table>`;
}

// metadata: result of getAttributeMetadata(); when null every scalar/range bucket stays clickable
function renderFacets(facets, metadata = null) {
  const container = $('products-facets');
  container.innerHTML = '';

  if (!facets || facets.length === 0) {
    updateFilterButton();
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

    const facetFilterable = !metadata || metadata.filterable.has(facet.attribute);

    const buckets = (facet.buckets || []).map((b) => {
      const isRange = b.__typename === 'RangeBucket';
      const isScalar = b.__typename === 'ScalarBucket';
      const label = b.title || (isRange ? `${b.from ?? ''}–${b.to ?? ''}` : '—');
      const count = b.count != null ? ` <span class="facet-bucket-count">(${escHtml(String(b.count))})</span>` : '';

      // Stats / category buckets cannot be filtered directly
      if (!(isScalar || isRange)) {
        return `<span class="facet-bucket">${escHtml(label)}${count}</span>`;
      }

      const key = isRange ? `${b.from ?? ''}-${b.to ?? ''}` : String(b.id);
      const active = isFacetBucketActive(facet.attribute, key);
      const classes = `facet-bucket facet-bucket-btn${active ? ' active' : ''}${facetFilterable ? '' : ' facet-disabled'}`;
      const data = [
        `data-attribute="${escHtml(facet.attribute)}"`,
        `data-facet-title="${escHtml(facet.title || facet.attribute)}"`,
        `data-label="${escHtml(label)}"`,
        `data-kind="${isRange ? 'range' : 'scalar'}"`,
        isRange
          ? `data-from="${escHtml(String(b.from ?? ''))}" data-to="${escHtml(String(b.to ?? ''))}"`
          : `data-value="${escHtml(String(b.id))}"`,
      ].join(' ');
      const title = facetFilterable ? '' : ' title="No filtrable en este contexto"';

      return `<button type="button" class="${classes}" ${data}${title}${facetFilterable ? '' : ' disabled'}>${escHtml(label)}${count}</button>`;
    }).join('');

    card.innerHTML = `
      <div class="facet-title">${escHtml(facet.title || '—')}</div>
      <div class="facet-attr">${escHtml(facet.attribute || '—')}</div>
      <div><span class="facet-type">${escHtml(facet.type || '—')}</span></div>
      ${buckets ? `<div class="facet-buckets">${buckets}</div>` : ''}
    `;

    grid.appendChild(card);
  });

  container.appendChild(grid);
  updateFilterButton();
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

// ===== CATEGORIES TAB =====

const CATEGORIES_QUERY = `
query Categories($ids: [String!]!) {
  categories(
    subtree: { depth: 0, startLevel: 5 }
    ids: $ids
    roles: ["active"]
  ) {
    id
    name
    position
    path
    urlPath
    level
    roles
  }
}
`.trim();

// Holds the last fetched flat list for re-rendering
let categoriesData = [];

function initCategoriesTab() {
  const searchBtn = $('btn-category-search');
  const rootIdInput = $('category-root-id');

  searchBtn.addEventListener('click', () => runCategorySearch());
  rootIdInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') runCategorySearch();
  });

  $('btn-expand-all').addEventListener('click', () => setAllCategoriesCollapsed(false));
  $('btn-collapse-all').addEventListener('click', () => setAllCategoriesCollapsed(true));
}

async function runCategorySearch() {
  const rootId = $('category-root-id').value.trim();

  // Clear previous state
  $('categories-tree').innerHTML = '';
  $('categories-raw-pre').textContent = '';
  $('categories-raw-container').style.display = 'none';
  $('categories-query-pre').textContent = '';
  $('categories-query-container').style.display = 'none';
  $('categories-error').style.display = 'none';
  $('categories-toolbar').style.display = 'none';
  $('categories-loading').classList.remove('visible');
  $('categories-initial-state').style.display = 'none';
  const prevLegend = $('categories-legend');
  if (prevLegend) prevLegend.remove();

  // Validate config (env + website + store view)
  const configErrors = validateConfig();
  if (configErrors.length > 0) {
    showCategoryError(configErrors.map((e) => `• ${e}`).join('\n'));
    return;
  }

  if (!rootId) {
    showCategoryError('Introduce un Root Category ID (ej: 1).');
    return;
  }

  $('categories-loading').classList.add('visible');
  $('btn-category-search').disabled = true;

  const variables = { ids: [rootId] };

  try {
    const data = await graphqlFetch(CATEGORIES_QUERY, variables);

    $('categories-loading').classList.remove('visible');
    $('btn-category-search').disabled = false;

    // Raw JSON
    $('categories-raw-pre').textContent = JSON.stringify(data, null, 2);
    $('categories-raw-container').style.display = 'block';

    // Sent query
    $('categories-query-pre').textContent = formatSentQuery(CATEGORIES_QUERY, variables);
    $('categories-query-container').style.display = 'block';

    if (data.errors && data.errors.length > 0) {
      const msgs = data.errors.map((e) => e.message).join('\n');
      showCategoryError('Error GraphQL:\n' + msgs);
      return;
    }

    const cats = data?.data?.categories;
    if (!cats) {
      showCategoryError('La respuesta no contiene datos de categories.');
      return;
    }

    categoriesData = cats;
    renderCategories(cats);

  } catch (err) {
    $('categories-loading').classList.remove('visible');
    $('btn-category-search').disabled = false;
    showCategoryError('Error de red o del servidor:\n' + err.message);
  }
}

function showCategoryError(msg) {
  const el = $('categories-error');
  el.style.display = 'flex';
  el.querySelector('.error-text').textContent = msg;
}

// Build a tree from the flat list using the `path` field (e.g. "1/4/10/13")
function buildCategoryTree(flatList) {
  const byId = new Map();

  // Index every node and attach a children array
  flatList.forEach((cat) => {
    byId.set(String(cat.id), { ...cat, children: [] });
  });

  const roots = [];

  byId.forEach((node) => {
    const parts = String(node.path || '').split('/').filter(Boolean);
    // parent id is the second-to-last segment in the path
    const parentId = parts.length >= 2 ? parts[parts.length - 2] : null;

    if (parentId && byId.has(parentId)) {
      byId.get(parentId).children.push(node);
    } else {
      // Parent not present in the result => this is a visible root
      roots.push(node);
    }
  });

  // Sort children by position, then name
  const sortNodes = (nodes) => {
    nodes.sort((a, b) => {
      const pa = a.position ?? 0;
      const pb = b.position ?? 0;
      if (pa !== pb) return pa - pb;
      return String(a.name || '').localeCompare(String(b.name || ''));
    });
    nodes.forEach((n) => sortNodes(n.children));
  };
  sortNodes(roots);

  return roots;
}

function hasMenuRole(cat) {
  return Array.isArray(cat.roles) && cat.roles.includes('show_in_menu');
}

function renderCategories(flatList) {
  const container = $('categories-tree');
  container.innerHTML = '';

  $('categories-count').textContent = flatList.length;

  if (flatList.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">&#x1F4C1;</div>
        <p>No se encontraron categorías para ese Root Category ID.</p>
      </div>
    `;
    return;
  }

  // Count invisible (no show_in_menu)
  const invisibleCount = flatList.filter((c) => !hasMenuRole(c)).length;
  const toolbar = $('categories-toolbar');
  toolbar.style.display = 'flex';

  // Build legend right after the toolbar
  const legend = document.createElement('div');
  legend.id = 'categories-legend';
  legend.className = 'tree-legend';
  legend.innerHTML = `
    <span class="tree-legend-item"><span class="cat-menu-dot visible"></span> Visible en menú</span>
    <span class="tree-legend-item"><span class="cat-menu-dot hidden"></span> Oculta en menú (${invisibleCount})</span>
  `;
  toolbar.parentNode.insertBefore(legend, toolbar.nextSibling);

  const tree = buildCategoryTree(flatList);
  const ul = document.createElement('ul');
  ul.className = 'cat-tree-root';

  tree.forEach((node) => {
    ul.appendChild(buildCategoryNode(node));
  });

  container.appendChild(ul);
}

function buildCategoryNode(node) {
  const li = document.createElement('li');
  li.className = 'cat-node';

  const hasChildren = node.children && node.children.length > 0;
  const isVisible = hasMenuRole(node);

  const row = document.createElement('div');
  row.className = 'cat-row' + (isVisible ? '' : ' cat-hidden-menu');

  const menuDot = isVisible
    ? '<span class="cat-menu-dot visible" title="Visible en menú (show_in_menu)"></span>'
    : '<span class="cat-menu-dot hidden" title="Oculta en menú (sin show_in_menu)"></span>';

  const hiddenBadge = isVisible
    ? ''
    : '<span class="cat-hidden-badge" title="No tiene el rol show_in_menu">oculta</span>';

  const urlPathHtml = node.urlPath
    ? `<span class="cat-url-path" title="${escHtml(node.urlPath)}">${escHtml(node.urlPath)}</span>`
    : '';

  row.innerHTML = `
    <span class="cat-toggle ${hasChildren ? '' : 'cat-toggle-empty'}">
      ${hasChildren ? '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="9 18 15 12 9 6"/></svg>' : ''}
    </span>
    ${menuDot}
    <span class="cat-name">${escHtml(node.name || '—')}</span>
    <button class="cat-view-products" type="button" title="Ver productos" aria-label="Ver productos">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
    </button>
    <span class="cat-id">#${escHtml(node.id)}</span>
    ${hiddenBadge}
    ${urlPathHtml}
    ${hasChildren ? `<span class="cat-children-count">${node.children.length}</span>` : ''}
  `;

  li.appendChild(row);

  // "Ver productos" link
  const viewBtn = row.querySelector('.cat-view-products');
  viewBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    openCategoryProducts(node.id, node.name);
  });

  if (hasChildren) {
    const childUl = document.createElement('ul');
    childUl.className = 'cat-children';
    node.children.forEach((child) => {
      childUl.appendChild(buildCategoryNode(child));
    });
    li.appendChild(childUl);

    const toggle = row.querySelector('.cat-toggle');
    const toggleFn = () => {
      const collapsed = li.classList.toggle('collapsed');
      toggle.classList.toggle('collapsed', collapsed);
    };
    toggle.addEventListener('click', (e) => { e.stopPropagation(); toggleFn(); });
    row.addEventListener('click', toggleFn);
  }

  return li;
}

function setAllCategoriesCollapsed(collapsed) {
  const nodes = $('categories-tree').querySelectorAll('.cat-node');
  nodes.forEach((li) => {
    // Only nodes that have children
    if (li.querySelector(':scope > .cat-children')) {
      li.classList.toggle('collapsed', collapsed);
      const toggle = li.querySelector(':scope > .cat-row > .cat-toggle');
      if (toggle) toggle.classList.toggle('collapsed', collapsed);
    }
  });
}

// ===== CATEGORY PRODUCTS TAB =====

const CATEGORY_PRODUCTS_QUERY = `
query CategoryProducts($categoryId: String!, $pageSize: Int, $currentPage: Int) {
  productSearch(
    phrase: ""
    page_size: $pageSize
    current_page: $currentPage
    filter: [{ attribute: "categoryIds", in: [$categoryId] }]
  ) {
    total_count
    page_info {
      current_page
      page_size
      total_pages
    }
    items {
      productView {
        __typename
        sku
        name
      }
    }
  }
}
`.trim();

// Currently selected category for this tab
let currentCategoryProducts = null; // { id, name }

function initCategoryProductsTab() {
  const idInput = $('cat-products-id');
  const searchBtn = $('btn-cat-products-search');

  // Restore last used category id
  if (lastUsed.categoryProductId) {
    idInput.value = lastUsed.categoryProductId;
  }

  searchBtn.addEventListener('click', () => {
    const id = idInput.value.trim();
    runCategoryProductsSearch(id, currentCategoryProducts && currentCategoryProducts.id === id ? currentCategoryProducts.name : null, 1);
  });

  idInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const id = idInput.value.trim();
      runCategoryProductsSearch(id, currentCategoryProducts && currentCategoryProducts.id === id ? currentCategoryProducts.name : null, 1);
    }
  });

  // When the id is edited manually, the category name no longer matches: clear it
  idInput.addEventListener('input', () => {
    if (currentCategoryProducts && idInput.value.trim() !== currentCategoryProducts.id) {
      currentCategoryProducts = null;
      $('cat-products-context').innerHTML = '';
    }
  });
}

// Called from the "Ver productos" link in the categories tree
function openCategoryProducts(categoryId, categoryName) {
  activateTab('category-products');
  $('cat-products-id').value = String(categoryId);
  runCategoryProductsSearch(categoryId, categoryName, 1);
}

async function runCategoryProductsSearch(categoryId, categoryName, page = 1) {
  categoryId = String(categoryId || '').trim();

  // Reset state
  $('cat-products-results').innerHTML = '';
  $('cat-products-summary').innerHTML = '';
  $('cat-products-pagination').innerHTML = '';
  $('cat-products-pagination').style.display = 'none';
  $('cat-products-raw-pre').textContent = '';
  $('cat-products-raw-container').style.display = 'none';
  $('cat-products-query-pre').textContent = '';
  $('cat-products-query-container').style.display = 'none';
  $('cat-products-error').style.display = 'none';
  $('cat-products-loading').classList.remove('visible');
  $('cat-products-initial-state').style.display = 'none';

  if (!categoryId) {
    currentCategoryProducts = null;
    $('cat-products-context').innerHTML = '';
    showCatProductsError('Introduce un Category ID (ej: 4).');
    return;
  }

  currentCategoryProducts = { id: categoryId, name: categoryName || null };

  // Remember the last used category id
  setLastUsed('categoryProductId', categoryId);

  // Sync the input with the id (when coming from the tree)
  $('cat-products-id').value = categoryId;

  // Update context header (only show the name block when we know it)
  if (categoryName) {
    $('cat-products-context').innerHTML = `
      <div class="cat-products-ctx-info">
        <span class="cat-products-ctx-label">Categoría</span>
        <span class="cat-products-ctx-name">${escHtml(categoryName)}</span>
      </div>
    `;
  } else {
    $('cat-products-context').innerHTML = '';
  }

  // Validate config
  const configErrors = validateConfig();
  if (configErrors.length > 0) {
    showCatProductsError(configErrors.map((e) => `• ${e}`).join('\n'));
    return;
  }

  $('cat-products-loading').classList.add('visible');
  $('btn-cat-products-search').disabled = true;

  const variables = {
    categoryId: String(categoryId),
    pageSize: getResultLimit(),
    currentPage: page,
  };

  try {
    const data = await graphqlFetch(CATEGORY_PRODUCTS_QUERY, variables);

    $('cat-products-loading').classList.remove('visible');
    $('btn-cat-products-search').disabled = false;

    $('cat-products-raw-pre').textContent = JSON.stringify(data, null, 2);
    $('cat-products-raw-container').style.display = 'block';

    // Sent query
    $('cat-products-query-pre').textContent = formatSentQuery(CATEGORY_PRODUCTS_QUERY, variables);
    $('cat-products-query-container').style.display = 'block';

    if (data.errors && data.errors.length > 0) {
      const msgs = data.errors.map((e) => e.message).join('\n');
      showCatProductsError('Error GraphQL:\n' + msgs);
      return;
    }

    const result = data?.data?.productSearch;
    if (!result) {
      showCatProductsError('La respuesta no contiene datos de productSearch.');
      return;
    }

    renderCategoryProducts(result);

    const area = $('cat-products-results').closest('.results-area');
    if (area) area.scrollTop = 0;

  } catch (err) {
    $('cat-products-loading').classList.remove('visible');
    $('btn-cat-products-search').disabled = false;
    showCatProductsError('Error de red o del servidor:\n' + err.message);
  }
}

function showCatProductsError(msg) {
  const el = $('cat-products-error');
  el.style.display = 'flex';
  el.querySelector('.error-text').textContent = msg;
}

function renderCategoryProducts(result) {
  const items = result.items || [];
  const total = result.total_count != null ? result.total_count : items.length;
  const pageInfo = result.page_info || { current_page: 1, total_pages: 1, page_size: getResultLimit() };
  const summary = $('cat-products-summary');
  const container = $('cat-products-results');

  if (items.length === 0) {
    summary.innerHTML = '';
    $('cat-products-pagination').style.display = 'none';
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">&#x1F4ED;</div>
        <p>Esta categoría no tiene productos (o no son visibles para el store view seleccionado).</p>
      </div>
    `;
    return;
  }

  const pageSize = pageInfo.page_size || getResultLimit();
  const from = (pageInfo.current_page - 1) * pageSize + 1;
  const to = from + items.length - 1;
  summary.innerHTML = `
    <div class="results-count"><strong>${total}</strong> producto${total !== 1 ? 's' : ''} en total · mostrando ${from}–${to}</div>
  `;

  renderPagination($('cat-products-pagination'), pageInfo, total, (p) => {
    if (currentCategoryProducts) {
      runCategoryProductsSearch(currentCategoryProducts.id, currentCategoryProducts.name, p);
    }
  });

  const list = document.createElement('div');
  list.className = 'cat-products-list';

  items.forEach((item) => {
    const pv = item.productView;
    if (!pv) return;

    const row = document.createElement('div');
    row.className = 'cat-product-row';
    row.title = 'Ver detalle del producto';
    row.innerHTML = `
      <div class="cat-product-main">
        <span class="cat-product-name">${escHtml(pv.name || '—')}</span>
      </div>
      <span>${buildProductTypeBadge(pv)} <span class="product-sku">${escHtml(pv.sku || '—')}</span></span>
    `;
    // Reuse the existing product detail modal
    row.addEventListener('click', () => openProductModal(pv));
    list.appendChild(row);
  });

  container.appendChild(list);
}

// ===== PRODUCT TYPE & VARIANTS =====

const PRODUCT_ASSOCIATED_QUERY = `query Products($skus: [String]!) {
  products(skus: $skus) {
    ... on ComplexProductView {
      name
      options {
        values {
          ... on ProductViewOptionValueProduct {
            product {
              sku
              name
            }
          }
        }
      }
    }
  }
}`;

// SKU of the complex product whose associated products the modal is showing (ignores stale responses)
let variantsRequestSku = null;

function getProductTypeLabel(pv) {
  if (pv.__typename === 'SimpleProductView') return 'Simple';
  if (pv.__typename === 'ComplexProductView') return 'Complex';
  return pv.__typename || '';
}

function buildProductTypeBadge(pv) {
  const label = getProductTypeLabel(pv);
  if (!label) return '';
  const cls = pv.__typename === 'ComplexProductView' ? 'tag-complex' : 'tag-simple';
  return `<span class="tag ${cls}">${escHtml(label)}</span>`;
}

async function loadAssociatedProducts(sku) {
  variantsRequestSku = sku;
  const box = $('pmd-variants-body');
  const variables = { skus: [sku] };
  const queryDetails = `
    <details class="raw-json" style="margin-top:10px">
      <summary>Ver consulta GraphQL enviada</summary>
      <pre class="raw-json-pre">${escHtml(formatSentQuery(PRODUCT_ASSOCIATED_QUERY, variables))}</pre>
    </details>
  `;

  let data;
  try {
    data = await graphqlFetch(PRODUCT_ASSOCIATED_QUERY, variables);
  } catch (err) {
    if (variantsRequestSku !== sku) return;
    box.innerHTML = `<p class="pmd-empty">Error de red o del servidor: ${escHtml(err.message)}</p>${queryDetails}`;
    return;
  }
  if (variantsRequestSku !== sku) return;

  if (data.errors && data.errors.length > 0) {
    box.innerHTML = `<p class="pmd-empty">Error GraphQL: ${escHtml(data.errors.map((e) => e.message).join('\n'))}</p>${queryDetails}`;
    return;
  }

  // Collect the simple products from every option value, deduplicated by SKU
  const bySku = new Map();
  (data?.data?.products || []).filter(Boolean).forEach((p) => {
    (p.options || []).forEach((opt) => {
      (opt.values || []).forEach((val) => {
        if (val && val.product && val.product.sku) bySku.set(val.product.sku, val.product);
      });
    });
  });

  if (bySku.size === 0) {
    box.innerHTML = `<p class="pmd-empty">Sin productos simples asociados.</p>${queryDetails}`;
    return;
  }

  const rows = [...bySku.values()].map((p) => `
    <tr>
      <td class="pmd-attr-name"><span class="product-sku">${escHtml(p.sku)}</span></td>
      <td class="pmd-attr-value">${escHtml(p.name || '—')}</td>
    </tr>
  `).join('');

  box.innerHTML = `
    <div class="pmd-table-wrap">
      <table class="pmd-attrs-table">
        <thead><tr><th>SKU</th><th>Nombre</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    ${queryDetails}
  `;
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
  currentModalPv = pv;
  $('product-modal-title').textContent = pv.name || pv.sku || 'Detalle del producto';
  $('product-modal-content').innerHTML = buildProductModalContent(pv);
  $('product-modal-overlay').style.display = 'flex';
  document.body.style.overflow = 'hidden';
  if (pv.__typename === 'ComplexProductView' && pv.sku) {
    loadAssociatedProducts(pv.sku);
  } else {
    variantsRequestSku = null;
  }
}

function closeProductModal() {
  currentModalPv = null;
  variantsRequestSku = null;
  $('product-modal-overlay').style.display = 'none';
  document.body.style.overflow = '';
}

function buildModalAttrsInner(attrs) {
  if (attrs.length === 0) return '<p class="pmd-empty">Sin atributos disponibles.</p>';

  const attrRows = sortAttributesByFavorite(attrs).map((attr) => {
    const roles = Array.isArray(attr.roles)
      ? attr.roles.map((r) => `<span class="attrs-role">${escHtml(r)}</span>`).join(' ')
      : (attr.roles ? `<span class="attrs-role">${escHtml(attr.roles)}</span>` : '');
    return `
      <tr>
        <td class="pmd-attr-name" title="${escHtml(attr.name || '')}">${buildFavButton(attr)}${escHtml(attr.label || attr.name || '—')}</td>
        <td class="pmd-attr-value">${renderAttrValue(attr.value)}</td>
        <td class="pmd-attr-roles">${roles}</td>
      </tr>
    `;
  }).join('');

  return `
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
  `;
}

function buildProductModalContent(pv) {
  const attrs = pv.attributes || [];
  const attrsSection = `<div class="pmd-section" id="pmd-attrs-section">${buildModalAttrsInner(attrs)}</div>`;

  const variantsSection = pv.__typename === 'ComplexProductView'
    ? `
      <div class="pmd-section">
        <div class="pmd-section-title">Productos simples asociados</div>
        <div id="pmd-variants-body"><p class="pmd-empty">Cargando…</p></div>
      </div>
    `
    : '';

  return `
    <div class="pmd-hero">
      <div class="pmd-hero-main">
        <div class="pmd-name">${escHtml(pv.name || '—')}</div>
        <div class="pmd-sku-row">
          <span class="pmd-sku-label">SKU</span>
          <span class="product-sku">${escHtml(pv.sku || '—')}</span>
          ${buildProductTypeBadge(pv)}
        </div>
      </div>
    </div>
    ${variantsSection}
    ${attrsSection}
  `;
}

// ===== INIT =====

document.addEventListener('DOMContentLoaded', () => {
  loadLastUsed();
  initFavoriteAttributes();
  loadWebsites();
  initSettings();
  initEnvironmentManager();
  initWebsiteSelector();
  initWebsiteManager();
  initTabs();
  initProductsTab();
  initProductsBySkuTab();
  initCategoriesTab();
  initCategoryProductsTab();
  initProductModal();
});
