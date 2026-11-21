/* ============================================================
   PixelForge Studio 3.3 — Orchestrator + RAM Garbage Collector
   ============================================================ */
(function () {
  let currentProject = null;
  let isRestoringHistory = false;
  let isDirty = false;
  let cachedHudCoords = null;

  let uiSyncRaf = 0;
  let pendingUiSync = { layers: false, options: false, props: false, adj: false, effects: false };
  let commitCounter = 0;
  let gcTimer = 0;

  function buildSnapshot() {
    const dims = window.CanvasEngine.getArtboardDims();
    return {
      artboard: { width: dims.width, height: dims.height, ...window.CanvasEngine.getBackground() },
      layers: window.LayerManager.serializeLayers()
    };
  }

  function buildFullProjectPayload() {
    const snap = buildSnapshot();
    const usedAssets = window.LayerManager.getUsedAssets(snap.layers);
    const nameInput = document.getElementById('project-name');
    const name = (nameInput?.value || currentProject?.name || 'Sin título').trim() || 'Sin título';
    return {
      schemaVersion: '3.3',
      id: currentProject?.id || window.ProjectManager.genId(),
      name,
      createdAt: currentProject?.createdAt || Date.now(),
      updatedAt: Date.now(),
      artboard: snap.artboard,
      assets: usedAssets,
      layers: snap.layers,
      thumbnail: window.CanvasEngine.renderThumbnail()
    };
  }

  function runMemoryGC() {
    if (window.CanvasEngine.isBusy?.()) {
      scheduleGC(1200);
      return;
    }
    window.LayerManager.gcAssets(window.HistoryManager.getActiveAssetIds());
  }

  function scheduleGC(delay = 900) {
    if (gcTimer) clearTimeout(gcTimer);
    gcTimer = setTimeout(() => {
      gcTimer = 0;
      runMemoryGC();
    }, delay);
  }

  function queueUiSync({ layers = false, options = false, props = false, adj = false, effects = false } = {}) {
    if (layers) pendingUiSync.layers = true;
    if (options) pendingUiSync.options = true;
    if (props) pendingUiSync.props = true;
    if (adj) pendingUiSync.adj = true;
    if (effects) pendingUiSync.effects = true;

    if (uiSyncRaf) return;
    uiSyncRaf = requestAnimationFrame(() => {
      uiSyncRaf = 0;
      const run = pendingUiSync;
      pendingUiSync = { layers: false, options: false, props: false, adj: false, effects: false };

      if (run.layers) window.UI.renderLayers();
      if (run.options) window.UI.renderOptionsBar();
      if (run.props) window.UI.syncPropertiesPanel();
      if (run.adj) window.UI.syncAdjustmentsPanel();
      if (run.effects) window.UI.syncEffectsPanel();
    });
  }

  function commitState() {
    if (isRestoringHistory || !currentProject) return;
    isDirty = true;
    window.HistoryManager.push(buildSnapshot());
    commitCounter++;
    if (commitCounter % 4 === 0) {
      scheduleGC(450);
    }
    queueUiSync({ layers: true, options: true, props: true });
  }

  function scheduleCommit() {
    if (isRestoringHistory || !currentProject) return;
    isDirty = true;
    window.HistoryManager.schedulePush(() => {
      const snap = buildSnapshot();
      scheduleGC(900);
      return snap;
    }, 320);
  }

  async function applySnapshot(snap) {
    if (!snap) return;
    isRestoringHistory = true;
    try {
      const ab = snap.artboard || { width: 1080, height: 1080, type: 'solid', color: '#ffffff' };
      const cur = window.CanvasEngine.getArtboardDims();
      if (cur.width !== ab.width || cur.height !== ab.height) window.CanvasEngine.createArtboard(ab.width, ab.height, ab);
      else window.CanvasEngine.setBackground(ab);

      await window.LayerManager.deserializeLayers(snap.layers || [], null);
      window.UI.updateArtboardBadge(ab.width, ab.height);
      queueUiSync({ layers: true, options: true, props: true, adj: true, effects: true });
      scheduleGC(700);
      isDirty = true;
    } finally {
      isRestoringHistory = false;
    }
  }

  async function undo() {
    window.HistoryManager.flushPending(buildSnapshot);
    const prev = window.HistoryManager.undo();
    if (prev) await applySnapshot(prev);
  }

  async function redo() {
    const next = window.HistoryManager.redo();
    if (next) await applySnapshot(next);
  }

  async function refreshProjectsList() {
    try {
      const list = await window.ProjectManager.listProjects();
      window.UI.renderProjects(list);
    } catch (_) { window.UI.renderProjects([]); }
  }

  function makeInitialBg(bgMode) {
    if (bgMode === 'transparent') return { type: 'transparent', color: '#ffffff' };
    if (bgMode === 'dark') return { type: 'solid', color: '#111116' };
    return { type: 'solid', color: '#ffffff' };
  }

  async function createNewProject(width, height, bgMode = 'white', name = 'Sin título') {
    const bg = makeInitialBg(bgMode);
    currentProject = {
      schemaVersion: '3.3', id: window.ProjectManager.genId(), name,
      createdAt: Date.now(), updatedAt: Date.now(),
      artboard: { width, height, ...bg }, assets: {}, layers: []
    };
    isDirty = false;
    commitCounter = 0;
    if (gcTimer) { clearTimeout(gcTimer); gcTimer = 0; }
    window.LayerManager.setAssets({});
    window.UI.showScreen('editor');
    document.getElementById('project-name').value = name;
    window.CanvasEngine.createArtboard(width, height, bg);
    window.CanvasEngine.setTool('select');
    window.UI.setActiveTool('select');
    window.UI.updateArtboardBadge(width, height);

    window.HistoryManager.clear();
    window.HistoryManager.push(buildSnapshot());
    queueUiSync({ layers: true, options: true, props: true, adj: true, effects: true });
  }

  async function openProjectData(proj) {
    currentProject = proj;
    isDirty = false;
    commitCounter = 0;
    if (gcTimer) { clearTimeout(gcTimer); gcTimer = 0; }
    const ab = proj.artboard || { width: 1080, height: 1080, type: 'solid', color: '#ffffff' };
    const bg = {
      type: ab.bgType || ab.type || 'solid',
      color: ab.bgColor || ab.color || '#ffffff',
      gradient: ab.bgGradient || ab.gradient || { color1: '#1e1b4b', color2: '#4c1d95', angle: 135 }
    };
    window.UI.showScreen('editor');
    document.getElementById('project-name').value = proj.name || 'Sin título';
    window.CanvasEngine.createArtboard(ab.width, ab.height, bg);
    window.LayerManager.setAssets(proj.assets || {});

    let layers = proj.layers || [];
    if (!layers.length && proj.legacyStageJson) layers = window.LayerManager.extractLegacyLayers(proj.legacyStageJson);
    await window.LayerManager.deserializeLayers(layers, null);

    window.CanvasEngine.setTool('select');
    window.UI.setActiveTool('select');
    window.UI.updateArtboardBadge(ab.width, ab.height);
    window.HistoryManager.clear();
    window.HistoryManager.push(buildSnapshot());
    queueUiSync({ layers: true, options: true, props: true, adj: true, effects: true });
  }

  async function openProject(id) {
    try {
      const proj = await window.ProjectManager.getProject(id);
      if (!proj) { window.UI.toast('No se encontró el proyecto', 'error'); return; }
      await openProjectData(proj);
    } catch (err) {
      console.error(err);
      window.UI.toast('Error al abrir el proyecto', 'error');
    }
  }

  async function openImportedProject(file) {
    try {
      const proj = await window.ProjectManager.importProjectFile(file);
      await window.ProjectManager.saveProject(proj);
      await refreshProjectsList();
      await openProjectData(proj);
      window.UI.toast('Proyecto importado', 'success');
    } catch (err) { window.UI.toast(err.message || 'Archivo inválido', 'error'); }
  }

  async function saveCurrentProject(silent = false) {
    if (!currentProject) return;
    if (silent && window.CanvasEngine.isBusy?.()) return;
    try {
      window.HistoryManager.flushPending(buildSnapshot);
      currentProject = await window.ProjectManager.saveProject(buildFullProjectPayload());
      isDirty = false;
      if (!silent) window.UI.toast('Proyecto guardado', 'success');
    } catch (err) {
      console.error(err);
      if (!silent) window.UI.toast('No se pudo guardar', 'error');
    }
  }

  function downloadProjectFile() {
    if (!currentProject) return;
    window.HistoryManager.flushPending(buildSnapshot);
    window.ProjectManager.exportProjectFile(buildFullProjectPayload());
    window.UI.toast('Archivo .pixelforge descargado', 'success');
  }

  async function deleteProject(id) {
    await window.ProjectManager.deleteProject(id);
    await refreshProjectsList();
    window.UI.toast('Proyecto eliminado');
  }

  async function backToHome() {
    if (currentProject) await saveCurrentProject(true);
    if (gcTimer) { clearTimeout(gcTimer); gcTimer = 0; }
    window.CanvasEngine.cancelCropMode();
    window.LayerManager.setAssets({});
    window.HistoryManager.clear();
    currentProject = null;
    isDirty = false;
    commitCounter = 0;
    await refreshProjectsList();
    window.UI.showScreen('home');
  }

  function setupKeyboardShortcuts() {
    window.addEventListener('keydown', (e) => {
      if (!document.getElementById('screen-editor')?.classList.contains('active')) return;
      const tag = document.activeElement?.tagName;
      const isEditingInput = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';

      if (e.code === 'Space' && !isEditingInput) { e.preventDefault(); window.CanvasEngine.setSpacePanning(true); return; }
      if (isEditingInput) return;

      const ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
      if (ctrl && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
      if (ctrl && e.key.toLowerCase() === 's') { e.preventDefault(); saveCurrentProject(false); return; }
      if (ctrl && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        const sel = window.CanvasEngine.getSelectedNode();
        if (sel) { window.LayerManager.duplicateLayer(sel.id()); commitState(); }
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const sel = window.CanvasEngine.getSelectedNode();
        if (sel) { e.preventDefault(); window.LayerManager.deleteLayer(sel.id()); commitState(); }
        return;
      }

      const sel = window.CanvasEngine.getSelectedNode();
      if (sel && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        if (e.key === 'ArrowUp') sel.y(sel.y() - step);
        if (e.key === 'ArrowDown') sel.y(sel.y() + step);
        if (e.key === 'ArrowLeft') sel.x(sel.x() - step);
        if (e.key === 'ArrowRight') sel.x(sel.x() + step);
        sel.getLayer()?.batchDraw();
        window.UI.syncTransformFieldsOnly();
        scheduleCommit();
        return;
      }

      const keyMap = { v: 'select', h: 'hand', c: 'crop', i: 'eyedropper', b: 'brush', e: 'eraser', k: 'bucket', t: 'text', u: 'shape' };
      const k = e.key.toLowerCase();
      if (keyMap[k]) window.UI.handleToolTrigger(keyMap[k]);
      else if (k === 'g') {
        document.getElementById('btn-toggle-grid')?.classList.toggle('active', window.CanvasEngine.toggleGrid());
      }
    });

    window.addEventListener('keyup', (e) => {
      if (e.code === 'Space') window.CanvasEngine.setSpacePanning(false);
    });
  }

  function setupAutoSave() {
    document.getElementById('project-name')?.addEventListener('input', () => { isDirty = true; });
    setInterval(() => {
      if (currentProject && isDirty && !window.CanvasEngine.isBusy?.()) {
        saveCurrentProject(true);
      }
    }, 75000);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden' && currentProject && isDirty) saveCurrentProject(true);
    });
  }

  document.addEventListener('DOMContentLoaded', async () => {
    window.Icons?.injectAll();
    if (typeof Konva === 'undefined') {
      window.UI?.toast?.('Error: KonvaJS no cargó. Verifica internet la primera vez.', 'error');
      return;
    }

    cachedHudCoords = document.getElementById('hud-coords');
    window.HistoryManager.init((status) => window.UI.updateHistoryButtons(status));
    window.CanvasEngine.init('konva-container', {
      onSelect: () => {
        queueUiSync({ layers: true, options: true, props: true, adj: true, effects: true });
      },
      onTransformChange: () => window.UI.syncTransformFieldsOnly(),
      onCommit: () => commitState(),
      onZoomChange: (z) => window.UI.updateZoomUI(z),
      onCoordsMove: (x, y) => {
        if (cachedHudCoords) cachedHudCoords.textContent = `X: ${x}  Y: ${y}`;
      },
      onColorSampled: (hex) => {
        window.UI.updateActiveColorUI(hex);
        queueUiSync({ options: true });
        window.UI.toast(`Color muestreado: ${hex.toUpperCase()}`);
      },
      onMessage: (msg) => window.UI.toast(msg)
    });

    window.UI.init(window.App);
    setupKeyboardShortcuts();
    setupAutoSave();
    await refreshProjectsList();
  });

  window.App = {
    getCurrentProject: () => currentProject,
    createNewProject, openProject, openImportedProject,
    saveCurrentProject, downloadProjectFile, deleteProject,
    backToHome, commitState, scheduleCommit, undo, redo
  };
})();
