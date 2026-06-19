    function buildExportFileName() {
      const sourcePath = (mermaidMarkdownFilePath || 'diagram').replace(/\\/g, '/');
      const sourceFileName = sourcePath.split('/').pop() || 'diagram';
      const withoutExt = sourceFileName.replace(/\.md$/i, '') || 'diagram';
      const safeBase = withoutExt.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100) || 'diagram';
      return safeBase;
    }

    function serializeSvg(svgEl) {
      const serializer = new XMLSerializer();
      const clonedSvg = svgEl.cloneNode(true);
      clonedSvg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      return serializer.serializeToString(clonedSvg);
    }

    async function svgToPngDataUrl(svgEl) {
      const viewBoxParts = (svgEl.getAttribute('viewBox') || '').trim().split(/\s+/).map(Number);
      const width = (viewBoxParts.length === 4 && Number.isFinite(viewBoxParts[2]) && viewBoxParts[2] > 0)
        ? Math.ceil(viewBoxParts[2])
        : Math.ceil(Number(svgEl.getAttribute('width')) || svgEl.clientWidth || 1200);
      const height = (viewBoxParts.length === 4 && Number.isFinite(viewBoxParts[3]) && viewBoxParts[3] > 0)
        ? Math.ceil(viewBoxParts[3])
        : Math.ceil(Number(svgEl.getAttribute('height')) || svgEl.clientHeight || 800);

      const svgText = serializeSvg(svgEl);
      const svgBlob = new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' });
      const svgUrl = URL.createObjectURL(svgBlob);

      try {
        const image = await new Promise((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve(img);
          img.onerror = reject;
          img.src = svgUrl;
        });

        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, width);
        canvas.height = Math.max(1, height);
        const context = canvas.getContext('2d');
        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        return canvas.toDataURL('image/png');
      } finally {
        URL.revokeObjectURL(svgUrl);
      }
    }

    async function uploadExport(payload) {
      const response = await fetch('/__crosswayai/export', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      const result = await response.json();
      if (!response.ok || !result || !result.ok) {
        throw new Error((result && result.error) || `HTTP ${response.status}`);
      }
      return result;
    }

    async function exportDiagramAsPng() {
      const svg = diagram.querySelector('svg');
      if (!svg) {
        setStatus('No rendered diagram available to export.', true);
        return;
      }

      setStatus('Exporting image...');

      try {
        const dataUrl = await svgToPngDataUrl(svg);
        const fileBase = buildExportFileName();
        const result = await uploadExport({
          format: 'png',
          fileName: `${fileBase}.png`,
          dataUrl
        });
        setStatus(`Exported to ${result.relativePath}`);
      } catch (err) {
        const message = err && err.message ? err.message : String(err);
        const shouldFallbackToSvg = /tainted canvas|tainted canvases/i.test(message);

        if (!shouldFallbackToSvg) {
          setStatus('Export failed: ' + message, true);
          return;
        }

        try {
          setStatus('PNG blocked by browser security. Exporting as SVG...');
          const fileBase = buildExportFileName();
          const svgText = serializeSvg(svg);
          const result = await uploadExport({
            format: 'svg',
            fileName: `${fileBase}.svg`,
            svgText
          });
          setStatus(`Exported SVG to ${result.relativePath}`);
        } catch (fallbackErr) {
          setStatus('Export failed: ' + (fallbackErr && fallbackErr.message ? fallbackErr.message : String(fallbackErr)), true);
        }
      }
    }

    function attachExportHandlers() {
      document.getElementById('exportPng').addEventListener('click', exportDiagramAsPng);
    }
