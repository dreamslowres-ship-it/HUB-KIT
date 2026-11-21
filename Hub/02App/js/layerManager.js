/* ============================================================
   PixelForge Studio 3.3 — Layer Manager + RAM GC + 64px Thumbs
   ============================================================ */
(function () {
  let assetMap = {};
  const imageCache = new Map();
  const thumbMap = new Map();
  const MAX_CACHED_IMAGES = 16;
  const MAX_CACHED_THUMBS = 40;
  let layerSeq = 1;
  let supportsWebP = null;

  function checkWebP() {
    if (supportsWebP !== null) return supportsWebP;
    try {
      const c = document.createElement('canvas');
      c.width = 2;
      c.height = 2;
      supportsWebP = c.toDataURL('image/webp').startsWith('data:image/webp');
    } catch (_) {
      supportsWebP = false;
    }
    return supportsWebP;
  }

  function canvasToFastDataURL(canvas, quality = 0.82, preserveAlpha = true) {
    if (!canvas) return '';
    const q = Math.max(0.4, Math.min(0.95, quality));
    if (checkWebP()) return canvas.toDataURL('image/webp', q);
    return preserveAlpha ? canvas.toDataURL('image/png') : canvas.toDataURL('image/jpeg', q);
  }

  function uid(prefix = 'layer') {
    return `${prefix}_${Date.now().toString(36)}_${(layerSeq++).toString(36)}`;
  }

  function trimMap(map, maxSize, keepIds = null) {
    while (map.size > maxSize) {
      let removed = false;
      for (const key of map.keys()) {
        if (!keepIds || !keepIds.has(key)) {
          map.delete(key);
          removed = true;
          break;
        }
      }
      if (!removed) break;
    }
  }

  function makeThumb(source) {
    try {
      const w = source.naturalWidth || source.width || 64;
      const h = source.naturalHeight || source.height || 64;
      const s = Math.min(64 / w, 64 / h, 1);
      const cw = Math.max(1, Math.round(w * s));
      const ch = Math.max(1, Math.round(h * s));
      const c = document.createElement('canvas');
      c.width = cw;
      c.height = ch;
      c.getContext('2d').drawImage(source, 0, 0, cw, ch);
      const url = canvasToFastDataURL(c, 0.65, false);
      c.width = 1;
      c.height = 1;
      return url;
    } catch (_) {
      return '';
    }
  }

  function createAssetFromDataURL(dataUrl, sourceEl = null) {
    const len = dataUrl.length;
    for (const [id, val] of Object.entries(assetMap)) {
      if (val.length === len && val === dataUrl) {
        if (sourceEl && !thumbMap.has(id)) {
          thumbMap.set(id, makeThumb(sourceEl));
          trimMap(thumbMap, MAX_CACHED_THUMBS);
        }
        return id;
      }
    }
    const id = uid('asset');
    assetMap[id] = dataUrl;
    if (sourceEl) {
      thumbMap.set(id, makeThumb(sourceEl));
      trimMap(thumbMap, MAX_CACHED_THUMBS);
    }
    return id;
  }

  function getThumbnail(assetId) {
    if (!assetId) return '';
    if (thumbMap.has(assetId)) return thumbMap.get(assetId);
    const cached = imageCache.get(assetId);
    if (cached && cached.complete && cached.naturalWidth > 0) {
      const t = makeThumb(cached);
      thumbMap.set(assetId, t);
      trimMap(thumbMap, MAX_CACHED_THUMBS);
      return t;
    }
    return '';
  }

  function loadImageElement(assetId) {
    if (imageCache.has(assetId)) {
      const cached = imageCache.get(assetId);
      if (cached.complete && cached.naturalWidth > 0) {
        imageCache.delete(assetId);
        imageCache.set(assetId, cached);
        return Promise.resolve(cached);
      }
    }
    const src = assetMap[assetId];
    if (!src) return Promise.reject(new Error('Asset missing: ' + assetId));

    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        imageCache.set(assetId, img);
        trimMap(imageCache, MAX_CACHED_IMAGES);
        if (!thumbMap.has(assetId)) {
          thumbMap.set(assetId, makeThumb(img));
          trimMap(thumbMap, MAX_CACHED_THUMBS);
        }
        resolve(img);
      };
      img.onerror = () => reject(new Error('Failed loading image asset'));
      img.src = src;
    });
  }

  function downscaleImageIfTooLarge(dataUrl, maxDim = 2048) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const w = img.naturalWidth || img.width || 400;
        const h = img.naturalHeight || img.height || 400;
        if (Math.max(w, h) <= maxDim) {
          resolve({ dataUrl, img });
          return;
        }
        const ratio = maxDim / Math.max(w, h);
        const nw = Math.round(w * ratio);
        const nh = Math.round(h * ratio);
        const c = document.createElement('canvas');
        c.width = nw;
        c.height = nh;
        c.getContext('2d').drawImage(img, 0, 0, nw, nh);
        const fastUrl = canvasToFastDataURL(c, 0.85, true);
        c.width = 1;
        c.height = 1;
        const resizedImg = new Image();
        resizedImg.onload = () => resolve({ dataUrl: fastUrl, img: resizedImg });
        resizedImg.onerror = () => resolve({ dataUrl: fastUrl, img });
        resizedImg.src = fastUrl;
      };
      img.onerror = () => reject(new Error('Imagen inválida'));
      img.src = dataUrl;
    });
  }

  function disposeNodeResources(node) {
    if (!node) return;
    if (node._pfCanvas) {
      node._pfCanvas.width = 1;
      node._pfCanvas.height = 1;
      node._pfCanvas = null;
    }
    if (node._pfGlCanvas) {
      node._pfGlCanvas.width = 1;
      node._pfGlCanvas.height = 1;
      node._pfGlCanvas = null;
    }
    node._pfOrigSource = null;
  }

  function gcAssets(keepIdsSet) {
    const keep = new Set(keepIdsSet || []);
    getNodes().forEach((n) => {
      const id = n.getAttr('pfAssetId');
      if (id) keep.add(id);
    });
    for (const id of Object.keys(assetMap)) {
      if (!keep.has(id)) {
        delete assetMap[id];
      }
    }
    for (const id of imageCache.keys()) {
      if (!keep.has(id)) imageCache.delete(id);
    }
    for (const id of thumbMap.keys()) {
      if (!keep.has(id)) thumbMap.delete(id);
    }
    trimMap(imageCache, MAX_CACHED_IMAGES, keep);
    trimMap(thumbMap, MAX_CACHED_THUMBS, keep);
  }

  function setAssets(newAssets) {
    assetMap = { ...(newAssets || {}) };
    imageCache.clear();
    thumbMap.clear();
  }

  function getAssets() {
    return { ...assetMap };
  }

  function getUsedAssets(layersData) {
    const used = {};
    for (const l of layersData || []) {
      if (l.assetId && assetMap[l.assetId]) used[l.assetId] = assetMap[l.assetId];
    }
    return used;
  }

  function getContentGroup() {
    return window.CanvasEngine.getContentGroup();
  }

  function getNodes() {
    const g = getContentGroup();
    return g ? g.getChildren().slice() : [];
  }

  function getNodeById(id) {
    return getNodes().find((n) => n.id() === id) || null;
  }

  function applyLinearGradientFill(node, gradCfg) {
    const c1 = gradCfg?.color1 || '#a78bfa';
    const c2 = gradCfg?.color2 || '#38bdf8';
    const angle = ((gradCfg?.angle ?? 135) * Math.PI) / 180;
    const isCenterOrigin = node.className !== 'Rect';
    const w = node.width ? node.width() : 140;
    const h = node.height ? node.height() : 140;
    const cx = isCenterOrigin ? 0 : w / 2;
    const cy = isCenterOrigin ? 0 : h / 2;
    const r = Math.max(w, h) / 2 || 80;
    const dx = Math.cos(angle) * r;
    const dy = Math.sin(angle) * r;
    node.fillPriority('linear-gradient');
    node.fillLinearGradientStartPoint({ x: cx - dx, y: cy - dy });
    node.fillLinearGradientEndPoint({ x: cx + dx, y: cy + dy });
    node.fillLinearGradientColorStops([0, c1, 1, c2]);
  }

  function applyShapeFillConfig(node, fillCfg) {
    const mode = fillCfg?.mode || 'solid';
    node.setAttr('pfFillConfig', { ...fillCfg, mode });
    if (mode === 'none') {
      node.fillPriority('color');
      node.fill('transparent');
    } else if (mode === 'gradient') {
      applyLinearGradientFill(node, fillCfg.gradient || { color1: '#a78bfa', color2: '#38bdf8', angle: 135 });
    } else {
      node.fillPriority('color');
      node.fill(fillCfg?.color || '#a78bfa');
    }
  }

  async function addImageLayer(dataUrl, name = 'Imagen', exactRect = null) {
    let finalUrl = dataUrl;
    let loadedImg = null;
    if (!exactRect) {
      const res = await downscaleImageIfTooLarge(dataUrl, 2048);
      finalUrl = res.dataUrl;
      loadedImg = res.img;
    }
    const assetId = createAssetFromDataURL(finalUrl, loadedImg);
    if (loadedImg) {
      imageCache.set(assetId, loadedImg);
      trimMap(imageCache, MAX_CACHED_IMAGES);
    }
    const img = loadedImg || await loadImageElement(assetId);

    const { width: aw, height: ah } = window.CanvasEngine.getArtboardDims();
    const natW = img.naturalWidth || img.width || 400;
    const natH = img.naturalHeight || img.height || 400;

    let x, y, w, h;
    if (exactRect) {
      ({ x, y, width: w, height: h } = exactRect);
    } else {
      const ratio = Math.min((aw * 0.75) / natW, (ah * 0.75) / natH, 1);
      w = Math.max(20, Math.round(natW * ratio));
      h = Math.max(20, Math.round(natH * ratio));
      x = Math.round((aw - w) / 2);
      y = Math.round((ah - h) / 2);
    }

    const node = new Konva.Image({ id: uid('img'), name: 'pf-user-node', image: img, x, y, width: w, height: h, draggable: true });
    node._pfOrigSource = img;
    node.setAttr('pfType', 'image');
    node.setAttr('pfName', name);
    node.setAttr('pfAssetId', assetId);
    node.setAttr('pfLocked', false);
    node.setAttr('pfAdjustments', { ...window.AdjustmentEngine.DEFAULTS });

    getContentGroup().add(node);
    window.CanvasEngine.selectNode(node);
    return node;
  }

  function addPaintLayer(name = 'Capa de dibujo') {
    const { width: aw, height: ah } = window.CanvasEngine.getArtboardDims();
    const canvas = document.createElement('canvas');
    canvas.width = aw;
    canvas.height = ah;
    const assetId = createAssetFromDataURL(canvasToFastDataURL(canvas, 0.82, true), canvas);

    const node = new Konva.Image({ id: uid('paint'), name: 'pf-user-node', image: canvas, x: 0, y: 0, width: aw, height: ah, draggable: true });
    node._pfCanvas = canvas;
    node._pfOrigSource = canvas;
    node.setAttr('pfType', 'paint');
    node.setAttr('pfName', name);
    node.setAttr('pfAssetId', assetId);
    node.setAttr('pfLocked', false);
    node.setAttr('pfAdjustments', { ...window.AdjustmentEngine.DEFAULTS });

    getContentGroup().add(node);
    window.CanvasEngine.selectNode(node);
    return node;
  }

  function addTextLayer(opts = {}) {
    const { width: aw, height: ah } = window.CanvasEngine.getArtboardDims();
    const fontSize = opts.fontSize || Math.max(28, Math.round(Math.min(aw, ah) * 0.065));
    const boxW = Math.min(aw * 0.8, Math.max(220, fontSize * 8));

    const node = new Konva.Text({
      id: uid('txt'), name: 'pf-user-node', text: opts.text || 'Doble toque para editar',
      x: Math.round((aw - boxW) / 2), y: Math.round(ah / 2 - fontSize / 2),
      width: boxW, fontSize, fontFamily: opts.fontFamily || 'Inter',
      fill: opts.fill || '#111111', align: 'center', lineHeight: 1.2,
      letterSpacing: 0, fillAfterStrokeEnabled: true, stroke: '#000000', strokeWidth: 0, draggable: true
    });
    node.setAttr('pfType', 'text');
    node.setAttr('pfName', 'Texto');
    node.setAttr('pfLocked', false);
    node.setAttr('pfUppercase', false);
    node.setAttr('pfRawText', node.text());

    getContentGroup().add(node);
    window.CanvasEngine.selectNode(node);
    return node;
  }

  function addShapeLayer(shapeType = 'rect', activeColor = '#a78bfa') {
    const { width: aw, height: ah } = window.CanvasEngine.getArtboardDims();
    const base = Math.max(80, Math.round(Math.min(aw, ah) * 0.24));
    const cx = Math.round(aw / 2);
    const cy = Math.round(ah / 2);
    const common = { id: uid('shp'), name: 'pf-user-node', draggable: true, stroke: '#ffffff', strokeWidth: 0 };
    let node, label = 'Forma';
    const fillCfg = { mode: 'solid', color: activeColor, gradient: { color1: activeColor, color2: '#38bdf8', angle: 135 } };

    switch (shapeType) {
      case 'circle': node = new Konva.Circle({ ...common, x: cx, y: cy, radius: Math.round(base / 2) }); label = 'Círculo'; break;
      case 'ellipse': node = new Konva.Ellipse({ ...common, x: cx, y: cy, radiusX: Math.round(base * 0.65), radiusY: Math.round(base * 0.4) }); label = 'Elipse'; break;
      case 'triangle': node = new Konva.RegularPolygon({ ...common, x: cx, y: cy, sides: 3, radius: Math.round(base * 0.58) }); label = 'Triángulo'; break;
      case 'polygon': node = new Konva.RegularPolygon({ ...common, x: cx, y: cy, sides: 6, radius: Math.round(base * 0.55) }); label = 'Polígono'; break;
      case 'star': node = new Konva.Star({ ...common, x: cx, y: cy, numPoints: 5, innerRadius: Math.round(base * 0.26), outerRadius: Math.round(base * 0.58) }); label = 'Estrella'; break;
      case 'line':
        node = new Konva.Line({ ...common, x: Math.round(cx - base * 0.7), y: cy, points: [0, 0, Math.round(base * 1.4), 0], stroke: activeColor, strokeWidth: 6, hitStrokeWidth: 22, lineCap: 'round' });
        fillCfg.mode = 'none';
        label = 'Línea';
        break;
      case 'arrow':
        node = new Konva.Arrow({ ...common, x: Math.round(cx - base * 0.7), y: cy, points: [0, 0, Math.round(base * 1.4), 0], stroke: activeColor, fill: activeColor, strokeWidth: 6, hitStrokeWidth: 22, pointerLength: 18, pointerWidth: 16, lineCap: 'round' });
        label = 'Flecha';
        break;
      default:
        node = new Konva.Rect({ ...common, x: Math.round(cx - base / 2), y: Math.round(cy - base / 2), width: base, height: base, cornerRadius: 8 });
        label = 'Rectángulo';
        break;
    }

    node.setAttr('pfType', 'shape');
    node.setAttr('pfShapeType', shapeType);
    node.setAttr('pfName', label);
    node.setAttr('pfLocked', false);
    if (shapeType !== 'line' && shapeType !== 'arrow') applyShapeFillConfig(node, fillCfg);
    else node.setAttr('pfFillConfig', fillCfg);

    getContentGroup().add(node);
    window.CanvasEngine.selectNode(node);
    return node;
  }

  function duplicateLayer(id) {
    const node = getNodeById(id);
    if (!node) return null;
    const clone = node.clone({ id: uid(node.getAttr('pfType') || 'layer') });
    clone.x(node.x() + 20);
    clone.y(node.y() + 20);
    clone.setAttr('pfName', (node.getAttr('pfName') || 'Capa') + ' copia');
    clone._pfGlCanvas = null;

    if (node._pfCanvas) {
      const c = document.createElement('canvas');
      c.width = node._pfCanvas.width;
      c.height = node._pfCanvas.height;
      c.getContext('2d').drawImage(node._pfCanvas, 0, 0);
      clone._pfCanvas = c;
      clone._pfOrigSource = c;
      clone.image(c);
    } else if (node._pfOrigSource) {
      clone._pfOrigSource = node._pfOrigSource;
      clone.image(node._pfOrigSource);
    }

    getContentGroup().add(clone);
    const adj = clone.getAttr('pfAdjustments');
    if (adj) window.AdjustmentEngine.applyToNode(clone, adj);
    window.CanvasEngine.selectNode(clone);
    return clone;
  }

  function deleteLayer(id) {
    const node = getNodeById(id);
    if (!node) return false;
    if (window.CanvasEngine.getSelectedNode()?.id() === id) window.CanvasEngine.clearSelection();
    disposeNodeResources(node);
    node.destroy();
    getContentGroup().getLayer()?.batchDraw();
    return true;
  }

  function moveLayer(id, dir) {
    const node = getNodeById(id);
    if (!node) return false;
    if (dir === 'up') node.moveUp();
    else if (dir === 'down') node.moveDown();
    else if (dir === 'top') node.moveToTop();
    else if (dir === 'bottom') node.moveToBottom();
    node.getLayer()?.batchDraw();
    return true;
  }

  function toggleVisibility(id) {
    const node = getNodeById(id);
    if (!node) return;
    node.visible(!node.visible());
    if (!node.visible() && window.CanvasEngine.getSelectedNode()?.id() === id) window.CanvasEngine.clearSelection();
    node.getLayer()?.batchDraw();
  }

  function toggleLock(id) {
    const node = getNodeById(id);
    if (!node) return;
    const locked = !node.getAttr('pfLocked');
    node.setAttr('pfLocked', locked);
    node.draggable(!locked);
    if (locked && window.CanvasEngine.getSelectedNode()?.id() === id) window.CanvasEngine.clearSelection();
    node.getLayer()?.batchDraw();
  }

  function renameLayer(id, name) {
    const n = getNodeById(id);
    if (n && name.trim()) n.setAttr('pfName', name.trim());
  }

  function setBlendMode(id, mode) {
    const n = getNodeById(id);
    if (n) {
      n.globalCompositeOperation(mode || 'source-over');
      n.getLayer()?.batchDraw();
    }
  }

  function setLayerOpacity(id, op01) {
    const n = getNodeById(id);
    if (n) {
      n.opacity(Math.max(0, Math.min(1, op01)));
      n.getLayer()?.batchDraw();
    }
  }

  function flipLayer(id, axis) {
    const node = getNodeById(id);
    if (!node || node.getAttr('pfLocked')) return;
    const cg = getContentGroup();
    const r1 = node.getClientRect({ relativeTo: cg });
    const c1x = r1.x + r1.width / 2;
    const c1y = r1.y + r1.height / 2;
    if (axis === 'h') node.scaleX(-node.scaleX());
    else node.scaleY(-node.scaleY());
    const r2 = node.getClientRect({ relativeTo: cg });
    node.x(node.x() + (c1x - (r2.x + r2.width / 2)));
    node.y(node.y() + (c1y - (r2.y + r2.height / 2)));
    node.getLayer()?.batchDraw();
  }

  function alignLayer(id, alignType) {
    const node = getNodeById(id);
    if (!node || node.getAttr('pfLocked')) return;
    const cg = getContentGroup();
    const { width: aw, height: ah } = window.CanvasEngine.getArtboardDims();
    const rect = node.getClientRect({ relativeTo: cg });
    if (alignType === 'left') node.x(node.x() - rect.x);
    else if (alignType === 'centerH') node.x(node.x() + (aw / 2 - (rect.x + rect.width / 2)));
    else if (alignType === 'right') node.x(node.x() + (aw - (rect.x + rect.width)));
    else if (alignType === 'top') node.y(node.y() - rect.y);
    else if (alignType === 'centerV') node.y(node.y() + (ah / 2 - (rect.y + rect.height / 2)));
    else if (alignType === 'bottom') node.y(node.y() + (ah - (rect.y + rect.height)));
    node.getLayer()?.batchDraw();
  }

  async function flattenVisibleLayers() {
    const visible = getNodes().filter((n) => n.visible());
    if (visible.length < 2) return null;
    const dataUrl = window.CanvasEngine.exportStageDataURL({ format: 'png', scale: 1, includeBg: false });
    visible.forEach((n) => {
      disposeNodeResources(n);
      n.destroy();
    });
    const { width: aw, height: ah } = window.CanvasEngine.getArtboardDims();
    return await addImageLayer(dataUrl, 'Capa acoplada', { x: 0, y: 0, width: aw, height: ah });
  }

  function serializeNode(node) {
    const pfType = node.getAttr('pfType');
    const attrs = { ...node.getAttrs() };
    delete attrs.image;
    delete attrs.filters;
    let assetId = node.getAttr('pfAssetId') || null;
    if (pfType === 'paint' && node._pfCanvas && !assetId) {
      assetId = createAssetFromDataURL(canvasToFastDataURL(node._pfCanvas, 0.82, true), node._pfCanvas);
      node.setAttr('pfAssetId', assetId);
    }
    return {
      id: node.id(),
      className: node.className,
      pfType,
      pfShapeType: node.getAttr('pfShapeType') || null,
      name: node.getAttr('pfName') || 'Capa',
      locked: !!node.getAttr('pfLocked'),
      visible: node.visible(),
      assetId,
      adjustments: node.getAttr('pfAdjustments') || null,
      fillConfig: node.getAttr('pfFillConfig') || null,
      attrs
    };
  }

  function serializeLayers() {
    return getNodes().map(serializeNode);
  }

  async function deserializeLayers(layersData, incomingAssets) {
    if (incomingAssets) setAssets(incomingAssets);
    const cg = getContentGroup();
    window.CanvasEngine.clearSelection();
    cg.getChildren().forEach(disposeNodeResources);
    cg.destroyChildren();

    const createdNodes = [];
    for (const item of (layersData || [])) {
      try {
        const attrs = { ...(item.attrs || {}), id: item.id, name: 'pf-user-node' };
        delete attrs.image;
        delete attrs.filters;
        attrs.draggable = !item.locked;
        attrs.visible = item.visible !== false;

        let node = null;
        if (item.pfType === 'image' && item.assetId) {
          const img = await loadImageElement(item.assetId);
          node = new Konva.Image({ ...attrs, image: img });
          node._pfOrigSource = img;
        } else if (item.pfType === 'paint' && item.assetId) {
          const img = await loadImageElement(item.assetId);
          const { width: aw, height: ah } = window.CanvasEngine.getArtboardDims();
          const c = document.createElement('canvas');
          c.width = img.naturalWidth || img.width || aw;
          c.height = img.naturalHeight || img.height || ah;
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          node = new Konva.Image({ ...attrs, image: c });
          node._pfCanvas = c;
          node._pfOrigSource = c;
        } else if (item.pfType === 'text' || item.className === 'Text') {
          node = new Konva.Text({ fillAfterStrokeEnabled: true, ...attrs });
        } else if (item.className === 'Circle') {
          node = new Konva.Circle(attrs);
        } else if (item.className === 'Ellipse') {
          node = new Konva.Ellipse(attrs);
        } else if (item.className === 'RegularPolygon') {
          node = new Konva.RegularPolygon(attrs);
        } else if (item.className === 'Star') {
          node = new Konva.Star(attrs);
        } else if (item.className === 'Arrow') {
          node = new Konva.Arrow({ hitStrokeWidth: 22, ...attrs });
        } else if (item.className === 'Line') {
          node = new Konva.Line({ hitStrokeWidth: 22, ...attrs });
        } else {
          node = new Konva.Rect(attrs);
        }

        node.setAttr('pfType', item.pfType || 'shape');
        node.setAttr('pfShapeType', item.pfShapeType || null);
        node.setAttr('pfName', item.name || 'Capa');
        node.setAttr('pfLocked', !!item.locked);
        if (item.assetId) node.setAttr('pfAssetId', item.assetId);
        if (item.fillConfig) applyShapeFillConfig(node, item.fillConfig);

        cg.add(node);
        createdNodes.push({ node, adjustments: item.adjustments });
      } catch (err) {
        console.warn('Layer skipped during restore:', item, err);
      }
    }

    for (const { node, adjustments } of createdNodes) {
      if (adjustments && (node.getAttr('pfType') === 'image' || node.getAttr('pfType') === 'paint')) {
        window.AdjustmentEngine.applyToNode(node, adjustments);
      }
    }
    cg.getLayer()?.batchDraw();
  }

  function extractLegacyLayers(legacyStageJson) {
    try {
      const parsed = typeof legacyStageJson === 'string' ? JSON.parse(legacyStageJson) : legacyStageJson;
      const out = [];
      (function walk(n) {
        if (!n) return;
        const cls = n.className;
        if (['Text', 'Rect', 'Circle', 'Ellipse', 'Star', 'RegularPolygon', 'Line', 'Arrow'].includes(cls)) {
          const a = { ...(n.attrs || {}) };
          if (a.listening === false || a.name === 'pf-artboard-bg') return;
          out.push({
            id: a.id || uid('leg'),
            className: cls,
            pfType: cls === 'Text' ? 'text' : 'shape',
            pfShapeType: cls === 'Rect' ? 'rect' : cls.toLowerCase(),
            name: a.pfName || cls,
            locked: !!a.pfLocked,
            visible: a.visible !== false,
            attrs: a
          });
        }
        (n.children || []).forEach(walk);
      })(parsed);
      return out;
    } catch (_) {
      return [];
    }
  }

  window.LayerManager = {
    setAssets, getAssets, getUsedAssets, gcAssets,
    createAssetFromDataURL, getThumbnail, canvasToFastDataURL,
    getNodes, getNodeById, applyShapeFillConfig,
    addImageLayer, addPaintLayer, addTextLayer, addShapeLayer,
    duplicateLayer, deleteLayer, moveLayer, toggleVisibility,
    toggleLock, renameLayer, setBlendMode, setLayerOpacity,
    flipLayer, alignLayer, flattenVisibleLayers,
    serializeLayers, deserializeLayers, extractLegacyLayers
  };
})();