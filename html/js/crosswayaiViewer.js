    mermaid.initialize({
      startOnLoad: false,
      theme: 'default',
      securityLevel: 'loose',
      deterministicIds: true,
      maxTextSize: 5000000,
      er: {
        layoutDirection: 'LR'
      }
    });

    const status = document.getElementById('status');
    const stage = document.getElementById('stage');
    const diagram = document.getElementById('diagram');
    const nodeContextMenu = document.getElementById('nodeContextMenu');

    const params = new URLSearchParams(window.location.search);
    const mermaidMarkdownFilePath = params.get('file');
    let LINK_TYPE_COLORS = {};

    async function loadDiagramColors() {
      try {
        const response = await fetch('/__crosswayai/diagram-colors.json', { cache: 'no-store' });
        if (response.ok) {
          const colors = await response.json();
          LINK_TYPE_COLORS = Object.assign({}, colors.linkColors || {});
        }
      } catch (_) {
        // Keep existing colors when config cannot be loaded.
      }
    }

    function setStatus(text, isError = false) {
      status.textContent = text;
      status.style.color = isError ? '#fca5a5' : '#9ca3af';
    }

    function matchesMarkdownDiagramPath(markdownPath, prefix) {
      const pathText = String(markdownPath || '');
      const escapedPrefix = String(prefix || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const pathPattern = new RegExp(`[/\\\\]${escapedPrefix}_[^/\\\\]+\\.md$`, 'i');
      const filePattern = new RegExp(`^${escapedPrefix}_[^/\\\\]+\\.md$`, 'i');
      return pathPattern.test(pathText) || filePattern.test(pathText);
    }

    function isPackageDiagram(mermaidCode, markdownPath) {
      return matchesMarkdownDiagramPath(markdownPath, 'package');
    }

    function isTableRelationsDiagram(markdownPath) {
      return matchesMarkdownDiagramPath(markdownPath, 'table_relations');
    }

    function activateDiagramSizing() {
      const svg = diagram.querySelector('svg');
      if (!svg) return;

      setZoomBaseSizeFromSvg(svg);

      fitDiagramToViewport();
      activateDiagramInteractivity(svg);
    }

    function activateDiagramInteractivity(svg) {
      if (!svg) return;

      const CLICK_TOLERANCE = 24;
      const NODE_DOUBLE_CLICK_DELAY_MS = 220;
      let activeSelection = null;
      let lockedNode = null;
      let pendingNodeClickTimer = null;
      clearAllPinnedEdgeTooltips();

      function openNodeFile(nodeId) {
        const filePath = (window.CROSSWAY_FILE_MAP || {})[nodeId];
        if (!filePath) {
          return false;
        }

        window.parent.postMessage({ type: 'openFile', filePath: filePath }, '*');
        return true;
      }

      function isDiagramEdgeElement(edgeEl) {
        if (!edgeEl) {
          return false;
        }
        const tagName = (edgeEl.tagName || '').toLowerCase();
        if (!['path', 'line', 'polyline'].includes(tagName)) {
          return false;
        }
        if (edgeEl.closest('defs')) {
          return false;
        }
        const markerStart = edgeEl.getAttribute('marker-start');
        const markerEnd = edgeEl.getAttribute('marker-end');
        const edgeClass = edgeEl.getAttribute('class') || '';
        const edgeId = edgeEl.id || '';
        if (markerStart || markerEnd) {
          return true;
        }
        return /(^|\s)(edge|edgePath|relation|relationshipLine)(\s|$)/i.test(edgeClass) || edgeId.includes('L-');
      }

      function clearActiveSelection() {
        if (!activeSelection) {
          return;
        }
        const { pathElement, originalStroke, originalStrokeWidth, originalStyleStroke, originalStyleStrokeWidth } = activeSelection;
        if (pathElement && pathElement.isConnected) {
          if (originalStroke === null) {
            pathElement.removeAttribute('stroke');
          } else {
            pathElement.setAttribute('stroke', originalStroke);
          }
          if (originalStrokeWidth === null) {
            pathElement.removeAttribute('stroke-width');
          } else {
            pathElement.setAttribute('stroke-width', originalStrokeWidth);
          }
          if (originalStyleStroke === null) {
            pathElement.style.removeProperty('stroke');
          } else {
            pathElement.style.stroke = originalStyleStroke;
          }
          if (originalStyleStrokeWidth === null) {
            pathElement.style.removeProperty('stroke-width');
          } else {
            pathElement.style.strokeWidth = originalStyleStrokeWidth;
          }
        }
        activeSelection = null;
      }

      function highlightEdge(edgeEl) {
        clearActiveSelection();

        const originalStroke = edgeEl.hasAttribute('stroke') ? edgeEl.getAttribute('stroke') : null;
        const originalStrokeWidth = edgeEl.hasAttribute('stroke-width') ? edgeEl.getAttribute('stroke-width') : null;
        const originalStyleStroke = edgeEl.style.stroke || null;
        const originalStyleStrokeWidth = edgeEl.style.strokeWidth || null;
        const selectedHighlightColor = LINK_TYPE_COLORS.selected;

        edgeEl.setAttribute('stroke', selectedHighlightColor);
        edgeEl.style.stroke = selectedHighlightColor;

        activeSelection = {
          pathElement: edgeEl,
          originalStroke,
          originalStrokeWidth,
          originalStyleStroke,
          originalStyleStrokeWidth
        };
      }

      function createClickTargetForEdge(edgeEl) {
        const tagName = (edgeEl.tagName || '').toLowerCase();
        const clickTarget = document.createElementNS('http://www.w3.org/2000/svg', tagName);
        if (tagName === 'path') {
          clickTarget.setAttribute('d', edgeEl.getAttribute('d') || '');
        } else if (tagName === 'line') {
          clickTarget.setAttribute('x1', edgeEl.getAttribute('x1') || '0');
          clickTarget.setAttribute('y1', edgeEl.getAttribute('y1') || '0');
          clickTarget.setAttribute('x2', edgeEl.getAttribute('x2') || '0');
          clickTarget.setAttribute('y2', edgeEl.getAttribute('y2') || '0');
        } else if (tagName === 'polyline') {
          clickTarget.setAttribute('points', edgeEl.getAttribute('points') || '');
        }
        clickTarget.setAttribute('fill', 'none');
        clickTarget.setAttribute('stroke', 'transparent');
        clickTarget.setAttribute('stroke-width', String(CLICK_TOLERANCE));
        clickTarget.setAttribute('pointer-events', 'stroke');
        clickTarget.setAttribute('class', 'crosswayai-click-target');
        clickTarget.style.cursor = 'pointer';
        return clickTarget;
      }

      function fadeGraphExceptPath(pathNodes, svgElement, pathEdges) {
        const pathSet = pathNodes instanceof Set ? pathNodes : new Set(pathNodes || []);
        const keepEdges = pathEdges instanceof Set ? pathEdges : new Set();
        svgElement.querySelectorAll('.node').forEach(node => {
          const nodeId = getNodeIdentity(node);
          node.style.opacity = nodeId && pathSet.has(nodeId) ? '1' : '0.1';
        });

        const diagramEdges = getDiagramEdgeElements(svgElement);
        diagramEdges.forEach(edgeEl => {
          const edgeIds = getEdgeIdentity(edgeEl);
          const isOnPath = edgeIds ? keepEdges.has(`${edgeIds.from}->${edgeIds.to}`) : false;
          edgeEl.style.opacity = isOnPath ? '1' : '0.1';
        });

        const edgeLabelGroups = getEdgeLabelGroups(svgElement);
        edgeLabelGroups.forEach((labelGroup, index) => {
          const edgeIds = getEdgeIdentity(labelGroup);
          if (edgeIds) {
            const isOnPath = keepEdges.has(`${edgeIds.from}->${edgeIds.to}`);
            labelGroup.style.opacity = isOnPath ? '1' : '0.1';
            return;
          }

          // Some Mermaid builds do not expose edge ids on labels; in that case,
          // map labels to edges by render order.
          const mappedEdge = index < diagramEdges.length ? diagramEdges[index] : null;
          const mappedIds = getEdgeIdentity(mappedEdge);
          if (!mappedIds) {
            labelGroup.style.opacity = '1';
            return;
          }

          const isMappedEdgeOnPath = keepEdges.has(`${mappedIds.from}->${mappedIds.to}`);
          labelGroup.style.opacity = isMappedEdgeOnPath ? '1' : '0.1';
        });
      }

      function resetGraphFade(svgElement) {

        svgElement.querySelectorAll('.node').forEach(n => {
          n.style.opacity = '1';
        });

        svgElement.querySelectorAll('path, line, polyline').forEach(e => {
          if (!isDiagramEdgeElement(e)) {
            return;
          }
          e.style.opacity = '1';
        });

        getEdgeLabelGroups(svgElement).forEach((labelGroup) => {
          labelGroup.style.opacity = '1';
        });

      }

      function getEdgeLabelGroups(svgElement) {
        if (!svgElement) {
          return [];
        }

        const selectors = [
          '.edgeLabels .edgeLabel',
          'g.edgeLabel'
        ];
        const groups = new Set();

        selectors.forEach((selector) => {
          svgElement.querySelectorAll(selector).forEach((labelEl) => {
            const container = labelEl.closest('g.edgeLabel, g[id*="L-"]') || labelEl;
            groups.add(container);
          });
        });

        return Array.from(groups);
      }

      function getDiagramEdgeElements(svgElement) {
        if (!svgElement) {
          return [];
        }
        return Array.from(svgElement.querySelectorAll('path, line, polyline'))
          .filter((edgeEl) => isDiagramEdgeElement(edgeEl));
      }

      function getNodeIdentity(nodeEl) {
        if (!nodeEl) return null;
        const dataId = nodeEl.getAttribute('data-id');
        if (dataId) return dataId;

        const className = nodeEl.getAttribute('class') || '';
        const classMatch = className.match(/\bid-([A-Za-z0-9_]+)\b/);
        if (classMatch) return classMatch[1];

        const id = nodeEl.id || '';
        const flowMatch = id.match(/(?:flowchart|graph)-([A-Za-z0-9_]+)-\d+$/i);
        if (flowMatch) return flowMatch[1];

        const fallbackLabel = nodeEl.querySelector('text')?.textContent?.trim();
        return fallbackLabel || null;
      }

      function getEdgeIdentity(edgeEl) {
        if (!edgeEl) return null;

        const edgeGroup = edgeEl.closest('g.edgePath, g[id*="L-"], g[class*="edge"]');
        const edgeTokens = [
          edgeEl.getAttribute('id') || '',
          edgeEl.getAttribute('class') || '',
          edgeGroup?.getAttribute('id') || '',
          edgeGroup?.getAttribute('class') || ''
        ].join(' ');

        let match = edgeTokens.match(/L-([A-Za-z0-9_.-]+)-([A-Za-z0-9_.-]+)-\d+/);
        if (!match) {
          match = edgeTokens.match(/LS-([A-Za-z0-9_.-]+)[^A-Za-z0-9_.-]+LE-([A-Za-z0-9_.-]+)/);
        }
        if (match) {
          return {
            from: match[1],
            to: match[2]
          };
        }

        return null;
      }

      function buildEdgeGraph(svgElement) {
        const outgoing = new Map();
        const incoming = new Map();

        function add(map, from, to) {
          if (!map.has(from)) {
            map.set(from, new Set());
          }
          map.get(from).add(to);
        }

        svgElement.querySelectorAll('path, line, polyline').forEach(edgeEl => {
          if (!isDiagramEdgeElement(edgeEl)) {
            return;
          }
          const edge = getEdgeIdentity(edgeEl);
          if (!edge) {
            return;
          }
          add(outgoing, edge.from, edge.to);
          add(incoming, edge.to, edge.from);
        });

        return { outgoing, incoming };
      }

      function collectDirectedSubgraphToSource(startNodeId, sourceNodeId, svgElement) {
        if (!startNodeId || !sourceNodeId || !svgElement) {
          return {
            nodes: new Set(startNodeId ? [startNodeId] : []),
            edges: new Set()
          };
        }

        const { outgoing, incoming } = buildEdgeGraph(svgElement);
        
        function collectPaths(stepMap, reverseStepMap, edgeKeyBuilder) {
          const canReachSource = new Set([sourceNodeId]);
          const reverseQueue = [sourceNodeId];

          while (reverseQueue.length) {
            const current = reverseQueue.shift();
            const prevNodes = reverseStepMap.get(current);
            if (!prevNodes) continue;
            prevNodes.forEach((prev) => {
              if (canReachSource.has(prev)) return;
              canReachSource.add(prev);
              reverseQueue.push(prev);
            });
          }

          if (!canReachSource.has(startNodeId)) {
            return null;
          }

          const keepNodes = new Set([startNodeId]);
          const keepEdges = new Set();
          const stack = [startNodeId];
          const visited = new Set([startNodeId]);

          while (stack.length) {
            const current = stack.pop();
            const nextNodes = stepMap.get(current);
            if (!nextNodes) continue;

            nextNodes.forEach((next) => {
              if (!canReachSource.has(next)) {
                return;
              }
              keepNodes.add(next);
              keepEdges.add(edgeKeyBuilder(current, next));
              if (!visited.has(next)) {
                visited.add(next);
                stack.push(next);
              }
            });
          }

          return { nodes: keepNodes, edges: keepEdges };
        }

        // Preferred: follow arrow direction toward source.
        const forwardPaths = collectPaths(
          outgoing,
          incoming,
          (current, next) => `${current}->${next}`
        );
        if (forwardPaths) {
          return forwardPaths;
        }

        // Fallback: if hovered node is below source, keep opposite-direction route.
        const reversePaths = collectPaths(
          incoming,
          outgoing,
          (current, next) => `${next}->${current}`
        );
        if (reversePaths) {
          return reversePaths;
        }

        return {
          nodes: new Set([startNodeId]),
          edges: new Set()
        };
      }

      function getPathToRoot(nodeId) {

        const path = [];
        let current = nodeId;

        while (current) {

          path.push(current);

          const parent = window.CROSSWAY_PARENT_MAP?.[current];

          if (!parent) break;

          current = parent;

        }

        return path;

      }

      function getTreePathBetweenNodes(startNodeId, targetNodeId) {
        if (!startNodeId || !targetNodeId) {
          return null;
        }

        const startPath = getPathToRoot(startNodeId);
        const targetPath = getPathToRoot(targetNodeId);
        if (startPath.length === 0 || targetPath.length === 0) {
          return null;
        }

        const targetPositions = new Map();
        targetPath.forEach((nodeId, index) => {
          targetPositions.set(nodeId, index);
        });

        let sharedAncestor = null;
        let startAncestorIndex = -1;
        let targetAncestorIndex = -1;

        for (let i = 0; i < startPath.length; i++) {
          const nodeId = startPath[i];
          if (targetPositions.has(nodeId)) {
            sharedAncestor = nodeId;
            startAncestorIndex = i;
            targetAncestorIndex = targetPositions.get(nodeId);
            break;
          }
        }

        if (!sharedAncestor) {
          return null;
        }

        const combinedPath = startPath.slice(0, startAncestorIndex + 1);
        const downPath = targetPath.slice(0, targetAncestorIndex).reverse();
        return combinedPath.concat(downPath);
      }

      function getHighlightSubgraph(nodeId, svgElement) {
        if (window.CROSSWAY_IS_PACKAGE_DIAGRAM) {
          const path = getPathToRoot(nodeId);
          const nodes = new Set(path);
          const edges = new Set();
          for (let i = 0; i < path.length - 1; i++) {
            edges.add(`${path[i]}->${path[i + 1]}`);
            edges.add(`${path[i + 1]}->${path[i]}`);
          }
          return { nodes, edges };
        }

        const sourceNodeId = window.CROSSWAY_SOURCE_NODE || null;
        if (sourceNodeId) {
          const directedHighlight = collectDirectedSubgraphToSource(nodeId, sourceNodeId, svgElement);
          const isTrivialDirectedHighlight =
            directedHighlight &&
            directedHighlight.nodes instanceof Set &&
            directedHighlight.nodes.size === 1 &&
            directedHighlight.nodes.has(nodeId) &&
            directedHighlight.edges instanceof Set &&
            directedHighlight.edges.size === 0;

          if (!isTrivialDirectedHighlight) {
            return directedHighlight;
          }

          const treePath = getTreePathBetweenNodes(nodeId, sourceNodeId);
          if (Array.isArray(treePath) && treePath.length > 0) {
            const nodes = new Set(treePath);
            const edges = new Set();

            for (let i = 0; i < treePath.length - 1; i++) {
              const from = treePath[i];
              const to = treePath[i + 1];
              edges.add(`${from}->${to}`);
              edges.add(`${to}->${from}`);
            }

            return { nodes, edges };
          }

          return directedHighlight;
        }

        const path = getPathToRoot(nodeId);
        const nodes = new Set(path);
        const edges = new Set();
        for (let i = 0; i < path.length - 1; i++) {
          edges.add(`${path[i]}->${path[i + 1]}`);
        }
        return { nodes, edges };
      }

      function toUniqueList(values) {
        const unique = new Set();
        (Array.isArray(values) ? values : []).forEach((value) => {
          const text = String(value || '').trim();
          if (text) {
            unique.add(text);
          }
        });
        return Array.from(unique);
      }

    function filterTooltipCallItems(values) {
      const blocked = new Set([
        'include',
        'run',
        'inherits',
        'implements',
        'new',
        'circular',
        'undefined',
        'multiple'
      ]);

        return toUniqueList(values).filter((item) => !blocked.has(item.toLowerCase()));
      }

      const edgeIndexKeys = Array.isArray(window.CROSSWAY_EDGE_INDEX_KEYS)
        ? window.CROSSWAY_EDGE_INDEX_KEYS
        : [];

      function getTooltipItemsByKey(key) {
        if (!key) {
          return null;
        }
        const metadataItems = window.CROSSWAY_EDGE_DETAILS?.[key];
        if (Array.isArray(metadataItems) && metadataItems.length > 0) {
          return { items: filterTooltipCallItems(metadataItems), metadataKey: key };
        }
        const idMappedItems = fallbackLabelsByEdge.get(key);
        if (idMappedItems && idMappedItems.length > 0) {
          return { items: filterTooltipCallItems(idMappedItems), metadataKey: key };
        }
        return null;
      }

      function getEdgeTooltipItems(edgeEl, edgeElementOrder, fallbackLabelsByEdge, edgeMetadataKeyByEdge) {
        const edgeIds = getEdgeIdentity(edgeEl);
        if (edgeIds) {
          const metadataKey = `${edgeIds.from}->${edgeIds.to}`;
          const result = getTooltipItemsByKey(metadataKey);
          if (result) {
            return result;
          }
        }

        const mappedFallbackItems = fallbackLabelsByEdge.get(edgeEl);
        if (mappedFallbackItems && mappedFallbackItems.length > 0) {
          const metadataKey = edgeMetadataKeyByEdge?.get(edgeEl) || null;
          return { items: filterTooltipCallItems(mappedFallbackItems), metadataKey };
        }

        const edgeIndex = edgeElementOrder.indexOf(edgeEl);
        if (edgeIndex >= 0) {
          let metadataKeyFromIndex = null;
          if (edgeIndexKeys.length > edgeIndex) {
            metadataKeyFromIndex = edgeIndexKeys[edgeIndex];
            const result = getTooltipItemsByKey(metadataKeyFromIndex);
            if (result) {
              return result;
            }
          }
          const indexMappedItems = fallbackLabelsByEdge.get(edgeIndex);
          if (indexMappedItems && indexMappedItems.length > 0) {
            return { items: filterTooltipCallItems(indexMappedItems), metadataKey: metadataKeyFromIndex };
          }
        }

        return { items: [], metadataKey: null };
      }
      
      const allDiagramEdges = getDiagramEdgeElements(svg);
      const edgeLabelGroups = getEdgeLabelGroups(svg);
      const fallbackLabelsByEdge = new Map();
      const edgeMetadataKeyByEdge = new Map();

      edgeLabelGroups.forEach((labelGroup, index) => {
        const labelText = (labelGroup.textContent || '').trim();
        if (!labelText) {
          return;
        }

        const parsedItems = labelText
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean);
        if (parsedItems.length === 0) {
          return;
        }

        const edgeIds = getEdgeIdentity(labelGroup);
        if (edgeIds) {
          const idKey = `${edgeIds.from}->${edgeIds.to}`;
          fallbackLabelsByEdge.set(idKey, parsedItems);
        }

        if (index < allDiagramEdges.length) {
          fallbackLabelsByEdge.set(allDiagramEdges[index], parsedItems);
          if (edgeIndexKeys.length > index) {
            edgeMetadataKeyByEdge.set(allDiagramEdges[index], edgeIndexKeys[index]);
          }
        }

        fallbackLabelsByEdge.set(index, parsedItems);
      });


      function registerEdgeEventListeners(edgeEl, clickTarget) {
        clickTarget.addEventListener('click', (event) => {
          event.stopPropagation();
          event.preventDefault();
          if (activeSelection && activeSelection.pathElement === edgeEl) {
            clearActiveSelection();
            clearAllPinnedEdgeTooltips();
            hideEdgeTooltip(true);
            return;
          } else {
            highlightEdge(edgeEl);
          }
          const { items, metadataKey } = getEdgeTooltipItems(edgeEl, allDiagramEdges, fallbackLabelsByEdge, edgeMetadataKeyByEdge);
          if (!items || items.length === 0) {
            clearAllPinnedEdgeTooltips();
            hideEdgeTooltip(true);
            return;
          }
          window.CROSSWAY_EDGE_TOOLTIP_PINNED = true;
          showEdgeTooltip(items, event, metadataKey);
        });
        clickTarget.addEventListener('mouseenter', (event) => {
          if (isAnyEdgeTooltipPinned()) {
            return;
          }
          const { items, metadataKey } = getEdgeTooltipItems(edgeEl, allDiagramEdges, fallbackLabelsByEdge, edgeMetadataKeyByEdge);
          showEdgeTooltip(items, event, metadataKey);
        });
        clickTarget.addEventListener('mousemove', (event) => {
          if (edgeTooltip.hidden || isAnyEdgeTooltipPinned()) {
            return;
          }
          positionEdgeTooltip(event.clientX, event.clientY);
        });
        clickTarget.addEventListener('mouseleave', (event) => {
          const related = event.relatedTarget;
          if (edgeTooltip && related && edgeTooltip.contains(related)) {
            return;
          }
          if (edgeTooltipDetail && related && edgeTooltipDetail.contains(related)) {
            return;
          }
          hideEdgeTooltip();
        });
      }

      allDiagramEdges.forEach((edgeEl) => {
        if (!isDiagramEdgeElement(edgeEl)) {
          return;
        }
        edgeEl.style.cursor = 'pointer';
        const clickTarget = createClickTargetForEdge(edgeEl);
        edgeEl.parentNode.insertBefore(clickTarget, edgeEl.nextSibling);
        registerEdgeEventListeners(edgeEl, clickTarget);
      });

      function resetNodeInteractionUi(event, { preventDefault = false } = {}) {
        if (event) {
          if (preventDefault) {
            event.preventDefault();
          }
          event.stopPropagation();
        }
        clearAllPinnedEdgeTooltips();
        hideEdgeTooltip(true);
        hideNodeContextMenu();
        if (pendingNodeClickTimer) {
          clearTimeout(pendingNodeClickTimer);
          pendingNodeClickTimer = null;
        }
      }

      if (edgeTooltip) {
        edgeTooltip.addEventListener('mouseleave', (event) => {
          const related = event.relatedTarget;
          if (edgeTooltipDetail && related && edgeTooltipDetail.contains(related)) {
            return;
          }
          hideEdgeTooltip();
        });
      }

      const allNodes = svg.querySelectorAll('.node'); 


      function registerNodeEventListeners(node) {
        node.addEventListener('mouseenter', (event) => {
          if (lockedNode) return;
          const nodeId = getNodeIdentity(node);
          if (!nodeId) return;
          const highlight = getHighlightSubgraph(nodeId, svg);
          fadeGraphExceptPath(highlight.nodes, svg, highlight.edges);
          if (isAnyEdgeTooltipPinned()) {
            return;
          }
          const nodeDetails = window.CROSSWAY_NODE_DETAILS?.[nodeId];
          if (nodeDetails && Object.keys(nodeDetails).length > 0) {
            showNodeTooltip(nodeDetails, event);
          } else {
            hideEdgeTooltip();
          }
        });
        node.addEventListener('mousemove', (event) => {
          if (edgeTooltip.hidden || isAnyEdgeTooltipPinned()) {
            return;
          }
          positionEdgeTooltip(event.clientX, event.clientY);
        });
        node.addEventListener('mouseleave', () => {
          if (lockedNode) return;
          resetGraphFade(svg);
          hideEdgeTooltip();
        });
        node.addEventListener('click', (event) => {
          resetNodeInteractionUi(event);
          const nodeId = getNodeIdentity(node);
          if (!nodeId) return;
          pendingNodeClickTimer = window.setTimeout(() => {
            pendingNodeClickTimer = null;
            if (lockedNode === nodeId) {
              lockedNode = null;
              resetGraphFade(svg);
              return;
            }
            lockedNode = nodeId;
            const highlight = getHighlightSubgraph(nodeId, svg);
            fadeGraphExceptPath(highlight.nodes, svg, highlight.edges);
          }, NODE_DOUBLE_CLICK_DELAY_MS);
        });
        node.addEventListener('dblclick', (event) => {
          resetNodeInteractionUi(event, { preventDefault: true });
          const nodeId = getNodeIdentity(node);
          if (!nodeId) return;
          if (openNodeFile(nodeId)) {
            setStatus('Opened file from node.');
          }
        });
      }

      allNodes.forEach(registerNodeEventListeners);

      attachNodeContextMenu({
        nodeContextMenu,
        allNodes,
        getNodeIdentity,
        openNodeFile,
        stage
      });


      svg.addEventListener('click', () => {
        if (window.CROSSWAY_IGNORE_NEXT_SVG_CLICK) {
          window.CROSSWAY_IGNORE_NEXT_SVG_CLICK = false;
          return;
        }

        clearAllPinnedEdgeTooltips();
        clearActiveSelection();
        lockedNode = null;
        resetGraphFade(svg);
        hideEdgeTooltip(true);

      });

      if (window.CROSSWAY_KEYDOWN_HANDLER) {
        document.removeEventListener('keydown', window.CROSSWAY_KEYDOWN_HANDLER);
      }
      const onKeyDown = (event) => {
        if (event.key !== 'Escape') {
          return;
        }

        const hadContextMenu = !nodeContextMenu.hidden;
        hideNodeContextMenu();

        const hadActiveEdgeSelection = Boolean(activeSelection);
        const hadLockedNode = Boolean(lockedNode);

        clearAllPinnedEdgeTooltips();
        clearActiveSelection();
        hideEdgeTooltip(true);

        if (hadLockedNode) {
          lockedNode = null;
          resetGraphFade(svg);
        }

        if (hadContextMenu || hadActiveEdgeSelection || hadLockedNode) {
          event.preventDefault();
          event.stopPropagation();
        }
      };
      window.CROSSWAY_KEYDOWN_HANDLER = onKeyDown;
      document.addEventListener('keydown', onKeyDown);
      computeAndInitDepthFilter(svg, { buildEdgeGraph, getDiagramEdgeElements, getEdgeIdentity, getEdgeLabelGroups, getNodeIdentity });
    }

    function createOrGetOverlayLayer(svg) {
      if (!svg) {
        return null;
      }

      let layer = svg.querySelector('#crosswayai-edge-overlay');
      if (!layer) {
        layer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        layer.setAttribute('id', 'crosswayai-edge-overlay');
        layer.style.pointerEvents = 'none';
        svg.appendChild(layer);
      } else if (layer.parentNode !== svg) {
        svg.appendChild(layer);
      }

      return layer;
    }

    async function InitializeDiagram(mermaidCode, markdownPath) {
      diagram.innerHTML = '';
      clearAllPinnedEdgeTooltips();
      hideEdgeTooltip(true);
      hideNodeContextMenu();
      clearSearchHighlights();
      const id = 'm' + Date.now();
      const result = await mermaid.render(id, mermaidCode);
      diagram.innerHTML = result.svg;

      // Post-process SVG: assign .node class to all <g> elements with a <text> child
      const svg = diagram.querySelector('svg');
      if (svg) {
        Array.from(svg.querySelectorAll('g')).forEach(g => {
          if (g.querySelector('text')) {
            g.classList.add('node');
          }
        });
      }

      activateDiagramSizing();
      // Set zoom to 1 (same as reset button)
      applyZoom(1, false);
      // Center the source node in the viewer if available
      // Use the svg variable already declared above
      if (svg && window.CROSSWAY_SOURCE_NODE) {
        // Find the node element by id, data-id, or class
        let nodeEl = null;
        // Try data-id
        nodeEl = svg.querySelector(`.node[data-id='${window.CROSSWAY_SOURCE_NODE}']`);
        // Try class
        if (!nodeEl) nodeEl = svg.querySelector(`.node.id-${window.CROSSWAY_SOURCE_NODE}`);
        // Try id pattern
        if (!nodeEl) nodeEl = svg.querySelector(`.node[id*='${window.CROSSWAY_SOURCE_NODE}']`);
        if (nodeEl) {
          // Get the bounding box of the node
          const nodeRect = nodeEl.getBoundingClientRect();
          const svgRect = svg.getBoundingClientRect();
          // Calculate node center relative to SVG
          const nodeCenterX = nodeRect.left + nodeRect.width / 2 - svgRect.left;
          const nodeCenterY = nodeRect.top + nodeRect.height / 2 - svgRect.top;
          // Calculate scroll to center node in stage
          const zoom = currentZoom || 1;
          const scrollX = nodeCenterX * zoom - stage.clientWidth / 2;
          const scrollY = nodeCenterY * zoom - stage.clientHeight / 2;
          stage.scrollLeft = Math.max(0, scrollX);
          stage.scrollTop = Math.max(0, scrollY);
        }
      } else if (isTableRelationsDiagram(markdownPath)) {
        centerStageScroll();
      }
      if (nodeSearchInput.value.trim()) {
        applySearchHighlights(nodeSearchInput.value.trim());
      }
      setStatus('Rendered. Use controls to navigate.');
    }

    async function renderDiagram(code, markdownPath = mermaidMarkdownFilePath) {
      const entityRelations = window.CrosswayEntityRelations || {};
      const normalizeErKeySyntax = typeof entityRelations.normalizeErKeySyntax === 'function'
        ? entityRelations.normalizeErKeySyntax
        : (text) => text;
      const organizeErDiagram = typeof entityRelations.organizeErDiagram === 'function'
        ? entityRelations.organizeErDiagram
        : (text) => text;
      const mermaidCode = organizeErDiagram(normalizeErKeySyntax(code)).trim();
      window.CROSSWAY_IS_PACKAGE_DIAGRAM = isPackageDiagram(code, markdownPath);
      window.CROSSWAY_PARENT_MAP = {};
      window.CROSSWAY_SOURCE_NODE = null;
      window.CROSSWAY_EDGE_DETAILS = {};
      window.CROSSWAY_EDGE_METHOD_SIGS = {};
      window.CROSSWAY_EDGE_INDEX_KEYS = [];
      window.CROSSWAY_GLOBAL_METHOD_SIGS = {};
      window.CROSSWAY_NODE_DETAILS = {};
      window.CROSSWAY_FILE_MAP = {};

      const sourceNodeMatch = (code || '').match(/^\s*%%CROSSWAY_SOURCE_NODE:(.*)$/m);
      if (sourceNodeMatch) {
        window.CROSSWAY_SOURCE_NODE = sourceNodeMatch[1].trim() || null;
      }
      const parentMapMatch = (code || '').match(/^\s*%%CROSSWAY_PARENT_MAP:(.*)$/m);
      if (parentMapMatch) {
        try {
          window.CROSSWAY_PARENT_MAP = JSON.parse(parentMapMatch[1]);
        } catch {
          window.CROSSWAY_PARENT_MAP = {};
        }
      }
      const edgeDetailsMatch = (code || '').match(/^\s*%%CROSSWAY_EDGE_DETAILS:(.*)$/m);
      if (edgeDetailsMatch) {
        try {
          window.CROSSWAY_EDGE_DETAILS = JSON.parse(edgeDetailsMatch[1]);
        } catch {
          window.CROSSWAY_EDGE_DETAILS = {};
        }
      }

      const edgeMethodSigMatch = (code || '').match(/^\s*%%CROSSWAY_EDGE_METHOD_SIGS:(.*)$/m);
      const edgeIndexKeysMatch = (code || '').match(/^\s*%%CROSSWAY_EDGE_INDEX_KEYS:(.*)$/m);
      const globalMethodSigMatch = (code || '').match(/^\s*%%CROSSWAY_GLOBAL_METHOD_SIGS:(.*)$/m);
      if (edgeMethodSigMatch) {
        try {
          window.CROSSWAY_EDGE_METHOD_SIGS = JSON.parse(edgeMethodSigMatch[1]);
        } catch {
          window.CROSSWAY_EDGE_METHOD_SIGS = {};
        }
      }
      
      if (edgeIndexKeysMatch) {
        try {
          window.CROSSWAY_EDGE_INDEX_KEYS = JSON.parse(edgeIndexKeysMatch[1]);
        } catch {
          window.CROSSWAY_EDGE_INDEX_KEYS = [];
        }
      }

      if (globalMethodSigMatch) {
        try {
          window.CROSSWAY_GLOBAL_METHOD_SIGS = JSON.parse(globalMethodSigMatch[1]);
        } catch {
          window.CROSSWAY_GLOBAL_METHOD_SIGS = {};
        }
      }

      const nodeDetailsMatch = (code || '').match(/^\s*%%CROSSWAY_NODE_DETAILS:(.*)$/m);
      if (nodeDetailsMatch) {
        try {
          window.CROSSWAY_NODE_DETAILS = JSON.parse(nodeDetailsMatch[1]);
        } catch {
          window.CROSSWAY_NODE_DETAILS = {};
        }
      }

      const fileMapMatch = (code || '').match(/^\s*%%CROSSWAY_FILE_MAP:(.*)$/m);
      if (fileMapMatch) {
        try {
          window.CROSSWAY_FILE_MAP = JSON.parse(fileMapMatch[1]);
        } catch {
          window.CROSSWAY_FILE_MAP = {};
        }
      }

      if (!mermaidCode) {
        diagram.innerHTML = '';
        updateLegend('', markdownPath);
        setStatus('No Mermaid content to render.', true);
        return;
      }

      updateLegend(mermaidCode, markdownPath);

      setStatus('Rendering...');

      try {
        await InitializeDiagram(mermaidCode, markdownPath);
      } catch (err) {
        setStatus('Render failed: ' + (err && err.message ? err.message : String(err)), true);
      }
    }

    function extractMermaidBlocks(markdownText) {
      const blocks = [];
      const regex = /```[ \t]*mermaid(?:[ \t]+[^\r\n]*)?[ \t]*\r?\n([\s\S]*?)```/gi;
      let match;
      while ((match = regex.exec(markdownText)) !== null) {
        const block = (match[1] || '').trim();
        if (block) {
          blocks.push(block);
        }
      }

      if (!blocks.length) {
        const fallback = (markdownText || '').trim();
        if (/^(?:graph|flowchart|sequenceDiagram|classDiagram|stateDiagram|erDiagram|journey|gantt|pie|mindmap|timeline|gitGraph|quadrantChart|xychart-beta)\b/i.test(fallback)) {
          blocks.push(fallback);
        }
      }

      return blocks;
    }

    function buildMarkdownRequestUrl(markdownPath) {
      const trimmed = (markdownPath || '').trim();
      if (!trimmed) {
        return '';
      }

      if (/^https?:\/\//i.test(trimmed)) {
        return trimmed;
      }

      const normalized = trimmed
        .replace(/\\/g, '/')
        .replace(/^\/+/, '');

      const encodedPath = normalized
        .split('/')
        .map(segment => encodeURIComponent(segment))
        .join('/');

      return `${window.location.origin}/${encodedPath}`;
    }

    async function loadFromMarkdown(path) {
      const markdownPath = (path || '').trim();
      if (!markdownPath) {
        setStatus('No markdown file path provided.', true);
        return;
      }

      const requestUrl = buildMarkdownRequestUrl(markdownPath);
      setStatus('Loading markdown...');

      try {
        let response;
        try {
          response = await fetch(requestUrl, { cache: 'no-store' });
        } catch (_) {
          const retryUrl = `${requestUrl}${requestUrl.includes('?') ? '&' : '?'}_ts=${Date.now()}`;
          response = await fetch(retryUrl, { cache: 'no-store' });
        }

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        const markdown = await response.text();

        const blocks = extractMermaidBlocks(markdown);
        if (!blocks.length) {
          setStatus('No Mermaid blocks found in markdown.', true);
          return;
        }

        await renderDiagram(blocks[0], markdownPath);
        setStatus(`Loaded Mermaid from ${markdownPath}.`);
      } catch (err) {
        setStatus('Markdown load failed: ' + (err && err.message ? err.message : String(err)), true);
      }
    }

    attachExportHandlers();
    attachZoomControls();
    attachPanHandlers();

    // Depth Filter: Slider Event Listener 
    depthSliderEl.addEventListener('input', () => {
      const val = parseInt(depthSliderEl.value, 10);
      updateDepthBubble(val, false); // animate bubble smoothly to the new thumb position
      applyDepthFilter(val);
    });
    depthSliderEl.addEventListener('mousedown', (event) => event.stopPropagation());

    loadDiagramColors().then(() => loadFromMarkdown(mermaidMarkdownFilePath));
