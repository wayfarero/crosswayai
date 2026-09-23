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
      // Get the stage (scrollable container)
      const stageEl = document.getElementById('stage');
      if (!stageEl) return;

      // Get the SVG element
      const svg = diagram.querySelector('svg');
      if (!svg) return;

      // Get the node group's bounding box
      const nodeBBox = node.getBBox ? node.getBBox() : node.getBoundingClientRect();

      // If getBBox is available (SVG element), we need to convert to screen coordinates
      let nodeScreenX, nodeScreenY, nodeScreenWidth, nodeScreenHeight;

      if (typeof nodeBBox.x === 'number' && typeof nodeBBox.y === 'number') {
        // SVG coordinate space (from getBBox)
        const transform = node.getScreenCTM();
        if (transform) {
          nodeScreenX = transform.e + nodeBBox.x * transform.a;
          nodeScreenY = transform.f + nodeBBox.y * transform.d;
          nodeScreenWidth = nodeBBox.width * Math.abs(transform.a);
          nodeScreenHeight = nodeBBox.height * Math.abs(transform.d);
        } else {
          // Fallback: use getBoundingClientRect
          const rect = node.getBoundingClientRect();
          nodeScreenX = rect.left;
          nodeScreenY = rect.top;
          nodeScreenWidth = rect.width;
          nodeScreenHeight = rect.height;
        }
      } else {
        // Already in screen coordinates
        nodeScreenX = nodeBBox.left;
        nodeScreenY = nodeBBox.top;
        nodeScreenWidth = nodeBBox.width;
        nodeScreenHeight = nodeBBox.height;
      }

      // Get the viewport center
      const viewportWidth = stageEl.clientWidth;
      const viewportHeight = stageEl.clientHeight;

      // Calculate node center in screen space
      const nodeCenterScreenX = nodeScreenX + nodeScreenWidth / 2;
      const nodeCenterScreenY = nodeScreenY + nodeScreenHeight / 2;

      // Get the diagram offset from viewport
      const diagramRect = diagram.getBoundingClientRect();
      const stageRect = stageEl.getBoundingClientRect();

      // Convert screen coordinates to diagram space (accounting for stage position)
      const nodeCenterDiagramX = nodeCenterScreenX - diagramRect.left + stageEl.scrollLeft;
      const nodeCenterDiagramY = nodeCenterScreenY - diagramRect.top + stageEl.scrollTop;

      // Calculate target scroll to center the node
      const targetScrollLeft = nodeCenterDiagramX - viewportWidth / 2;
      const targetScrollTop = nodeCenterDiagramY - viewportHeight / 2;

      // Apply scroll with bounds checking
      stageEl.scrollLeft = Math.max(0, Math.min(targetScrollLeft, stageEl.scrollWidth - viewportWidth));
      stageEl.scrollTop = Math.max(0, Math.min(targetScrollTop, stageEl.scrollHeight - viewportHeight));

      // Trigger viewport change event if it exists
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
