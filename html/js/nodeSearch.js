    // Node search: highlight matching diagram nodes by label query.
    // Loaded after crosswayaiViewer.js; shares the same plain-script scope.
    // Depends on: diagram (crosswayaiViewer.js)

    const nodeSearchInput = document.getElementById('nodeSearch');
    const searchCountEl = document.getElementById('searchCount');
    let searchHighlightedNodes = [];

    function clearSearchHighlights() {
      searchHighlightedNodes.forEach(({ node, originalFill, originalStyleFill }) => {
        const rect = node.querySelector('rect, polygon, circle, ellipse, path');
        if (rect) {
          if (originalFill !== null) {
            rect.setAttribute('fill', originalFill);
          } else {
            rect.removeAttribute('fill');
          }
          // Restore style fill
          if (originalStyleFill !== undefined) {
            rect.style.fill = originalStyleFill;
          } else {
            rect.style.fill = '';
          }
        }
      });
      searchHighlightedNodes = [];
      searchCountEl.textContent = '';
    }

    function stripPrefixToken(text) {
      // Remove known prefixes (case-insensitive)
      return text.replace(/^(class|include|procedure|screen):\s*/i, '').trim();
    }

    function applySearchHighlights(query) {
      clearSearchHighlights();

      if (!query) {
        return;
      }

      const svg = diagram.querySelector('svg');
      if (!svg) {
        return;
      }

      const lowerQuery = query.toLowerCase();
      const allNodes = svg.querySelectorAll('.node');
      let matchCount = 0;

      allNodes.forEach(node => {
        // Try <span class='nodeLabel'> first, fallback to <text>
        let labelEl = node.querySelector('span.nodeLabel');
        if (!labelEl) labelEl = node.querySelector('text');
        if (!labelEl) return;

        let nodeText = (labelEl.textContent || '').trim();
        nodeText = stripPrefixToken(nodeText);
        const firstLine = nodeText.split('\n')[0].trim().toLowerCase();
        if (firstLine.includes(lowerQuery)) {
          // Do not highlight referenced file node
          let isReferencedFileNode = false;
          if (window.CROSSWAY_SOURCE_NODE) {
            // Try to match node id or label
            const nodeId = node.getAttribute('data-id') || node.id || '';
            if (nodeId && String(nodeId).replace(/[^a-zA-Z0-9_]/g, '') === String(window.CROSSWAY_SOURCE_NODE).replace(/[^a-zA-Z0-9_]/g, '')) {
              isReferencedFileNode = true;
            }
          }
          if (!isReferencedFileNode) {
            const rect = node.querySelector('rect, polygon, circle, ellipse, path');
            if (rect) {
              const originalFill = rect.hasAttribute('fill') ? rect.getAttribute('fill') : null;
              const originalStyleFill = rect.style.fill;
              searchHighlightedNodes.push({ node, originalFill, originalStyleFill });
              rect.setAttribute('fill', '#a7f3d0'); // pale green
              rect.style.fill = '#a7f3d0'; // pale green
              matchCount++;
            }
          }
        }
      });

      searchCountEl.textContent = matchCount > 0 ? `${matchCount}` : '0';
      searchCountEl.style.color = matchCount > 0 ? '#22c55e' : '#9ca3af';
    }

    nodeSearchInput.addEventListener('input', () => {
      applySearchHighlights(nodeSearchInput.value.trim());
    });

    nodeSearchInput.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        nodeSearchInput.value = '';
        clearSearchHighlights();
        nodeSearchInput.blur();
        event.stopPropagation();
      }
    });

    // Prevent pan/drag when interacting with the search input
    nodeSearchInput.addEventListener('mousedown', (event) => event.stopPropagation());
