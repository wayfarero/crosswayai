    // Node search: highlight matching diagram nodes by label query.
    // Loaded after crosswayaiViewer.js; shares the same plain-script scope.
    // Depends on: diagram (crosswayaiViewer.js)

    const nodeSearchInput = document.getElementById('nodeSearch');
    const searchCountEl = document.getElementById('searchCount');
    const prevSearchBtn = document.getElementById('prevSearchResult');
    const nextSearchBtn = document.getElementById('nextSearchResult');

    let searchHighlightedNodes = [];
    let searchResultNodes = [];           // Array of matched node elements (for navigation)
    let currentSearchIndex = -1;          // -1 = no active result; 0+ = active index
    let showInViewerNode = null;

    function clearShowInViewerHighlight() {
      if (!showInViewerNode) return;
      showInViewerNode.classList.remove('show-in-viewer-node');
      showInViewerNode = null;
    }

    function highlightShowInViewerNode(node) {
      clearShowInViewerHighlight();
      showInViewerNode = node;
      showInViewerNode.classList.add('show-in-viewer-node');
    }

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
      resetSearchNavigation();
    }

    function stripPrefixToken(text) {
      // Remove known prefixes (case-insensitive)
      return text.replace(/^(class|include|procedure|screen):\s*/i, '').trim();
    }

    function resetSearchNavigation() {
      // Clear navigation state when search query changes
      searchResultNodes = [];
      currentSearchIndex = -1;
      updateNavigationButtonStates();
    }

    function updateNavigationButtonStates() {
      // Enable/disable nav buttons based on whether we have results
      const hasResults = searchResultNodes.length > 0;
      prevSearchBtn.disabled = !hasResults;
      nextSearchBtn.disabled = !hasResults;
    }

    function centerNodeInViewport(node) {
      const stageEl = document.getElementById('stage');
      if (!stageEl) return;

      const stageRect = stageEl.getBoundingClientRect();
      const nodeRect = node.getBoundingClientRect();
      const nodeCenterX = nodeRect.left + nodeRect.width / 2;
      const nodeCenterY = nodeRect.top + nodeRect.height / 2;
      const viewportCenterX = stageRect.left + stageEl.clientWidth / 2;
      const viewportCenterY = stageRect.top + stageEl.clientHeight / 2;
      const targetScrollLeft = stageEl.scrollLeft + nodeCenterX - viewportCenterX;
      const targetScrollTop = stageEl.scrollTop + nodeCenterY - viewportCenterY;
      const maxScrollLeft = Math.max(0, stageEl.scrollWidth - stageEl.clientWidth);
      const maxScrollTop = Math.max(0, stageEl.scrollHeight - stageEl.clientHeight);

      stageEl.scrollLeft = Math.max(0, Math.min(targetScrollLeft, maxScrollLeft));
      stageEl.scrollTop = Math.max(0, Math.min(targetScrollTop, maxScrollTop));

      if (typeof window.CROSSWAY_ON_VIEWPORT_CHANGED === 'function') {
        window.CROSSWAY_ON_VIEWPORT_CHANGED();
      }
    }

    function navigateSearchResults(direction) {
      // direction: 1 for next, -1 for prev
      if (searchResultNodes.length === 0) return;

      // Move to next/prev index with wrapping
      currentSearchIndex += direction;
      if (currentSearchIndex >= searchResultNodes.length) {
        currentSearchIndex = 0;  // Wrap to start
      } else if (currentSearchIndex < 0) {
        currentSearchIndex = searchResultNodes.length - 1;  // Wrap to end
      }

      const activeNode = searchResultNodes[currentSearchIndex];
      if (activeNode) {
        // Center the viewport on this node
        centerNodeInViewport(activeNode);

        // Update visual highlight (make active result brighter)
        updateActiveNodeHighlight();
      }
    }

    function updateActiveNodeHighlight() {
      // Update all nodes: active gets brighter highlight, others get normal search highlight
      searchResultNodes.forEach((node, index) => {
        const rect = node.querySelector('rect, polygon, circle, ellipse, path');
        if (!rect) return;

        if (index === currentSearchIndex) {
          // Active result: brighter/yellow highlight
          rect.setAttribute('fill', '#fbbf24');  // amber
          rect.style.fill = '#fbbf24';  // amber
        } else {
          // Non-active results: pale green
          rect.setAttribute('fill', '#a7f3d0');  // pale green
          rect.style.fill = '#a7f3d0';  // pale green
        }
      });
    }

    function normalizeFilePath(filePath, caseInsensitive) {
      const normalizedPath = String(filePath || '').replace(/\\/g, '/');
      return caseInsensitive ? normalizedPath.toLowerCase() : normalizedPath;
    }

    function showFileNodeInViewer(message) {
      clearShowInViewerHighlight();
      const requestedPath = normalizeFilePath(message.filePath, message.caseInsensitive);
      const fileMapEntry = Object.entries(window.CROSSWAY_FILE_MAP || {}).find(([, filePath]) => (
        normalizeFilePath(filePath, message.caseInsensitive) === requestedPath
      ));
      const svg = diagram.querySelector('svg');
      const node = fileMapEntry && svg
        ? Array.from(svg.querySelectorAll('.node')).find((candidate) => getNodeIdentity(candidate) === fileMapEntry[0])
        : null;

      if (node) {
        centerNodeInViewport(node);
        highlightShowInViewerNode(node);
      }

      window.parent.postMessage({
        type: 'showFileInViewerResult',
        filePath: message.filePath,
        found: Boolean(node)
      }, '*');
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
          // Highlight all matching nodes including the source node
          const rect = node.querySelector('rect, polygon, circle, ellipse, path');
          if (rect) {
            const originalFill = rect.hasAttribute('fill') ? rect.getAttribute('fill') : null;
            const originalStyleFill = rect.style.fill;
            searchHighlightedNodes.push({ node, originalFill, originalStyleFill });
            searchResultNodes.push(node);  // Track node elements for navigation
            rect.setAttribute('fill', '#a7f3d0'); // pale green
            rect.style.fill = '#a7f3d0'; // pale green
            matchCount++;
          }
        }
      });

      searchCountEl.textContent = matchCount > 0 ? `${matchCount}` : '0';
      searchCountEl.style.color = matchCount > 0 ? '#22c55e' : '#9ca3af';
      updateNavigationButtonStates();  // Enable/disable nav buttons

      // Auto-navigate to first result when search completes
      if (searchResultNodes.length > 0) {
        currentSearchIndex = 0;
        const firstNode = searchResultNodes[0];
        centerNodeInViewport(firstNode);
        updateActiveNodeHighlight();
      }
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
      } else if (event.key === 'ArrowDown') {
        // Navigate to next search result (forward through 0 to end)
        event.preventDefault();
        navigateSearchResults(1);
      } else if (event.key === 'Enter') {
        event.preventDefault();
        navigateSearchResults(1);
      } else if (event.key === 'ArrowUp') {
        // Navigate to previous search result (backward)
        event.preventDefault();
        navigateSearchResults(-1);
      }
    });

    // Prevent pan/drag when interacting with the search input
    nodeSearchInput.addEventListener('mousedown', (event) => event.stopPropagation());

    // Navigation button handlers
    prevSearchBtn.addEventListener('click', (event) => {
      event.preventDefault();
      navigateSearchResults(-1);  // Go to previous result
    });

    nextSearchBtn.addEventListener('click', (event) => {
      event.preventDefault();
      navigateSearchResults(1);   // Go to next result
    });

    document.getElementById('stage').addEventListener('click', clearShowInViewerHighlight);

    window.addEventListener('message', (event) => {
      const message = event.data || {};
      if (message.type === 'showFileInViewer' && message.filePath) {
        showFileNodeInViewer(message);
      }
    });
