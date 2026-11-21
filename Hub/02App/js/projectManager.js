/* ============================================================
   PixelForge Studio 3.3 — IndexedDB + LocalStorage Fallback
   ============================================================ */
(function () {
  const INDEX_KEY = 'pf_projects_index_v31';
  const PROJ_PREFIX = 'pf_project_v31_';
  const LEGACY_KEYS = ['pixelforge_projects', 'projects', 'pf_projects'];

  const PRESETS = [
    { cat: 'Redes', name: 'Instagram Post', width: 1080, height: 1080 },
    { cat: 'Redes', name: 'Instagram Story / Reel', width: 1080, height: 1920 },
    { cat: 'Redes', name: 'YouTube Miniatura', width: 1280, height: 720 },
    { cat: 'Redes', name: 'Portada / Banner HD', width: 1920, height: 1080 },
    { cat: 'Diseño', name: 'Tarjeta Vertical (4:5)', width: 1080, height: 1350 },
    { cat: 'Diseño', name: 'Twitter / X Post', width: 1200, height: 675 },
    { cat: 'Foto', name: 'Foto 3:2', width: 1800, height: 1200 },
    { cat: 'Impresión', name: 'A4 Vertical (150dpi)', width: 1240, height: 1754 }
  ];

  async function dbGet(key) {
    try {
      if (window.idbKeyval) return await window.idbKeyval.get(key);
    } catch (_) {}
    try {
      const raw = localStorage.getItem('pf_ls_' + key);
      return raw ? JSON.parse(raw) : undefined;
    } catch (_) { return undefined; }
  }

  async function dbSet(key, val) {
    try {
      if (window.idbKeyval) { await window.idbKeyval.set(key, val); return; }
    } catch (_) {}
    try { localStorage.setItem('pf_ls_' + key, JSON.stringify(val)); } catch (_) {}
  }

  async function dbDel(key) {
    try {
      if (window.idbKeyval) { await window.idbKeyval.del(key); return; }
    } catch (_) {}
    try { localStorage.removeItem('pf_ls_' + key); } catch (_) {}
  }

  function genId() {
    return 'pf_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
  }

  async function migrateLegacyIfNeeded() {
    let idx = await dbGet(INDEX_KEY);
    if (Array.isArray(idx)) return idx;
    idx = [];
    for (const key of LEGACY_KEYS) {
      try {
        const legacy = await dbGet(key);
        if (Array.isArray(legacy) && legacy.length) {
          for (const p of legacy) {
            if (!p || !p.id) continue;
            const migrated = normalizeProjectData(p);
            await dbSet(PROJ_PREFIX + migrated.id, migrated);
            idx.push(toMeta(migrated));
          }
        }
      } catch (_) {}
    }
    await dbSet(INDEX_KEY, idx);
    return idx;
  }

  function toMeta(proj) {
    return {
      id: proj.id, name: proj.name || 'Sin título',
      width: proj.artboard?.width || 1080, height: proj.artboard?.height || 1080,
      updatedAt: proj.updatedAt || Date.now(), thumbnail: proj.thumbnail || ''
    };
  }

  function normalizeProjectData(raw) {
    const id = raw.id || genId();
    const width = Number(raw.artboard?.width || raw.width) || 1080;
    const height = Number(raw.artboard?.height || raw.height) || 1080;
    const bgColor = raw.artboard?.bgColor || raw.artboard?.color || raw.bgColor || '#ffffff';
    const bgType = raw.artboard?.bgType || raw.artboard?.type || 'solid';
    const bgGradient = raw.artboard?.bgGradient || raw.artboard?.gradient || { color1: '#1e1b4b', color2: '#4c1d95', angle: 135 };
    const legacyStageJson = (!Array.isArray(raw.layers) && (raw.stageJson || raw.konvaJson || raw.stage))
      ? (raw.stageJson || raw.konvaJson || raw.stage) : null;

    return {
      schemaVersion: '3.3', id, name: raw.name || 'Sin título',
      createdAt: raw.createdAt || Date.now(), updatedAt: raw.updatedAt || Date.now(),
      artboard: { width, height, bgType, bgColor, bgGradient },
      assets: raw.assets || {},
      layers: Array.isArray(raw.layers) ? raw.layers : [],
      legacyStageJson, thumbnail: raw.thumbnail || ''
    };
  }

  async function listProjects() {
    const idx = await migrateLegacyIfNeeded();
    return [...idx].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  }

  async function getProject(id) {
    const data = await dbGet(PROJ_PREFIX + id);
    return data ? normalizeProjectData(data) : null;
  }

  async function saveProject(projectData) {
    const proj = normalizeProjectData({ ...projectData, updatedAt: Date.now() });
    await dbSet(PROJ_PREFIX + proj.id, proj);
    const idx = (await migrateLegacyIfNeeded()).filter((m) => m.id !== proj.id);
    idx.unshift(toMeta(proj));
    await dbSet(INDEX_KEY, idx);
    return proj;
  }

  async function deleteProject(id) {
    await dbDel(PROJ_PREFIX + id);
    const idx = (await migrateLegacyIfNeeded()).filter((m) => m.id !== id);
    await dbSet(INDEX_KEY, idx);
  }

  function exportProjectFile(projectData) {
    const safeName = (projectData.name || 'proyecto').replace(/[^\w\-áéíóúñÁÉÍÓÚÑ ]+/g, '').trim() || 'proyecto';
    const blob = new Blob([JSON.stringify(projectData)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `${safeName}.pixelforge`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function importProjectFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const proj = normalizeProjectData(JSON.parse(reader.result));
          proj.id = genId();
          resolve(proj);
        } catch (_) { reject(new Error('Archivo .pixelforge inválido')); }
      };
      reader.onerror = () => reject(new Error('No se pudo leer el archivo'));
      reader.readAsText(file);
    });
  }

  window.ProjectManager = {
    PRESETS, genId, listProjects, getProject, saveProject,
    deleteProject, exportProjectFile, importProjectFile
  };
})();