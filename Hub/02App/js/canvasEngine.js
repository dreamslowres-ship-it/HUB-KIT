/* ============================================================
   PixelForge Studio 3.3.3 — 60fps Konva Engine + Nearest/Smooth + 1px Brush
   ============================================================ */
(function () {
  let stage = null, artboardLayer = null, overlayLayer = null;
  let artboardChecker = null, artboardBgRect = null, artboardBorder = null, contentGroup = null;
  let transformer = null, guidesGroup = null, gridGroup = null, cropGroup = null;
  let brushPreviewNode = null, brushCursorCircle = null;
  let checkerPatternCanvas = null;
  let stageHostEl = null;

  let artboardW = 1080, artboardH = 1080;
  let bgConfig = { type: 'solid', color: '#ffffff', gradient: { color1: '#1e1b4b', color2: '#4c1d95', angle: 135 } };
  let pixelMode = 'smooth';
  try {
    if (localStorage.getItem('pf_pixel_mode') === 'nearest') pixelMode = 'nearest';
  } catch (_) {}

  let currentTool = 'select', activeColor = '#a78bfa';
  let brushSettings = { size: 28, opacity: 0.9, hardness: 80 };
  let bucketSettings = { tolerance: 32 };
  let snapEnabled = true, gridEnabled = false, rulersEnabled = true;

  let isSpacePanning = false, isPanning = false;
  let panStartClient = null, panStartStage = null, panDelta = { x: 0, y: 0 }, panRaf = 0;

  let isPinching = false, ignoreSingleTouchUntilRelease = false;
  let lastPinchDist = 0, lastPinchCenter = null, pinchBox = null;
  let pinchStart = null, pinchCurrent = null, pinchRaf = 0;

  let isDrawing = false, strokeCanvas = null, strokeCtx = null, targetPaintNode = null, lastDrawLocal = null;
  let cropState = null, callbacks = {};

  let viewRaf = 0, coordsRaf = 0, pendingCoords = null;
  let rulerTopEl = null, rulerLeftEl = null;
  let cachedDragState = null;

  function getCheckerPattern() {
    if (checkerPatternCanvas) return checkerPatternCanvas;
    const c = document.createElement('canvas'); c.width = 24; c.height = 24;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#1b1b22'; ctx.fillRect(0, 0, 24, 24);
    ctx.fillStyle = '#25252f'; ctx.fillRect(0, 0, 12, 12); ctx.fillRect(12, 12, 12, 12);
    checkerPatternCanvas = c;
    return c;
  }

  function getViewportBoxEl() {
    return stageHostEl?.parentElement || stageHostEl || stage?.container();
  }

  function applyPixelModeToDOMAndLayers() {
    const smooth = pixelMode !== 'nearest';
    document.body?.classList.toggle('pixel-mode-nearest', !smooth);
    for (const layer of [artboardLayer, overlayLayer]) {
      if (!layer) continue;
      if (typeof layer.imageSmoothingEnabled === 'function') {
        layer.imageSmoothingEnabled(smooth);
      }
      const ctx = layer.getCanvas?.()?.getContext?.()?._context;
      if (ctx) ctx.imageSmoothingEnabled = smooth;
    }
  }

  function setPixelMode(mode) {
    pixelMode = mode === 'nearest' ? 'nearest' : 'smooth';
    try { localStorage.setItem('pf_pixel_mode', pixelMode); } catch (_) {}
    applyPixelModeToDOMAndLayers();
    if (artboardLayer) artboardLayer.batchDraw();
    if (overlayLayer) overlayLayer.batchDraw();
    return pixelMode;
  }

  function init(containerId, cbs = {}) {
    callbacks = cbs;
    Konva.pixelRatio = Math.min(1.5, window.devicePixelRatio || 1);

    rulerTopEl = document.getElementById('ruler-top');
    rulerLeftEl = document.getElementById('ruler-left');

    const container = document.getElementById(containerId);
    stageHostEl = container;
    const boxEl = container.parentElement || container;
    const rect = boxEl.getBoundingClientRect();
    stage = new Konva.Stage({
      container: containerId,
      width: Math.max(200, Math.round(rect.width) || 600),
      height: Math.max(200, Math.round(rect.height) || 400)
    });
    artboardLayer = new Konva.Layer();
    overlayLayer = new Konva.Layer();
    stage.add(artboardLayer, overlayLayer);
    applyPixelModeToDOMAndLayers();

    gridGroup = new Konva.Group({ listening: false });
    guidesGroup = new Konva.Group({ listening: false });
    cropGroup = new Konva.Group();
    transformer = new Konva.Transformer({
      borderStroke: '#a78bfa', borderStrokeWidth: 1.5, anchorStroke: '#8b5cf6',
      anchorFill: '#ffffff', anchorSize: 9, anchorCornerRadius: 2, rotateAnchorOffset: 24,
      keepRatio: false,
      boundBoxFunc: (oldBox, newBox) => (Math.abs(newBox.width) < 10 || Math.abs(newBox.height) < 10) ? oldBox : newBox
    });
    brushCursorCircle = new Konva.Circle({ radius: 14, stroke: '#ffffff', strokeWidth: 1.5, dash: [3, 3], listening: false, visible: false });
    overlayLayer.add(gridGroup, guidesGroup, transformer, cropGroup, brushCursorCircle);
    setupStageEvents(container);
    setupResizeObserver(container);
  }

  function createArtboard(w, h, bg = { type: 'solid', color: '#ffffff' }) {
    artboardW = Math.max(64, Math.round(w));
    artboardH = Math.max(64, Math.round(h));
    clearSelection(); cancelCropMode();
    artboardLayer.destroyChildren();
    if (artboardBorder) { artboardBorder.destroy(); artboardBorder = null; }

    artboardChecker = new Konva.Rect({
      x: 0, y: 0, width: artboardW, height: artboardH,
      fillPatternImage: getCheckerPattern(), listening: false,
      visible: bg?.type === 'transparent'
    });
    artboardBgRect = new Konva.Rect({ x: 0, y: 0, width: artboardW, height: artboardH, listening: true, name: 'pf-artboard-bg' });
    contentGroup = new Konva.Group({ x: 0, y: 0, clipX: 0, clipY: 0, clipWidth: artboardW, clipHeight: artboardH });
    artboardBorder = new Konva.Rect({ x: 0, y: 0, width: artboardW, height: artboardH, stroke: '#3f3f52', strokeWidth: 1, listening: false });

    artboardLayer.add(artboardChecker, artboardBgRect, contentGroup);
    overlayLayer.add(artboardBorder); artboardBorder.moveToBottom();
    cachedDragState = null;
    applyPixelModeToDOMAndLayers();
    setBackground(bg); rebuildGrid(); fitToScreen();
  }

  function resizeArtboard(newW, newH, scaleContent = false) {
    const oldW = artboardW, oldH = artboardH;
    artboardW = Math.max(64, Math.round(newW)); artboardH = Math.max(64, Math.round(newH));
    artboardChecker.size({ width: artboardW, height: artboardH });
    artboardBgRect.size({ width: artboardW, height: artboardH });
    artboardBorder.size({ width: artboardW, height: artboardH });
    contentGroup.clip({ x: 0, y: 0, width: artboardW, height: artboardH });
    if (scaleContent && oldW > 0 && oldH > 0) {
      const sx = artboardW / oldW, sy = artboardH / oldH;
      contentGroup.getChildren().forEach((n) => {
        n.x(n.x() * sx); n.y(n.y() * sy);
        if (n.getAttr('pfType') === 'text') { n.width(n.width() * sx); n.fontSize(Math.max(8, Math.round(n.fontSize() * Math.min(sx, sy)))); }
        else { n.scaleX(n.scaleX() * sx); n.scaleY(n.scaleY() * sy); }
      });
    }
    setBackground(bgConfig); rebuildGrid(); fitToScreen();
  }

  function setBackground(cfg) {
    bgConfig = { type: cfg?.type || 'solid', color: cfg?.color || '#ffffff', gradient: cfg?.gradient || { color1: '#1e1b4b', color2: '#4c1d95', angle: 135 } };
    if (!artboardBgRect) return;
    if (artboardChecker) artboardChecker.visible(bgConfig.type === 'transparent');
    if (bgConfig.type === 'transparent') { artboardBgRect.fillPriority('color'); artboardBgRect.fill('transparent'); }
    else if (bgConfig.type === 'gradient') {
      const a = ((bgConfig.gradient.angle ?? 135) * Math.PI) / 180;
      const cx = artboardW / 2, cy = artboardH / 2, r = Math.max(artboardW, artboardH) / 2;
      artboardBgRect.fillPriority('linear-gradient');
      artboardBgRect.fillLinearGradientStartPoint({ x: cx - Math.cos(a) * r, y: cy - Math.sin(a) * r });
      artboardBgRect.fillLinearGradientEndPoint({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
      artboardBgRect.fillLinearGradientColorStops([0, bgConfig.gradient.color1, 1, bgConfig.gradient.color2]);
    } else { artboardBgRect.fillPriority('color'); artboardBgRect.fill(bgConfig.color); }
    artboardLayer.batchDraw();
  }

  function getBackground() { return JSON.parse(JSON.stringify(bgConfig)); }

  function rebuildGrid() {
    if (!gridGroup || !stage) return;
    gridGroup.destroyChildren();
    if (!gridEnabled) { overlayLayer.batchDraw(); return; }
    const step = Math.max(16, Math.round(Math.min(artboardW, artboardH) / 12)), sw = 1 / stage.scaleX();
    for (let x = step; x < artboardW; x += step) gridGroup.add(new Konva.Line({ points: [x, 0, x, artboardH], stroke: 'rgba(167,139,250,0.22)', strokeWidth: sw, listening: false }));
    for (let y = step; y < artboardH; y += step) gridGroup.add(new Konva.Line({ points: [0, y, artboardW, y], stroke: 'rgba(167,139,250,0.22)', strokeWidth: sw, listening: false }));
    gridGroup.add(new Konva.Line({ points: [artboardW / 2, 0, artboardW / 2, artboardH], stroke: 'rgba(167,139,250,0.45)', dash: [6, 6], strokeWidth: sw, listening: false }));
    gridGroup.add(new Konva.Line({ points: [0, artboardH / 2, artboardW, artboardH / 2], stroke: 'rgba(167,139,250,0.45)', dash: [6, 6], strokeWidth: sw, listening: false }));
    overlayLayer.batchDraw();
  }

  function updateGridStrokeScale() {
    if (!gridEnabled || !gridGroup || !stage) return;
    const sw = 1 / stage.scaleX();
    gridGroup.getChildren().forEach((line) => line.strokeWidth(sw));
  }

  function toggleGrid() { gridEnabled = !gridEnabled; rebuildGrid(); return gridEnabled; }
  function toggleSnap() { snapEnabled = !snapEnabled; return snapEnabled; }
  function toggleRulers() {
    rulersEnabled = !rulersEnabled;
    document.getElementById('canvas-viewport')?.classList.toggle('no-rulers', !rulersEnabled);
    if (rulersEnabled) drawRulers();
    return rulersEnabled;
  }

  function fitToScreen() {
    if (!stage) return;
    const c = getViewportBoxEl();
    const cw = Math.round(c?.clientWidth || 0), ch = Math.round(c?.clientHeight || 0);
    if (cw < 20 || ch < 20) return;
    if (stage.width() !== cw || stage.height() !== ch) {
      stage.size({ width: cw, height: ch });
      applyPixelModeToDOMAndLayers();
    }
    const maxFitScale = pixelMode === 'nearest' ? 8 : 1.5;
    const scale = Math.max(0.08, Math.min((cw - 42) / artboardW, (ch - 42) / artboardH, maxFitScale));
    stage.scale({ x: scale, y: scale });
    stage.position({ x: Math.round((cw - artboardW * scale) / 2), y: Math.round((ch - artboardH * scale) / 2) });
    afterViewTransform(true);
  }

  function setZoom(newScale, center) {
    if (!stage) return;
    const oldScale = stage.scaleX(), clamped = Math.max(0.08, Math.min(16, newScale));
    const c = center || { x: stage.width() / 2, y: stage.height() / 2 };
    const pt = { x: (c.x - stage.x()) / oldScale, y: (c.y - stage.y()) / oldScale };
    stage.scale({ x: clamped, y: clamped });
    stage.position({ x: c.x - pt.x * clamped, y: c.y - pt.y * clamped });
    afterViewTransform(false);
  }

  function zoomBy(factor) { setZoom(stage.scaleX() * factor); }
  function getZoom() { return stage ? stage.scaleX() : 1; }

  function afterViewTransform(immediate = false) {
    if (immediate) {
      if (viewRaf) { cancelAnimationFrame(viewRaf); viewRaf = 0; }
      applyPixelModeToDOMAndLayers();
      updateGridStrokeScale();
      if (artboardBorder) artboardBorder.strokeWidth(1 / stage.scaleX());
      if (cropState) updateCropOverlay();
      artboardLayer.draw();
      overlayLayer.draw();
      drawRulers();
      callbacks.onZoomChange?.(stage.scaleX());
      return;
    }

    if (viewRaf) return;
    viewRaf = requestAnimationFrame(() => {
      viewRaf = 0;
      applyPixelModeToDOMAndLayers();
      updateGridStrokeScale();
      if (artboardBorder) artboardBorder.strokeWidth(1 / stage.scaleX());
      if (cropState) updateCropOverlay();
      artboardLayer.draw();
      overlayLayer.draw();
      drawRulers();
      callbacks.onZoomChange?.(stage.scaleX());
    });
  }

  function drawRulers() {
    if (!rulersEnabled || !stage || !rulerTopEl || !rulerLeftEl) return;
    const scale = stage.scaleX(), ox = stage.x(), oy = stage.y();
    let step = 100;
    if (100 * scale < 35) step = 250; if (100 * scale < 15) step = 500;
    if (100 * scale > 180) step = 50; if (100 * scale > 400) step = 20;
    if (100 * scale > 800) step = 8;

    const tw = rulerTopEl.clientWidth, th = rulerTopEl.clientHeight;
    if (tw > 0 && th > 0) {
      if (rulerTopEl.width !== tw || rulerTopEl.height !== th) { rulerTopEl.width = tw; rulerTopEl.height = th; }
      const ctx = rulerTopEl.getContext('2d');
      ctx.clearRect(0, 0, tw, th);
      ctx.strokeStyle = '#3f3f52'; ctx.fillStyle = '#717182'; ctx.font = '9px Inter, sans-serif';
      for (let v = Math.floor((-ox / scale) / step) * step; v <= Math.ceil(((tw - ox) / scale) / step) * step; v += step) {
        const sx = Math.round(v * scale + ox) + 0.5;
        ctx.beginPath(); ctx.moveTo(sx, 8); ctx.lineTo(sx, th); ctx.stroke(); ctx.fillText(String(v), sx + 2, 10);
      }
    }

    const lw = rulerLeftEl.clientWidth, lh = rulerLeftEl.clientHeight;
    if (lw > 0 && lh > 0) {
      if (rulerLeftEl.width !== lw || rulerLeftEl.height !== lh) { rulerLeftEl.width = lw; rulerLeftEl.height = lh; }
      const ctx = rulerLeftEl.getContext('2d');
      ctx.clearRect(0, 0, lw, lh);
      ctx.strokeStyle = '#3f3f52'; ctx.fillStyle = '#717182'; ctx.font = '9px Inter, sans-serif';
      for (let v = Math.floor((-oy / scale) / step) * step; v <= Math.ceil(((lh - oy) / scale) / step) * step; v += step) {
        const sy = Math.round(v * scale + oy) + 0.5;
        ctx.beginPath(); ctx.moveTo(8, sy); ctx.lineTo(lw, sy); ctx.stroke();
        ctx.save(); ctx.translate(9, sy + 2); ctx.rotate(-Math.PI / 2); ctx.fillText(String(v), -24, 0); ctx.restore();
      }
    }
  }

  function setupResizeObserver(container) {
    let roRaf = 0;
    const host = container.parentElement || container;
    new ResizeObserver(() => {
      if (!stage || roRaf || isPinching || isPanning) return;
      roRaf = requestAnimationFrame(() => {
        roRaf = 0;
        const cw = Math.round(host.clientWidth);
        const ch = Math.round(host.clientHeight);
        if (cw > 20 && ch > 20 && (stage.width() !== cw || stage.height() !== ch)) {
          stage.size({ width: cw, height: ch });
          applyPixelModeToDOMAndLayers();
          drawRulers();
        }
      });
    }).observe(host);
  }

  function getArtboardPointFromStage() {
    const p = stage?.getPointerPosition();
    return p ? stage.getAbsoluteTransform().copy().invert().point(p) : null;
  }

  function syncListeningState() {
    if (!contentGroup) return;
    const interactive = !isSpacePanning && !isPinching && !isPanning && (currentTool === 'select' || currentTool === 'bucket');
    if (contentGroup.listening() !== interactive) contentGroup.listening(interactive);
    const shouldBeDraggable = currentTool === 'select' && !isSpacePanning && !isPinching && !isPanning;
    contentGroup.getChildren().forEach((n) => {
      const targetDraggable = shouldBeDraggable && !n.getAttr('pfLocked');
      if (n.draggable() !== targetDraggable) n.draggable(targetDraggable);
    });
  }

  function setGestureListeningPaused(paused) {
    if (artboardBgRect) artboardBgRect.listening(!paused);
    if (paused) {
      if (contentGroup) contentGroup.listening(false);
    } else {
      syncListeningState();
    }
  }

  function setTool(tool) {
    if (cropState && tool !== 'crop') cancelCropMode();
    currentTool = tool;
    if (tool === 'brush' || tool === 'eraser') transformer.nodes([]);
    brushCursorCircle.visible(false);
    syncListeningState();
    updateCursorStyle();
    overlayLayer.batchDraw();
  }

  function setSpacePanning(val) {
    isSpacePanning = !!val;
    syncListeningState();
    updateCursorStyle();
  }

  function updateCursorStyle() {
    if (!stage) return;
    const c = stage.container();
    if (isSpacePanning || currentTool === 'hand') c.style.cursor = isPanning ? 'grabbing' : 'grab';
    else if (currentTool === 'eyedropper' || currentTool === 'bucket') c.style.cursor = 'crosshair';
    else if (currentTool === 'brush' || currentTool === 'eraser') c.style.cursor = 'none';
    else c.style.cursor = 'default';
  }

  function selectNode(node) {
    if (!node || node.getAttr('pfLocked') || !node.visible()) { clearSelection(); return; }
    transformer.enabledAnchors(node.getAttr('pfType') === 'text'
      ? ['top-left', 'top-right', 'bottom-left', 'bottom-right', 'middle-left', 'middle-right']
      : ['top-left', 'top-center', 'top-right', 'middle-left', 'middle-right', 'bottom-left', 'bottom-center', 'bottom-right']);
    transformer.nodes([node]); overlayLayer.batchDraw();
    callbacks.onSelect?.(node);
  }

  function clearSelection() {
    if (!transformer) return;
    transformer.nodes([]); guidesGroup?.destroyChildren(); overlayLayer?.batchDraw();
    callbacks.onSelect?.(null);
  }

  function getSelectedNode() { return (transformer?.nodes() || [])[0] || null; }

  function prepareDragSnapCache(draggedNode) {
    if (!snapEnabled || !contentGroup) { cachedDragState = null; return; }
    const vStops = [0, artboardW / 2, artboardW];
    const hStops = [0, artboardH / 2, artboardH];
    contentGroup.getChildren().forEach((other) => {
      if (other === draggedNode || !other.visible()) return;
      const r = other.getClientRect({ relativeTo: contentGroup });
      vStops.push(r.x, r.x + r.width / 2, r.x + r.width);
      hStops.push(r.y, r.y + r.height / 2, r.y + r.height);
    });
    cachedDragState = { nodeId: draggedNode._id, vStops, hStops };
  }

  function handleDragSnap(node) {
    guidesGroup.destroyChildren();
    if (!snapEnabled) return;
    if (!cachedDragState || cachedDragState.nodeId !== node._id) prepareDragSnapCache(node);
    const { vStops, hStops } = cachedDragState;
    const thresh = 6 / stage.scaleX(), box = node.getClientRect({ relativeTo: contentGroup });
    let snapDx = null, snapLineX = null, snapDy = null, snapLineY = null;
    for (const s of vStops) for (const edge of [box.x, box.x + box.width / 2, box.x + box.width]) {
      const d = s - edge; if (Math.abs(d) < thresh && (snapDx === null || Math.abs(d) < Math.abs(snapDx))) { snapDx = d; snapLineX = s; }
    }
    for (const s of hStops) for (const edge of [box.y, box.y + box.height / 2, box.y + box.height]) {
      const d = s - edge; if (Math.abs(d) < thresh && (snapDy === null || Math.abs(d) < Math.abs(snapDy))) { snapDy = d; snapLineY = s; }
    }
    if (snapDx !== null) { node.x(node.x() + snapDx); guidesGroup.add(new Konva.Line({ points: [snapLineX, 0, snapLineX, artboardH], stroke: '#f472b6', strokeWidth: 1.2 / stage.scaleX(), dash: [4, 4] })); }
    if (snapDy !== null) { node.y(node.y() + snapDy); guidesGroup.add(new Konva.Line({ points: [0, snapLineY, artboardW, snapLineY], stroke: '#f472b6', strokeWidth: 1.2 / stage.scaleX(), dash: [4, 4] })); }
    overlayLayer.batchDraw();
  }

  function ensureMutableCanvas(node) {
    if (!node._pfCanvas) {
      const img = node._pfOrigSource || node.image();
      const c = document.createElement('canvas');
      c.width = img.naturalWidth || img.width || node.width();
      c.height = img.naturalHeight || img.height || node.height();
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      node._pfCanvas = c;
      node._pfOrigSource = c;
      node.image(c);
      node.clearCache();
    }
    return node._pfCanvas;
  }

  function ensurePaintTarget(tool) {
    const sel = getSelectedNode();
    if (tool === 'eraser') {
      if (sel && (sel.getAttr('pfType') === 'paint' || sel.getAttr('pfType') === 'image') && !sel.getAttr('pfLocked')) { ensureMutableCanvas(sel); return sel; }
      const pNodes = window.LayerManager.getNodes().filter((n) => n.getAttr('pfType') === 'paint' && !n.getAttr('pfLocked') && n.visible());
      return pNodes.length ? pNodes[pNodes.length - 1] : null;
    }
    if (sel && sel.getAttr('pfType') === 'paint' && !sel.getAttr('pfLocked')) return sel;
    const pNodes = window.LayerManager.getNodes().filter((n) => n.getAttr('pfType') === 'paint' && !n.getAttr('pfLocked') && n.visible());
    return pNodes.length ? pNodes[pNodes.length - 1] : window.LayerManager.addPaintLayer('Capa de dibujo');
  }

  function stampCircle(ctx, x, y, radius, color, hardness) {
    if (hardness >= 95) { ctx.fillStyle = color; ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.fill(); }
    else {
      const g = ctx.createRadialGradient(x, y, radius * (hardness / 100) * 0.85, x, y, radius);
      g.addColorStop(0, color); g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.fill();
    }
  }

  function stampPixelDisc(ctx, ix, iy, diameter, color) {
    ctx.fillStyle = color;
    if (diameter <= 1) {
      ctx.fillRect(ix, iy, 1, 1);
      return;
    }
    if (diameter === 2) {
      ctx.fillRect(ix, iy, 2, 2);
      return;
    }
    const r = diameter / 2;
    const half = Math.floor(r);
    const minOff = -half;
    const maxOff = diameter % 2 === 0 ? half - 1 : half;
    const centerOff = (minOff + maxOff) / 2;
    const r2 = r * r;
    for (let dy = minOff; dy <= maxOff; dy++) {
      for (let dx = minOff; dx <= maxOff; dx++) {
        const ox = dx - centerOff, oy = dy - centerOff;
        if (ox * ox + oy * oy <= r2 + 0.15) {
          ctx.fillRect(ix + dx, iy + dy, 1, 1);
        }
      }
    }
  }

  function bresenhamStamp(ctx, x0, y0, x1, y1, diameter, color) {
    let ix0 = Math.floor(x0), iy0 = Math.floor(y0);
    const ix1 = Math.floor(x1), iy1 = Math.floor(y1);
    const dx = Math.abs(ix1 - ix0), dy = Math.abs(iy1 - iy0);
    const sx = ix0 < ix1 ? 1 : -1, sy = iy0 < iy1 ? 1 : -1;
    let err = dx - dy;
    while (true) {
      stampPixelDisc(ctx, ix0, iy0, diameter, color);
      if (ix0 === ix1 && iy0 === iy1) break;
      const e2 = 2 * err;
      if (e2 > -dy) { err -= dy; ix0 += sx; }
      if (e2 < dx) { err += dx; iy0 += sy; }
    }
  }

  function toNodeCanvasCoords(node) {
    const p = stage.getPointerPosition();
    if (!p) return null;
    const local = node.getAbsoluteTransform().copy().invert().point(p), c = node._pfCanvas;
    const cropW = node.cropWidth() || c.width, cropH = node.cropHeight() || c.height;
    return { x: (node.cropX() || 0) + (local.x / node.width()) * cropW, y: (node.cropY() || 0) + (local.y / node.height()) * cropH };
  }

  function startStroke() {
    targetPaintNode = ensurePaintTarget(currentTool);
    if (!targetPaintNode) { callbacks.onMessage?.('Selecciona una imagen o crea una capa de dibujo para borrar'); return; }
    const pt = toNodeCanvasCoords(targetPaintNode);
    if (!pt) return;
    isDrawing = true;
    const c = targetPaintNode._pfCanvas;
    if (targetPaintNode.image() !== c) {
      targetPaintNode.image(c);
    }
    if (!strokeCanvas) { strokeCanvas = document.createElement('canvas'); strokeCtx = strokeCanvas.getContext('2d'); }
    strokeCanvas.width = c.width; strokeCanvas.height = c.height;
    strokeCtx.clearRect(0, 0, c.width, c.height);
    targetPaintNode.clearCache();

    if (currentTool === 'brush') {
      const cfg = {
        image: strokeCanvas, x: targetPaintNode.x(), y: targetPaintNode.y(), width: targetPaintNode.width(), height: targetPaintNode.height(),
        scaleX: targetPaintNode.scaleX(), scaleY: targetPaintNode.scaleY(), rotation: targetPaintNode.rotation(), opacity: brushSettings.opacity, listening: false
      };
      if (targetPaintNode.cropWidth() > 0) cfg.crop = targetPaintNode.crop();
      brushPreviewNode = new Konva.Image(cfg);
      overlayLayer.add(brushPreviewNode);
    }
    lastDrawLocal = pt; paintStep(pt, pt);
  }

  function paintStep(fromPt, toPt) {
    if (!isDrawing || !targetPaintNode || !fromPt || !toPt) return;
    const c = targetPaintNode._pfCanvas;
    const pxScale = (c.width / (targetPaintNode.width() * Math.abs(targetPaintNode.scaleX()))) || 1;
    const pxDiameter = Math.max(1, brushSettings.size * pxScale);
    const usePixelExact = pixelMode === 'nearest' || pxDiameter <= 1.25;

    if (currentTool === 'eraser') {
      const ctx = targetPaintNode._pfCanvas.getContext('2d');
      ctx.save();
      ctx.globalCompositeOperation = 'destination-out';
      ctx.globalAlpha = brushSettings.opacity >= 0.9 ? 1 : Math.max(0.05, brushSettings.opacity * 0.55);
      if (usePixelExact) {
        bresenhamStamp(ctx, fromPt.x, fromPt.y, toPt.x, toPt.y, Math.max(1, Math.round(pxDiameter)), '#000000');
      } else {
        const radius = pxDiameter / 2;
        const dx = toPt.x - fromPt.x, dy = toPt.y - fromPt.y;
        const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) / Math.max(0.4, radius * 0.25)));
        for (let i = 0; i <= steps; i++) {
          stampCircle(ctx, fromPt.x + dx * (i / steps), fromPt.y + dy * (i / steps), radius, '#000000', brushSettings.hardness);
        }
      }
      ctx.restore();
      artboardLayer.batchDraw();
    } else {
      if (usePixelExact) {
        bresenhamStamp(strokeCtx, fromPt.x, fromPt.y, toPt.x, toPt.y, Math.max(1, Math.round(pxDiameter)), activeColor);
      } else {
        const radius = pxDiameter / 2;
        const dx = toPt.x - fromPt.x, dy = toPt.y - fromPt.y;
        const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) / Math.max(0.4, radius * 0.25)));
        for (let i = 0; i <= steps; i++) {
          stampCircle(strokeCtx, fromPt.x + dx * (i / steps), fromPt.y + dy * (i / steps), radius, activeColor, brushSettings.hardness);
        }
      }
      overlayLayer.batchDraw();
    }
  }

  function endStroke() {
    if (!isDrawing) return;
    isDrawing = false;
    brushCursorCircle.visible(false);
    if (currentTool === 'brush' && targetPaintNode && strokeCanvas) {
      const ctx = targetPaintNode._pfCanvas.getContext('2d');
      ctx.save(); ctx.globalAlpha = brushSettings.opacity; ctx.drawImage(strokeCanvas, 0, 0); ctx.restore();
      brushPreviewNode?.destroy(); brushPreviewNode = null;
      strokeCanvas.width = 1; strokeCanvas.height = 1;
      overlayLayer.batchDraw();
    }
    if (targetPaintNode) {
      targetPaintNode._pfOrigSource = targetPaintNode._pfCanvas;
      const fastUrl = window.LayerManager.canvasToFastDataURL(targetPaintNode._pfCanvas, 0.92);
      targetPaintNode.setAttr('pfAssetId', window.LayerManager.createAssetFromDataURL(fastUrl, targetPaintNode._pfCanvas));
      const adj = targetPaintNode.getAttr('pfAdjustments');
      if (adj) window.AdjustmentEngine.applyToNode(targetPaintNode, adj);
      artboardLayer.batchDraw(); callbacks.onCommit?.();
    }
    targetPaintNode = null; lastDrawLocal = null;
  }

  function hexToRgb(hex) {
    const clean = hex.replace('#', '');
    const n = parseInt(clean.length === 3 ? clean.replace(/(.)/g, '$1$1') : clean, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  function floodFillCanvas(canvas, sx, sy, fillHex, tolerancePct) {
    const w = canvas.width, h = canvas.height, x0 = Math.floor(sx), y0 = Math.floor(sy);
    if (x0 < 0 || y0 < 0 || x0 >= w || y0 >= h) return false;
    const ctx = canvas.getContext('2d'), imgData = ctx.getImageData(0, 0, w, h), data = imgData.data;
    const si = (y0 * w + x0) * 4, tr = data[si], tg = data[si + 1], tb = data[si + 2], ta = data[si + 3];
    const [fr, fg, fb] = hexToRgb(fillHex);
    if (ta === 255 && Math.abs(tr - fr) <= 2 && Math.abs(tg - fg) <= 2 && Math.abs(tb - fb) <= 2) return false;

    const tol = Math.round((Math.max(0, Math.min(100, tolerancePct)) / 100) * 255);
    const visited = new Uint8Array(w * h);

    const matchAt = (p) => {
      if (visited[p]) return false;
      const i = p * 4;
      return (
        Math.abs(data[i] - tr) <= tol &&
        Math.abs(data[i + 1] - tg) <= tol &&
        Math.abs(data[i + 2] - tb) <= tol &&
        Math.abs(data[i + 3] - ta) <= tol
      );
    };

    const paintAt = (p) => {
      visited[p] = 1;
      const i = p * 4;
      data[i] = fr; data[i + 1] = fg; data[i + 2] = fb; data[i + 3] = 255;
    };

    let cap = Math.max(4096, w * 4);
    let stackX = new Int32Array(cap);
    let stackY = new Int32Array(cap);
    let top = 0;

    const pushSeed = (px, py) => {
      if (top >= cap) {
        const nextCap = cap * 2;
        const nx = new Int32Array(nextCap);
        const ny = new Int32Array(nextCap);
        nx.set(stackX); ny.set(stackY);
        stackX = nx; stackY = ny; cap = nextCap;
      }
      stackX[top] = px; stackY[top] = py; top++;
    };

    pushSeed(x0, y0);
    while (top > 0) {
      top--;
      const x = stackX[top], y = stackY[top], rowOffset = y * w;
      if (!matchAt(rowOffset + x)) continue;

      let lx = x;
      while (lx > 0 && matchAt(rowOffset + lx - 1)) lx--;
      let rx = x;
      while (rx < w - 1 && matchAt(rowOffset + rx + 1)) rx++;

      let spanUp = false, spanDown = false;
      for (let cx = lx; cx <= rx; cx++) {
        paintAt(rowOffset + cx);
        if (y > 0) {
          const upMatch = matchAt(rowOffset - w + cx);
          if (!spanUp && upMatch) { pushSeed(cx, y - 1); spanUp = true; }
          else if (spanUp && !upMatch) spanUp = false;
        }
        if (y < h - 1) {
          const downMatch = matchAt(rowOffset + w + cx);
          if (!spanDown && downMatch) { pushSeed(cx, y + 1); spanDown = true; }
          else if (spanDown && !downMatch) spanDown = false;
        }
      }
    }

    ctx.putImageData(imgData, 0, 0);
    return true;
  }

  function handleBucketClick(target) {
    if (target && target.name() === 'pf-user-node' && !target.getAttr('pfLocked')) {
      const t = target.getAttr('pfType');
      if (t === 'shape') {
        if (target.getAttr('pfShapeType') === 'line') target.stroke(activeColor);
        else window.LayerManager.applyShapeFillConfig(target, { ...(target.getAttr('pfFillConfig') || {}), mode: 'solid', color: activeColor });
        artboardLayer.batchDraw(); callbacks.onCommit?.(); return;
      }
      if (t === 'text') { target.fill(activeColor); artboardLayer.batchDraw(); callbacks.onCommit?.(); return; }
      if (t === 'paint' || t === 'image') {
        const c = ensureMutableCanvas(target), pt = toNodeCanvasCoords(target);
        if (pt && floodFillCanvas(c, pt.x, pt.y, activeColor, bucketSettings.tolerance)) {
          target._pfOrigSource = c;
          const fastUrl = window.LayerManager.canvasToFastDataURL(c, 0.92);
          target.setAttr('pfAssetId', window.LayerManager.createAssetFromDataURL(fastUrl, c));
          const adj = target.getAttr('pfAdjustments'); if (adj) window.AdjustmentEngine.applyToNode(target, adj);
          artboardLayer.batchDraw(); callbacks.onCommit?.();
        }
        return;
      }
    }
    const sel = getSelectedNode();
    if (sel && sel.getAttr('pfType') === 'paint' && !sel.getAttr('pfLocked')) {
      const c = ensureMutableCanvas(sel), pt = toNodeCanvasCoords(sel);
      if (pt && floodFillCanvas(c, pt.x, pt.y, activeColor, bucketSettings.tolerance)) {
        sel._pfOrigSource = c;
        const fastUrl = window.LayerManager.canvasToFastDataURL(c, 0.92);
        sel.setAttr('pfAssetId', window.LayerManager.createAssetFromDataURL(fastUrl, c));
        const adj = sel.getAttr('pfAdjustments'); if (adj) window.AdjustmentEngine.applyToNode(sel, adj);
        artboardLayer.batchDraw(); callbacks.onCommit?.();
      }
      return;
    }
    setBackground({ ...bgConfig, type: 'solid', color: activeColor });
    callbacks.onCommit?.();
  }

  function sampleColorAtPointer() {
    const p = stage?.getPointerPosition();
    if (!p) return null;
    const canvasEl = artboardLayer.getCanvas()._canvas;
    if (!canvasEl.width || !canvasEl.height) return null;
    const pr = artboardLayer.getCanvas().getPixelRatio() || 1;
    const px = Math.max(0, Math.min(canvasEl.width - 1, Math.round(p.x * pr)));
    const py = Math.max(0, Math.min(canvasEl.height - 1, Math.round(p.y * pr)));
    const d = canvasEl.getContext('2d').getImageData(px, py, 1, 1).data;
    if (d[3] === 0) {
      callbacks.onMessage?.('Zona transparente (sin color)');
      return null;
    }
    const hex = '#' + [d[0], d[1], d[2]].map((v) => v.toString(16).padStart(2, '0')).join('');
    activeColor = hex; callbacks.onColorSampled?.(hex); return hex;
  }

  function updateCropOverlay() {
    if (!cropState) return;
    const { rect, masks, thirds } = cropState;
    const x = rect.x(), y = rect.y(), w = Math.max(10, rect.width() * rect.scaleX()), h = Math.max(10, rect.height() * rect.scaleY()), pad = 4000;
    masks.top.setAttrs({ x: -pad, y: -pad, width: artboardW + pad * 2, height: y + pad });
    masks.bottom.setAttrs({ x: -pad, y: y + h, width: artboardW + pad * 2, height: artboardH + pad - (y + h) });
    masks.left.setAttrs({ x: -pad, y: y, width: x + pad, height: h });
    masks.right.setAttrs({ x: x + w, y: y, width: artboardW + pad - (x + w), height: h });
    const sw = 1 / stage.scaleX();
    thirds.v1.setAttrs({ points: [x + w / 3, y, x + w / 3, y + h], strokeWidth: sw });
    thirds.v2.setAttrs({ points: [x + (w * 2) / 3, y, x + (w * 2) / 3, y + h], strokeWidth: sw });
    thirds.h1.setAttrs({ points: [x, y + h / 3, x + w, y + h / 3], strokeWidth: sw });
    thirds.h2.setAttrs({ points: [x, y + (h * 2) / 3, x + w, y + (h * 2) / 3], strokeWidth: sw });
    rect.strokeWidth(2 / stage.scaleX());
  }

  function startCropMode() {
    cancelCropMode();
    const sel = getSelectedNode(), isImg = sel && sel.getAttr('pfType') === 'image';
    let initBox = { x: 0, y: 0, width: artboardW, height: artboardH };
    if (isImg) { const r = sel.getClientRect({ relativeTo: contentGroup }); initBox = { x: Math.round(r.x), y: Math.round(r.y), width: Math.max(20, Math.round(r.width)), height: Math.max(20, Math.round(r.height)) }; }
    transformer.nodes([]);
    const maskCfg = { fill: 'rgba(0,0,0,0.58)', listening: false }, lineCfg = { stroke: 'rgba(255,255,255,0.45)', listening: false };
    const masks = { top: new Konva.Rect(maskCfg), bottom: new Konva.Rect(maskCfg), left: new Konva.Rect(maskCfg), right: new Konva.Rect(maskCfg) };
    const thirds = { v1: new Konva.Line(lineCfg), v2: new Konva.Line(lineCfg), h1: new Konva.Line(lineCfg), h2: new Konva.Line(lineCfg) };
    const rect = new Konva.Rect({ x: initBox.x, y: initBox.y, width: initBox.width, height: initBox.height, stroke: '#a78bfa', strokeWidth: 2 / stage.scaleX(), dash: [6, 4], fill: 'transparent', draggable: true });
    const cropTr = new Konva.Transformer({
      nodes: [rect],
      rotateEnabled: false,
      borderStroke: '#a78bfa',
      anchorFill: '#ffffff',
      anchorStroke: '#8b5cf6',
      anchorSize: 10,
      boundBoxFunc: (oldBox, newBox) => (Math.abs(newBox.width) < 16 || Math.abs(newBox.height) < 16) ? oldBox : newBox
    });
    cropGroup.add(masks.top, masks.bottom, masks.left, masks.right, thirds.v1, thirds.v2, thirds.h1, thirds.h2, rect, cropTr);
    cropState = { target: isImg ? 'image' : 'artboard', node: isImg ? sel : null, bounds: { ...initBox }, rect, tr: cropTr, masks, thirds };
    updateCropOverlay();
    rect.on('dragmove transform', () => {
      if (!cropState) return;
      const b = cropState.bounds;
      const w = Math.min(b.width, Math.max(16, rect.width() * rect.scaleX()));
      const h = Math.min(b.height, Math.max(16, rect.height() * rect.scaleY()));
      const clampedX = Math.max(b.x, Math.min(b.x + b.width - w, rect.x()));
      const clampedY = Math.max(b.y, Math.min(b.y + b.height - h, rect.y()));
      rect.x(clampedX);
      rect.y(clampedY);
      updateCropOverlay();
    });
    overlayLayer.batchDraw();
    return cropState.target;
  }

  function setCropAspectRatio(ratio) {
    if (!cropState) return;
    const { rect, tr, bounds } = cropState;
    if (!ratio) { tr.keepRatio(false); return; }
    tr.keepRatio(true);
    let curW = Math.min(bounds.width, Math.max(16, rect.width() * rect.scaleX()));
    let curH = Math.max(16, curW / ratio);
    if (curH > bounds.height) {
      curH = bounds.height;
      curW = Math.max(16, curH * ratio);
    }
    rect.scale({ x: 1, y: 1 });
    rect.size({ width: curW, height: curH });
    rect.x(Math.max(bounds.x, Math.min(bounds.x + bounds.width - curW, rect.x())));
    rect.y(Math.max(bounds.y, Math.min(bounds.y + bounds.height - curH, rect.y())));
    updateCropOverlay(); overlayLayer.batchDraw();
  }

  function cancelCropMode() { if (!cropState) return; cropGroup.destroyChildren(); cropState = null; overlayLayer.batchDraw(); }

  function applyCropMode() {
    if (!cropState) return false;
    const { target, node, rect } = cropState;
    const box = { x: rect.x(), y: rect.y(), width: Math.max(16, rect.width() * rect.scaleX()), height: Math.max(16, rect.height() * rect.scaleY()) };
    if (target === 'image' && node) {
      const img = node._pfOrigSource || node.image();
      const natW = img.naturalWidth || img.width, natH = img.naturalHeight || img.height;
      const cx = node.cropX() || 0, cy = node.cropY() || 0, cw = node.cropWidth() || natW, ch = node.cropHeight() || natH;
      const nb = node.getClientRect({ relativeTo: contentGroup });
      const rl = Math.max(0, Math.min(1, (box.x - nb.x) / nb.width)), rt = Math.max(0, Math.min(1, (box.y - nb.y) / nb.height));
      const rr = Math.max(rl + 0.02, Math.min(1, (box.x + box.width - nb.x) / nb.width)), rb = Math.max(rt + 0.02, Math.min(1, (box.y + box.height - nb.y) / nb.height));
      node.clearCache();
      node.crop({ x: cx + rl * cw, y: cy + rt * ch, width: Math.max(4, (rr - rl) * cw), height: Math.max(4, (rb - rt) * ch) });
      node.position({ x: nb.x + rl * nb.width, y: nb.y + rt * nb.height });
      node.scale({ x: node.scaleX() < 0 ? -1 : 1, y: node.scaleY() < 0 ? -1 : 1 });
      node.size({ width: Math.max(10, (rr - rl) * nb.width), height: Math.max(10, (rb - rt) * nb.height) });
      const adj = node.getAttr('pfAdjustments'); if (adj) window.AdjustmentEngine.applyToNode(node, adj);
      cancelCropMode(); selectNode(node);
    } else {
      contentGroup.getChildren().forEach((n) => { n.x(n.x() - box.x); n.y(n.y() - box.y); });
      cancelCropMode(); resizeArtboard(Math.round(box.width), Math.round(box.height), false);
    }
    callbacks.onCommit?.(); return true;
  }

  function startTextEdit(textNode) {
    if (!textNode || textNode.getAttr('pfLocked')) return;
    document.querySelectorAll('.pf-text-editor, .pf-text-commit-bar').forEach((e) => e.remove());
    const absPos = textNode.getAbsolutePosition(), absScale = textNode.getAbsoluteScale(), stageBox = stage.container().getBoundingClientRect();
    textNode.hide(); transformer.hide(); artboardLayer.batchDraw(); overlayLayer.batchDraw();

    const ta = document.createElement('textarea');
    ta.className = 'pf-text-editor';
    ta.value = textNode.getAttr('pfRawText') ?? textNode.text();
    ta.style.left = `${stageBox.left + absPos.x}px`; ta.style.top = `${stageBox.top + absPos.y}px`;
    ta.style.width = `${Math.max(60, textNode.width() * Math.abs(absScale.x))}px`;
    ta.style.minHeight = `${Math.max(30, textNode.height() * Math.abs(absScale.y))}px`;
    ta.style.fontSize = `${Math.max(10, textNode.fontSize() * Math.abs(absScale.y))}px`;
    ta.style.fontFamily = textNode.fontFamily(); ta.style.lineHeight = String(textNode.lineHeight() || 1.2);
    ta.style.letterSpacing = `${(textNode.letterSpacing() || 0) * Math.abs(absScale.x)}px`;
    ta.style.color = textNode.fill() || '#111111'; ta.style.textAlign = textNode.align() || 'left';
    const fs = textNode.fontStyle() || '';
    ta.style.fontWeight = fs.includes('bold') ? '700' : '400'; ta.style.fontStyle = fs.includes('italic') ? 'italic' : 'normal';
    ta.style.transform = `rotate(${textNode.getAbsoluteRotation()}deg)`;

    const commitBar = document.createElement('div');
    commitBar.className = 'pf-text-commit-bar';
    commitBar.innerHTML = `<button class="btn btn-secondary btn-sm" id="pf-te-cancel">Cancelar</button><button class="btn btn-primary btn-sm" id="pf-te-ok">Listo</button>`;
    document.body.appendChild(ta); document.body.appendChild(commitBar);

    const resizeTa = () => { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; };
    resizeTa();
    const openedAt = Date.now();
    setTimeout(() => { ta.focus(); ta.select(); }, 30);

    let finished = false;
    function finish(save) {
      if (finished) return;
      finished = true;
      if (save) {
        textNode.setAttr('pfRawText', ta.value);
        textNode.text(textNode.getAttr('pfUppercase') ? ta.value.toUpperCase() : ta.value);
        callbacks.onCommit?.();
      }
      ta.remove(); commitBar.remove(); textNode.show(); transformer.show();
      artboardLayer.batchDraw(); overlayLayer.batchDraw();
    }

    ta.addEventListener('input', resizeTa);
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); finish(false); }
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); finish(true); }
    });
    commitBar.querySelector('#pf-te-ok').addEventListener('pointerdown', (e) => { e.preventDefault(); finish(true); });
    commitBar.querySelector('#pf-te-cancel').addEventListener('pointerdown', (e) => { e.preventDefault(); finish(false); });
    ta.addEventListener('blur', () => {
      if (Date.now() - openedAt < 280) { ta.focus(); return; }
      setTimeout(() => finish(true), 120);
    });
  }

  function scheduleCoordsAndBrush(pt) {
    pendingCoords = pt;
    if (coordsRaf) return;
    coordsRaf = requestAnimationFrame(() => {
      coordsRaf = 0;
      const p = pendingCoords;
      if (!p || isPanning || isPinching) return;
      callbacks.onCoordsMove?.(Math.round(p.x), Math.round(p.y));
      if (currentTool === 'brush' || currentTool === 'eraser') {
        brushCursorCircle.visible(true);
        brushCursorCircle.position(p);
        brushCursorCircle.radius(Math.max(0.5, brushSettings.size / 2));
        brushCursorCircle.stroke(currentTool === 'eraser' ? '#f87171' : '#ffffff');
        brushCursorCircle.strokeWidth(1.5 / stage.scaleX());
        overlayLayer.batchDraw();
      }
    });
  }

  function startPan(ev) {
    isPanning = true;
    const cx = ev.touches ? ev.touches[0].clientX : ev.clientX;
    const cy = ev.touches ? ev.touches[0].clientY : ev.clientY;
    panStartClient = { x: cx, y: cy };
    panStartStage = { x: stage.x(), y: stage.y() };
    panDelta = { x: 0, y: 0 };
    setGestureListeningPaused(true);
    if (stageHostEl) {
      stageHostEl.style.transformOrigin = '0 0';
      stageHostEl.style.willChange = 'transform';
    }
    updateCursorStyle();
  }

  function movePan(ev) {
    if (!isPanning || !panStartClient) return;
    const cx = ev.touches ? ev.touches[0].clientX : ev.clientX;
    const cy = ev.touches ? ev.touches[0].clientY : ev.clientY;
    panDelta.x = cx - panStartClient.x;
    panDelta.y = cy - panStartClient.y;
    if (panRaf) return;
    panRaf = requestAnimationFrame(() => {
      panRaf = 0;
      if (isPanning && stageHostEl) {
        stageHostEl.style.transform = `translate3d(${panDelta.x.toFixed(1)}px, ${panDelta.y.toFixed(1)}px, 0)`;
      }
    });
  }

  function endPan(commit = true) {
    if (!isPanning) return;
    if (panRaf) { cancelAnimationFrame(panRaf); panRaf = 0; }
    isPanning = false;
    if (stageHostEl) {
      stageHostEl.style.transform = '';
      stageHostEl.style.willChange = '';
    }
    if (commit && panStartStage) {
      stage.position({ x: panStartStage.x + panDelta.x, y: panStartStage.y + panDelta.y });
    }
    panStartClient = null;
    panStartStage = null;
    panDelta = { x: 0, y: 0 };
    setGestureListeningPaused(false);
    updateCursorStyle();
    if (commit) afterViewTransform(true);
  }

  function setupStageEvents(container) {
    stage.on('mousedown touchstart', (e) => {
      if (isPinching || ignoreSingleTouchUntilRelease || (e.evt?.touches && e.evt.touches.length >= 2)) return;
      if (isSpacePanning || currentTool === 'hand' || e.evt?.button === 1) {
        startPan(e.evt);
        return;
      }
      if (currentTool === 'eyedropper') { sampleColorAtPointer(); return; }
      if (currentTool === 'bucket') { handleBucketClick(e.target); return; }
      if (currentTool === 'brush' || currentTool === 'eraser') { startStroke(); return; }
      if (currentTool !== 'select') return;
      const target = e.target;
      if (target === stage || target === artboardBgRect || target === artboardChecker) { clearSelection(); return; }
      if (target.getParent()?.className === 'Transformer') return;
      if (target.name() === 'pf-user-node' && !target.getAttr('pfLocked')) selectNode(target);
    });

    stage.on('mousemove touchmove', (e) => {
      if (isPinching || ignoreSingleTouchUntilRelease || (e.evt?.touches && e.evt.touches.length >= 2)) return;
      if (isPanning) return;

      const pt = getArtboardPointFromStage();
      if (pt) scheduleCoordsAndBrush(pt);

      if ((currentTool === 'brush' || currentTool === 'eraser') && isDrawing && targetPaintNode) {
        const nextLocal = toNodeCanvasCoords(targetPaintNode);
        if (nextLocal) { paintStep(lastDrawLocal, nextLocal); lastDrawLocal = nextLocal; }
      }
    });

    stage.on('mouseleave', () => {
      if (brushCursorCircle.visible()) { brushCursorCircle.visible(false); overlayLayer.batchDraw(); }
    });

    stage.on('mouseup touchend', () => {
      if (isDrawing) endStroke();
      if (isPanning) endPan(true);
    });

    window.addEventListener('mousemove', (e) => { if (isPanning) movePan(e); });
    window.addEventListener('mouseup', () => { if (isPanning) endPan(true); });
    window.addEventListener('touchmove', (e) => { if (isPanning && e.touches.length === 1) movePan(e); }, { passive: true });
    window.addEventListener('touchend', (e) => { if (isPanning && e.touches.length === 0) endPan(true); });
    window.addEventListener('touchcancel', () => { if (isPanning) endPan(true); });

    stage.on('dblclick dbltap', (e) => {
      if (e.target?.getAttr('pfType') === 'text' && !e.target.getAttr('pfLocked')) startTextEdit(e.target);
    });

    stage.on('dragstart', (e) => {
      if (e.target.name() === 'pf-user-node') prepareDragSnapCache(e.target);
    });
    stage.on('dragmove', (e) => {
      if (e.target.name() === 'pf-user-node') { handleDragSnap(e.target); callbacks.onTransformChange?.(e.target); }
    });
    stage.on('dragend', (e) => {
      cachedDragState = null;
      guidesGroup.destroyChildren(); overlayLayer.batchDraw();
      if (e.target.name() === 'pf-user-node') { callbacks.onTransformChange?.(e.target); callbacks.onCommit?.(); }
    });

    transformer.on('transform', () => {
      const node = getSelectedNode(); if (!node) return;
      if (node.getAttr('pfType') === 'text') {
        const anchor = transformer.getActiveAnchor();
        if (anchor === 'middle-left' || anchor === 'middle-right') {
          node.width(Math.max(20, node.width() * Math.abs(node.scaleX())));
          node.scaleX(node.scaleX() < 0 ? -1 : 1);
        }
      }
      callbacks.onTransformChange?.(node);
    });

    transformer.on('transformend', () => {
      const node = getSelectedNode(); if (!node) return;
      if (node.getAttr('pfType') === 'text') {
        const sx = Math.abs(node.scaleX()), sy = Math.abs(node.scaleY());
        if (Math.abs(sx - 1) > 0.01 || Math.abs(sy - 1) > 0.01) {
          node.fontSize(Math.max(8, Math.round(node.fontSize() * sy)));
          node.width(Math.max(24, Math.round(node.width() * sx)));
          node.scale({ x: node.scaleX() < 0 ? -1 : 1, y: node.scaleY() < 0 ? -1 : 1 });
        }
      } else if (node.getAttr('pfType') === 'shape' && node.className === 'Rect') {
        node.width(Math.max(8, Math.round(node.width() * Math.abs(node.scaleX()))));
        node.height(Math.max(8, Math.round(node.height() * Math.abs(node.scaleY()))));
        node.scale({ x: node.scaleX() < 0 ? -1 : 1, y: node.scaleY() < 0 ? -1 : 1 });
        const fc = node.getAttr('pfFillConfig');
        if (fc?.mode === 'gradient') window.LayerManager.applyShapeFillConfig(node, fc);
      } else if (node.getAttr('pfType') === 'image') {
        const adj = node.getAttr('pfAdjustments');
        if (adj) window.AdjustmentEngine.applyToNode(node, adj);
      }
      callbacks.onTransformChange?.(node); callbacks.onCommit?.();
    });

    container.addEventListener('wheel', (e) => {
      e.preventDefault();
      setZoom(stage.scaleX() * (e.deltaY < 0 ? 1.1 : 1 / 1.1), stage.getPointerPosition());
    }, { passive: false });

    container.addEventListener('touchstart', (e) => {
      if (e.touches.length === 2) {
        if (isDrawing) endStroke();
        if (isPanning) endPan(true);
        if (viewRaf) { cancelAnimationFrame(viewRaf); viewRaf = 0; }
        isPinching = true;
        ignoreSingleTouchUntilRelease = true;
        setGestureListeningPaused(true);

        const t1 = e.touches[0], t2 = e.touches[1];
        pinchBox = getViewportBoxEl().getBoundingClientRect();
        lastPinchDist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
        lastPinchCenter = {
          x: (t1.clientX + t2.clientX) / 2 - pinchBox.left,
          y: (t1.clientY + t2.clientY) / 2 - pinchBox.top
        };
        pinchStart = { x: stage.x(), y: stage.y(), scale: stage.scaleX() };
        pinchCurrent = { ...pinchStart };
        container.style.transformOrigin = '0 0';
        container.style.willChange = 'transform';
      }
    }, { passive: true });

    container.addEventListener('touchmove', (e) => {
      if (e.touches.length === 2 && isPinching && lastPinchCenter && pinchBox) {
        e.preventDefault();
        const t1 = e.touches[0], t2 = e.touches[1];
        const dist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
        const center = {
          x: (t1.clientX + t2.clientX) / 2 - pinchBox.left,
          y: (t1.clientY + t2.clientY) / 2 - pinchBox.top
        };
        const oldScale = pinchCurrent.scale;
        const newScale = Math.max(0.08, Math.min(16, oldScale * (dist / (lastPinchDist || dist))));
        const ptX = (lastPinchCenter.x - pinchCurrent.x) / oldScale;
        const ptY = (lastPinchCenter.y - pinchCurrent.y) / oldScale;
        pinchCurrent = {
          scale: newScale,
          x: center.x - ptX * newScale,
          y: center.y - ptY * newScale
        };
        lastPinchDist = dist;
        lastPinchCenter = center;

        if (!pinchRaf) {
          pinchRaf = requestAnimationFrame(() => {
            pinchRaf = 0;
            if (!isPinching || !pinchCurrent || !pinchStart) return;
            const k = pinchCurrent.scale / pinchStart.scale;
            if (k > 2.5 || k < 0.4) {
              stage.scale({ x: pinchCurrent.scale, y: pinchCurrent.scale });
              stage.position({ x: pinchCurrent.x, y: pinchCurrent.y });
              applyPixelModeToDOMAndLayers();
              updateGridStrokeScale();
              if (artboardBorder) artboardBorder.strokeWidth(1 / pinchCurrent.scale);
              artboardLayer.draw();
              overlayLayer.draw();
              pinchStart = { ...pinchCurrent };
              container.style.transform = '';
            } else {
              const tx = pinchCurrent.x - k * pinchStart.x;
              const ty = pinchCurrent.y - k * pinchStart.y;
              container.style.transform = `translate3d(${tx.toFixed(1)}px, ${ty.toFixed(1)}px, 0) scale(${k.toFixed(4)})`;
            }
          });
        }
      }
    }, { passive: false });

    const finishPinch = (e) => {
      if (isPinching && e.touches.length < 2) {
        if (pinchRaf) { cancelAnimationFrame(pinchRaf); pinchRaf = 0; }
        isPinching = false;
        container.style.transform = '';
        container.style.willChange = '';
        if (pinchCurrent) {
          stage.scale({ x: pinchCurrent.scale, y: pinchCurrent.scale });
          stage.position({ x: pinchCurrent.x, y: pinchCurrent.y });
        }
        lastPinchDist = 0;
        lastPinchCenter = null;
        pinchBox = null;
        pinchStart = null;
        pinchCurrent = null;
        setGestureListeningPaused(false);
        afterViewTransform(true);
      }
      if (e.touches.length === 0) {
        ignoreSingleTouchUntilRelease = false;
      }
    };

    container.addEventListener('touchend', finishPinch);
    container.addEventListener('touchcancel', finishPinch);
  }

  function exportStageDataURL({ format = 'png', quality = 0.9, scale = 1, includeBg = true } = {}) {
    if (!stage || !artboardLayer) return '';
    const prevPos = { ...stage.position() }, prevScale = { ...stage.scale() };
    const prevCheckerVis = artboardChecker.visible(), prevBgVis = artboardBgRect.visible(), wasOverlayVis = overlayLayer.visible();
    let tempWhiteBg = null;
    try {
      overlayLayer.hide(); artboardChecker.hide();
      if (!includeBg) artboardBgRect.hide();
      else if (bgConfig.type === 'transparent' && format !== 'png') {
        tempWhiteBg = new Konva.Rect({ x: 0, y: 0, width: artboardW, height: artboardH, fill: '#ffffff' });
        artboardLayer.add(tempWhiteBg); tempWhiteBg.moveToBottom();
      }
      stage.position({ x: 0, y: 0 }); stage.scale({ x: 1, y: 1 });
      applyPixelModeToDOMAndLayers();
      artboardLayer.batchDraw();
      const mimeType = format === 'jpg' ? 'image/jpeg' : format === 'webp' ? 'image/webp' : 'image/png';
      return artboardLayer.toDataURL({ x: 0, y: 0, width: artboardW, height: artboardH, pixelRatio: scale, mimeType, quality });
    } finally {
      if (tempWhiteBg) tempWhiteBg.destroy();
      artboardBgRect.visible(prevBgVis); artboardChecker.visible(prevCheckerVis);
      stage.position(prevPos); stage.scale(prevScale);
      if (wasOverlayVis) overlayLayer.show();
      applyPixelModeToDOMAndLayers();
      artboardLayer.batchDraw(); overlayLayer.batchDraw();
    }
  }

  function renderThumbnail() {
    if (!artboardW || !artboardH) return '';
    const targetScale = Math.min(240 / artboardW, 160 / artboardH, 1);
    return exportStageDataURL({ format: 'jpg', quality: 0.7, scale: Math.max(0.06, targetScale), includeBg: true });
  }

  window.CanvasEngine = {
    init, createArtboard, resizeArtboard, setBackground, getBackground, fitToScreen,
    setZoom, zoomBy, getZoom, setTool, getTool: () => currentTool, setSpacePanning,
    selectNode, clearSelection, getSelectedNode, toggleGrid, toggleSnap, toggleRulers,
    drawRulers, startTextEdit, startCropMode, setCropAspectRatio, cancelCropMode,
    applyCropMode, getCropState: () => cropState, isBusy: () => isDrawing || isPanning || isPinching,
    getPixelMode: () => pixelMode, setPixelMode,
    getBrushSettings: () => ({ ...brushSettings }), setBrushSettings: (p) => { brushSettings = { ...brushSettings, ...p }; },
    getBucketSettings: () => ({ ...bucketSettings }), setBucketSettings: (p) => { bucketSettings = { ...bucketSettings, ...p }; },
    getActiveColor: () => activeColor, setActiveColor: (hex) => { activeColor = hex; },
    getArtboardDims: () => ({ width: artboardW, height: artboardH }),
    getContentGroup: () => contentGroup, getOverlayLayer: () => overlayLayer, getStage: () => stage,
    exportStageDataURL, renderThumbnail
  };
})();