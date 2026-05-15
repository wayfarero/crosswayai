    let currentZoom = 1;
    let svgBaseWidth = 0;
    let svgBaseHeight = 0;

    function setZoomBaseSizeFromSvg(svg) {
      if (!svg) {
        svgBaseWidth = 0;
        svgBaseHeight = 0;
        return;
      }

      const viewBox = (svg.getAttribute('viewBox') || '').trim().split(/\s+/).map(Number);
      if (viewBox.length === 4 && Number.isFinite(viewBox[2]) && Number.isFinite(viewBox[3]) && viewBox[2] > 0 && viewBox[3] > 0) {
        svgBaseWidth = viewBox[2];
        svgBaseHeight = viewBox[3];
        return;
      }

      const fallbackWidth = Number(svg.getAttribute('width')) || svg.clientWidth || 1200;
      const fallbackHeight = Number(svg.getAttribute('height')) || svg.clientHeight || 800;
      svgBaseWidth = Math.max(100, fallbackWidth);
      svgBaseHeight = Math.max(100, fallbackHeight);
    }

    function centerStageScroll() {
      const left = Math.max(0, (stage.scrollWidth - stage.clientWidth) / 2);
      const top = Math.max(0, (stage.scrollHeight - stage.clientHeight) / 2);
      stage.scrollLeft = left;
      stage.scrollTop = top;
    }

    function applyZoom(zoomValue, centerScroll = false) {
      const svg = diagram.querySelector('svg');
      if (!svg || !svgBaseWidth || !svgBaseHeight) {
        return;
      }
      const clamped = Math.min(10, Math.max(0.1, zoomValue));
      currentZoom = clamped;
      svg.style.width = `${Math.round(svgBaseWidth * currentZoom)}px`;
      svg.style.height = `${Math.round(svgBaseHeight * currentZoom)}px`;
      if (centerScroll) {
        centerStageScroll();
      }
      setStatus(`Rendered at ${Math.round(currentZoom * 100)}% zoom.`);

      if (typeof window.CROSSWAY_ON_VIEWPORT_CHANGED === 'function') {
        window.CROSSWAY_ON_VIEWPORT_CHANGED();
      }
    }

    function fitDiagramToViewport() {
      if (!svgBaseWidth || !svgBaseHeight) {
        return;
      }
      const availableWidth = Math.max(120, stage.clientWidth - 36);
      const availableHeight = Math.max(120, stage.clientHeight - 36);
      const fitZoom = Math.min(availableWidth / svgBaseWidth, availableHeight / svgBaseHeight);
      applyZoom(fitZoom, true);
    }

    function zoomWithCenter(targetZoom) {
      const svg = diagram.querySelector('svg');
      if (!svg || !svgBaseWidth || !svgBaseHeight) {
        applyZoom(targetZoom, true);
        return;
      }

      const centerX = stage.scrollLeft + stage.clientWidth / 2;
      const centerY = stage.scrollTop + stage.clientHeight / 2;
      const svgCenterX = centerX / currentZoom;
      const svgCenterY = centerY / currentZoom;

      const newZoom = Math.min(1, Math.max(0.1, targetZoom));
      applyZoom(newZoom, false);

      const newCenterX = svgCenterX * newZoom;
      const newCenterY = svgCenterY * newZoom;
      const maxScrollLeft = Math.max(0, stage.scrollWidth - stage.clientWidth);
      const maxScrollTop = Math.max(0, stage.scrollHeight - stage.clientHeight);
      let targetScrollLeft = newCenterX - stage.clientWidth / 2;
      let targetScrollTop = newCenterY - stage.clientHeight / 2;

      stage.scrollLeft = Math.max(0, Math.min(targetScrollLeft, maxScrollLeft));
      stage.scrollTop = Math.max(0, Math.min(targetScrollTop, maxScrollTop));
    }

    function centerOnSourceNode(svg, sourceNode) {
      if (!svg || !sourceNode) {
        return false;
      }

      let nodeEl = null;
      nodeEl = svg.querySelector(`.node[data-id='${sourceNode}']`);
      if (!nodeEl) nodeEl = svg.querySelector(`.node.id-${sourceNode}`);
      if (!nodeEl) nodeEl = svg.querySelector(`.node[id*='${sourceNode}']`);
      if (!nodeEl) {
        return false;
      }

      const nodeRect = nodeEl.getBoundingClientRect();
      const svgRect = svg.getBoundingClientRect();
      const nodeCenterX = nodeRect.left + nodeRect.width / 2 - svgRect.left;
      const nodeCenterY = nodeRect.top + nodeRect.height / 2 - svgRect.top;
      const zoom = currentZoom || 1;
      const scrollX = nodeCenterX * zoom - stage.clientWidth / 2;
      const scrollY = nodeCenterY * zoom - stage.clientHeight / 2;

      stage.scrollLeft = Math.max(0, scrollX);
      stage.scrollTop = Math.max(0, scrollY);
      return true;
    }

    function attachZoomControls() {
      document.getElementById('zoomIn').addEventListener('click', () => {
        zoomWithCenter(currentZoom * 1.2);
      });

      document.getElementById('zoomOut').addEventListener('click', () => {
        zoomWithCenter(currentZoom / 1.2);
      });

      document.getElementById('fit').addEventListener('click', fitDiagramToViewport);

      document.getElementById('reset').addEventListener('click', () => {
        applyZoom(1, false);
        const svg = diagram.querySelector('svg');

        if (svg && window.CROSSWAY_SOURCE_NODE) {
          if (centerOnSourceNode(svg, window.CROSSWAY_SOURCE_NODE)) {
            return;
          }
        }

        if (typeof isTableRelationsDiagram === 'function' && isTableRelationsDiagram(defaultMarkdownPath)) {
          centerStageScroll();
        }
      });

      stage.addEventListener('wheel', (event) => {
        if (event.ctrlKey || event.metaKey) {
          event.preventDefault();
          const zoomFactor = event.deltaY > 0 ? 0.9 : 1.1;
          const svg = diagram.querySelector('svg');
          if (!svg || !svgBaseWidth || !svgBaseHeight) {
            applyZoom(currentZoom * zoomFactor, false);
            return;
          }

          const stageRect = stage.getBoundingClientRect();
          const mouseX = event.clientX - stageRect.left + stage.scrollLeft;
          const mouseY = event.clientY - stageRect.top + stage.scrollTop;
          const svgX = mouseX / currentZoom;
          const svgY = mouseY / currentZoom;

          const newZoom = Math.min(1, Math.max(0.1, currentZoom * zoomFactor));
          applyZoom(newZoom, false);

          const newMouseX = svgX * newZoom;
          const newMouseY = svgY * newZoom;
          const maxScrollLeft = Math.max(0, stage.scrollWidth - stage.clientWidth);
          const maxScrollTop = Math.max(0, stage.scrollHeight - stage.clientHeight);
          let targetScrollLeft = newMouseX - (event.clientX - stageRect.left);
          let targetScrollTop = newMouseY - (event.clientY - stageRect.top);

          targetScrollLeft = Math.max(0, Math.min(targetScrollLeft, maxScrollLeft));
          targetScrollTop = Math.max(0, Math.min(targetScrollTop, maxScrollTop));
          stage.scrollLeft = targetScrollLeft;
          stage.scrollTop = targetScrollTop;
        }
      });
    }

