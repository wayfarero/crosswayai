    // Drag-to-pan behavior for the diagram stage.
    function attachPanHandlers() {
      let isDragging = false;
      let didPanDrag = false;
      let dragStartX = 0;
      let dragStartY = 0;
      let dragStartScrollLeft = 0;
      let dragStartScrollTop = 0;

      stage.addEventListener('mousedown', (event) => {
        // Do not start panning when grabbing edge/text shapes.
        if (event.target.tagName === 'path' || event.target.tagName === 'text' || event.target.tagName === 'tspan') {
          return;
        }

        isDragging = true;
        didPanDrag = false;
        dragStartX = event.clientX;
        dragStartY = event.clientY;
        dragStartScrollLeft = stage.scrollLeft;
        dragStartScrollTop = stage.scrollTop;
        stage.classList.add('dragging');
      });

      document.addEventListener('mousemove', (event) => {
        if (!isDragging) return;

        const deltaX = event.clientX - dragStartX;
        const deltaY = event.clientY - dragStartY;
        if (Math.abs(deltaX) > 3 || Math.abs(deltaY) > 3) {
          didPanDrag = true;
        }

        stage.scrollLeft = dragStartScrollLeft - deltaX;
        stage.scrollTop = dragStartScrollTop - deltaY;
      });

      document.addEventListener('mouseup', () => {
        if (isDragging && didPanDrag) {
          window.CROSSWAY_IGNORE_NEXT_SVG_CLICK = true;
        }
        isDragging = false;
        didPanDrag = false;
        stage.classList.remove('dragging');
      });
    }
