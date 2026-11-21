/* ============================================================
   PixelForge Studio 3.3 — PNG / JPG / WebP / PDF Export (Lazy jsPDF)
   ============================================================ */
(function () {
  const JSPDF_URL = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
  let jspdfPromise = null;

  function loadJsPDF() {
    if (window.jspdf?.jsPDF) return Promise.resolve(window.jspdf.jsPDF);
    if (jspdfPromise) return jspdfPromise;
    jspdfPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = JSPDF_URL;
      s.async = true;
      s.onload = () => {
        if (window.jspdf?.jsPDF) resolve(window.jspdf.jsPDF);
        else {
          jspdfPromise = null;
          reject(new Error('No se pudo inicializar jsPDF'));
        }
      };
      s.onerror = () => {
        jspdfPromise = null;
        reject(new Error('La librería jsPDF requiere conexión o caché previa'));
      };
      document.head.appendChild(s);
    });
    return jspdfPromise;
  }

  function downloadDataURL(dataUrl, filename) {
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  async function exportImage({ format = 'png', quality = 0.88, scale = 2, filename = 'pixelforge-export' } = {}) {
    const cleanName = (filename || 'pixelforge-export')
      .replace(/[^\w\-áéíóúñÁÉÍÓÚÑ ]+/g, '')
      .trim() || 'pixelforge-export';

    const { width, height } = window.CanvasEngine.getArtboardDims();
    const numScale = Math.max(0.5, Math.min(4, Number(scale) || 1));
    const numQuality = Math.max(0.1, Math.min(1, Number(quality) || 0.88));

    if (format === 'pdf') {
      const jsPDF = await loadJsPDF();
      const dataUrl = window.CanvasEngine.exportStageDataURL({
        format: 'jpg',
        quality: 0.94,
        scale: numScale,
        includeBg: true
      });
      if (!dataUrl) throw new Error('No se pudo generar la imagen para PDF');
      const outW = Math.round(width * numScale);
      const outH = Math.round(height * numScale);
      const pdf = new jsPDF({
        orientation: outW >= outH ? 'landscape' : 'portrait',
        unit: 'px',
        format: [outW, outH],
        hotfixes: ['px_scaling']
      });
      pdf.addImage(dataUrl, 'JPEG', 0, 0, outW, outH);
      pdf.save(`${cleanName}.pdf`);
      return;
    }

    const fmt = format === 'jpg' ? 'jpg' : format === 'webp' ? 'webp' : 'png';
    const dataUrl = window.CanvasEngine.exportStageDataURL({
      format: fmt,
      quality: numQuality,
      scale: numScale,
      includeBg: true
    });

    if (!dataUrl) throw new Error('No se pudo generar la imagen');
    downloadDataURL(dataUrl, `${cleanName}.${fmt}`);
  }

  window.ExportEngine = { exportImage };
})();