// ===== CONSTANTS =====

const ENDPOINTS = {
  staging: 'https://catalog-service-sandbox.adobe.io/graphql',
  production: 'https://catalog-service.adobe.io/graphql',
};

// x-api-key used when the environment does not define its own
const DEFAULT_API_KEY = 'search_gql';

const LS_PROJECTS_KEY = 'catalogService.projects';
// Legacy keys (before projects): only read once to migrate them into a default project
const LS_KEY = 'catalogService.environments';
const LS_WS_KEY = 'catalogService.websites';
const LS_SETTINGS_KEY = 'catalogService.settings';
const LS_LAST_USED_KEY = 'catalogService.lastUsed';
const LS_FAV_ATTRS_KEY = 'catalogService.favoriteAttributes';
const LS_SORT_KEY = 'catalogService.productSort';

// Default application settings
const DEFAULT_SETTINGS = {
  resultLimit: 500, // productSearch page_size
};

// Last used selections/values, persisted so the panel restores them on reload
const DEFAULT_LAST_USED = {
  projectId: null,       // activeProject.id
  environmentId: null,   // activeEnvironment.id
  website: null,         // website code
  store: null,           // store code
  storeView: null,       // store view code
  customerGroup: '',     // customer group id (internal) of the active environment, '' = none
  productPhrase: '',     // Products tab phrase
  productSkus: '',       // Products by SKU tab SKUs
  categoryProductId: '', // Category Products tab category id
};

// ===== STATE =====

// projects: [{ id, name, environments: Environment[], websites: Websites }]
let projects = [];
let activeProject = null;

// `environments` and `websites` always point at the active project's data
// environments: [{ id, label, environmentId, type, apiKey, customerGroups: [{ id, groupId, hash, label }] }]
let environments = [];
let activeEnvironment = null;

// websites: { [code]: { label: string, stores: { [code]: { label: string, storeViews: string[] } } } }
let websites = {};
let selectedWebsiteCode = null; // for the manager modal
let selectedStoreCode = null;   // for the manager modal

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

const CONFIG_EXPORT_VERSION = 2;

// Asks for a file name and downloads `payload` as a JSON file.
// Returns the final file name, or null when the user cancels.
function downloadJson(message, defaultName, payload) {
  let name = window.prompt(message, defaultName);
  if (name === null) return null; // cancelled
  name = name.trim();
  if (!name) name = defaultName;
  if (!name.toLowerCase().endsWith('.json')) name += '.json';

  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  return name;
}

function exportConfig() {
  const defaultName = `catalog-service-config-${new Date().toISOString().slice(0, 10)}`;

  const payload = {
    app: 'adobe-catalog-service-panel',
    version: CONFIG_EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    data: {
      projects: safeParse(localStorage.getItem(LS_PROJECTS_KEY), []),
      settings: safeParse(localStorage.getItem(LS_SETTINGS_KEY), DEFAULT_SETTINGS),
      lastUsed: safeParse(localStorage.getItem(LS_LAST_USED_KEY), DEFAULT_LAST_USED),
      favoriteAttributes: safeParse(localStorage.getItem(LS_FAV_ATTRS_KEY), []),
      productSort: safeParse(localStorage.getItem(LS_SORT_KEY), {}),
    },
  };

  const name = downloadJson('Nombre del archivo de configuración:', defaultName, payload);
  if (name) showConfigIoMessage('success', `Configuración exportada como "${name}".`);
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
  // Accept either the wrapped format ({ data: {...} }) or a raw {projects,settings,...}.
  // Files from before projects ({ environments, websites }) are migrated into a default project.
  const data = parsed && parsed.data ? parsed.data : parsed;

  if (!data || typeof data !== 'object') {
    showConfigIoMessage('error', 'El archivo no contiene una configuración válida.');
    return;
  }

  const hasAny = ['projects', 'environments', 'websites', 'settings', 'lastUsed', 'favoriteAttributes', 'productSort'].some((k) => k in data);
  if (!hasAny) {
    showConfigIoMessage('error', 'El archivo no contiene datos de configuración reconocibles.');
    return;
  }

  if (!window.confirm('Importar esta configuración reemplazará tus proyectos (entornos, websites, stores y store views) y ajustes actuales. ¿Continuar?')) {
    return;
  }

  // Persist each section if present
  let legacyProject = null;
  if (Array.isArray(data.projects)) {
    localStorage.setItem(LS_PROJECTS_KEY, JSON.stringify(data.projects.map(normalizeProject)));
  } else if ('environments' in data || 'websites' in data) {
    legacyProject = migrateLegacyToProject(
      Array.isArray(data.environments) ? data.environments : [],
      data.websites && typeof data.websites === 'object' ? data.websites : {}
    );
    localStorage.setItem(LS_PROJECTS_KEY, JSON.stringify([legacyProject]));
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
  if ('productSort' in data && data.productSort && typeof data.productSort === 'object' && !Array.isArray(data.productSort)) {
    localStorage.setItem(LS_SORT_KEY, JSON.stringify(data.productSort));
  }

  // Reload in-memory state from storage
  loadSettings();
  loadLastUsed();
  if (legacyProject) {
    lastUsed.projectId = null;
    adoptLegacyLastUsed(legacyProject);
  }
  loadFavoriteAttributes();
  loadProductSort();
  refreshAttributeViews();
  loadProjects();

  // Refresh the whole UI to reflect the imported config
  resetEnvForm();
  selectedWebsiteCode = null;
  selectedStoreCode = null;
  // Clear current DOM selections so the imported lastUsed takes effect
  $('website-select').value = '';
  $('store-select').value = '';
  $('store-view-select').value = '';
  $('customer-group-select').innerHTML = '';
  selectInitialProject();
  renderEnvironments();
  populateSidebarWebsites();
  fillSettingsForm();
  resetFacetContext();

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

// ===== UTILS =====

function newId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// "Cliente Ñandú" -> "cliente-nandu", for file names
function slugify(str) {
  return String(str)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'project';
}

// Synchronous SHA-1 (hex). Commerce's Magento-Customer-Group header is sha1(<customer_group_id>);
// crypto.subtle is async and only available in secure contexts, so it is not used here.
function sha1Hex(str) {
  const bytes = new TextEncoder().encode(str);
  const padded = new Uint8Array(((bytes.length + 9 + 63) >> 6) << 6);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  const bitLength = bytes.length * 8;
  view.setUint32(padded.length - 8, Math.floor(bitLength / 0x100000000));
  view.setUint32(padded.length - 4, bitLength >>> 0);

  const rotl = (n, s) => (n << s) | (n >>> (32 - s));
  const w = new Uint32Array(80);
  let h0 = 0x67452301, h1 = 0xefcdab89, h2 = 0x98badcfe, h3 = 0x10325476, h4 = 0xc3d2e1f0;

  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4);
    for (let i = 16; i < 80; i++) w[i] = rotl(w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16], 1);

    let a = h0, b = h1, c = h2, d = h3, e = h4;
    for (let i = 0; i < 80; i++) {
      let f, k;
      if (i < 20) { f = (b & c) | (~b & d); k = 0x5a827999; }
      else if (i < 40) { f = b ^ c ^ d; k = 0x6ed9eba1; }
      else if (i < 60) { f = (b & c) | (b & d) | (c & d); k = 0x8f1bbcdc; }
      else { f = b ^ c ^ d; k = 0xca62c1d6; }
      const temp = (rotl(a, 5) + f + e + k + w[i]) >>> 0;
      e = d;
      d = c;
      c = rotl(b, 30) >>> 0;
      b = a;
      a = temp;
    }
    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
  }

  return [h0, h1, h2, h3, h4].map((h) => h.toString(16).padStart(8, '0')).join('');
}

const byName = (a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' });

// ===== PROJECTS LOCAL STORAGE =====

function normalizeCustomerGroups(raw) {
  if (!Array.isArray(raw)) return [];
  const groups = [];
  raw.forEach((g) => {
    if (!g || typeof g !== 'object') return;
    const groupId = g.groupId != null ? String(g.groupId).trim() : '';
    const hash = /^\d+$/.test(groupId) ? sha1Hex(groupId) : String(g.hash || '').trim();
    if (!hash) return;
    groups.push({
      id: typeof g.id === 'string' && g.id ? g.id : newId(),
      groupId: /^\d+$/.test(groupId) ? groupId : '',
      hash,
      label: typeof g.label === 'string' ? g.label : '',
    });
  });
  return groups;
}

function normalizeEnvironments(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((e) => e && typeof e === 'object')
    .map((e) => ({
      id: e.id != null && e.id !== '' ? String(e.id) : newId(),
      label: String(e.label || ''),
      environmentId: String(e.environmentId || ''),
      type: e.type === 'production' ? 'production' : 'staging',
      apiKey: typeof e.apiKey === 'string' ? e.apiKey.trim() : '',
      customerGroups: normalizeCustomerGroups(e.customerGroups),
    }));
}

function normalizeWebsites(raw) {
  const result = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return result;
  const cleanViews = (list) => (Array.isArray(list) ? list.filter((v) => typeof v === 'string' && v) : []);

  Object.keys(raw).forEach((code) => {
    const ws = raw[code] && typeof raw[code] === 'object' ? raw[code] : {};
    const website = { label: typeof ws.label === 'string' ? ws.label : '', stores: {} };

    if (ws.stores && typeof ws.stores === 'object' && !Array.isArray(ws.stores)) {
      Object.keys(ws.stores).forEach((storeCode) => {
        const st = ws.stores[storeCode] && typeof ws.stores[storeCode] === 'object' ? ws.stores[storeCode] : {};
        website.stores[storeCode] = {
          label: typeof st.label === 'string' ? st.label : '',
          storeViews: cleanViews(st.storeViews),
        };
      });
    } else if (Array.isArray(ws.storeViews)) {
      // Legacy shape (no store level): one store with the website's code, which is
      // what used to be sent as Magento-Store-Code
      website.stores[code] = { label: '', storeViews: cleanViews(ws.storeViews) };
    }

    result[code] = website;
  });
  return result;
}

function normalizeProject(raw) {
  const p = raw && typeof raw === 'object' ? raw : {};
  return {
    id: p.id != null && p.id !== '' ? String(p.id) : newId(),
    name: String(p.name || 'Proyecto'),
    environments: normalizeEnvironments(p.environments),
    websites: normalizeWebsites(p.websites),
  };
}

// Builds the default project out of the pre-projects environments and websites
function migrateLegacyToProject(legacyEnvironments, legacyWebsites) {
  return normalizeProject({
    id: newId(),
    name: 'Proyecto por defecto',
    environments: legacyEnvironments,
    websites: legacyWebsites,
  });
}

// lastUsed saved before projects/stores existed: attach it to the migrated project
function adoptLegacyLastUsed(project) {
  if (!lastUsed.projectId) lastUsed.projectId = project.id;
  if (!lastUsed.store && lastUsed.website) lastUsed.store = lastUsed.website;
  saveLastUsed();
}

function loadProjects() {
  let stored = null;
  try {
    stored = JSON.parse(localStorage.getItem(LS_PROJECTS_KEY));
  } catch {
    stored = null;
  }

  if (Array.isArray(stored)) {
    projects = stored.map(normalizeProject);
    return;
  }

  // First run with projects: migrate legacy environments/websites if there are any
  const legacyEnvironments = safeParse(localStorage.getItem(LS_KEY), []);
  const legacyWebsites = safeParse(localStorage.getItem(LS_WS_KEY), {});
  const hasLegacy = (Array.isArray(legacyEnvironments) && legacyEnvironments.length > 0)
    || (legacyWebsites && typeof legacyWebsites === 'object' && Object.keys(legacyWebsites).length > 0);

  projects = [];
  if (hasLegacy) {
    const project = migrateLegacyToProject(legacyEnvironments, legacyWebsites);
    projects.push(project);
    saveProjects();
    adoptLegacyLastUsed(project);
  }
}

function saveProjects() {
  localStorage.setItem(LS_PROJECTS_KEY, JSON.stringify(projects));
}

// ===== PROJECT MANAGEMENT =====

function setActiveProject(project) {
  activeProject = project || null;
  environments = activeProject ? activeProject.environments : [];
  websites = activeProject ? activeProject.websites : {};
  activeEnvironment = null;
  selectedWebsiteCode = null;
  selectedStoreCode = null;
  if (editingEnvId) resetEnvForm();
}

// Restores the last used project (or the first one, alphabetically) as the active one
function selectInitialProject() {
  const remembered = lastUsed.projectId ? projects.find((p) => p.id === lastUsed.projectId) : null;
  const project = remembered || [...projects].sort(byName)[0] || null;
  setActiveProject(project);
  const id = project ? project.id : null;
  if (lastUsed.projectId !== id) setLastUsed('projectId', id);
  renderProjectSelect();
}

function renderProjectSelect() {
  const select = $('project-select');
  select.innerHTML = '';

  if (projects.length === 0) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = '-- Sin proyectos --';
    select.appendChild(opt);
  } else {
    [...projects].sort(byName).forEach((p) => {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.name;
      select.appendChild(opt);
    });
    if (activeProject) select.value = activeProject.id;
  }

  const hasProject = !!activeProject;
  $('btn-edit-project').disabled = !hasProject;
  $('btn-export-project').disabled = !hasProject;
  $('btn-delete-project').disabled = !hasProject;
  $('btn-add-env').disabled = !hasProject;
  $('btn-open-ws-manager').disabled = !hasProject;
}

// Switches to another project and reloads everything that depends on it
function selectProject(project) {
  setActiveProject(project);
  setLastUsed('projectId', project ? project.id : null);
  renderProjectSelect();
  renderEnvironments();
  populateSidebarWebsites();
  resetFacetContext();
}

// Asks for a project name; returns null when cancelled, empty or duplicated
function askProjectName(message, current = '') {
  const name = (window.prompt(message, current) || '').trim();
  if (!name || name === current) return null;
  if (projects.some((p) => p.name.toLowerCase() === name.toLowerCase())) {
    window.alert('Ya existe un proyecto con ese nombre.');
    return null;
  }
  return name;
}

function addProject() {
  const name = askProjectName('Nombre del nuevo proyecto:');
  if (!name) return;
  const project = { id: newId(), name, environments: [], websites: {} };
  projects.push(project);
  saveProjects();
  selectProject(project);
}

function renameProject() {
  if (!activeProject) return;
  const name = askProjectName('Nuevo nombre del proyecto:', activeProject.name);
  if (!name) return;
  activeProject.name = name;
  saveProjects();
  renderProjectSelect();
}

function deleteProject() {
  if (!activeProject) return;
  const project = activeProject;
  const wsCount = Object.keys(project.websites).length;
  const detail = `${project.environments.length} entorno(s) y ${wsCount} website(s) con sus stores y store views`;
  if (!window.confirm(`Se eliminará el proyecto "${project.name}" junto con ${detail}. ¿Continuar?`)) return;

  // Drop the sorts saved for its environments
  let sortChanged = false;
  project.environments.forEach((env) => {
    if (productSortByEnv[env.id]) {
      delete productSortByEnv[env.id];
      sortChanged = true;
    }
  });
  if (sortChanged) saveProductSort();

  projects = projects.filter((p) => p !== project);
  saveProjects();
  selectProject([...projects].sort(byName)[0] || null);
}

function initProjectManager() {
  selectInitialProject();

  $('project-select').addEventListener('change', () => {
    const project = projects.find((p) => p.id === $('project-select').value) || null;
    selectProject(project);
  });
  $('import-project-file').addEventListener('change', handleImportProjectFile);

  initProjectMenu();
}

// ===== PROJECT MENU (hamburger) =====

function isProjectMenuOpen() {
  return !$('project-menu').hidden;
}

function openProjectMenu() {
  $('project-menu').hidden = false;
  $('btn-project-menu').setAttribute('aria-expanded', 'true');
  const first = $('project-menu').querySelector('.project-menu-item:not(:disabled)');
  if (first) first.focus();
}

function closeProjectMenu(returnFocus = false) {
  if (!isProjectMenuOpen()) return;
  $('project-menu').hidden = true;
  $('btn-project-menu').setAttribute('aria-expanded', 'false');
  if (returnFocus) $('btn-project-menu').focus();
}

function initProjectMenu() {
  const toggle = $('btn-project-menu');
  const menu = $('project-menu');

  toggle.addEventListener('click', () => {
    if (isProjectMenuOpen()) closeProjectMenu();
    else openProjectMenu();
  });
  toggle.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' && !isProjectMenuOpen()) {
      e.preventDefault();
      openProjectMenu();
    }
  });

  // The menu closes first because prompt/confirm/file dialogs are blocking
  const actions = {
    'btn-add-project': addProject,
    'btn-edit-project': renameProject,
    'btn-export-project': exportProject,
    'btn-import-project': () => $('import-project-file').click(),
    'btn-delete-project': deleteProject,
  };
  Object.keys(actions).forEach((id) => {
    $(id).addEventListener('click', () => {
      closeProjectMenu(true);
      actions[id]();
    });
  });

  menu.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeProjectMenu(true);
    } else if (e.key === 'Tab') {
      e.preventDefault();
      closeProjectMenu(true);
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const items = [...menu.querySelectorAll('.project-menu-item:not(:disabled)')];
      if (items.length === 0) return;
      const index = items.indexOf(document.activeElement);
      const next = e.key === 'ArrowDown'
        ? (index + 1) % items.length
        : (index - 1 + items.length) % items.length;
      items[next].focus();
    }
  });

  // Click outside closes it
  document.addEventListener('click', (e) => {
    if (isProjectMenuOpen() && !e.target.closest('.project-menu-wrap')) closeProjectMenu();
  });
}

// ===== PROJECT EXPORT / IMPORT =====

const PROJECT_EXPORT_VERSION = 1;

// Exports the active project with everything under it (environments, customer groups, websites, stores, store views)
function exportProject() {
  if (!activeProject) return;

  const defaultName = `catalog-service-project-${slugify(activeProject.name)}-${new Date().toISOString().slice(0, 10)}`;
  const payload = {
    app: 'adobe-catalog-service-panel',
    type: 'projects',
    version: PROJECT_EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    data: { projects: [activeProject] },
  };

  downloadJson('Nombre del archivo del proyecto:', defaultName, payload);
}

function handleImportProjectFile(e) {
  const file = e.target.files && e.target.files[0];
  // Allow re-importing the same file later
  e.target.value = '';
  if (!file) return;

  const reader = new FileReader();
  reader.onload = () => {
    let parsed;
    try {
      parsed = JSON.parse(reader.result);
    } catch {
      window.alert('El archivo no es un JSON válido.');
      return;
    }
    importProjects(parsed);
  };
  reader.onerror = () => window.alert('No se pudo leer el archivo.');
  reader.readAsText(file);
}

const projectNameTaken = (name) => projects.some((p) => p.name.toLowerCase() === name.toLowerCase());

// "Cliente A" -> "Cliente A (2)", "Cliente A (2)" -> "Cliente A (3)"
function nextProjectName(name) {
  const base = name.replace(/\s*\(\d+\)$/, '');
  let n = 2;
  while (projectNameTaken(`${base} (${n})`)) n++;
  return `${base} (${n})`;
}

// Imported entities get fresh internal ids so they never collide with the existing ones
function withNewIds(project) {
  return {
    id: newId(),
    name: project.name,
    environments: project.environments.map((env) => ({
      ...env,
      id: newId(),
      customerGroups: env.customerGroups.map((g) => ({ ...g, id: newId() })),
    })),
    websites: project.websites,
  };
}

function countProjectEntities(project) {
  const sites = Object.values(project.websites);
  const stores = sites.flatMap((w) => Object.values(w.stores));
  return {
    environments: project.environments.length,
    customerGroups: project.environments.reduce((n, e) => n + e.customerGroups.length, 0),
    websites: sites.length,
    stores: stores.length,
    storeViews: stores.reduce((n, s) => n + s.storeViews.length, 0),
  };
}

// Adds the projects of a project file (or of a configuration file) without touching the existing ones
function importProjects(parsed) {
  const data = parsed && parsed.data ? parsed.data : parsed;
  const incoming = data && Array.isArray(data.projects) ? data.projects : [];
  if (incoming.length === 0) {
    window.alert('El archivo no contiene proyectos. Los archivos de configuración anteriores a los proyectos se importan desde Ajustes → Importar configuración.');
    return;
  }

  const imported = [];
  let skipped = 0;

  incoming.forEach((raw) => {
    if (!raw || typeof raw !== 'object') {
      skipped++;
      return;
    }
    const project = withNewIds(normalizeProject(raw));

    // Never overwrite: a repeated name asks for another one
    let name = project.name;
    while (!name || projectNameTaken(name)) {
      const answer = window.prompt(
        name
          ? `Ya existe un proyecto llamado "${name}".\nNombre para el proyecto importado (Cancelar para omitirlo):`
          : 'El nombre no puede estar vacío.\nNombre para el proyecto importado (Cancelar para omitirlo):',
        name ? nextProjectName(name) : 'Proyecto importado'
      );
      if (answer === null) {
        name = null;
        break;
      }
      name = answer.trim();
    }
    if (name === null) {
      skipped++;
      return;
    }

    project.name = name;
    projects.push(project);
    imported.push(project);
  });

  if (imported.length === 0) return;

  saveProjects();
  selectProject(imported[0]);

  const lines = imported.map((p) => {
    const c = countProjectEntities(p);
    return `• "${p.name}": ${c.environments} entorno(s), ${c.customerGroups} customer group(s), ${c.websites} website(s), ${c.stores} store(s) y ${c.storeViews} store view(s)`;
  });
  const title = imported.length === 1 ? 'Proyecto importado' : 'Proyectos importados';
  window.alert(`${title}:\n${lines.join('\n')}${skipped ? `\n\n${skipped} proyecto(s) omitido(s).` : ''}`);
}

// ===== ENVIRONMENT MANAGEMENT =====

// Internal id of the environment being edited (null when adding a new one)
let editingEnvId = null;

function resetEnvForm() {
  editingEnvId = null;
  $('new-env-label').value = '';
  $('new-env-id').value = '';
  $('new-env-type').value = 'staging';
  $('new-env-api-key').value = '';
  $('env-add-form').classList.remove('visible');
  $('btn-add-env').textContent = '+ Añadir entorno';
  $('btn-save-env').textContent = 'Guardar entorno';
}

function startEditEnvironment(env) {
  editingEnvId = env.id;
  $('new-env-label').value = env.label;
  $('new-env-id').value = env.environmentId;
  $('new-env-type').value = env.type === 'production' ? 'production' : 'staging';
  $('new-env-api-key').value = env.apiKey || '';
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
    list.innerHTML = `<div class="env-empty">${activeProject ? 'No hay entornos guardados' : 'Crea un proyecto para añadir entornos'}</div>`;
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
      const changed = activeEnvironment !== env;
      activeEnvironment = env;
      if (changed) resetFacetContext();
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
      // Drop the sort saved for this environment
      if (productSortByEnv[env.id]) {
        delete productSortByEnv[env.id];
        saveProductSort();
      }
      environments.splice(index, 1);
      saveProjects();
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

  // Customer groups belong to the environment
  populateCustomerGroupSelect();
}

function initEnvironmentManager() {
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
    if (!activeProject) return;
    const label = $('new-env-label').value.trim();
    const envId = $('new-env-id').value.trim();
    const type = $('new-env-type').value;
    const apiKey = $('new-env-api-key').value.trim();

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
        env.apiKey = apiKey;
        saveProjects();
        // Endpoint, Environment ID or API key may have changed
        if (activeEnvironment === env) resetFacetContext();
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
      apiKey,
      customerGroups: [],
    };

    environments.push(newEnv);
    saveProjects();
    activeEnvironment = newEnv;
    setLastUsed('environmentId', newEnv.id);
    resetFacetContext();

    resetEnvForm();

    renderEnvironments();
  });

  // Allow Enter key in form fields
  [$('new-env-label'), $('new-env-id'), $('new-env-api-key')].forEach((input) => {
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

// ===== WEBSITE / STORE / STORE VIEW SELECTOR (sidebar) =====

function initWebsiteSelector() {
  const websiteSelect = $('website-select');
  const storeSelect = $('store-select');
  const storeViewSelect = $('store-view-select');

  websiteSelect.addEventListener('change', () => {
    setLastUsed('website', websiteSelect.value);
    populateSidebarStores(websiteSelect.value);
    resetFacetContext();
  });

  storeSelect.addEventListener('change', () => {
    setLastUsed('store', storeSelect.value);
    populateSidebarStoreViews(websiteSelect.value, storeSelect.value);
    resetFacetContext();
  });

  storeViewSelect.addEventListener('change', () => {
    setLastUsed('storeView', storeViewSelect.value);
    resetFacetContext();
    renderActiveHeaders();
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
    populateSidebarStores('');
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

  populateSidebarStores(websiteSelect.value);
}

function populateSidebarStores(websiteCode) {
  const storeSelect = $('store-select');
  // Prefer the current DOM value, fall back to the last-used store
  const previousValue = storeSelect.value || lastUsed.store || '';
  storeSelect.innerHTML = '';

  const stores = websiteCode && websites[websiteCode] ? websites[websiteCode].stores : {};
  const codes = Object.keys(stores).sort();

  if (codes.length === 0) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = '-- Sin stores --';
    storeSelect.appendChild(opt);
    populateSidebarStoreViews(websiteCode, '');
    return;
  }

  codes.forEach((code) => {
    const opt = document.createElement('option');
    opt.value = code;
    opt.textContent = stores[code].label ? `${code} — ${stores[code].label}` : code;
    storeSelect.appendChild(opt);
  });

  if (previousValue && stores[previousValue]) {
    storeSelect.value = previousValue;
  }

  // Keep lastUsed in sync with the effective selection
  if (storeSelect.value) setLastUsed('store', storeSelect.value);

  populateSidebarStoreViews(websiteCode, storeSelect.value);
}

function populateSidebarStoreViews(websiteCode, storeCode) {
  const storeViewSelect = $('store-view-select');
  // Prefer the current DOM value, fall back to the last-used store view
  const previousValue = storeViewSelect.value || lastUsed.storeView || '';
  storeViewSelect.innerHTML = '';

  const store = websiteCode && storeCode && websites[websiteCode]
    ? websites[websiteCode].stores[storeCode]
    : null;
  const views = store ? store.storeViews : [];

  if (views.length === 0) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = '-- Sin store views --';
    storeViewSelect.appendChild(opt);
    renderActiveHeaders();
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

  renderActiveHeaders();
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

  // Add store
  $('btn-save-st').addEventListener('click', addStore);
  $('btn-cancel-st-edit').addEventListener('click', resetStoreForm);
  $('new-st-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') addStore(); });
  $('new-st-label').addEventListener('keydown', (e) => { if (e.key === 'Enter') addStore(); });

  // Add store view
  $('btn-save-sv').addEventListener('click', addStoreView);
  $('new-sv-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') addStoreView(); });

  // Close with Escape
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && $('ws-modal-overlay').style.display !== 'none') closeWsModal();
  });
}

function openWsModal() {
  if (!activeProject) return;
  selectedWebsiteCode = null;
  selectedStoreCode = null;
  resetWsForm();
  resetStoreForm();
  renderWsManager();
  $('ws-modal-overlay').style.display = 'flex';
  document.body.style.overflow = 'hidden';
}

function closeWsModal() {
  $('ws-modal-overlay').style.display = 'none';
  document.body.style.overflow = '';
  // Refresh sidebar selectors in case something changed
  const contextBefore = getContextKey();
  populateSidebarWebsites();
  if (getContextKey() !== contextBefore) resetFacetContext();
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

// Store code being edited inside the selected website (null when adding a new store)
let editingStoreCode = null;

function resetStoreForm() {
  editingStoreCode = null;
  $('new-st-code').value = '';
  $('new-st-code').disabled = false;
  $('new-st-label').value = '';
  $('btn-save-st').textContent = 'Añadir store';
  $('btn-cancel-st-edit').style.display = 'none';
}

function startEditStore(code) {
  const store = websites[selectedWebsiteCode].stores[code];
  editingStoreCode = code;
  $('new-st-code').value = code;
  $('new-st-code').disabled = true;
  $('new-st-label').value = store.label || '';
  $('btn-save-st').textContent = 'Guardar label';
  $('btn-cancel-st-edit').style.display = 'block';
  $('new-st-label').focus();
}

function renderWsManager() {
  renderWebsiteList();
  renderStorePanel();
  renderStoreViewPanel();
}

function countStoreViews(website) {
  return Object.values(website.stores).reduce((total, st) => total + st.storeViews.length, 0);
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
    const storeCount = Object.keys(ws.stores).length;
    const isSelected = code === selectedWebsiteCode;
    const item = document.createElement('div');
    item.className = 'ws-item' + (isSelected ? ' active' : '');

    item.innerHTML = `
      <div class="ws-item-info">
        <div class="ws-item-code">${escHtml(code)}</div>
        ${ws.label ? `<div class="ws-item-label">${escHtml(ws.label)}</div>` : ''}
      </div>
      <span class="ws-item-sv-count" title="${storeCount} store(s)">${storeCount} ST</span>
      <button class="env-item-edit ws-edit-btn" title="Editar label">&#x270E;</button>
      <button class="env-item-delete ws-delete-btn" title="Eliminar website" data-code="${escHtml(code)}">&#x2715;</button>
    `;

    item.addEventListener('click', (e) => {
      if (e.target.closest('.ws-delete-btn, .ws-edit-btn')) return;
      if (selectedWebsiteCode !== code) {
        selectedWebsiteCode = code;
        selectedStoreCode = null;
        resetStoreForm();
      }
      renderWsManager();
    });

    item.querySelector('.ws-edit-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      startEditWebsite(code);
    });

    item.querySelector('.ws-delete-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      if (storeCount > 0 && !window.confirm(`Se eliminará el website "${code}" con ${storeCount} store(s) y ${countStoreViews(ws)} store view(s). ¿Continuar?`)) return;
      if (editingWsCode === code) resetWsForm();
      delete websites[code];
      saveProjects();
      if (selectedWebsiteCode === code) {
        selectedWebsiteCode = null;
        selectedStoreCode = null;
        resetStoreForm();
      }
      renderWsManager();
    });

    list.appendChild(item);
  });
}

function renderStorePanel() {
  const stList = $('st-list');
  const stContext = $('st-website-label');
  const stForm = $('st-add-form');

  stList.innerHTML = '';

  if (!selectedWebsiteCode || !websites[selectedWebsiteCode]) {
    stContext.textContent = 'Selecciona un website para ver sus stores';
    stForm.style.display = 'none';
    $('st-count').textContent = '0';
    return;
  }

  const ws = websites[selectedWebsiteCode];
  stContext.innerHTML = `Stores de <strong>${escHtml(selectedWebsiteCode)}</strong>${ws.label ? ` — ${escHtml(ws.label)}` : ''}`;
  stForm.style.display = '';

  const codes = Object.keys(ws.stores).sort();
  $('st-count').textContent = codes.length;

  if (codes.length === 0) {
    stList.innerHTML = '<div class="ws-empty">Sin stores. Añade una abajo.</div>';
    return;
  }

  codes.forEach((code) => {
    const store = ws.stores[code];
    const item = document.createElement('div');
    item.className = 'ws-item' + (code === selectedStoreCode ? ' active' : '');

    item.innerHTML = `
      <div class="ws-item-info">
        <div class="ws-item-code">${escHtml(code)}</div>
        ${store.label ? `<div class="ws-item-label">${escHtml(store.label)}</div>` : ''}
      </div>
      <span class="ws-item-sv-count" title="${store.storeViews.length} store view(s)">${store.storeViews.length} SV</span>
      <button class="env-item-edit st-edit-btn" title="Editar label">&#x270E;</button>
      <button class="env-item-delete st-delete-btn" title="Eliminar store">&#x2715;</button>
    `;

    item.addEventListener('click', (e) => {
      if (e.target.closest('.st-delete-btn, .st-edit-btn')) return;
      selectedStoreCode = code;
      renderStorePanel();
      renderStoreViewPanel();
    });

    item.querySelector('.st-edit-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      startEditStore(code);
    });

    item.querySelector('.st-delete-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      const svCount = store.storeViews.length;
      if (svCount > 0 && !window.confirm(`Se eliminará la store "${code}" con ${svCount} store view(s). ¿Continuar?`)) return;
      if (editingStoreCode === code) resetStoreForm();
      delete ws.stores[code];
      saveProjects();
      if (selectedStoreCode === code) selectedStoreCode = null;
      renderWsManager();
    });

    stList.appendChild(item);
  });
}

function renderStoreViewPanel() {
  const svList = $('sv-list');
  const svContext = $('sv-website-label');
  const svForm = $('sv-add-form');

  svList.innerHTML = '';

  const store = selectedWebsiteCode && selectedStoreCode && websites[selectedWebsiteCode]
    ? websites[selectedWebsiteCode].stores[selectedStoreCode]
    : null;

  if (!store) {
    svContext.textContent = 'Selecciona una store para ver sus store views';
    svContext.style.display = 'block';
    svForm.style.display = 'none';
    $('sv-count').textContent = '0';
    return;
  }

  svContext.innerHTML = `Store views de <strong>${escHtml(selectedWebsiteCode)}</strong> / <strong>${escHtml(selectedStoreCode)}</strong>`;
  svContext.style.display = 'block';
  svForm.style.display = '';
  $('new-sv-code').value = '';

  const views = store.storeViews;
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
      views.splice(idx, 1);
      saveProjects();
      renderStorePanel(); // update the SV count of the store
      renderStoreViewPanel();
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
      saveProjects();
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

  websites[code] = { label, stores: {} };
  saveProjects();
  codeInput.value = '';
  labelInput.value = '';
  selectedWebsiteCode = code;
  selectedStoreCode = null;
  resetStoreForm();
  renderWsManager();
}

function addStore() {
  if (!selectedWebsiteCode || !websites[selectedWebsiteCode]) return;
  const stores = websites[selectedWebsiteCode].stores;
  const codeInput = $('new-st-code');
  const labelInput = $('new-st-label');
  const code = codeInput.value.trim();
  const label = labelInput.value.trim();

  if (editingStoreCode) {
    if (stores[editingStoreCode]) {
      stores[editingStoreCode].label = label;
      saveProjects();
    }
    resetStoreForm();
    renderWsManager();
    populateSidebarWebsites(); // refresh the sidebar selector with the new label
    return;
  }

  if (!code) {
    showFieldError(codeInput, 'El código es requerido');
    return;
  }
  if (stores[code]) {
    showFieldError(codeInput, 'Ya existe esa store en el website');
    return;
  }

  stores[code] = { label, storeViews: [] };
  saveProjects();
  codeInput.value = '';
  labelInput.value = '';
  selectedStoreCode = code;
  renderWsManager();
}

function addStoreView() {
  if (!selectedWebsiteCode || !selectedStoreCode) return;
  const store = websites[selectedWebsiteCode] && websites[selectedWebsiteCode].stores[selectedStoreCode];
  if (!store) return;
  const input = $('new-sv-code');
  const code = input.value.trim();

  if (!code) {
    showFieldError(input, 'El código es requerido');
    return;
  }
  if (store.storeViews.includes(code)) {
    showFieldError(input, 'Ya existe esa store view en la store');
    return;
  }

  store.storeViews.push(code);
  saveProjects();
  input.value = '';
  renderStorePanel(); // update the SV count of the store
  renderStoreViewPanel();
}

// ===== CUSTOMER GROUPS (per environment) =====

function getActiveCustomerGroup() {
  if (!activeEnvironment) return null;
  const id = $('customer-group-select').value;
  return (activeEnvironment.customerGroups || []).find((g) => g.id === id) || null;
}

// "General (ID 1)", "ID 1" or "356a192b…" depending on what the group defines
function customerGroupText(group) {
  const ref = group.groupId !== '' ? `ID ${group.groupId}` : `${group.hash.slice(0, 8)}…`;
  return group.label ? `${group.label} (${ref})` : ref;
}

function populateCustomerGroupSelect() {
  const select = $('customer-group-select');
  // Prefer the current DOM value, fall back to the last-used customer group
  const previousValue = select.value || lastUsed.customerGroup || '';
  select.innerHTML = '';

  const none = document.createElement('option');
  none.value = '';
  none.textContent = '— Ninguno (no se envía) —';
  select.appendChild(none);

  const groups = activeEnvironment ? (activeEnvironment.customerGroups || []) : [];
  groups.forEach((g) => {
    const opt = document.createElement('option');
    opt.value = g.id;
    opt.textContent = customerGroupText(g);
    select.appendChild(opt);
  });

  select.value = groups.some((g) => g.id === previousValue) ? previousValue : '';
  select.disabled = !activeEnvironment;
  $('btn-open-cg-manager').disabled = !activeEnvironment;

  // Keep lastUsed in sync with the effective selection
  if (lastUsed.customerGroup !== select.value) setLastUsed('customerGroup', select.value);

  renderActiveHeaders();
}

function initCustomerGroups() {
  const select = $('customer-group-select');
  select.addEventListener('change', () => {
    setLastUsed('customerGroup', select.value);
    resetFacetContext();
    renderActiveHeaders();
  });

  $('btn-open-cg-manager').addEventListener('click', openCgModal);
  $('btn-close-cg-modal').addEventListener('click', closeCgModal);
  $('cg-modal-overlay').addEventListener('click', (e) => {
    if (e.target === $('cg-modal-overlay')) closeCgModal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && $('cg-modal-overlay').style.display !== 'none') closeCgModal();
  });

  $('btn-save-cg').addEventListener('click', saveCustomerGroup);
  $('btn-cancel-cg-edit').addEventListener('click', resetCgForm);
  $('new-cg-id').addEventListener('input', syncCgHashField);
  ['new-cg-id', 'new-cg-hash', 'new-cg-label'].forEach((id) => {
    $(id).addEventListener('keydown', (e) => { if (e.key === 'Enter') saveCustomerGroup(); });
  });

  populateCustomerGroupSelect();
}

// Customer group id being edited (null when adding a new one)
let editingCgId = null;

function openCgModal() {
  if (!activeEnvironment) return;
  resetCgForm();
  renderCgManager();
  $('cg-modal-overlay').style.display = 'flex';
  document.body.style.overflow = 'hidden';
}

function closeCgModal() {
  $('cg-modal-overlay').style.display = 'none';
  document.body.style.overflow = '';
}

function showCgFormError(msg) {
  const el = $('cg-form-error');
  el.textContent = msg;
  el.style.display = msg ? 'block' : 'none';
}

function resetCgForm() {
  editingCgId = null;
  $('new-cg-id').value = '';
  const hashInput = $('new-cg-hash');
  hashInput.value = '';
  hashInput.readOnly = false;
  hashInput.dataset.auto = '';
  $('new-cg-label').value = '';
  $('btn-save-cg').textContent = 'Añadir customer group';
  $('btn-cancel-cg-edit').style.display = 'none';
  showCgFormError('');
}

// With an ID the hash is computed (read-only); without it the hash is typed by hand
function syncCgHashField() {
  const idValue = $('new-cg-id').value.trim();
  const hashInput = $('new-cg-hash');
  const auto = idValue !== '';

  hashInput.readOnly = auto;
  if (auto) hashInput.value = /^\d+$/.test(idValue) ? sha1Hex(idValue) : '';
  else if (hashInput.dataset.auto === '1') hashInput.value = '';
  hashInput.dataset.auto = auto ? '1' : '';
}

function startEditCustomerGroup(group) {
  editingCgId = group.id;
  $('new-cg-id').value = group.groupId;
  syncCgHashField();
  if (group.groupId === '') $('new-cg-hash').value = group.hash;
  $('new-cg-label').value = group.label || '';
  $('btn-save-cg').textContent = 'Guardar cambios';
  $('btn-cancel-cg-edit').style.display = 'block';
  showCgFormError('');
  $('new-cg-label').focus();
}

function renderCgManager() {
  const groups = activeEnvironment.customerGroups;
  const list = $('cg-list');
  list.innerHTML = '';

  $('cg-count').textContent = groups.length;
  $('cg-context').innerHTML = `Customer groups del entorno <strong>${escHtml(activeEnvironment.label)}</strong>`;

  if (groups.length === 0) {
    list.innerHTML = '<div class="ws-empty">Sin customer groups. Añade uno abajo.</div>';
    return;
  }

  groups.forEach((group) => {
    const item = document.createElement('div');
    item.className = 'ws-item';
    const title = group.label || (group.groupId !== '' ? `ID ${group.groupId}` : 'Hash manual');
    const detail = `${group.groupId !== '' ? `ID ${group.groupId} · ` : ''}${group.hash}`;

    item.innerHTML = `
      <div class="ws-item-info">
        <div class="ws-item-code">${escHtml(title)}</div>
        <div class="ws-item-label" title="${escHtml(detail)}">${escHtml(detail)}</div>
      </div>
      <button class="env-item-edit cg-edit-btn" title="Editar customer group">&#x270E;</button>
      <button class="env-item-delete cg-delete-btn" title="Eliminar customer group">&#x2715;</button>
    `;

    item.querySelector('.cg-edit-btn').addEventListener('click', () => startEditCustomerGroup(group));

    item.querySelector('.cg-delete-btn').addEventListener('click', () => {
      const wasSelected = $('customer-group-select').value === group.id;
      if (editingCgId === group.id) resetCgForm();
      activeEnvironment.customerGroups = groups.filter((g) => g !== group);
      saveProjects();
      renderCgManager();
      populateCustomerGroupSelect();
      if (wasSelected) resetFacetContext();
    });

    list.appendChild(item);
  });
}

function saveCustomerGroup() {
  if (!activeEnvironment) return;
  const idInput = $('new-cg-id');
  const hashInput = $('new-cg-hash');
  const groupId = idInput.value.trim();
  const label = $('new-cg-label').value.trim();
  let hash;

  if (groupId) {
    if (!/^\d+$/.test(groupId)) {
      showFieldError(idInput);
      showCgFormError('El ID del customer group debe ser un número entero (0, 1, 2...).');
      return;
    }
    hash = sha1Hex(groupId);
  } else {
    hash = hashInput.value.trim();
    if (!hash) {
      showFieldError(idInput);
      showCgFormError('Indica el ID del customer group o, si lo prefieres, el hash manualmente.');
      return;
    }
    if (!/^[0-9a-f]{40}$/i.test(hash)) {
      showFieldError(hashInput);
      showCgFormError('El hash debe tener 40 caracteres hexadecimales (sha1 del ID).');
      return;
    }
    hash = hash.toLowerCase();
  }

  const groups = activeEnvironment.customerGroups;
  if (groups.some((g) => g.hash === hash && g.id !== editingCgId)) {
    showFieldError(groupId ? idInput : hashInput);
    showCgFormError('Ya existe un customer group con ese hash en este entorno.');
    return;
  }

  let changedSelected = false;
  if (editingCgId) {
    const group = groups.find((g) => g.id === editingCgId);
    if (group) {
      group.groupId = groupId;
      group.hash = hash;
      group.label = label;
      changedSelected = $('customer-group-select').value === group.id;
    }
  } else {
    groups.push({ id: newId(), groupId, hash, label });
  }

  saveProjects();
  resetCgForm();
  renderCgManager();
  populateCustomerGroupSelect();
  if (changedSelected) resetFacetContext();
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

// x-api-key of the active environment, or the default one when it has none
function getApiKey() {
  const custom = activeEnvironment && activeEnvironment.apiKey ? activeEnvironment.apiKey.trim() : '';
  return custom || DEFAULT_API_KEY;
}

// Single source of truth for the headers: [name, value] in display order.
// magento-customer-group is only present when a customer group is selected.
function getActiveHeaders() {
  const headers = [
    ['magento-environment-id', activeEnvironment ? activeEnvironment.environmentId : ''],
    ['magento-website-code', $('website-select').value],
    ['magento-store-code', $('store-select').value],
    ['magento-store-view-code', $('store-view-select').value],
  ];

  const group = getActiveCustomerGroup();
  if (group) headers.push(['magento-customer-group', group.hash]);

  headers.push(['x-api-key', getApiKey()]);
  return headers;
}

function buildHeaders() {
  const headers = { 'Content-Type': 'application/json' };
  getActiveHeaders().forEach(([name, value]) => {
    headers[name] = value;
  });
  return headers;
}

// Sidebar "Headers activos": shows exactly what buildHeaders() sends
function renderActiveHeaders() {
  const container = $('active-headers');
  if (!container) return;

  const group = getActiveCustomerGroup();
  const hasCustomKey = !!(activeEnvironment && activeEnvironment.apiKey && activeEnvironment.apiKey.trim());
  const row = (name, valueHtml) => `
    <div class="active-header">
      <span class="active-header-name">${name}</span>
      <span class="active-header-value">${valueHtml}</span>
    </div>`;
  const empty = (text) => `<span class="active-header-empty">${text}</span>`;

  const headers = getActiveHeaders();
  const sent = new Set(headers.map(([name]) => name));
  const rows = [];

  headers.forEach(([name, value]) => {
    // Show the optional header even when it is not sent
    if (name === 'x-api-key' && !sent.has('magento-customer-group')) {
      rows.push(row('magento-customer-group', empty('no se envía')));
    }

    let valueHtml = value ? escHtml(value) : empty('sin valor');
    if (name === 'magento-customer-group') {
      valueHtml = `${escHtml(customerGroupText(group))}<span class="active-header-sub">${escHtml(value)}</span>`;
    } else if (name === 'x-api-key' && !hasCustomKey) {
      valueHtml += ' <span class="active-header-tag">por defecto</span>';
    }
    rows.push(row(name, valueHtml));
  });

  container.innerHTML = rows.join('');
}

// ===== VALIDATE BEFORE CALL =====

function validateConfig() {
  if (!activeProject) {
    return ['No hay ningún proyecto. Crea o selecciona uno en el panel izquierdo.'];
  }

  const errors = [];

  if (!activeEnvironment) {
    errors.push('No hay ningún entorno seleccionado. Añade y selecciona un Environment ID en el panel izquierdo.');
  }

  const website = $('website-select').value;
  if (!website) {
    errors.push('Selecciona un Website Code.');
  }

  const store = $('store-select').value;
  if (!store) {
    errors.push('Selecciona un Store Code.');
  }

  const storeView = $('store-view-select').value;
  if (!storeView) {
    errors.push('Selecciona un Store View Code.');
  }

  return errors;
}

// ===== GRAPHQL FETCH =====

// Headers actually sent with each GraphQL response, so the displayed request matches
// what was sent even if the panel context changes while the request is in flight
const sentHeadersByResponse = new WeakMap();

// Formats the request (headers, query and variables) for display purposes.
// `result` is the object returned by graphqlFetch; without it the current headers are used.
function formatSentQuery(query, variables, result) {
  const headers = (result && sentHeadersByResponse.get(result)) || buildHeaders();
  const headerLines = Object.entries(headers).map(([name, value]) => `${name}: ${value}`).join('\n');
  const vars = JSON.stringify(variables, null, 2);
  return `# Headers\n${headerLines}\n\n# Query\n${query}\n\n# Variables\n${vars}`;
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
  if (json && typeof json === 'object') sentHeadersByResponse.set(json, headers);

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
query ProductSearch($phrase: String!, $pageSize: Int, $currentPage: Int, $filter: [SearchClauseInput!], $sort: [ProductSearchSortInput!]) {
  productSearch(phrase: $phrase, page_size: $pageSize, current_page: $currentPage, filter: $filter, sort: $sort) {
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

// Map<contextKey, Promise<{filterable, sortable: Set<string>, filterableList, sortableList: object[], raw} | null>>
const attributeMetadataCache = new Map();

function getContextKey() {
  const envId = activeEnvironment ? activeEnvironment.environmentId : '';
  const group = getActiveCustomerGroup();
  return [
    envId,
    $('website-select').value,
    $('store-select').value,
    $('store-view-select').value,
    group ? group.hash : '',
  ].join('|');
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
        return {
          filterable: names(meta.filterableInSearch),
          sortable: names(meta.sortable),
          sortableList: meta.sortable || [],
          filterableList: meta.filterableInSearch || [],
          raw: data,
        };
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

// ===== METADATA TAB =====

// Merged rows (one per attribute) from the cached filterable / sortable lists
function buildMetadataRows(metadata) {
  const rows = new Map();
  const add = (list, flag) => list.forEach((a) => {
    const row = rows.get(a.attribute) || { attribute: a.attribute, label: a.label, frontendInput: a.frontendInput, numeric: a.numeric, filterable: false, sortable: false };
    row[flag] = true;
    rows.set(a.attribute, row);
  });
  add(metadata.filterableList, 'filterable');
  add(metadata.sortableList, 'sortable');
  return [...rows.values()].sort((a, b) => a.attribute.localeCompare(b.attribute));
}

let metadataRows = [];

function renderMetadataTable() {
  const text = $('metadata-search').value.trim().toLowerCase();
  const capability = $('metadata-capability').value;
  const input = $('metadata-input').value;

  const rows = metadataRows.filter((r) => {
    if (capability === 'filterable' && !r.filterable) return false;
    if (capability === 'sortable' && !r.sortable) return false;
    if (capability === 'both' && !(r.filterable && r.sortable)) return false;
    if (input && r.frontendInput !== input) return false;
    return !text || r.attribute.toLowerCase().includes(text) || (r.label || '').toLowerCase().includes(text);
  });

  const yes = '<span class="meta-flag yes">Sí</span>';
  const no = '<span class="meta-flag">No</span>';
  $('metadata-count').textContent = `${rows.length} de ${metadataRows.length}`;
  $('metadata-tbody').innerHTML = rows.map((r) => `
    <tr>
      <td class="meta-attr">${escHtml(r.attribute)}</td>
      <td>${escHtml(r.label || '')}</td>
      <td>${escHtml(r.frontendInput || '')}</td>
      <td>${r.numeric ? yes : no}</td>
      <td>${r.filterable ? yes : no}</td>
      <td>${r.sortable ? yes : no}</td>
    </tr>`).join('') || '<tr><td colspan="6" class="meta-empty">Ningún atributo coincide con el filtro.</td></tr>';
}

async function runMetadataLoad() {
  const show = (id, visible) => { $(id).style.display = visible ? '' : 'none'; };
  show('metadata-error', false);
  show('metadata-results', false);
  show('metadata-raw-container', false);
  show('metadata-query-container', false);
  show('metadata-initial-state', false);

  const errors = validateConfig();
  if (errors.length > 0) {
    $('metadata-error').querySelector('pre').textContent = errors.map((e) => `• ${e}`).join('\n');
    show('metadata-error', true);
    return;
  }

  $('metadata-loading').classList.add('visible');
  $('btn-metadata-load').disabled = true;
  attributeMetadataCache.delete(getContextKey()); // always fetch fresh data on explicit load
  const metadata = await getAttributeMetadata();
  $('metadata-loading').classList.remove('visible');
  $('btn-metadata-load').disabled = false;

  $('metadata-query-pre').textContent = formatSentQuery(ATTRIBUTE_METADATA_QUERY, {}, metadata && metadata.raw);
  show('metadata-query-container', true);

  if (!metadata) {
    $('metadata-error').querySelector('pre').textContent = 'No se pudo cargar attributeMetadata de este contexto (revisa la consola).';
    show('metadata-error', true);
    return;
  }

  metadataRows = buildMetadataRows(metadata);
  const both = metadataRows.filter((r) => r.filterable && r.sortable).length;
  $('metadata-summary').innerHTML = `
    <span><strong>${metadata.filterableList.length}</strong> filtrables</span>
    <span><strong>${metadata.sortableList.length}</strong> ordenables</span>
    <span><strong>${both}</strong> ambos</span>
    <span><strong>${metadataRows.length}</strong> atributos en total</span>`;

  const inputs = [...new Set(metadataRows.map((r) => r.frontendInput).filter(Boolean))].sort();
  $('metadata-input').innerHTML = '<option value="">Todos los tipos de input</option>'
    + inputs.map((i) => `<option value="${escHtml(i)}">${escHtml(i)}</option>`).join('');

  renderMetadataTable();
  show('metadata-results', true);
  $('metadata-raw-pre').textContent = JSON.stringify(metadata.raw, null, 2);
  show('metadata-raw-container', true);
}

function initMetadataTab() {
  $('btn-metadata-load').addEventListener('click', runMetadataLoad);
  ['metadata-search', 'metadata-capability', 'metadata-input'].forEach((id) => {
    $(id).addEventListener(id === 'metadata-search' ? 'input' : 'change', renderMetadataTable);
  });
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

// ===== PRODUCT SORT (saved per environment) =====

// { [environmentId]: { attribute, direction: 'ASC' | 'DESC' } }
let productSortByEnv = {};

// True when the saved sort was ignored because its attribute is no longer sortable in the current context
let productSortInvalid = false;

function loadProductSort() {
  try {
    const raw = JSON.parse(localStorage.getItem(LS_SORT_KEY));
    productSortByEnv = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  } catch {
    productSortByEnv = {};
  }
}

function saveProductSort() {
  localStorage.setItem(LS_SORT_KEY, JSON.stringify(productSortByEnv));
}

// Saved sort of the active environment, or null
function getProductSort() {
  const sort = activeEnvironment ? productSortByEnv[activeEnvironment.id] : null;
  const valid = sort && typeof sort.attribute === 'string' && (sort.direction === 'ASC' || sort.direction === 'DESC');
  return valid ? sort : null;
}

function setProductSort(sort) {
  if (!activeEnvironment) return;
  if (sort) productSortByEnv[activeEnvironment.id] = sort;
  else delete productSortByEnv[activeEnvironment.id];
  saveProductSort();
}

// The saved sort if it can be sent: its attribute must still be sortable.
// Without metadata it cannot be validated, so it is sent as saved.
function resolveProductSort(saved, metadata) {
  if (!saved) return null;
  if (!metadata || metadata.sortable.has(saved.attribute)) return saved;
  return null;
}

function updateSortButton() {
  const sort = getProductSort();
  const btn = $('btn-product-sort');
  const badge = $('product-sort-badge');

  if (!sort) {
    badge.style.display = 'none';
    btn.title = '';
    return;
  }
  badge.style.display = 'inline-block';
  badge.classList.toggle('warning', productSortInvalid);
  badge.textContent = productSortInvalid ? '!' : (sort.direction === 'ASC' ? '↑' : '↓');
  btn.title = productSortInvalid
    ? `El orden guardado "${sort.attribute}" ya no es ordenable en este contexto y se ha ignorado`
    : `Orden: ${sort.attribute} ${sort.direction}`;
}

function openSortModal() {
  $('sort-modal-overlay').style.display = 'flex';
  document.body.style.overflow = 'hidden';
  renderSortModal();
}

function closeSortModal() {
  $('sort-modal-overlay').style.display = 'none';
  document.body.style.overflow = '';
}

async function renderSortModal() {
  const content = $('sort-modal-content');
  const message = (text) => { content.innerHTML = `<p class="sort-modal-msg">${text}</p>`; };

  const errors = validateConfig();
  if (errors.length > 0) {
    message(errors.map(escHtml).join('<br>'));
    return;
  }

  message('Cargando atributos ordenables...');
  const metadata = await getAttributeMetadata();
  if ($('sort-modal-overlay').style.display === 'none') return; // closed while loading

  if (!metadata) {
    message('No se pudieron cargar los atributos ordenables de este contexto.');
    return;
  }

  const saved = getProductSort();
  const stale = saved && !metadata.sortable.has(saved.attribute);
  const current = saved
    ? `
      <div class="sort-current${stale ? ' warning' : ''}">
        <span>${stale
          ? `El orden guardado <strong>${escHtml(saved.attribute)}</strong> ya no es ordenable en este contexto y se ignora.`
          : `Orden actual: <strong>${escHtml(saved.attribute)}</strong> ${saved.direction}`}</span>
        <button type="button" class="sort-clear">Quitar orden</button>
      </div>`
    : '';

  const rows = [...metadata.sortableList]
    .sort((a, b) => (a.label || a.attribute).localeCompare(b.label || b.attribute))
    .map((a) => {
      const dirBtn = (dir) => {
        const active = saved && saved.attribute === a.attribute && saved.direction === dir && !stale;
        return `<button type="button" class="sort-dir-btn${active ? ' active' : ''}"
          data-attribute="${escHtml(a.attribute)}" data-direction="${dir}">${dir}</button>`;
      };
      return `
        <div class="sort-row">
          <div class="sort-row-name">
            <span>${escHtml(a.label || a.attribute)}</span>
            <span class="sort-row-attr">${escHtml(a.attribute)}</span>
          </div>
          <div class="sort-row-dirs">${dirBtn('ASC')}${dirBtn('DESC')}</div>
        </div>`;
    }).join('');

  content.innerHTML = current + (rows || '<p class="sort-modal-msg">Este contexto no tiene atributos ordenables.</p>');
}

// sort: { attribute, direction } or null to restore the default (relevance) order
function applyProductSort(sort) {
  setProductSort(sort);
  productSortInvalid = false;
  updateSortButton();
  closeSortModal();
  // Re-run the active search; without one the sort is just saved for the next search
  if (currentProductPhrase) runProductSearch(1, true);
}

function initProductSort() {
  loadProductSort();
  updateSortButton();

  $('btn-product-sort').addEventListener('click', openSortModal);
  $('btn-close-sort-modal').addEventListener('click', closeSortModal);
  $('sort-modal-overlay').addEventListener('click', (e) => {
    if (e.target === $('sort-modal-overlay')) closeSortModal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && $('sort-modal-overlay').style.display !== 'none') closeSortModal();
  });

  $('sort-modal-content').addEventListener('click', (e) => {
    if (e.target.closest('.sort-clear')) {
      applyProductSort(null);
      return;
    }
    const btn = e.target.closest('.sort-dir-btn');
    if (!btn) return;
    const { attribute, direction } = btn.dataset;
    const saved = getProductSort();
    // Clicking the active option again clears the sort
    const same = saved && saved.attribute === attribute && saved.direction === direction;
    applyProductSort(same ? null : { attribute, direction });
  });
}

// Context changed (environment, website or store view): filters, facets and metadata are no longer valid
function resetFacetContext() {
  activeFacetFilters.clear();
  attributeMetadataCache.clear();
  metadataRows = [];
  ['metadata-results', 'metadata-raw-container', 'metadata-query-container', 'metadata-error'].forEach((id) => {
    const el = $(id);
    if (el) el.style.display = 'none';
  });
  const metaInitial = $('metadata-initial-state');
  if (metaInitial) metaInitial.style.display = '';
  productSortInvalid = false;
  updateSortButton();
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
  initProductSort();

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

  // The saved sort is only sent while its attribute is still sortable, so wait for the metadata
  const savedSort = getProductSort();
  const sort = resolveProductSort(savedSort, savedSort ? await metadataPromise : null);
  productSortInvalid = !!savedSort && !sort;
  updateSortButton();
  if (sort) variables.sort = [sort];

  try {
    const data = await graphqlFetch(PRODUCT_SEARCH_QUERY, variables);
    const metadata = await metadataPromise;

    $('products-loading').classList.remove('visible');
    $('btn-product-search').disabled = false;

    // Show raw JSON
    $('products-raw-pre').textContent = JSON.stringify(data, null, 2);
    $('products-raw-container').style.display = 'block';

    // Show sent query
    $('products-query-pre').textContent = formatSentQuery(PRODUCT_SEARCH_QUERY, variables, data);
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

    $('psku-query-pre').textContent = formatSentQuery(PRODUCTS_BY_SKU_QUERY, variables, data);
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
    $('categories-query-pre').textContent = formatSentQuery(CATEGORIES_QUERY, variables, data);
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
    $('cat-products-query-pre').textContent = formatSentQuery(CATEGORY_PRODUCTS_QUERY, variables, data);
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

const PRODUCT_OPTIONS_QUERY = `query Products($skus: [String]!) {
  products(skus: $skus) {
    ... on ComplexProductView {
      options {
        id
        title
        required
        multi
        values {
          id
          title
          inStock
          ... on ProductViewOptionValueSwatch {
            type
            value
          }
          ... on ProductViewOptionValueProduct {
            quantity
            isDefault
            product {
              sku
              name
              inStock
              ... on SimpleProductView {
                price {
                  final {
                    amount {
                      value
                      currency
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
}`;

const PRODUCT_VARIANTS_QUERY = `query Variants($sku: String!, $pageSize: Int, $cursor: String) {
  variants(sku: $sku, pageSize: $pageSize, cursor: $cursor) {
    variants {
      selections
      product {
        sku
        name
        inStock
        ... on SimpleProductView {
          price {
            final {
              amount {
                value
                currency
              }
            }
          }
        }
      }
    }
    cursor
  }
}`;

const VARIANTS_PAGE_SIZE = 100; // maximum allowed by the variants query

// SKU of the complex product whose options/variants the modal is showing (ignores stale responses)
let variantsRequestSku = null;

// State of the variants being listed in the modal: { labels, rows, cursor, queries }
let variantsState = null;

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

function formatProductPrice(product) {
  const amount = product && product.price && product.price.final && product.price.final.amount;
  return amount && amount.value != null ? `${amount.value} ${amount.currency || ''}`.trim() : '—';
}

function stockHtml(inStock) {
  if (inStock === true) return '<span class="stock-in">Sí</span>';
  if (inStock === false) return '<span class="stock-out">No</span>';
  return '—';
}

// Sent requests of the modal (options + each variants page), each with its real headers
function renderModalQueries(blocks) {
  const el = $('pmd-query-body');
  if (!el) return;
  el.innerHTML = blocks.map((b) => `
    <details class="raw-json" style="margin-top:10px">
      <summary>Ver consulta GraphQL enviada · ${escHtml(b.title)}</summary>
      <pre class="raw-json-pre">${escHtml(b.text)}</pre>
    </details>
  `).join('');
}

function buildOptionValueChip(v) {
  const swatch = v.type === 'COLOR_HEX' && /^#[0-9a-f]{3,8}$/i.test(v.value || '')
    ? `<span class="opt-swatch" style="background:${v.value}"></span>`
    : '';
  const stock = v.inStock === false ? ' <span class="stock-out">sin stock</span>' : '';
  return `<span class="opt-chip" title="${escHtml(v.id || '')}">${swatch}${escHtml(v.title || v.value || '—')}${stock}</span>`;
}

function buildOptionsHtml(options) {
  return options.filter(Boolean).map((opt) => {
    const flags = [opt.required ? 'obligatoria' : '', opt.multi ? 'múltiple' : '']
      .filter(Boolean).map((f) => `<span class="attrs-role">${f}</span>`).join(' ');
    const values = (opt.values || []).filter(Boolean);
    const productValues = values.filter((v) => v.product);
    const otherValues = values.filter((v) => !v.product);

    const table = productValues.length === 0 ? '' : `
      <div class="pmd-table-wrap">
        <table class="pmd-attrs-table">
          <thead><tr><th>SKU</th><th>Nombre</th><th class="col-narrow">Cant.</th><th class="col-narrow">Defecto</th><th class="col-narrow">Stock</th><th>Precio</th></tr></thead>
          <tbody>${productValues.map((v) => `
            <tr>
              <td class="pmd-attr-name"><span class="product-sku">${escHtml(v.product.sku || '—')}</span></td>
              <td class="pmd-attr-value col-wide">${escHtml(v.product.name || v.title || '—')}</td>
              <td class="pmd-attr-value col-narrow">${v.quantity != null ? escHtml(String(v.quantity)) : '—'}</td>
              <td class="pmd-attr-value col-narrow">${v.isDefault ? 'Sí' : ''}</td>
              <td class="pmd-attr-value col-narrow">${stockHtml(v.product.inStock != null ? v.product.inStock : v.inStock)}</td>
              <td class="pmd-attr-value col-price">${escHtml(formatProductPrice(v.product))}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>`;
    const chips = otherValues.length === 0 ? '' : `<div class="opt-chips">${otherValues.map(buildOptionValueChip).join('')}</div>`;

    return `
      <details class="pmd-option">
        <summary class="pmd-option-title">
          <svg class="summary-chevron" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>
          ${escHtml(opt.title || opt.id || 'Opción')} ${flags}
          <span class="tab-pill">${values.length}</span>
        </summary>
        ${table}${chips}
      </details>`;
  }).join('');
}

// A configurable has option values that are not products (swatch / configuration values)
function isConfigurableOptions(options) {
  return options.some((o) => o && (o.values || []).some((v) => v && !v.product));
}

function renderVariants(state) {
  const body = $('pmd-variants-body');
  if (!body) return;
  $('pmd-variants-count').textContent = state.rows.length + (state.cursor ? '+' : '');

  const rows = state.rows.map((v) => {
    const sel = (v.selections || []).map((id) => (state.labels.has(id)
      ? `<span class="opt-chip">${escHtml(state.labels.get(id))}</span>`
      : `<span class="opt-chip opt-chip-raw" title="Sin coincidencia en las opciones">${escHtml(id)}</span>`)).join('');
    const p = v.product || {};
    return `
      <tr>
        <td class="pmd-attr-name"><span class="product-sku">${escHtml(p.sku || '—')}</span></td>
        <td class="pmd-attr-value col-wide">${escHtml(p.name || '—')}</td>
        <td class="pmd-attr-value"><div class="opt-chips">${sel}</div></td>
        <td class="pmd-attr-value col-narrow">${stockHtml(p.inStock)}</td>
        <td class="pmd-attr-value col-price">${escHtml(formatProductPrice(p))}</td>
      </tr>`;
  }).join('');

  body.innerHTML = `
    ${state.error ? `<p class="pmd-empty">${escHtml(state.error)}</p>` : ''}
    ${state.rows.length === 0 && !state.error && !state.loading ? '<p class="pmd-empty">Sin variantes.</p>' : ''}
    ${state.rows.length === 0 ? '' : `
      <div class="pmd-table-wrap">
        <table class="pmd-attrs-table">
          <thead><tr><th>SKU</th><th>Nombre</th><th>Selecciones</th><th class="col-narrow">Stock</th><th>Precio</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`}
    ${state.loading ? '<p class="pmd-empty">Cargando…</p>' : ''}
    ${state.cursor && !state.loading ? '<button id="pmd-variants-more" class="btn btn-secondary btn-sm" style="margin-top:10px">Cargar más variantes</button>' : ''}
  `;

  const more = $('pmd-variants-more');
  if (more) more.addEventListener('click', () => loadVariants(state));
}

async function loadVariants(state) {
  state.loading = true;
  state.error = null;
  renderVariants(state);

  const variables = { sku: state.sku, pageSize: VARIANTS_PAGE_SIZE };
  if (state.cursor) variables.cursor = state.cursor;
  const page = state.queries.length;

  let data;
  try {
    data = await graphqlFetch(PRODUCT_VARIANTS_QUERY, variables);
  } catch (err) {
    if (variantsState !== state) return;
    state.loading = false;
    state.error = `Error de red o del servidor: ${err.message}`;
    state.queries.push({ title: `Variantes (página ${page + 1})`, text: formatSentQuery(PRODUCT_VARIANTS_QUERY, variables) });
    renderVariants(state);
    renderModalQueries(state.queries);
    return;
  }
  if (variantsState !== state) return;

  state.loading = false;
  state.queries.push({ title: `Variantes (página ${page + 1})`, text: formatSentQuery(PRODUCT_VARIANTS_QUERY, variables, data) });

  const result = data?.data?.variants;
  if (data.errors && data.errors.length > 0 && !result) {
    state.error = `Error GraphQL: ${data.errors.map((e) => e.message).join('\n')}`;
  } else if (result) {
    state.rows.push(...(result.variants || []).filter(Boolean));
    state.cursor = result.cursor || null;
  }
  renderVariants(state);
  renderModalQueries(state.queries);
}

async function loadAssociatedProducts(sku) {
  variantsRequestSku = sku;
  const state = { sku, labels: new Map(), rows: [], cursor: null, loading: false, error: null, queries: [] };
  variantsState = state;

  const box = $('pmd-options-body');
  const variables = { skus: [sku] };
  const title = 'Opciones';

  let data;
  try {
    data = await graphqlFetch(PRODUCT_OPTIONS_QUERY, variables);
  } catch (err) {
    if (variantsState !== state) return;
    box.innerHTML = `<p class="pmd-empty">Error de red o del servidor: ${escHtml(err.message)}</p>`;
    renderModalQueries([{ title, text: formatSentQuery(PRODUCT_OPTIONS_QUERY, variables) }]);
    return;
  }
  if (variantsState !== state) return;

  state.queries.push({ title, text: formatSentQuery(PRODUCT_OPTIONS_QUERY, variables, data) });
  renderModalQueries(state.queries);

  if (data.errors && data.errors.length > 0) {
    box.innerHTML = `<p class="pmd-empty">Error GraphQL: ${escHtml(data.errors.map((e) => e.message).join('\n'))}</p>`;
    return;
  }

  const options = ((data?.data?.products || []).filter(Boolean)[0] || {}).options || [];
  if (options.length === 0) {
    box.innerHTML = '<p class="pmd-empty">Sin opciones.</p>';
    return;
  }

  box.innerHTML = buildOptionsHtml(options);

  if (isConfigurableOptions(options)) {
    options.filter(Boolean).forEach((opt) => {
      (opt.values || []).filter(Boolean).forEach((v) => {
        if (v.id) state.labels.set(v.id, `${opt.title || opt.id}: ${v.title || v.value || v.id}`);
      });
    });
    $('pmd-variants-section').style.display = '';
    loadVariants(state);
  }
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
    variantsState = null;
  }
}

function closeProductModal() {
  currentModalPv = null;
  variantsRequestSku = null;
  variantsState = null;
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
        <div class="pmd-section-title">Opciones</div>
        <div id="pmd-options-body"><p class="pmd-empty">Cargando…</p></div>
      </div>
      <div class="pmd-section" id="pmd-variants-section" style="display:none">
        <div class="pmd-section-title">Variantes <span id="pmd-variants-count" class="tab-pill"></span></div>
        <div id="pmd-variants-body"></div>
      </div>
      <div id="pmd-query-body"></div>
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
  loadProjects();
  initSettings();
  initProjectManager();
  initEnvironmentManager();
  initCustomerGroups();
  initWebsiteSelector();
  initWebsiteManager();
  initTabs();
  initProductsTab();
  initProductsBySkuTab();
  initCategoriesTab();
  initCategoryProductsTab();
  initMetadataTab();
  initProductModal();
});
