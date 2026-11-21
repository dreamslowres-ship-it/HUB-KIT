/* ============================================================
   PixelForge Studio 3.3.3 — UI Controller + Pixel Mode + 1px Brush
   ============================================================ */
(function () {
  let app = null, toastTimer = null, newDocBgMode = 'white', lockAspectRatio = true;
  let lastOptionsKey = '';
  const quickPalette = ['#ffffff', '#111111', '#a78bfa', '#38bdf8', '#4ade80', '#facc15', '#fb7185', '#f97316'];
  const $ = (id) => document.getElementById(id);

  function toast(msg, type = '') {
    const el = $('toast'); if (!el) return;
    el.textContent = msg; el.className = `toast ${type}`;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.add('hidden'), 2400);
  }

  function showScreen(name) {
    document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));
    $(`screen-${name}`)?.classList.add('active');
    if (name === 'editor') {
      requestAnimationFrame(() => {
        window.CanvasEngine.fitToScreen();
      });
    }
  }

  function formatDate(ts) { return ts ? new Date(ts).toLocaleDateString('es-ES', { day: '2-digit', month: 'short' }) : ''; }
  function escapeHtml(str) { return String(str).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m])); }

  function renderProjects(list) {
    const container = $('projects-list'), empty = $('empty-projects');
    $('projects-count').textContent = String(list.length);
    container.querySelectorAll('.project-card').forEach((c) => c.remove());
    if (!list.length) { empty.classList.remove('hidden'); return; }
    empty.classList.add('hidden');
    const frag = document.createDocumentFragment();
    for (const p of list) {
      const card = document.createElement('div');
      card.className = 'project-card';
      card.innerHTML = `
        <div class="project-thumb">
          ${p.thumbnail ? `<img src="${p.thumbnail}" alt="" />` : `<span class="icon">${window.Icons.svg('image')}</span>`}
          <button class="project-delete-btn" title="Eliminar proyecto">${window.Icons.svg('trash')}</button>
        </div>
        <div class="project-info"><h3>${escapeHtml(p.name || 'Sin título')}</h3><p>${p.width} × ${p.height} · ${formatDate(p.updatedAt)}</p></div>
      `;
      card.querySelector('.project-delete-btn').addEventListener('click', (e) => {
        e.stopPropagation(); if (confirm(`¿Eliminar "${p.name || 'Sin título'}"?`)) app.deleteProject(p.id);
      });
      card.addEventListener('click', () => app.openProject(p.id));
      frag.appendChild(card);
    }
    container.appendChild(frag);
  }

  function renderSizePresets() {
    const grid = $('size-presets'); grid.innerHTML = '';
    const frag = document.createDocumentFragment();
    for (const p of window.ProjectManager.PRESETS) {
      const btn = document.createElement('button');
      btn.className = 'size-card';
      btn.innerHTML = `<span class="cat">${p.cat}</span><span class="name">${p.name}</span><span class="dims">${p.width} × ${p.height} px</span>`;
      btn.addEventListener('click', () => app.createNewProject(p.width, p.height, newDocBgMode, p.name));
      frag.appendChild(btn);
    }
    grid.appendChild(frag);
  }

  function renderQuickSwatches() {
    const box = $('quick-swatches'); if (!box) return;
    box.innerHTML = '';
    const frag = document.createDocumentFragment();
    quickPalette.forEach((hex) => {
      const sw = document.createElement('button');
      sw.className = 'q-swatch'; sw.style.background = hex; sw.title = hex.toUpperCase();
      sw.addEventListener('click', () => { window.CanvasEngine.setActiveColor(hex); updateActiveColorUI(hex); renderOptionsBar(); });
      frag.appendChild(sw);
    });
    box.appendChild(frag);
  }

  function setActiveTool(tool) { document.querySelectorAll('#toolbar .tool-btn').forEach((b) => b.classList.toggle('active', b.dataset.tool === tool)); }
  function setActiveTab(tabName) {
    document.querySelectorAll('.panel-tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === tabName));
    document.querySelectorAll('.panel-content').forEach((c) => c.classList.toggle('active', c.id === `tab-${tabName}`));
  }
  function updateHistoryButtons({ canUndo, canRedo }) { $('btn-undo').disabled = !canUndo; $('btn-redo').disabled = !canRedo; }
  function updateZoomUI(z) { const el = $('zoom-level'); if (el) el.textContent = `${Math.round(z * 100)}%`; }
  function updateArtboardBadge(w, h) { const el = $('btn-artboard-size'); if (el) el.textContent = `${w} × ${h}`; }
  function updateActiveColorUI(hex) {
    if (!hex) return;
    $('active-color-picker').value = hex; $('active-color-preview').style.background = hex; $('active-color-hex').textContent = hex.toUpperCase();
  }

  function renderOptionsBar(force = false) {
    const bar = $('options-bar'); if (!bar) return;
    const tool = window.CanvasEngine.getTool(), sel = window.CanvasEngine.getSelectedNode();
    const selId = sel?.id() || '';
    const selType = sel?.getAttr('pfType') || '';
    const cropTarget = window.CanvasEngine.getCropState()?.target || '';
    const pm = window.CanvasEngine.getPixelMode?.() || 'smooth';
    const key = `${tool}|${selId}|${selType}|${cropTarget}|${pm}`;

    if (!force && key === lastOptionsKey && bar.childElementCount > 0) {
      const color = window.CanvasEngine.getActiveColor();
      if (tool === 'bucket') {
        const bk = window.CanvasEngine.getBucketSettings();
        const tolEl = bar.querySelector('#opt-bucket-tol');
        const tolV = bar.querySelector('#opt-bucket-tol-v');
        const colEl = bar.querySelector('#opt-bucket-color');
        if (tolEl && Number(tolEl.value) !== bk.tolerance) tolEl.value = bk.tolerance;
        if (tolV) tolV.textContent = `${bk.tolerance}%`;
        if (colEl && colEl.value !== color) colEl.value = color;
      } else if (tool === 'brush' || tool === 'eraser') {
        const bs = window.CanvasEngine.getBrushSettings();
        const szEl = bar.querySelector('#opt-brush-size');
        const szV = bar.querySelector('#opt-brush-size-v');
        const btn1 = bar.querySelector('#opt-brush-1px');
        const opEl = bar.querySelector('#opt-brush-op');
        const opV = bar.querySelector('#opt-brush-op-v');
        const hdEl = bar.querySelector('#opt-brush-hard');
        const hdV = bar.querySelector('#opt-brush-hard-v');
        const colEl = bar.querySelector('#opt-brush-color');
        if (szEl) szEl.value = bs.size;
        if (szV) szV.textContent = `${bs.size}px`;
        if (btn1) btn1.classList.toggle('active', bs.size === 1);
        if (opEl) opEl.value = Math.round(bs.opacity * 100);
        if (opV) opV.textContent = `${Math.round(bs.opacity * 100)}%`;
        if (hdEl) hdEl.value = bs.hardness;
        if (hdV) hdV.textContent = `${bs.hardness}%`;
        if (colEl && colEl.value !== color) colEl.value = color;
      } else if (tool === 'eyedropper') {
        const swEl = bar.querySelector('#opt-eye-swatch');
        const hexEl = bar.querySelector('#opt-eye-hex');
        if (swEl) swEl.style.background = color;
        if (hexEl) hexEl.textContent = color.toUpperCase();
      }
      return;
    }

    lastOptionsKey = key;

    if (tool === 'crop') {
      const targetLabel = cropTarget === 'image' ? 'Recortar Imagen' : 'Recortar Artboard';
      bar.innerHTML = `
        <span class="opt-chip">${targetLabel}</span>
        <div class="opt-group"><span class="opt-label">Proporción:</span>
          <button class="opt-btn" data-crop-ratio="">Libre</button><button class="opt-btn" data-crop-ratio="1">1:1</button>
          <button class="opt-btn" data-crop-ratio="0.8">4:5</button><button class="opt-btn" data-crop-ratio="1.777">16:9</button><button class="opt-btn" data-crop-ratio="0.5625">9:16</button>
        </div><div class="v-divider"></div>
        <button class="opt-btn" id="opt-crop-cancel">Cancelar</button><button class="opt-btn primary" id="opt-crop-apply">Aplicar recorte</button>
      `;
      bar.querySelectorAll('[data-crop-ratio]').forEach((b) => b.addEventListener('click', () => window.CanvasEngine.setCropAspectRatio(b.dataset.cropRatio ? Number(b.dataset.cropRatio) : null)));
      bar.querySelector('#opt-crop-cancel').addEventListener('click', () => handleToolTrigger('select'));
      bar.querySelector('#opt-crop-apply').addEventListener('click', () => { window.CanvasEngine.applyCropMode(); handleToolTrigger('select'); toast('Recorte aplicado', 'success'); });
      return;
    }

    if (tool === 'bucket') {
      const bk = window.CanvasEngine.getBucketSettings(), color = window.CanvasEngine.getActiveColor();
      bar.innerHTML = `
        <span class="opt-chip">Bote de Pintura</span>
        <div class="opt-group"><span class="opt-label">Tolerancia</span>
          <input type="range" class="opt-range" id="opt-bucket-tol" min="0" max="90" value="${bk.tolerance}" /><span class="opt-val" id="opt-bucket-tol-v">${bk.tolerance}%</span>
        </div>
        <input type="color" class="opt-color" id="opt-bucket-color" value="${color}" />
        <button class="opt-btn primary" id="opt-bucket-done">Selección (V)</button>
      `;
      bar.querySelector('#opt-bucket-tol').addEventListener('input', (e) => { const v = Number(e.target.value); window.CanvasEngine.setBucketSettings({ tolerance: v }); bar.querySelector('#opt-bucket-tol-v').textContent = `${v}%`; });
      bar.querySelector('#opt-bucket-color').addEventListener('input', (e) => { window.CanvasEngine.setActiveColor(e.target.value); updateActiveColorUI(e.target.value); });
      bar.querySelector('#opt-bucket-done').addEventListener('click', () => handleToolTrigger('select'));
      return;
    }

    if (tool === 'brush' || tool === 'eraser') {
      const bs = window.CanvasEngine.getBrushSettings(), color = window.CanvasEngine.getActiveColor();
      bar.innerHTML = `
        <span class="opt-chip">${tool === 'brush' ? 'Pincel' : 'Borrador'}</span>
        <button class="opt-btn${bs.size === 1 ? ' active' : ''}" id="opt-brush-1px" title="Píxel exacto 1px">1px</button>
        <div class="opt-group"><span class="opt-label">Tamaño</span><input type="range" class="opt-range" id="opt-brush-size" min="1" max="180" value="${bs.size}" /><span class="opt-val" id="opt-brush-size-v">${bs.size}px</span></div>
        <div class="opt-group"><span class="opt-label">Opacidad</span><input type="range" class="opt-range" id="opt-brush-op" min="5" max="100" value="${Math.round(bs.opacity * 100)}" /><span class="opt-val" id="opt-brush-op-v">${Math.round(bs.opacity * 100)}%</span></div>
        <div class="opt-group"><span class="opt-label">Dureza</span><input type="range" class="opt-range" id="opt-brush-hard" min="0" max="100" value="${bs.hardness}" /><span class="opt-val" id="opt-brush-hard-v">${bs.hardness}%</span></div>
        ${tool === 'brush' ? `<input type="color" class="opt-color" id="opt-brush-color" value="${color}" />` : ''}
        <button class="opt-btn" id="opt-new-paint-layer">+ Capa dibujo</button><button class="opt-btn primary" id="opt-brush-done">Selección (V)</button>
      `;
      const szInput = bar.querySelector('#opt-brush-size');
      const szVal = bar.querySelector('#opt-brush-size-v');
      const btn1 = bar.querySelector('#opt-brush-1px');
      btn1.addEventListener('click', () => {
        window.CanvasEngine.setBrushSettings({ size: 1 });
        szInput.value = 1;
        szVal.textContent = '1px';
        btn1.classList.add('active');
      });
      szInput.addEventListener('input', (e) => {
        const v = Number(e.target.value);
        window.CanvasEngine.setBrushSettings({ size: v });
        szVal.textContent = `${v}px`;
        btn1.classList.toggle('active', v === 1);
      });
      bar.querySelector('#opt-brush-op').addEventListener('input', (e) => { const v = Number(e.target.value); window.CanvasEngine.setBrushSettings({ opacity: v / 100 }); bar.querySelector('#opt-brush-op-v').textContent = `${v}%`; });
      bar.querySelector('#opt-brush-hard').addEventListener('input', (e) => { const v = Number(e.target.value); window.CanvasEngine.setBrushSettings({ hardness: v }); bar.querySelector('#opt-brush-hard-v').textContent = `${v}%`; });
      bar.querySelector('#opt-brush-color')?.addEventListener('input', (e) => { window.CanvasEngine.setActiveColor(e.target.value); updateActiveColorUI(e.target.value); });
      bar.querySelector('#opt-new-paint-layer').addEventListener('click', () => { window.LayerManager.addPaintLayer('Capa de dibujo'); app.commitState(); toast('Nueva capa de dibujo creada'); });
      bar.querySelector('#opt-brush-done').addEventListener('click', () => handleToolTrigger('select'));
      return;
    }

    if (tool === 'eyedropper') {
      const hex = window.CanvasEngine.getActiveColor();
      bar.innerHTML = `
        <span class="opt-chip">Cuentagotas</span><span class="opt-label">Toca el lienzo:</span>
        <span id="opt-eye-swatch" style="width:18px;height:18px;border-radius:4px;border:1px solid #555;background:${hex};display:inline-block"></span><span id="opt-eye-hex" class="mono-tag">${hex.toUpperCase()}</span>
        <button class="opt-btn" id="opt-eye-apply">Aplicar a selección</button><button class="opt-btn" id="opt-eye-brush">Ir a Pincel</button><button class="opt-btn primary" id="opt-eye-done">Selección</button>
      `;
      bar.querySelector('#opt-eye-apply').addEventListener('click', () => {
        const node = window.CanvasEngine.getSelectedNode(); if (!node) return toast('No hay ninguna capa seleccionada');
        const c = window.CanvasEngine.getActiveColor();
        if (node.getAttr('pfType') === 'text') node.fill(c);
        else if (node.getAttr('pfType') === 'shape') {
          if (node.getAttr('pfShapeType') === 'line') node.stroke(c);
          else window.LayerManager.applyShapeFillConfig(node, { ...(node.getAttr('pfFillConfig') || {}), mode: 'solid', color: c });
        }
        node.getLayer()?.batchDraw(); app.commitState(); syncPropertiesPanel();
      });
      bar.querySelector('#opt-eye-brush').addEventListener('click', () => handleToolTrigger('brush'));
      bar.querySelector('#opt-eye-done').addEventListener('click', () => handleToolTrigger('select'));
      return;
    }

    if (tool === 'shape') {
      const shapes = [['rect', 'Rectángulo'], ['circle', 'Círculo'], ['ellipse', 'Elipse'], ['triangle', 'Triángulo'], ['polygon', 'Polígono'], ['star', 'Estrella'], ['line', 'Línea'], ['arrow', 'Flecha']];
      bar.innerHTML = `<span class="opt-chip">Insertar forma</span>` + shapes.map(([id, lbl]) => `<button class="opt-btn" data-qshape="${id}">${window.Icons.svg(id)} ${lbl}</button>`).join('');
      bar.querySelectorAll('[data-qshape]').forEach((b) => b.addEventListener('click', () => {
        window.LayerManager.addShapeLayer(b.dataset.qshape, window.CanvasEngine.getActiveColor());
        app.commitState(); handleToolTrigger('select'); setActiveTab('props');
      }));
      return;
    }

    if (sel) {
      const type = sel.getAttr('pfType'), labels = { text: 'Texto', shape: 'Forma', image: 'Imagen', paint: 'Dibujo' };
      bar.innerHTML = `
        <span class="opt-chip">${labels[type] || 'Capa'}</span>
        ${type === 'text' ? `<button class="opt-btn primary" id="opt-edit-txt">Editar texto</button>` : ''}
        ${type === 'image' ? `<button class="opt-btn" id="opt-crop-img">${window.Icons.svg('crop')} Recortar</button>` : ''}
        <button class="opt-btn" id="opt-ch">${window.Icons.svg('alignBoardCenterH')} Centrar H</button>
        <button class="opt-btn" id="opt-cv">${window.Icons.svg('alignBoardCenterV')} Centrar V</button>
        <button class="opt-btn" id="opt-fh" title="Voltear H">${window.Icons.svg('flipH')}</button>
        <button class="opt-btn" id="opt-fv" title="Voltear V">${window.Icons.svg('flipV')}</button>
        <div class="v-divider"></div>
        <button class="opt-btn" id="opt-up">${window.Icons.svg('arrowUp')}</button><button class="opt-btn" id="opt-down">${window.Icons.svg('arrowDown')}</button>
        <button class="opt-btn" id="opt-dup">${window.Icons.svg('copy')} Duplicar</button><button class="opt-btn" id="opt-lock">${window.Icons.svg('lock')}</button>
        <button class="opt-btn danger" id="opt-del">${window.Icons.svg('trash')}</button>
      `;
      bar.querySelector('#opt-edit-txt')?.addEventListener('click', () => window.CanvasEngine.startTextEdit(sel));
      bar.querySelector('#opt-crop-img')?.addEventListener('click', () => handleToolTrigger('crop'));
      bar.querySelector('#opt-ch').addEventListener('click', () => { window.LayerManager.alignLayer(sel.id(), 'centerH'); app.commitState(); });
      bar.querySelector('#opt-cv').addEventListener('click', () => { window.LayerManager.alignLayer(sel.id(), 'centerV'); app.commitState(); });
      bar.querySelector('#opt-fh').addEventListener('click', () => { window.LayerManager.flipLayer(sel.id(), 'h'); app.commitState(); });
      bar.querySelector('#opt-fv').addEventListener('click', () => { window.LayerManager.flipLayer(sel.id(), 'v'); app.commitState(); });
      bar.querySelector('#opt-up').addEventListener('click', () => { window.LayerManager.moveLayer(sel.id(), 'up'); app.commitState(); });
      bar.querySelector('#opt-down').addEventListener('click', () => { window.LayerManager.moveLayer(sel.id(), 'down'); app.commitState(); });
      bar.querySelector('#opt-dup').addEventListener('click', () => { window.LayerManager.duplicateLayer(sel.id()); app.commitState(); });
      bar.querySelector('#opt-lock').addEventListener('click', () => { window.LayerManager.toggleLock(sel.id()); app.commitState(); });
      bar.querySelector('#opt-del').addEventListener('click', () => { window.LayerManager.deleteLayer(sel.id()); app.commitState(); });
    } else {
      bar.innerHTML = `
        <span class="opt-chip">${tool === 'hand' ? 'Mano / Pan' : 'Artboard'}</span>
        <button class="opt-btn${pm === 'nearest' ? ' active' : ''}" id="opt-pixel-mode" title="Alternar Suavizado / Nearest (Píxel)">${pm === 'nearest' ? 'Pixel: Nearest' : 'Pixel: Suave'}</button>
        <button class="opt-btn" id="opt-add-text">${window.Icons.svg('text')} + Texto</button>
        <button class="opt-btn" id="opt-add-rect">${window.Icons.svg('rect')} + Rect</button>
        <button class="opt-btn" id="opt-add-circle">${window.Icons.svg('circle')} + Círculo</button>
        <button class="opt-btn" id="opt-add-img">${window.Icons.svg('image')} + Imagen</button>
        <button class="opt-btn" id="opt-add-paint">${window.Icons.svg('brush')} + Dibujo</button>
        <button class="opt-btn" id="opt-crop-board">${window.Icons.svg('crop')} Recortar lienzo</button>
      `;
      bar.querySelector('#opt-pixel-mode').addEventListener('click', () => {
        const cur = window.CanvasEngine.getPixelMode?.() || 'smooth';
        const nextMode = window.CanvasEngine.setPixelMode?.(cur === 'nearest' ? 'smooth' : 'nearest');
        syncPropertiesPanel();
        renderOptionsBar(true);
        toast(nextMode === 'nearest' ? 'Renderizado: Nearest (Píxel exacto)' : 'Renderizado: Suavizado');
      });
      bar.querySelector('#opt-add-text').addEventListener('click', () => handleToolTrigger('text'));
      bar.querySelector('#opt-add-rect').addEventListener('click', () => { window.LayerManager.addShapeLayer('rect', window.CanvasEngine.getActiveColor()); app.commitState(); });
      bar.querySelector('#opt-add-circle').addEventListener('click', () => { window.LayerManager.addShapeLayer('circle', window.CanvasEngine.getActiveColor()); app.commitState(); });
      bar.querySelector('#opt-add-img').addEventListener('click', () => handleToolTrigger('image'));
      bar.querySelector('#opt-add-paint').addEventListener('click', () => handleToolTrigger('paintLayer'));
      bar.querySelector('#opt-crop-board').addEventListener('click', () => handleToolTrigger('crop'));
    }
  }

  function renderLayers() {
    const listEl = $('layers-list'); if (!listEl) return;
    const nodes = window.LayerManager.getNodes().slice().reverse(), sel = window.CanvasEngine.getSelectedNode();
    const blendSel = $('layer-blend-mode'), opRange = $('layer-opacity'), opVal = $('layer-opacity-val');
    if (sel) {
      blendSel.disabled = false; opRange.disabled = false; blendSel.value = sel.globalCompositeOperation() || 'source-over';
      const pct = Math.round((sel.opacity() ?? 1) * 100); opRange.value = pct; opVal.textContent = `${pct}%`;
    } else { blendSel.disabled = true; opRange.disabled = true; blendSel.value = 'source-over'; opRange.value = 100; opVal.textContent = '100%'; }

    const typeNames = { text: 'Texto', shape: 'Forma', image: 'Imagen', paint: 'Dibujo' }, typeIcons = { text: 'text', shape: 'shape', image: 'image', paint: 'brush' };
    const existingItems = Array.from(listEl.querySelectorAll('.layer-item'));
    const nextSignature = nodes.map((n) => {
      const id = n.id(), type = n.getAttr('pfType') || 'shape', locked = !!n.getAttr('pfLocked'), visible = n.visible();
      const assetId = n.getAttr('pfAssetId') || '', blend = n.globalCompositeOperation(), opPct = Math.round((n.opacity() ?? 1) * 100);
      const name = n.getAttr('pfName') || 'Capa';
      return `${id}|${type}|${name}|${locked ? 1 : 0}|${visible ? 1 : 0}|${assetId}|${blend}|${opPct}`;
    }).join('~');

    if (listEl.dataset.pfSig === nextSignature && existingItems.length === nodes.length) {
      for (let i = 0; i < nodes.length; i++) {
        const id = nodes[i].id();
        existingItems[i].classList.toggle('selected', sel?.id() === id);
      }
    } else {
      listEl.dataset.pfSig = nextSignature;
      listEl.innerHTML = nodes.length ? '' : `<p class="panel-hint" style="padding:18px 8px">Lienzo vacío. Añade texto, formas, imágenes o dibuja.</p>`;
      const frag = document.createDocumentFragment();

      for (const node of nodes) {
        const id = node.id(), type = node.getAttr('pfType') || 'shape', locked = !!node.getAttr('pfLocked'), visible = node.visible();
        const assetId = node.getAttr('pfAssetId'), blend = node.globalCompositeOperation(), opPct = Math.round((node.opacity() ?? 1) * 100);
        const thumbSrc = (type === 'image' || type === 'paint') ? window.LayerManager.getThumbnail(assetId) : '';
        const thumbHtml = thumbSrc ? `<img src="${thumbSrc}" alt="" />` : `<span class="icon">${window.Icons.svg(typeIcons[type] || 'shape')}</span>`;

        const item = document.createElement('div');
        item.className = `layer-item${sel?.id() === id ? ' selected' : ''}${locked ? ' locked' : ''}${!visible ? ' hidden-layer' : ''}`;
        item.innerHTML = `
          <div class="layer-thumb">${thumbHtml}</div>
          <div class="layer-meta"><div class="layer-name">${escapeHtml(node.getAttr('pfName') || 'Capa')}</div><div class="layer-sub">${typeNames[type] || 'Capa'} · ${opPct}%${blend && blend !== 'source-over' ? ' · ' + blend : ''}</div></div>
          <div class="layer-actions">
            <button class="${locked ? 'on' : ''}" data-act="lock" title="Bloquear">${window.Icons.svg(locked ? 'lock' : 'unlock')}</button>
            <button class="${visible ? '' : 'on'}" data-act="vis" title="Mostrar/Ocultar">${window.Icons.svg(visible ? 'eye' : 'eyeOff')}</button>
          </div>
        `;
        item.addEventListener('click', (e) => {
          if (e.target.closest('button')) return;
          if (locked) return toast('Capa bloqueada.'); if (!visible) return toast('Capa oculta.');
          window.CanvasEngine.setTool('select'); setActiveTool('select'); window.CanvasEngine.selectNode(node);
        });
        item.querySelector('.layer-name').addEventListener('dblclick', (e) => {
          e.stopPropagation(); const next = prompt('Nombre de la capa:', node.getAttr('pfName') || 'Capa');
          if (next !== null && next.trim()) { window.LayerManager.renameLayer(id, next); app.commitState(); }
        });
        item.querySelector('[data-act="lock"]').addEventListener('click', (e) => { e.stopPropagation(); window.LayerManager.toggleLock(id); app.commitState(); });
        item.querySelector('[data-act="vis"]').addEventListener('click', (e) => { e.stopPropagation(); window.LayerManager.toggleVisibility(id); app.commitState(); });
        frag.appendChild(item);
      }
      listEl.appendChild(frag);
    }

    const bg = window.CanvasEngine.getBackground(), thumb = $('artboard-thumb'), desc = $('artboard-bg-desc');
    if (bg.type === 'transparent') { thumb.style.background = 'repeating-conic-gradient(#262632 0% 25%, #16161d 0% 50%) 50% / 10px 10px'; desc.textContent = 'Transparente (PNG)'; }
    else if (bg.type === 'gradient') { thumb.style.background = `linear-gradient(${bg.gradient.angle}deg, ${bg.gradient.color1}, ${bg.gradient.color2})`; desc.textContent = `Degradado · ${bg.gradient.angle}°`; }
    else { thumb.style.background = bg.color; desc.textContent = `Sólido · ${bg.color.toUpperCase()}`; }
  }

  function getNodeSize(node) {
    if (node.className === 'Circle') { const d = Math.round(node.radius() * 2 * Math.abs(node.scaleX())); return { w: d, h: d }; }
    if (node.className === 'Ellipse') return { w: Math.round(node.radiusX() * 2 * Math.abs(node.scaleX())), h: Math.round(node.radiusY() * 2 * Math.abs(node.scaleY())) };
    if (node.className === 'Star' || node.className === 'RegularPolygon') { const r = node.outerRadius ? node.outerRadius() : node.radius(); return { w: Math.round(r * 2 * Math.abs(node.scaleX())), h: Math.round(r * 2 * Math.abs(node.scaleY())) }; }
    if (node.className === 'Line' || node.className === 'Arrow') { const r = node.getClientRect({ relativeTo: window.CanvasEngine.getContentGroup() }); return { w: Math.round(r.width), h: Math.round(r.height) }; }
    return { w: Math.round(Math.abs(node.width() * node.scaleX())), h: Math.round(Math.abs(node.height() * node.scaleY())) };
  }

  function syncTransformFieldsOnly() {
    const node = window.CanvasEngine.getSelectedNode(); if (!node) return;
    $('prop-x').value = Math.round(node.x()); $('prop-y').value = Math.round(node.y());
    const { w, h } = getNodeSize(node); $('prop-w').value = w; $('prop-h').value = h;
    const rot = Math.round(node.rotation()); $('prop-rot').value = rot; $('prop-rot-range').value = Math.max(-180, Math.min(180, rot));
  }

  function syncPropertiesPanel() {
    const node = window.CanvasEngine.getSelectedNode();
    ['prop-transform-box', 'prop-text-box', 'prop-shape-box', 'prop-image-box', 'prop-paint-box'].forEach((id) => $(id).classList.add('hidden'));
    if (!node) {
      $('prop-artboard-box').classList.remove('hidden');
      const pm = window.CanvasEngine.getPixelMode?.() || 'smooth';
      document.querySelectorAll('#pixel-mode-group .seg-btn').forEach((b) => b.classList.toggle('active', b.dataset.pixelmode === pm));
      const bg = window.CanvasEngine.getBackground();
      document.querySelectorAll('#bg-mode-group .seg-btn').forEach((b) => b.classList.toggle('active', b.dataset.bgtype === bg.type));
      $('bg-solid-row').classList.toggle('hidden', bg.type !== 'solid'); $('bg-grad-row').classList.toggle('hidden', bg.type !== 'gradient');
      $('bg-color').value = bg.color; $('bg-color-hex').textContent = bg.color.toUpperCase();
      $('bg-grad-1').value = bg.gradient.color1; $('bg-grad-2').value = bg.gradient.color2; $('bg-grad-angle').value = bg.gradient.angle;
      return;
    }

    $('prop-artboard-box').classList.add('hidden'); $('prop-transform-box').classList.remove('hidden'); syncTransformFieldsOnly();
    const type = node.getAttr('pfType');
    if (type === 'text') {
      $('prop-text-box').classList.remove('hidden');
      $('text-font').value = node.fontFamily() || 'Inter';
      const sz = Math.round(node.fontSize() || 48); $('text-size').value = sz; $('text-size-num').value = sz;
      $('text-color').value = node.fill() || '#111111';
      $('text-line-height').value = node.lineHeight() || 1.2; $('text-letter-spacing').value = node.letterSpacing() || 0;
      $('text-stroke-color').value = node.stroke() || '#000000';
      const sw = node.strokeWidth() || 0; $('text-stroke-width').value = sw; $('text-stroke-val').textContent = sw;
      const fs = node.fontStyle() || '', td = node.textDecoration() || '', up = !!node.getAttr('pfUppercase');
      document.querySelectorAll('[data-style]').forEach((b) => {
        const st = b.dataset.style;
        b.classList.toggle('active', (st === 'bold' && fs.includes('bold')) || (st === 'italic' && fs.includes('italic')) || (st === 'underline' && td.includes('underline')) || (st === 'upper' && up));
      });
      document.querySelectorAll('[data-align]').forEach((b) => b.classList.toggle('active', b.dataset.align === (node.align() || 'left')));
    } else if (type === 'shape') {
      $('prop-shape-box').classList.remove('hidden');
      const st = node.getAttr('pfShapeType'), fc = node.getAttr('pfFillConfig') || { mode: 'solid', color: node.fill() || '#a78bfa' };
      document.querySelectorAll('#shape-fill-mode .seg-btn').forEach((b) => b.classList.toggle('active', b.dataset.fill === fc.mode));
      $('shape-solid-row').classList.toggle('hidden', fc.mode !== 'solid' || st === 'line');
      $('shape-grad-row').classList.toggle('hidden', fc.mode !== 'gradient' || st === 'line');
      const fillCol = fc.color || '#a78bfa'; $('shape-fill').value = fillCol; $('shape-fill-hex').textContent = fillCol.toUpperCase();
      $('shape-grad-1').value = fc.gradient?.color1 || '#a78bfa'; $('shape-grad-2').value = fc.gradient?.color2 || '#38bdf8'; $('shape-grad-angle').value = fc.gradient?.angle ?? 135;
      $('shape-stroke').value = node.stroke() || '#ffffff';
      const sw = Math.round(node.strokeWidth() || 0); $('shape-stroke-width').value = sw; $('shape-stroke-val').textContent = sw;
      $('shape-dashed').checked = (node.dash() || []).length > 0;
      $('corner-radius-group').classList.toggle('hidden', st !== 'rect');
      if (st === 'rect') { const cr = Math.round(node.cornerRadius() || 0); $('shape-corner').value = cr; $('shape-corner-val').textContent = cr; }
      const hasSides = st === 'polygon' || st === 'star'; $('shape-sides-group').classList.toggle('hidden', !hasSides);
      if (hasSides) { const sides = st === 'star' ? node.numPoints() : node.sides(); $('shape-sides').value = sides; $('shape-sides-val').textContent = sides; }
    } else if (type === 'image') $('prop-image-box').classList.remove('hidden');
    else if (type === 'paint') $('prop-paint-box').classList.remove('hidden');
  }

  function buildAdjustmentsUI() {
    const presetsEl = $('filter-presets'); presetsEl.innerHTML = '';
    for (const p of window.AdjustmentEngine.PRESETS) {
      const b = document.createElement('button'); b.className = 'preset-btn'; b.textContent = p.name;
      b.addEventListener('click', () => {
        const node = window.CanvasEngine.getSelectedNode(); if (!node) return;
        window.AdjustmentEngine.applyToNode(node, window.AdjustmentEngine.normalize(p.vals), { preview: false });
        syncAdjustmentsPanel(); app.commitState();
      });
      presetsEl.appendChild(b);
    }
    const slidersEl = $('adjust-sliders'); slidersEl.innerHTML = '';
    for (const m of window.AdjustmentEngine.FILTERS_META) {
      const grp = document.createElement('div'); grp.className = 'slider-group';
      grp.innerHTML = `<label><span>${m.label}</span><span id="adj-val-${m.key}">0</span></label><input type="range" id="adj-in-${m.key}" min="${m.min}" max="${m.max}" step="${m.step}" value="0" />`;
      const input = grp.querySelector('input');
      input.addEventListener('input', () => {
        const node = window.CanvasEngine.getSelectedNode(); if (!node) return;
        const cur = window.AdjustmentEngine.normalize(node.getAttr('pfAdjustments'));
        cur[m.key] = Number(input.value); $(`adj-val-${m.key}`).textContent = input.value;
        window.AdjustmentEngine.schedulePreview(node, cur);
      });
      input.addEventListener('change', () => {
        const node = window.CanvasEngine.getSelectedNode(); if (!node) return;
        const cur = window.AdjustmentEngine.normalize(node.getAttr('pfAdjustments'));
        cur[m.key] = Number(input.value);
        window.AdjustmentEngine.applyToNode(node, cur, { preview: false });
        app.commitState();
      });
      input.addEventListener('dblclick', () => {
        const node = window.CanvasEngine.getSelectedNode(); if (!node) return;
        const cur = window.AdjustmentEngine.normalize(node.getAttr('pfAdjustments'));
        cur[m.key] = window.AdjustmentEngine.DEFAULTS[m.key]; input.value = cur[m.key]; $(`adj-val-${m.key}`).textContent = cur[m.key];
        window.AdjustmentEngine.applyToNode(node, cur, { preview: false }); app.commitState();
      });
      slidersEl.appendChild(grp);
    }
  }

  function syncAdjustmentsPanel() {
    const node = window.CanvasEngine.getSelectedNode(), ok = node && (node.getAttr('pfType') === 'image' || node.getAttr('pfType') === 'paint');
    $('adjust-active-area').classList.toggle('hidden', !ok); $('adjust-hint').classList.toggle('hidden', !!ok);
    if (!ok) return;
    const adj = window.AdjustmentEngine.normalize(node.getAttr('pfAdjustments'));
    for (const m of window.AdjustmentEngine.FILTERS_META) {
      const val = adj[m.key] ?? 0, el = $(`adj-in-${m.key}`), lbl = $(`adj-val-${m.key}`);
      if (el) el.value = val; if (lbl) lbl.textContent = String(val);
    }
    document.querySelectorAll('[data-adj-toggle]').forEach((b) => b.classList.toggle('active', !!adj[b.dataset.adjToggle]));
  }

  function syncEffectsPanel() {
    const node = window.CanvasEngine.getSelectedNode();
    $('effects-active-area').classList.toggle('hidden', !node); $('effects-hint').classList.toggle('hidden', !!node);
    if (!node) return;
    const on = !!node.shadowEnabled();
    $('btn-shadow-toggle').textContent = on ? 'Desactivar' : 'Activar';
    $('btn-shadow-toggle').className = `btn btn-xs ${on ? 'btn-primary' : 'btn-secondary'}`;
    $('shadow-controls').classList.toggle('hidden', !on);
    if (on) {
      $('shadow-color').value = node.shadowColor() || '#000000';
      const sb = Math.round(node.shadowBlur() ?? 14), sx = Math.round(node.shadowOffsetX() ?? 4), sy = Math.round(node.shadowOffsetY() ?? 6), so = Math.round((node.shadowOpacity() ?? 0.45) * 100);
      $('shadow-blur').value = sb; $('shadow-blur-val').textContent = sb;
      $('shadow-offset-x').value = sx; $('shadow-ox-val').textContent = sx;
      $('shadow-offset-y').value = sy; $('shadow-oy-val').textContent = sy;
      $('shadow-opacity').value = so; $('shadow-op-val').textContent = `${so}%`;
    }
  }

  function handleToolTrigger(tool) {
    if (tool === 'zoomFit') { window.CanvasEngine.fitToScreen(); return; }
    if (tool === 'image') { $('input-image').click(); return; }
    if (tool === 'text') { window.LayerManager.addTextLayer(); app.commitState(); setActiveTab('props'); handleToolTrigger('select'); return; }
    if (tool === 'paintLayer') { window.LayerManager.addPaintLayer('Capa de dibujo'); app.commitState(); handleToolTrigger('brush'); return; }
    window.CanvasEngine.setTool(tool); setActiveTool(tool);
    if (tool === 'crop') window.CanvasEngine.startCropMode();
    renderOptionsBar();
  }

  function bindAllEvents() {
    $('btn-new-project').addEventListener('click', () => { renderSizePresets(); showScreen('size'); });
    $('btn-import-project').addEventListener('click', () => $('input-import').click());
    $('input-import').addEventListener('change', async (e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) await app.openImportedProject(f); });

    $('btn-size-back').addEventListener('click', () => showScreen('home'));
    document.querySelectorAll('#new-doc-bg-mode .seg-btn').forEach((b) => b.addEventListener('click', () => {
      newDocBgMode = b.dataset.bg;
      document.querySelectorAll('#new-doc-bg-mode .seg-btn').forEach((x) => x.classList.toggle('active', x === b));
    }));
    $('btn-create-custom').addEventListener('click', () => {
      const w = Math.max(64, Math.min(8000, Number($('custom-width').value) || 1080));
      const h = Math.max(64, Math.min(8000, Number($('custom-height').value) || 1080));
      app.createNewProject(w, h, newDocBgMode, 'Diseño personalizado');
    });

    $('btn-editor-back').addEventListener('click', () => app.backToHome());
    $('btn-undo').addEventListener('click', () => app.undo());
    $('btn-redo').addEventListener('click', () => app.redo());
    $('btn-save').addEventListener('click', () => app.saveCurrentProject(false));
    $('btn-save-file').addEventListener('click', () => app.downloadProjectFile());
    $('btn-toggle-grid').addEventListener('click', (e) => e.currentTarget.classList.toggle('active', window.CanvasEngine.toggleGrid()));
    $('btn-toggle-snap').addEventListener('click', (e) => e.currentTarget.classList.toggle('active', window.CanvasEngine.toggleSnap()));
    $('btn-toggle-rulers').addEventListener('click', (e) => e.currentTarget.classList.toggle('active', window.CanvasEngine.toggleRulers()));
    $('btn-toggle-inspector').addEventListener('click', (e) => {
      const dock = $('inspector-dock'); dock.classList.toggle('collapsed');
      e.currentTarget.classList.toggle('active', !dock.classList.contains('collapsed'));
      requestAnimationFrame(() => window.CanvasEngine.drawRulers());
    });

    const openResize = () => {
      const { width, height } = window.CanvasEngine.getArtboardDims();
      $('resize-width').value = width; $('resize-height').value = height; $('resize-scale-content').checked = false;
      $('modal-resize').classList.remove('hidden');
    };
    $('btn-artboard-size').addEventListener('click', openResize);
    $('btn-open-resize-2').addEventListener('click', openResize);
    $('btn-resize-cancel').addEventListener('click', () => $('modal-resize').classList.add('hidden'));
    $('btn-resize-apply').addEventListener('click', () => {
      const w = Math.max(64, Math.min(8000, Number($('resize-width').value) || 1080));
      const h = Math.max(64, Math.min(8000, Number($('resize-height').value) || 1080));
      window.CanvasEngine.resizeArtboard(w, h, $('resize-scale-content').checked);
      updateArtboardBadge(w, h); $('modal-resize').classList.add('hidden'); app.commitState(); toast(`Artboard: ${w} × ${h}`);
    });

    $('btn-export').addEventListener('click', () => {
      $('export-filename').value = ($('project-name').value || 'pixelforge-export').trim();
      $('modal-export').classList.remove('hidden');
    });
    $('export-format').addEventListener('change', (e) => $('export-quality-field').classList.toggle('hidden', e.target.value !== 'jpg' && e.target.value !== 'webp'));
    $('btn-export-cancel').addEventListener('click', () => $('modal-export').classList.add('hidden'));
    $('btn-export-download').addEventListener('click', async () => {
      try {
        await window.ExportEngine.exportImage({ format: $('export-format').value, quality: Number($('export-quality').value), scale: Number($('export-scale').value), filename: $('export-filename').value });
        $('modal-export').classList.add('hidden'); toast('Exportación completada', 'success');
      } catch (err) { toast(err.message || 'Error al exportar', 'error'); }
    });

    document.querySelectorAll('#toolbar .tool-btn').forEach((btn) => btn.addEventListener('click', () => handleToolTrigger(btn.dataset.tool)));
    $('active-color-picker').addEventListener('input', (e) => { window.CanvasEngine.setActiveColor(e.target.value); updateActiveColorUI(e.target.value); renderOptionsBar(); });

    $('input-image').addEventListener('change', (e) => {
      const file = e.target.files?.[0]; e.target.value = ''; if (!file) return;
      const reader = new FileReader();
      reader.onload = async () => {
        try { await window.LayerManager.addImageLayer(reader.result, file.name.replace(/\.[^.]+$/, '') || 'Imagen'); handleToolTrigger('select'); app.commitState(); toast('Imagen añadida', 'success'); }
        catch (_) { toast('No se pudo cargar la imagen', 'error'); }
      };
      reader.readAsDataURL(file);
    });

    $('btn-zoom-in').addEventListener('click', () => window.CanvasEngine.zoomBy(1.2));
    $('btn-zoom-out').addEventListener('click', () => window.CanvasEngine.zoomBy(1 / 1.2));
    $('btn-zoom-fit').addEventListener('click', () => window.CanvasEngine.fitToScreen());
    $('btn-zoom-100').addEventListener('click', () => window.CanvasEngine.setZoom(1));
    document.querySelectorAll('.panel-tab').forEach((tab) => tab.addEventListener('click', () => setActiveTab(tab.dataset.tab)));

    $('layer-blend-mode').addEventListener('change', (e) => { const s = window.CanvasEngine.getSelectedNode(); if (s) { window.LayerManager.setBlendMode(s.id(), e.target.value); app.commitState(); } });
    $('layer-opacity').addEventListener('input', (e) => { const s = window.CanvasEngine.getSelectedNode(); if (!s) return; const p = Number(e.target.value); $('layer-opacity-val').textContent = `${p}%`; window.LayerManager.setLayerOpacity(s.id(), p / 100); });
    $('layer-opacity').addEventListener('change', () => app.commitState());

    $('btn-layer-add-paint').addEventListener('click', () => handleToolTrigger('paintLayer'));
    $('btn-layer-add-text').addEventListener('click', () => handleToolTrigger('text'));
    $('btn-layer-dup').addEventListener('click', () => { const s = window.CanvasEngine.getSelectedNode(); if (s) { window.LayerManager.duplicateLayer(s.id()); app.commitState(); } });
    $('btn-layer-up').addEventListener('click', () => { const s = window.CanvasEngine.getSelectedNode(); if (s) { window.LayerManager.moveLayer(s.id(), 'up'); app.commitState(); } });
    $('btn-layer-down').addEventListener('click', () => { const s = window.CanvasEngine.getSelectedNode(); if (s) { window.LayerManager.moveLayer(s.id(), 'down'); app.commitState(); } });
    $('btn-layer-flatten').addEventListener('click', async () => { const r = await window.LayerManager.flattenVisibleLayers(); if (!r) return toast('Necesitas al menos 2 capas visibles'); app.commitState(); toast('Capas acopladas', 'success'); });
    $('btn-layer-del').addEventListener('click', () => { const s = window.CanvasEngine.getSelectedNode(); if (s) { window.LayerManager.deleteLayer(s.id()); app.commitState(); } });
    $('artboard-layer-row').addEventListener('click', () => { window.CanvasEngine.clearSelection(); setActiveTab('props'); });

    $('btn-lock-ratio').addEventListener('click', (e) => { lockAspectRatio = !lockAspectRatio; e.currentTarget.classList.toggle('active', lockAspectRatio); });
    ['prop-x', 'prop-y'].forEach((id) => $(id).addEventListener('change', () => {
      const s = window.CanvasEngine.getSelectedNode(); if (!s) return;
      s.x(Number($('prop-x').value) || 0); s.y(Number($('prop-y').value) || 0); s.getLayer()?.batchDraw(); app.commitState();
    }));

    const applyNumericWH = (dim) => {
      const s = window.CanvasEngine.getSelectedNode(); if (!s) return;
      const cur = getNodeSize(s);
      let tw = Math.max(4, Number($('prop-w').value) || cur.w || 10), th = Math.max(4, Number($('prop-h').value) || cur.h || 10);
      if (lockAspectRatio && cur.w > 0 && cur.h > 0) {
        if (dim === 'w') th = Math.max(4, Math.round((tw * cur.h) / cur.w)); else tw = Math.max(4, Math.round((th * cur.w) / cur.h));
        $('prop-w').value = tw; $('prop-h').value = th;
      }
      if (s.className === 'Rect' || s.className === 'Image' || s.className === 'Text') {
        s.width(tw); if (s.className !== 'Text') s.height(th);
        s.scale({ x: s.scaleX() < 0 ? -1 : 1, y: s.scaleY() < 0 ? -1 : 1 });
        if (s.getAttr('pfType') === 'image') window.AdjustmentEngine.applyToNode(s, s.getAttr('pfAdjustments'));
        const fc = s.getAttr('pfFillConfig'); if (fc?.mode === 'gradient') window.LayerManager.applyShapeFillConfig(s, fc);
      } else { if (cur.w > 0) s.scaleX(s.scaleX() * (tw / cur.w)); if (cur.h > 0) s.scaleY(s.scaleY() * (th / cur.h)); }
      s.getLayer()?.batchDraw(); app.commitState();
    };
    $('prop-w').addEventListener('change', () => applyNumericWH('w'));
    $('prop-h').addEventListener('change', () => applyNumericWH('h'));

    const setRot = (deg, live) => {
      const s = window.CanvasEngine.getSelectedNode(); if (!s) return;
      s.rotation(deg); $('prop-rot').value = deg; $('prop-rot-range').value = Math.max(-180, Math.min(180, deg));
      s.getLayer()?.batchDraw(); if (live) app.scheduleCommit(); else app.commitState();
    };
    $('prop-rot-range').addEventListener('input', (e) => setRot(Number(e.target.value), true));
    $('prop-rot').addEventListener('change', (e) => setRot(Number(e.target.value) || 0, false));
    $('btn-flip-h').addEventListener('click', () => { const s = window.CanvasEngine.getSelectedNode(); if (s) { window.LayerManager.flipLayer(s.id(), 'h'); app.commitState(); } });
    $('btn-flip-v').addEventListener('click', () => { const s = window.CanvasEngine.getSelectedNode(); if (s) { window.LayerManager.flipLayer(s.id(), 'v'); app.commitState(); } });
    document.querySelectorAll('[data-align-board]').forEach((b) => b.addEventListener('click', () => { const s = window.CanvasEngine.getSelectedNode(); if (s) { window.LayerManager.alignLayer(s.id(), b.dataset.alignBoard); app.commitState(); } }));

    $('btn-edit-text-now').addEventListener('click', () => { const s = window.CanvasEngine.getSelectedNode(); if (s?.getAttr('pfType') === 'text') window.CanvasEngine.startTextEdit(s); });
    $('text-font').addEventListener('change', (e) => { const s = window.CanvasEngine.getSelectedNode(); if (s) { s.fontFamily(e.target.value); s.getLayer()?.batchDraw(); app.commitState(); } });
    const setTextSize = (v, live) => {
      const s = window.CanvasEngine.getSelectedNode(); if (!s) return;
      const sz = Math.max(8, Math.min(500, Number(v) || 24));
      s.fontSize(sz); $('text-size').value = Math.min(240, sz); $('text-size-num').value = sz;
      s.getLayer()?.batchDraw(); if (live) app.scheduleCommit(); else app.commitState();
    };
    $('text-size').addEventListener('input', (e) => setTextSize(e.target.value, true));
    $('text-size-num').addEventListener('change', (e) => setTextSize(e.target.value, false));
    $('text-color').addEventListener('input', (e) => { const s = window.CanvasEngine.getSelectedNode(); if (s) { s.fill(e.target.value); s.getLayer()?.batchDraw(); app.scheduleCommit(); } });
    document.querySelectorAll('[data-style]').forEach((b) => b.addEventListener('click', () => {
      const s = window.CanvasEngine.getSelectedNode(); if (!s || s.getAttr('pfType') !== 'text') return;
      const st = b.dataset.style, fs = s.fontStyle() || 'normal';
      let bold = fs.includes('bold'), italic = fs.includes('italic');
      if (st === 'bold') bold = !bold; if (st === 'italic') italic = !italic;
      if (st === 'bold' || st === 'italic') s.fontStyle([bold ? 'bold' : '', italic ? 'italic' : ''].filter(Boolean).join(' ') || 'normal');
      else if (st === 'underline') s.textDecoration(s.textDecoration() === 'underline' ? '' : 'underline');
      else if (st === 'upper') { const up = !s.getAttr('pfUppercase'); s.setAttr('pfUppercase', up); const raw = s.getAttr('pfRawText') ?? s.text(); s.setAttr('pfRawText', raw); s.text(up ? raw.toUpperCase() : raw); }
      s.getLayer()?.batchDraw(); syncPropertiesPanel(); app.commitState();
    }));
    document.querySelectorAll('[data-align]').forEach((b) => b.addEventListener('click', () => { const s = window.CanvasEngine.getSelectedNode(); if (s) { s.align(b.dataset.align); s.getLayer()?.batchDraw(); syncPropertiesPanel(); app.commitState(); } }));
    $('text-line-height').addEventListener('change', (e) => { const s = window.CanvasEngine.getSelectedNode(); if (s) { s.lineHeight(Math.max(0.6, Number(e.target.value) || 1.2)); s.getLayer()?.batchDraw(); app.commitState(); } });
    $('text-letter-spacing').addEventListener('change', (e) => { const s = window.CanvasEngine.getSelectedNode(); if (s) { s.letterSpacing(Number(e.target.value) || 0); s.getLayer()?.batchDraw(); app.commitState(); } });
    $('text-stroke-color').addEventListener('input', (e) => { const s = window.CanvasEngine.getSelectedNode(); if (s) { s.stroke(e.target.value); s.getLayer()?.batchDraw(); app.scheduleCommit(); } });
    $('text-stroke-width').addEventListener('input', (e) => { const s = window.CanvasEngine.getSelectedNode(); if (!s) return; const w = Number(e.target.value); $('text-stroke-val').textContent = w; s.strokeWidth(w); s.getLayer()?.batchDraw(); app.scheduleCommit(); });

    const updateShapeFill = (patch, live = false) => {
      const s = window.CanvasEngine.getSelectedNode(); if (!s || s.getAttr('pfType') !== 'shape') return;
      const cur = s.getAttr('pfFillConfig') || { mode: 'solid', color: '#a78bfa', gradient: { color1: '#a78bfa', color2: '#38bdf8', angle: 135 } };
      window.LayerManager.applyShapeFillConfig(s, { ...cur, ...patch, gradient: { ...(cur.gradient || {}), ...(patch.gradient || {}) } });
      s.getLayer()?.batchDraw(); if (!live) syncPropertiesPanel();
      if (live) app.scheduleCommit(); else app.commitState();
    };
    document.querySelectorAll('#shape-fill-mode .seg-btn').forEach((b) => b.addEventListener('click', () => updateShapeFill({ mode: b.dataset.fill }, false)));
    $('shape-fill').addEventListener('input', (e) => { $('shape-fill-hex').textContent = e.target.value.toUpperCase(); updateShapeFill({ color: e.target.value }, true); });
    $('shape-grad-1').addEventListener('input', (e) => updateShapeFill({ gradient: { color1: e.target.value } }, true));
    $('shape-grad-2').addEventListener('input', (e) => updateShapeFill({ gradient: { color2: e.target.value } }, true));
    $('shape-grad-angle').addEventListener('input', (e) => updateShapeFill({ gradient: { angle: Number(e.target.value) } }, true));
    $('shape-stroke').addEventListener('input', (e) => { const s = window.CanvasEngine.getSelectedNode(); if (s) { s.stroke(e.target.value); s.getLayer()?.batchDraw(); app.scheduleCommit(); } });
    $('shape-stroke-width').addEventListener('input', (e) => { const s = window.CanvasEngine.getSelectedNode(); if (!s) return; const v = Number(e.target.value); $('shape-stroke-val').textContent = v; s.strokeWidth(v); s.getLayer()?.batchDraw(); app.scheduleCommit(); });
    $('shape-dashed').addEventListener('change', (e) => { const s = window.CanvasEngine.getSelectedNode(); if (s) { s.dash(e.target.checked ? [12, 8] : []); s.getLayer()?.batchDraw(); app.commitState(); } });
    $('shape-corner').addEventListener('input', (e) => { const s = window.CanvasEngine.getSelectedNode(); if (s?.className === 'Rect') { const v = Number(e.target.value); $('shape-corner-val').textContent = v; s.cornerRadius(v); s.getLayer()?.batchDraw(); app.scheduleCommit(); } });
    $('shape-sides').addEventListener('input', (e) => {
      const s = window.CanvasEngine.getSelectedNode(); if (!s) return;
      const v = Number(e.target.value); $('shape-sides-val').textContent = v;
      if (s.className === 'RegularPolygon') s.sides(v); else if (s.className === 'Star') s.numPoints(v);
      s.getLayer()?.batchDraw(); app.scheduleCommit();
    });

    $('btn-img-crop').addEventListener('click', () => handleToolTrigger('crop'));
    $('btn-img-reset-crop').addEventListener('click', () => {
      const s = window.CanvasEngine.getSelectedNode(); if (!s || s.getAttr('pfType') !== 'image') return;
      const img = s._pfOrigSource || s.image();
      s.clearCache();
      s.crop({ x: 0, y: 0, width: img.naturalWidth || img.width, height: img.naturalHeight || img.height });
      window.AdjustmentEngine.applyToNode(s, s.getAttr('pfAdjustments'));
      s.getLayer()?.batchDraw();
      app.commitState();
    });
    const fitOrFillImg = (mode) => {
      const s = window.CanvasEngine.getSelectedNode(); if (!s) return;
      const { width: aw, height: ah } = window.CanvasEngine.getArtboardDims();
      const r = mode === 'fill' ? Math.max(aw / s.width(), ah / s.height()) : Math.min(aw / s.width(), ah / s.height());
      const nw = Math.round(s.width() * r), nh = Math.round(s.height() * r);
      s.size({ width: nw, height: nh }); s.scale({ x: s.scaleX() < 0 ? -1 : 1, y: s.scaleY() < 0 ? -1 : 1 });
      s.position({ x: Math.round((aw - nw) / 2), y: Math.round((ah - nh) / 2) });
      window.AdjustmentEngine.applyToNode(s, s.getAttr('pfAdjustments')); s.getLayer()?.batchDraw(); app.commitState();
    };
    $('btn-img-fit-board').addEventListener('click', () => fitOrFillImg('fit'));
    $('btn-img-fill-board').addEventListener('click', () => fitOrFillImg('fill'));

    $('btn-paint-use-brush').addEventListener('click', () => handleToolTrigger('brush'));
    $('btn-paint-clear').addEventListener('click', () => {
      const s = window.CanvasEngine.getSelectedNode(); if (!s || !s._pfCanvas) return;
      s._pfCanvas.getContext('2d').clearRect(0, 0, s._pfCanvas.width, s._pfCanvas.height);
      s._pfOrigSource = s._pfCanvas;
      const url = window.LayerManager.canvasToFastDataURL(s._pfCanvas, 0.92, true);
      s.setAttr('pfAssetId', window.LayerManager.createAssetFromDataURL(url, s._pfCanvas));
      const adj = s.getAttr('pfAdjustments');
      if (adj) window.AdjustmentEngine.applyToNode(s, adj);
      s.getLayer()?.batchDraw(); app.commitState();
    });

    document.querySelectorAll('#pixel-mode-group .seg-btn').forEach((b) => b.addEventListener('click', () => {
      const nextMode = window.CanvasEngine.setPixelMode?.(b.dataset.pixelmode) || b.dataset.pixelmode;
      syncPropertiesPanel();
      renderOptionsBar(true);
      toast(nextMode === 'nearest' ? 'Renderizado: Nearest (Píxel exacto)' : 'Renderizado: Suavizado');
    }));

    const updateBg = (patch, live = false) => {
      const cur = window.CanvasEngine.getBackground();
      window.CanvasEngine.setBackground({ ...cur, ...patch, gradient: { ...(cur.gradient || {}), ...(patch.gradient || {}) } });
      if (!live) syncPropertiesPanel(); renderLayers();
      if (live) app.scheduleCommit(); else app.commitState();
    };
    document.querySelectorAll('#bg-mode-group .seg-btn').forEach((b) => b.addEventListener('click', () => updateBg({ type: b.dataset.bgtype }, false)));
    $('bg-color').addEventListener('input', (e) => { $('bg-color-hex').textContent = e.target.value.toUpperCase(); updateBg({ color: e.target.value }, true); });
    $('bg-grad-1').addEventListener('input', (e) => updateBg({ gradient: { color1: e.target.value } }, true));
    $('bg-grad-2').addEventListener('input', (e) => updateBg({ gradient: { color2: e.target.value } }, true));
    $('bg-grad-angle').addEventListener('input', (e) => updateBg({ gradient: { angle: Number(e.target.value) } }, true));
    document.querySelectorAll('#shape-picker .shape-btn').forEach((b) => b.addEventListener('click', () => { window.LayerManager.addShapeLayer(b.dataset.shape, window.CanvasEngine.getActiveColor()); app.commitState(); }));

    const cmpBtn = $('btn-adjust-compare');
    const stopCmp = () => { const s = window.CanvasEngine.getSelectedNode(); if (s) window.AdjustmentEngine.setCompareOriginal(s, false); };
    cmpBtn.addEventListener('pointerdown', () => { const s = window.CanvasEngine.getSelectedNode(); if (s) window.AdjustmentEngine.setCompareOriginal(s, true); });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => cmpBtn.addEventListener(ev, stopCmp));

    $('btn-adjust-reset').addEventListener('click', () => { const s = window.CanvasEngine.getSelectedNode(); if (s) { window.AdjustmentEngine.applyToNode(s, { ...window.AdjustmentEngine.DEFAULTS }, { preview: false }); syncAdjustmentsPanel(); app.commitState(); } });
    document.querySelectorAll('[data-adj-toggle]').forEach((b) => b.addEventListener('click', () => {
      const s = window.CanvasEngine.getSelectedNode(); if (!s) return;
      const adj = window.AdjustmentEngine.normalize(s.getAttr('pfAdjustments')); adj[b.dataset.adjToggle] = !adj[b.dataset.adjToggle];
      window.AdjustmentEngine.applyToNode(s, adj, { preview: false }); syncAdjustmentsPanel(); app.commitState();
    }));

    $('btn-shadow-toggle').addEventListener('click', () => {
      const s = window.CanvasEngine.getSelectedNode(); if (!s) return;
      const next = !s.shadowEnabled(); s.shadowEnabled(next);
      if (next && !s.shadowColor()) { s.shadowColor('#000000'); s.shadowBlur(14); s.shadowOffsetX(4); s.shadowOffsetY(6); s.shadowOpacity(0.45); }
      s.getLayer()?.batchDraw(); syncEffectsPanel(); app.commitState();
    });
    $('shadow-color').addEventListener('input', (e) => { const s = window.CanvasEngine.getSelectedNode(); if (s) { s.shadowColor(e.target.value); s.getLayer()?.batchDraw(); app.scheduleCommit(); } });
    $('shadow-blur').addEventListener('input', (e) => { const s = window.CanvasEngine.getSelectedNode(); if (s) { const v = Number(e.target.value); $('shadow-blur-val').textContent = v; s.shadowBlur(v); s.getLayer()?.batchDraw(); app.scheduleCommit(); } });
    $('shadow-offset-x').addEventListener('input', (e) => { const s = window.CanvasEngine.getSelectedNode(); if (s) { const v = Number(e.target.value); $('shadow-ox-val').textContent = v; s.shadowOffsetX(v); s.getLayer()?.batchDraw(); app.scheduleCommit(); } });
    $('shadow-offset-y').addEventListener('input', (e) => { const s = window.CanvasEngine.getSelectedNode(); if (s) { const v = Number(e.target.value); $('shadow-oy-val').textContent = v; s.shadowOffsetY(v); s.getLayer()?.batchDraw(); app.scheduleCommit(); } });
    $('shadow-opacity').addEventListener('input', (e) => { const s = window.CanvasEngine.getSelectedNode(); if (s) { const v = Number(e.target.value); $('shadow-op-val').textContent = `${v}%`; s.shadowOpacity(v / 100); s.getLayer()?.batchDraw(); app.scheduleCommit(); } });

    document.querySelectorAll('.modal-backdrop').forEach((bd) => bd.addEventListener('click', () => bd.closest('.modal')?.classList.add('hidden')));
  }

  function init(appInstance) {
    app = appInstance;
    renderQuickSwatches();
    buildAdjustmentsUI();
    bindAllEvents();
  }

  window.UI = {
    init, toast, showScreen, renderProjects, renderSizePresets, setActiveTool,
    setActiveTab, handleToolTrigger, updateHistoryButtons, updateZoomUI,
    updateArtboardBadge, updateActiveColorUI, renderOptionsBar, renderLayers,
    syncTransformFieldsOnly, syncPropertiesPanel, syncAdjustmentsPanel, syncEffectsPanel
  };
})();