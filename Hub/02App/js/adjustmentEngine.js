/* ============================================================
   PixelForge Studio 3.3 — Fast WebGL + 2-Phase Adjustments
   Preview ligero con rAF al arrastrar · Calidad nítida al soltar
   ============================================================ */
(function () {
  const DEFAULTS = {
    exposure: 0, brightness: 0, contrast: 0, saturation: 0, hue: 0,
    temperature: 0, blur: 0, enhance: 0, vignette: 0, noise: 0,
    grayscale: false, sepia: false, invert: false
  };

  const FILTERS_META = [
    { key: 'exposure', label: 'Exposición', min: -100, max: 100, step: 1 },
    { key: 'brightness', label: 'Brillo', min: -100, max: 100, step: 1 },
    { key: 'contrast', label: 'Contraste', min: -100, max: 100, step: 1 },
    { key: 'saturation', label: 'Saturación', min: -100, max: 100, step: 1 },
    { key: 'hue', label: 'Matiz (Hue)', min: -180, max: 180, step: 1 },
    { key: 'temperature', label: 'Temperatura', min: -100, max: 100, step: 1 },
    { key: 'blur', label: 'Desenfoque', min: 0, max: 35, step: 1 },
    { key: 'enhance', label: 'Realce', min: -100, max: 100, step: 1 },
    { key: 'vignette', label: 'Viñeta', min: 0, max: 100, step: 1 },
    { key: 'noise', label: 'Grano / Ruido', min: 0, max: 100, step: 1 }
  ];

  const PRESETS = [
    { id: 'original', name: 'Original', vals: {} },
    { id: 'pop', name: 'Pop', vals: { contrast: 18, saturation: 28, enhance: 25, exposure: 8 } },
    { id: 'bw', name: 'B&N Pro', vals: { grayscale: true, contrast: 24, vignette: 25 } },
    { id: 'cinematic', name: 'Cinético', vals: { contrast: 16, saturation: -18, temperature: -12, vignette: 40 } },
    { id: 'warm', name: 'Cálido', vals: { temperature: 42, saturation: 14, brightness: 6 } },
    { id: 'cool', name: 'Frío', vals: { temperature: -42, contrast: 10, brightness: 4 } },
    { id: 'vintage', name: 'Vintage', vals: { sepia: true, contrast: -12, vignette: 35, noise: 18 } }
  ];

  let previewRaf = 0;
  let pendingPreview = null;

  const glState = {
    initialized: false,
    supported: false,
    canvas: null,
    gl: null,
    program: null,
    texture: null,
    uniforms: null
  };

  const VERT_SRC = `
    attribute vec2 a_pos;
    attribute vec2 a_uv;
    varying vec2 v_uv;
    void main() {
      v_uv = a_uv;
      gl_Position = vec4(a_pos, 0.0, 1.0);
    }
  `;

  const FRAG_SRC = `
    precision mediump float;
    uniform sampler2D u_tex;
    uniform float u_exp;
    uniform float u_bright;
    uniform float u_contrast;
    uniform float u_sat;
    uniform float u_hue;
    uniform float u_temp;
    uniform float u_vig;
    uniform float u_noise;
    uniform float u_gray;
    uniform float u_sepia;
    uniform float u_invert;
    uniform float u_seed;
    varying vec2 v_uv;

    vec3 hueRotate(vec3 c, float angle) {
      const vec3 k = vec3(0.57735, 0.57735, 0.57735);
      float cosAngle = cos(angle);
      return vec3(
        c * cosAngle +
        cross(k, c) * sin(angle) +
        k * dot(k, c) * (1.0 - cosAngle)
      );
    }

    float rand(vec2 co) {
      return fract(sin(dot(co, vec2(12.9898, 78.233))) * 43758.5453);
    }

    void main() {
      vec4 tex = texture2D(u_tex, v_uv);
      if (tex.a <= 0.001) {
        gl_FragColor = tex;
        return;
      }

      vec3 col = tex.rgb;

      if (abs(u_exp) > 0.0001) {
        col *= pow(2.0, u_exp / 55.0);
      }
      if (abs(u_temp) > 0.0001) {
        float shift = (u_temp * 0.65) / 255.0;
        col.r += shift;
        col.b -= shift;
      }

      if (abs(u_bright) > 0.0001) {
        col += u_bright / 100.0;
      }

      if (abs(u_contrast) > 0.0001) {
        float cVal = u_contrast;
        float factor = (259.0 * (cVal + 255.0)) / (255.0 * (259.0 - cVal));
        col = factor * (col - 0.5) + 0.5;
      }

      if (abs(u_hue) > 0.0001) {
        col = hueRotate(col, radians(u_hue));
      }
      if (abs(u_sat) > 0.0001) {
        float lum = dot(col, vec3(0.299, 0.587, 0.114));
        float satFactor = max(0.0, 1.0 + (u_sat / 100.0) * 2.0);
        col = mix(vec3(lum), col, satFactor);
      }

      if (u_vig > 0.0001) {
        vec2 p = (v_uv - 0.5) * 2.0;
        float d = min(1.0, dot(p, p) * 0.5);
        float strength = (u_vig / 100.0) * 0.85;
        float f = 1.0 - strength * d * (0.65 + 0.35 * d);
        col *= max(0.0, f);
      }

      if (u_noise > 0.0001) {
        float n = (rand(v_uv * vec2(512.0, 512.0) + u_seed) - 0.5) * (u_noise / 100.0) * 0.65;
        col += n;
      }

      if (u_gray > 0.5) {
        float g = dot(col, vec3(0.299, 0.587, 0.114));
        col = vec3(g);
      }
      if (u_sepia > 0.5) {
        col = vec3(
          dot(col, vec3(0.393, 0.769, 0.189)),
          dot(col, vec3(0.349, 0.686, 0.168)),
          dot(col, vec3(0.272, 0.534, 0.131))
        );
      }
      if (u_invert > 0.5) {
        col = 1.0 - col;
      }

      gl_FragColor = vec4(clamp(col, 0.0, 1.0), tex.a);
    }
  `;

  function compileShader(gl, type, src) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      gl.deleteShader(sh);
      return null;
    }
    return sh;
  }

  function ensureWebGL() {
    if (glState.initialized) return glState.supported;
    glState.initialized = true;
    try {
      const canvas = document.createElement('canvas');
      canvas.width = 2;
      canvas.height = 2;
      const gl = canvas.getContext('webgl', { preserveDrawingBuffer: true, premultipliedAlpha: false, antialias: false });
      if (!gl) return false;

      const vs = compileShader(gl, gl.VERTEX_SHADER, VERT_SRC);
      const fs = compileShader(gl, gl.FRAGMENT_SHADER, FRAG_SRC);
      if (!vs || !fs) return false;

      const prog = gl.createProgram();
      gl.attachShader(prog, vs);
      gl.attachShader(prog, fs);
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return false;

      const quad = new Float32Array([
        -1, -1, 0, 1,
         1, -1, 1, 1,
        -1,  1, 0, 0,
         1,  1, 1, 0
      ]);
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW);

      const aPos = gl.getAttribLocation(prog, 'a_pos');
      const aUv = gl.getAttribLocation(prog, 'a_uv');
      gl.enableVertexAttribArray(aPos);
      gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 16, 0);
      gl.enableVertexAttribArray(aUv);
      gl.vertexAttribPointer(aUv, 2, gl.FLOAT, false, 16, 8);

      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

      gl.useProgram(prog);
      gl.uniform1i(gl.getUniformLocation(prog, 'u_tex'), 0);

      glState.canvas = canvas;
      glState.gl = gl;
      glState.program = prog;
      glState.texture = tex;
      glState.uniforms = {
        exp: gl.getUniformLocation(prog, 'u_exp'),
        bright: gl.getUniformLocation(prog, 'u_bright'),
        contrast: gl.getUniformLocation(prog, 'u_contrast'),
        sat: gl.getUniformLocation(prog, 'u_sat'),
        hue: gl.getUniformLocation(prog, 'u_hue'),
        temp: gl.getUniformLocation(prog, 'u_temp'),
        vig: gl.getUniformLocation(prog, 'u_vig'),
        noise: gl.getUniformLocation(prog, 'u_noise'),
        gray: gl.getUniformLocation(prog, 'u_gray'),
        sepia: gl.getUniformLocation(prog, 'u_sepia'),
        invert: gl.getUniformLocation(prog, 'u_invert'),
        seed: gl.getUniformLocation(prog, 'u_seed')
      };
      glState.supported = true;
      return true;
    } catch (_) {
      glState.supported = false;
      return false;
    }
  }

  function renderWebGLToTarget(sourceEl, adj, targetCanvas, targetW, targetH, seed = 0.13) {
    if (!ensureWebGL() || !targetCanvas) return false;
    const { gl, canvas, program, texture, uniforms } = glState;
    const w = Math.max(1, Math.round(targetW));
    const h = Math.max(1, Math.round(targetH));

    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    gl.viewport(0, 0, w, h);
    gl.useProgram(program);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, sourceEl);

    gl.uniform1f(uniforms.exp, adj.exposure || 0);
    gl.uniform1f(uniforms.bright, adj.brightness || 0);
    gl.uniform1f(uniforms.contrast, adj.contrast || 0);
    gl.uniform1f(uniforms.sat, adj.saturation || 0);
    gl.uniform1f(uniforms.hue, adj.hue || 0);
    gl.uniform1f(uniforms.temp, adj.temperature || 0);
    gl.uniform1f(uniforms.vig, adj.vignette || 0);
    gl.uniform1f(uniforms.noise, adj.noise || 0);
    gl.uniform1f(uniforms.gray, adj.grayscale ? 1.0 : 0.0);
    gl.uniform1f(uniforms.sepia, adj.sepia ? 1.0 : 0.0);
    gl.uniform1f(uniforms.invert, adj.invert ? 1.0 : 0.0);
    gl.uniform1f(uniforms.seed, seed);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    if (targetCanvas.width !== w || targetCanvas.height !== h) {
      targetCanvas.width = w;
      targetCanvas.height = h;
    }
    const ctx = targetCanvas.getContext('2d');
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(canvas, 0, 0, w, h);
    return true;
  }

  function clamp(v) { return v < 0 ? 0 : v > 255 ? 255 : v; }

  function CustomToneFilter(imageData) {
    const exp = this.getAttr('pfExposure') || 0;
    const temp = this.getAttr('pfTemperature') || 0;
    const vig = this.getAttr('pfVignette') || 0;
    if (exp === 0 && temp === 0 && vig === 0) return;

    const data = imageData.data, w = imageData.width, h = imageData.height;
    const expFactor = exp !== 0 ? Math.pow(2, exp / 55) : 1;
    const tempShift = temp * 0.65;
    const vigStrength = (vig / 100) * 0.85;
    const cx = w * 0.5, cy = h * 0.5, invMax = 1 / (cx * cx + cy * cy || 1);

    for (let y = 0; y < h; y++) {
      const dy = y - cy, dy2 = dy * dy, row = y * w * 4;
      for (let x = 0; x < w; x++) {
        const i = row + x * 4;
        if (data[i + 3] === 0) continue;

        let r = data[i], g = data[i + 1], b = data[i + 2];
        if (expFactor !== 1) { r *= expFactor; g *= expFactor; b *= expFactor; }
        if (tempShift !== 0) { r += tempShift; b -= tempShift; }
        if (vigStrength > 0) {
          const dx = x - cx;
          const d = (dx * dx + dy2) * invMax;
          const f = 1 - vigStrength * d * (0.65 + 0.35 * d);
          r *= f; g *= f; b *= f;
        }
        data[i] = clamp(r); data[i + 1] = clamp(g); data[i + 2] = clamp(b);
      }
    }
  }

  function normalize(adj) { return { ...DEFAULTS, ...(adj || {}) }; }

  function hasActiveAdjustments(adj) {
    for (const k of Object.keys(DEFAULTS)) {
      if (adj[k] !== DEFAULTS[k]) return true;
    }
    return false;
  }

  function getOriginalSource(node) {
    if (!node || typeof node.image !== 'function') return null;
    if (node._pfOrigSource) return node._pfOrigSource;
    if (node._pfCanvas) {
      node._pfOrigSource = node._pfCanvas;
      return node._pfOrigSource;
    }
    const cur = node.image();
    if (cur && cur !== node._pfGlCanvas) {
      node._pfOrigSource = cur;
      return cur;
    }
    return null;
  }

  function restoreOriginalSource(node) {
    const orig = getOriginalSource(node);
    if (orig && node.image() !== orig) {
      node.image(orig);
    }
  }

  function releaseGlCanvas(node) {
    if (node && node._pfGlCanvas) {
      node._pfGlCanvas.width = 1;
      node._pfGlCanvas.height = 1;
    }
  }

  function applyKonvaFallback(node, adj, { preview = false } = {}) {
    restoreOriginalSource(node);
    const filters = [];
    if (adj.exposure !== 0 || adj.temperature !== 0 || adj.vignette !== 0) {
      node.setAttr('pfExposure', adj.exposure);
      node.setAttr('pfTemperature', adj.temperature);
      node.setAttr('pfVignette', adj.vignette);
      filters.push(CustomToneFilter);
    }
    if (adj.brightness !== 0) { node.brightness(adj.brightness / 100); filters.push(Konva.Filters.Brighten); }
    if (adj.contrast !== 0) { node.contrast(adj.contrast); filters.push(Konva.Filters.Contrast); }
    if (adj.saturation !== 0 || adj.hue !== 0) {
      node.hue(adj.hue < 0 ? 360 + adj.hue : adj.hue);
      node.saturation((adj.saturation / 100) * 2);
      filters.push(Konva.Filters.HSL);
    }
    if (adj.enhance !== 0) { node.enhance(adj.enhance / 100); filters.push(Konva.Filters.Enhance); }
    if (adj.blur > 0) { node.blurRadius(preview ? Math.max(1, Math.round(adj.blur * 0.45)) : adj.blur); filters.push(Konva.Filters.Blur); }
    if (adj.noise > 0) { node.noise((adj.noise / 100) * 1.2); filters.push(Konva.Filters.Noise); }
    if (adj.grayscale) filters.push(Konva.Filters.Grayscale);
    if (adj.sepia) filters.push(Konva.Filters.Sepia);
    if (adj.invert) filters.push(Konva.Filters.Invert);

    node.filters(filters);
    const maxDim = Math.max(node.width(), node.height());
    let pr = preview ? Math.min(0.45, 420 / (maxDim || 420)) : (maxDim > 1800 ? 1 : 1.5);
    pr = Math.max(0.2, pr);

    try {
      node.cache({ pixelRatio: pr });
    } catch (_) {
      try { node.cache({ pixelRatio: 1 }); } catch (__) {}
    }
    node.getLayer()?.batchDraw();
  }

  function applyToNode(node, rawAdj, { preview = false } = {}) {
    if (!node || typeof node.cache !== 'function') return;
    if (!preview && previewRaf) {
      cancelAnimationFrame(previewRaf);
      previewRaf = 0;
      pendingPreview = null;
    }

    const adj = normalize(rawAdj);
    node.setAttr('pfAdjustments', adj);

    const origEl = getOriginalSource(node);
    const ready = !origEl || (origEl instanceof HTMLCanvasElement) || (origEl.complete && origEl.naturalWidth > 0);
    if (!ready || node.width() <= 0 || node.height() <= 0) return;

    node.clearCache();
    if (!hasActiveAdjustments(adj)) {
      node.filters([]);
      node.setAttr('pfExposure', 0);
      node.setAttr('pfTemperature', 0);
      node.setAttr('pfVignette', 0);
      restoreOriginalSource(node);
      releaseGlCanvas(node);
      node.getLayer()?.batchDraw();
      return;
    }

    const canUseWebGL = origEl && ensureWebGL() && (!adj.blur || adj.blur === 0) && (!adj.enhance || adj.enhance === 0);
    if (canUseWebGL) {
      const natW = origEl.naturalWidth || origEl.width || Math.round(node.width());
      const natH = origEl.naturalHeight || origEl.height || Math.round(node.height());
      const maxSide = Math.max(natW, natH);
      const hasCrop = (node.cropWidth?.() || 0) > 0;
      // Si la imagen está recortada, mantener 1:1 (hasta 2048px) para no desfasar node.crop()
      const scale = hasCrop
        ? (maxSide > 2048 ? 2048 / maxSide : 1)
        : (preview ? Math.min(0.45, 420 / (maxSide || 420)) : (maxSide > 2048 ? 2048 / maxSide : 1));
      const tw = Math.max(1, Math.round(natW * scale));
      const th = Math.max(1, Math.round(natH * scale));

      if (!node._pfGlCanvas) node._pfGlCanvas = document.createElement('canvas');
      if (renderWebGLToTarget(origEl, adj, node._pfGlCanvas, tw, th, preview ? 0.25 : 0.77)) {
        node.filters([]);
        node.image(node._pfGlCanvas);
        node.getLayer()?.batchDraw();
        return;
      }
    }

    applyKonvaFallback(node, adj, { preview });
  }

  function schedulePreview(node, rawAdj) {
    pendingPreview = { node, rawAdj };
    if (previewRaf) return;
    previewRaf = requestAnimationFrame(() => {
      previewRaf = 0;
      const item = pendingPreview;
      pendingPreview = null;
      if (item) applyToNode(item.node, item.rawAdj, { preview: true });
    });
  }

  function setCompareOriginal(node, showOriginal) {
    if (!node || typeof node.clearCache !== 'function') return;
    if (showOriginal) {
      node.clearCache();
      node.filters([]);
      restoreOriginalSource(node);
      node.getLayer()?.batchDraw();
    } else {
      applyToNode(node, node.getAttr('pfAdjustments'), { preview: false });
    }
  }

  window.AdjustmentEngine = {
    DEFAULTS, FILTERS_META, PRESETS, normalize,
    applyToNode, schedulePreview, setCompareOriginal
  };
})();