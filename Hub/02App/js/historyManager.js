/* ============================================================
   PixelForge Studio 3.3 — Bounded History + Asset GC Tracking
   ============================================================ */
(function () {
  const MAX_HISTORY = 12;
  let stack = [];
  let signatures = [];
  let assetSets = [];
  let pointer = -1;
  let onChangeCb = null;
  let debounceTimer = null;

  function cloneSnapshot(state) {
    if (!state) return null;
    if (typeof structuredClone === 'function') {
      try {
        return structuredClone(state);
      } catch (_) {}
    }
    return JSON.parse(JSON.stringify(state));
  }

  function makeSignature(state) {
    const ab = state?.artboard || {};
    const layers = state?.layers || [];
    const layerSig = layers
      .map((l) => {
        const a = l.attrs || {};
        return [
          l.id,
          l.pfType,
          l.visible !== false ? 1 : 0,
          l.locked ? 1 : 0,
          l.assetId || '',
          l.name || '',
          a.x ?? 0,
          a.y ?? 0,
          a.width ?? 0,
          a.height ?? 0,
          a.scaleX ?? 1,
          a.scaleY ?? 1,
          a.rotation ?? 0,
          a.opacity ?? 1,
          a.text ?? '',
          a.fill ?? '',
          JSON.stringify(l.adjustments || null),
          JSON.stringify(l.fillConfig || null)
        ].join('|');
      })
      .join('~');

    return `${ab.width}x${ab.height}|${ab.type || ''}|${ab.color || ''}|${layerSig}`;
  }

  function extractAssetIds(state) {
    const ids = new Set();
    for (const l of (state?.layers || [])) {
      if (l.assetId) ids.add(l.assetId);
    }
    return ids;
  }

  function init(onChange) {
    onChangeCb = onChange;
    clear();
  }

  function notify() {
    if (typeof onChangeCb === 'function') {
      onChangeCb({
        canUndo: canUndo(),
        canRedo: canRedo(),
        index: pointer,
        total: stack.length
      });
    }
  }

  function clear() {
    clearTimeout(debounceTimer);
    debounceTimer = null;
    stack = [];
    signatures = [];
    assetSets = [];
    pointer = -1;
    notify();
  }

  function push(state) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
    if (!state) return false;

    const sig = makeSignature(state);
    if (pointer >= 0 && signatures[pointer] === sig) return false;

    if (pointer < stack.length - 1) {
      stack = stack.slice(0, pointer + 1);
      signatures = signatures.slice(0, pointer + 1);
      assetSets = assetSets.slice(0, pointer + 1);
    }

    stack.push(cloneSnapshot(state));
    signatures.push(sig);
    assetSets.push(extractAssetIds(state));

    if (stack.length > MAX_HISTORY) {
      stack.shift();
      signatures.shift();
      assetSets.shift();
    }
    pointer = stack.length - 1;
    notify();
    return true;
  }

  function schedulePush(getStateFn, delay = 320) {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      if (typeof getStateFn === 'function') push(getStateFn());
    }, delay);
  }

  function flushPending(getStateFn) {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
      if (typeof getStateFn === 'function') push(getStateFn());
    }
  }

  function getActiveAssetIds() {
    const all = new Set();
    for (const s of assetSets) {
      for (const id of s) all.add(id);
    }
    return all;
  }

  function canUndo() { return pointer > 0; }
  function canRedo() { return pointer >= 0 && pointer < stack.length - 1; }

  function undo() {
    if (!canUndo()) return null;
    pointer--;
    notify();
    return cloneSnapshot(stack[pointer]);
  }

  function redo() {
    if (!canRedo()) return null;
    pointer++;
    notify();
    return cloneSnapshot(stack[pointer]);
  }

  window.HistoryManager = {
    init, clear, push, schedulePush, flushPending,
    getActiveAssetIds, canUndo, canRedo, undo, redo
  };
})();
