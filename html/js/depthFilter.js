    // ── Depth Filter ─────────────────────────────────────────────────────────
    // The depth filter lets users limit how many "hops" from the source node
    // are shown. It works by pre-computing the depth of every node/edge after
    // Mermaid renders the SVG, then toggling display:none on slider change.
    //
    // depthFilterData is populated by computeAndInitDepthFilter() after each
    // render. It holds pre-collected { element, depth } entries so the slider
    // handler only needs to iterate a flat array.
    // ─────────────────────────────────────────────────────────────────────────

    var depthFilterControl = document.getElementById('depthFilterControl');
    var depthSliderEl = document.getElementById('depthSlider');
    var depthBubbleEl = document.getElementById('depthBubble');
    var depthFilterData = null; // { nodeEntries, edgeEntries, labelEntries, maxDepth }

    // Positions the on-thumb number circle to match the native (invisible) thumb.
    // skipTransition=true on first call prevents an ugly slide-in from the left.
    function updateDepthBubble(val, skipTransition) {
      const min = parseInt(depthSliderEl.min, 10) || 0;
      const max = parseInt(depthSliderEl.max, 10) || 1;
      const percent = max > min ? (val - min) / (max - min) : 1;
      const thumbWidth = 22; // matches the CSS width of the invisible native thumb
      const left = percent * (depthSliderEl.offsetWidth - thumbWidth) + thumbWidth / 2;
      if (skipTransition) {
        // Temporarily kill the CSS transition so the bubble snaps to position
        // immediately rather than animating from wherever it was before.
        depthBubbleEl.style.transition = 'none';
        depthBubbleEl.style.left = `${left}px`;
        void depthBubbleEl.offsetWidth; // force reflow to commit the no-transition frame
        depthBubbleEl.style.transition = ''; // restore the CSS transition
      } else {
        depthBubbleEl.style.left = `${left}px`;
      }
      depthBubbleEl.textContent = String(val);
      // Paint the track: blue on the left of the thumb, gray on the right
      const pct = (percent * 100).toFixed(1);
      depthSliderEl.style.background = `linear-gradient(to right, #3b82f6 ${pct}%, #4b5563 ${pct}%)`;
    }

    // ── Depth Filter: Apply ────────────────────────────────────────────────
    // Called on every slider change. Iterates the PRE-COLLECTED element arrays
    // and toggles display:none based on depth.
    //
    // We use requestAnimationFrame to batch all DOM writes into a single paint
    // frame, avoiding jank when the user drags the slider quickly.
    // ───────────────────────────────────────────────────────────────────────
    function applyDepthFilter(maxShow) {
      if (!depthFilterData) return;
      const { nodeEntries, edgeEntries, labelEntries } = depthFilterData;

      requestAnimationFrame(() => {
        // Show/hide elements based on their depth relative to the slider value.
        nodeEntries.forEach(({ element, depth }) => {
          element.style.display = (depth === null || depth <= maxShow) ? '' : 'none';
        });

        edgeEntries.forEach(({ element, depth }) => {
          element.style.display = (depth === null || depth <= maxShow) ? '' : 'none';
        });

        labelEntries.forEach(({ element, depth }) => {
          element.style.display = (depth === null || depth <= maxShow) ? '' : 'none';
        });
        // Sync the invisible click-target overlays that activateDiagramInteractivity()
        // creates for each edge (used for click/hover detection on thin arrows).
        // Each click-target is the nextSibling of its corresponding <path> element,
        // so we check if the previous sibling (the actual edge) is hidden.
        const svg = document.getElementById('diagram').querySelector('svg');
        if (svg) {
          svg.querySelectorAll('.crosswayai-click-target').forEach(ct => {
            const prev = ct.previousElementSibling;
            ct.style.display = (prev && prev.style.display === 'none') ? 'none' : '';
          });
        }
      });
    }

    // ── Depth Filter: Compute & Init ──────────────────────────────────────
    // Called from activateDiagramInteractivity() after each render.
    // Runs BFS from the source node to assign a depth to every SVG element,
    // pre-collects them into flat arrays, and configures the slider UI.
    //
    // helpers — object containing the SVG query helpers from crosswayaiViewer.js:
    //   { buildEdgeGraph, getDiagramEdgeElements, getEdgeIdentity,
    //     getEdgeLabelGroups, getNodeIdentity }
    // ─────────────────────────────────────────────────────────────────────────
    function computeAndInitDepthFilter(svg, helpers) {
      const { buildEdgeGraph, getDiagramEdgeElements, getEdgeIdentity, getEdgeLabelGroups, getNodeIdentity } = helpers;

      // HOW IT WORKS:
      // 1. Build an adjacency graph from the SVG arrows (edges)
      // 2. BFS from the source node to assign a "depth" (hop count) to every node
      // 3. Pre-collect all SVG elements with their depth, so the slider handler
      //    can toggle display:none without any DOM queries
      //
      // The slider only appears for diagrams that have a source node
      // (Impact, Inheritance, Interface, etc. — NOT Package or Table Relations).

      if (window.CROSSWAY_SOURCE_NODE) {
        // Step 1: Build adjacency lists from the rendered SVG edges.
        // outgoing = arrows going OUT from a node
        // incoming = arrows coming IN to a node
        const { outgoing, incoming } = buildEdgeGraph(svg);

        // Step 2: BFS (Breadth-First Search) from the source node.
        // We traverse BOTH directions (outgoing + incoming) because Impact
        // Diagrams show dependencies in both directions — "what I depend on"
        // and "what depends on me". Depth = minimum number of hops from source.
        const depthMap = new Map();
        const sourceId = window.CROSSWAY_SOURCE_NODE;
        depthMap.set(sourceId, 0);
        const bfsQueue = [{ id: sourceId, depth: 0 }];
        while (bfsQueue.length > 0) {
          const { id, depth } = bfsQueue.shift();
          // Combine both outgoing and incoming neighbors — bidirectional traversal
          const neighbors = [
            ...(outgoing.get(id) || []),
            ...(incoming.get(id) || [])
          ];
          neighbors.forEach(neighborId => {
            // Only visit each node once — depthMap.has() prevents revisiting
            // and also prevents infinite loops in graphs with circular references
            if (!depthMap.has(neighborId)) {
              depthMap.set(neighborId, depth + 1);
              bfsQueue.push({ id: neighborId, depth: depth + 1 });
            }
          });
        }

        // Find the maximum depth across all reachable nodes
        let maxDepth = 0;
        depthMap.forEach(d => { if (d > maxDepth) maxDepth = d; });

        // Step 3: Pre-collect SVG elements paired with their computed depths.
        // This is the key performance optimization — we query the DOM once here,
        // then the slider handler just iterates these flat arrays.

        // 3a: Collect all node <g> elements (the boxes in the diagram)
        const dfNodeEntries = [];
        svg.querySelectorAll('.node').forEach(nodeEl => {
          const nodeId = getNodeIdentity(nodeEl);
          // depth=null means this node wasn't reached by BFS (shouldn't happen
          // in a connected diagram, but safe fallback — will always be shown)
          const d = nodeId && depthMap.has(nodeId) ? depthMap.get(nodeId) : null;
          dfNodeEntries.push({ element: nodeEl, depth: d });
        });

        // 3b: Collect all edge <path> elements (the arrows between boxes)
        // An edge's depth = max(fromDepth, toDepth), because an edge connecting
        // depth 1 and depth 2 should only show at depth level 2 or higher.
        const allDfEdges = getDiagramEdgeElements(svg);
        const dfEdgeEntries = allDfEdges.map(edgeEl => {
          const edgeIds = getEdgeIdentity(edgeEl);
          if (!edgeIds) return { element: edgeEl, depth: null };
          const fd = depthMap.has(edgeIds.from) ? depthMap.get(edgeIds.from) : null;
          const td = depthMap.has(edgeIds.to) ? depthMap.get(edgeIds.to) : null;
          return { element: edgeEl, depth: (fd !== null && td !== null) ? Math.max(fd, td) : null };
        });

        // 3c: Collect edge label <g> elements (text on the arrows like "new", "invoke")
        // Uses same depth logic as edges. Falls back to index-based mapping if
        // the label element doesn't have its own edge identity.
        const dfLabelEntries = getEdgeLabelGroups(svg).map((labelEl, index) => {
          const edgeIds = getEdgeIdentity(labelEl);
          let d = null;
          if (edgeIds) {
            const fd = depthMap.has(edgeIds.from) ? depthMap.get(edgeIds.from) : null;
            const td = depthMap.has(edgeIds.to) ? depthMap.get(edgeIds.to) : null;
            if (fd !== null && td !== null) d = Math.max(fd, td);
          } else if (dfEdgeEntries[index]) {
            // Fallback: if Mermaid didn't put edge IDs on this label, assume it
            // corresponds to the edge at the same render index
            d = dfEdgeEntries[index].depth;
          }
          return { element: labelEl, depth: d };
        });

        // Step 4: Configure the slider UI and store the pre-collected data
        if (maxDepth > 0) {
          depthFilterData = { nodeEntries: dfNodeEntries, edgeEntries: dfEdgeEntries, labelEntries: dfLabelEntries, maxDepth };
          depthSliderEl.min = '0';
          depthSliderEl.max = String(maxDepth);
          depthSliderEl.value = String(maxDepth); // Start fully expanded
          depthFilterControl.style.display = 'flex';
          // Position the bubble without animation — the slider has just appeared
          // so we don't want it to slide in from a stale position.
          updateDepthBubble(maxDepth, true);
        } else {
          depthFilterData = null;
          depthFilterControl.style.display = 'none';
        }
      } else {
        // No source node (e.g. Package Diagram) — hide the depth slider
        depthFilterData = null;
        depthFilterControl.style.display = 'none';
      }
    }
