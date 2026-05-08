    // Edge and node tooltip rendering, positioning, and pin-state management.
    // Loaded before crosswayaiViewer.js; all declarations are shared in the global
    // script scope and used by both files.

    const edgeTooltip = document.getElementById('edgeTooltip');
    const edgeTooltipDetail = document.getElementById('edgeTooltipDetail');

    function escapeHtml(text) {
      return String(text || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    function isAnyEdgeTooltipPinned() {
      return Boolean(window.CROSSWAY_EDGE_TOOLTIP_PINNED || window.CROSSWAY_EDGE_DETAIL_TOOLTIP_PINNED);
    }

    function clearPinnedEdgeDetail() {
      window.CROSSWAY_EDGE_DETAIL_TOOLTIP_PINNED = false;
      window.CROSSWAY_EDGE_DETAIL_PINNED_KEY = null;
    }

    function clearAllPinnedEdgeTooltips() {
      window.CROSSWAY_EDGE_TOOLTIP_PINNED = false;
      clearPinnedEdgeDetail();
    }

    function pinEdgeDetail(detailKey) {
      window.CROSSWAY_EDGE_TOOLTIP_PINNED = true;
      window.CROSSWAY_EDGE_DETAIL_TOOLTIP_PINNED = true;
      window.CROSSWAY_EDGE_DETAIL_PINNED_KEY = detailKey;
    }

    function hideEdgeTooltipDetail() {
      if (!edgeTooltipDetail) {
        return;
      }
      edgeTooltipDetail.hidden = true;
      edgeTooltipDetail.innerHTML = '';
    }

    function hideEdgeTooltip(force = false) {
      const isNodeTooltip = edgeTooltip.classList.contains('node-tooltip');
      if (!force && isAnyEdgeTooltipPinned() && !isNodeTooltip) {
        return;
      }
      clearPinnedEdgeDetail();
      edgeTooltip.classList.remove('node-tooltip');
      edgeTooltip.hidden = true;
      edgeTooltip.innerHTML = '';
      hideEdgeTooltipDetail();
    }

    function positionEdgeTooltip(clientX, clientY) {
      if (edgeTooltip.hidden || edgeTooltip.classList.contains('node-tooltip')) {
        return;
      }

      const offset = 12;
      let left = clientX + offset;
      let top = clientY + offset;
      const rect = edgeTooltip.getBoundingClientRect();

      if (left + rect.width > window.innerWidth - 8) {
        left = Math.max(8, clientX - rect.width - offset);
      }
      if (top + rect.height > window.innerHeight - 8) {
        top = Math.max(8, clientY - rect.height - offset);
      }

      edgeTooltip.style.left = `${left}px`;
      edgeTooltip.style.top = `${top}px`;
    }

    function positionNodeTooltip(anchorElement) {
      if (edgeTooltip.hidden || !anchorElement || !anchorElement.getBoundingClientRect) {
        return;
      }

      const offset = 12;
      const anchorRect = anchorElement.getBoundingClientRect();
      const tooltipRect = edgeTooltip.getBoundingClientRect();
      let left = anchorRect.right + offset - 5;
      let top = anchorRect.bottom + offset - 10;

      if (left + tooltipRect.width > window.innerWidth - 8) {
        left = Math.max(8, anchorRect.right - tooltipRect.width);
      }
      if (top + tooltipRect.height > window.innerHeight - 8) {
        top = Math.max(8, anchorRect.bottom - tooltipRect.height - 10);
      }

      edgeTooltip.style.left = `${left}px`;
      edgeTooltip.style.top = `${top}px`;
    }

    function showEdgeTooltip(items, event, metadataKey = null) {
      if (!items || items.length === 0) {
        hideEdgeTooltip();
        return;
      }

      const methodSigsRaw = metadataKey ? (window.CROSSWAY_EDGE_METHOD_SIGS?.[metadataKey] || null) : null;
      const globalMethodSigsRaw = window.CROSSWAY_GLOBAL_METHOD_SIGS || null;
      const getMethodSignatures = (methodName) => {
        if (!methodSigsRaw) {
          if (globalMethodSigsRaw && globalMethodSigsRaw[methodName]) {
            const globalEntry = globalMethodSigsRaw[methodName];
            return Array.isArray(globalEntry) ? globalEntry.slice() : (globalEntry ? [globalEntry] : ['']);
          }
          return [];
        }
        if (Array.isArray(methodSigsRaw)) {
          return methodSigsRaw
            .filter(entry => entry && entry.name === methodName)
            .map(entry => entry.params)
            ;
        }
        if (typeof methodSigsRaw === 'object') {
          const entry = methodSigsRaw[methodName];
          if (Array.isArray(entry)) {
            return entry.slice();
          }
          if (entry) {
            return [entry];
          }
        }
        if (globalMethodSigsRaw && globalMethodSigsRaw[methodName]) {
          const globalEntry = globalMethodSigsRaw[methodName];
          return Array.isArray(globalEntry) ? globalEntry.slice() : (globalEntry ? [globalEntry] : ['']);
        }
        return [];
      };
      const renderedItems = items
        .map((item) => String(item || '').trim())
        .filter(Boolean)
        .map((item) => {
          const isParams = /^params\s*:/i.test(item);
          const methodKey = item.replace(/\s*\((invoke|run)\)\s*/i, '').trim();
          const signatures = getMethodSignatures(methodKey);
          const isCall = /\((invoke|run)\)\s*$/i.test(item) || signatures.length > 0;
          const cls = isParams ? ' class="param-line"' : ' class="method-item"';
          const sigAttr = isParams
            ? ''
            : ` data-signature="${escapeHtml(signatures.join('|||'))}" data-method="${escapeHtml(methodKey)}" data-is-call="${isCall ? 'true' : 'false'}"`;
          return `<li${cls}${sigAttr}>${escapeHtml(item)}</li>`;
        })
        .join('');

      if (!renderedItems) {
        hideEdgeTooltip();
        return;
      }

      edgeTooltip.innerHTML = `<ul>${renderedItems}</ul>`;
      edgeTooltip.classList.remove('node-tooltip');
      edgeTooltip.hidden = false;
      positionEdgeTooltip(event.clientX, event.clientY);
      clearPinnedEdgeDetail();
      hideEdgeTooltipDetail();

      if (edgeTooltipDetail) {
        const tooltipRows = edgeTooltip.querySelectorAll('li');
          tooltipRows.forEach((li) => {
            const isMethodRow = li.classList.contains('method-item');
            const renderMethodDetail = () => {
              const methodName = li.getAttribute('data-method') || '';
              const signatureRaw = li.getAttribute('data-signature') || '';
              const signatureList = signatureRaw.split('|||').map(item => item.trim());
              const normalizedSignatures = signatureList.map(signature => signature.trim());
              const hasNonEmpty = normalizedSignatures.some(signature => signature);
              const hasEmpty = normalizedSignatures.some(signature => !signature);
              const entries = [];
              if (!signatureRaw) {
                entries.push('( )');
              }
              if (hasEmpty && hasNonEmpty) {
                entries.push('( )');
              }
              normalizedSignatures
                .filter(signature => signature)
                .forEach(signature => {
                  entries.push(`(${signature})`);
                });
              const signatureItems = entries
                .map(entry => `<li>${escapeHtml(entry)}</li>`)
                .join('');
              const signatureListHtml = signatureItems ? `<ul>${signatureItems}</ul>` : '';
              edgeTooltipDetail.innerHTML = `<div class="detail-title">${escapeHtml(methodName)}</div>${signatureListHtml}`;
              edgeTooltipDetail.hidden = false;
              const tooltipRect = edgeTooltip.getBoundingClientRect();
              const liRect = li.getBoundingClientRect();
              let left = tooltipRect.right + 8;
              let top = liRect.top - 4;
              edgeTooltipDetail.style.left = `${left}px`;
              edgeTooltipDetail.style.top = `${top}px`;
              const detailRect = edgeTooltipDetail.getBoundingClientRect();
              if (detailRect.right > window.innerWidth - 8) {
                left = tooltipRect.left - detailRect.width - 8;
                edgeTooltipDetail.style.left = `${left}px`;
              }
            };

            const getDetailKey = () => {
              const methodName = li.getAttribute('data-method') || '';
              const signatureRaw = li.getAttribute('data-signature') || '';
              return `${methodName}::${signatureRaw}`;
            };

            const isPinnedDetailRow = () => {
              return window.CROSSWAY_EDGE_DETAIL_TOOLTIP_PINNED
                && window.CROSSWAY_EDGE_DETAIL_PINNED_KEY
                && window.CROSSWAY_EDGE_DETAIL_PINNED_KEY === getDetailKey();
            };

            li.addEventListener('mouseenter', () => {
              if (isMethodRow && window.CROSSWAY_EDGE_DETAIL_TOOLTIP_PINNED && !isPinnedDetailRow()) {
                return;
              }
              li.classList.add('active-method');
              if (!isMethodRow) {
                return;
              }
              const isCall = li.getAttribute('data-is-call') === 'true';
              if (!isCall) {
                if (!window.CROSSWAY_EDGE_DETAIL_TOOLTIP_PINNED) {
                  hideEdgeTooltipDetail();
                }
                return;
              }
              const signatureRaw = li.getAttribute('data-signature') || '';
              const methodName = li.getAttribute('data-method') || '';
              const detailKey = `${methodName}::${signatureRaw}`;
              if (window.CROSSWAY_EDGE_DETAIL_TOOLTIP_PINNED && window.CROSSWAY_EDGE_DETAIL_PINNED_KEY && window.CROSSWAY_EDGE_DETAIL_PINNED_KEY !== detailKey) {
                return;
              }
              renderMethodDetail();
            });
            li.addEventListener('click', (event) => {
              if (!isMethodRow) {
                return;
              }
              const isCall = li.getAttribute('data-is-call') === 'true';
              if (!isCall) {
                return;
              }
              event.preventDefault();
              event.stopPropagation();
              const signatureRaw = li.getAttribute('data-signature') || '';
              const methodName = li.getAttribute('data-method') || '';
              const detailKey = `${methodName}::${signatureRaw}`;
              const isAlreadyPinned = window.CROSSWAY_EDGE_DETAIL_TOOLTIP_PINNED && window.CROSSWAY_EDGE_DETAIL_PINNED_KEY === detailKey;
              if (isAlreadyPinned) {
                clearPinnedEdgeDetail();
                li.classList.remove('active-method');
                hideEdgeTooltipDetail();
                return;
              }
              edgeTooltip.querySelectorAll('.method-item.active-method').forEach((item) => {
                item.classList.remove('active-method');
              });
              li.classList.add('active-method');
              pinEdgeDetail(detailKey);
              renderMethodDetail();
          });
            li.addEventListener('mouseleave', (event) => {
              if (isMethodRow && (window.CROSSWAY_EDGE_DETAIL_TOOLTIP_PINNED || isPinnedDetailRow())) {
                return;
              }
              const related = event.relatedTarget;
              if (edgeTooltipDetail && related && edgeTooltipDetail.contains(related)) {
                return;
              }
              li.classList.remove('active-method');
              if (!isMethodRow) {
                return;
              }
              hideEdgeTooltipDetail();
            });
          });
      }
    }

    function showNodeTooltip(itemsByDatabase, event) {
      if (!itemsByDatabase || typeof itemsByDatabase !== 'object') {
        hideEdgeTooltip();
        return;
      }

      const renderedGroups = Object.entries(itemsByDatabase)
        .map(([databaseName, items]) => {
          const renderedItems = (Array.isArray(items) ? items : [])
            .map((item) => String(item || '').trim())
            .filter(Boolean)
            .map((item) => `<li>${escapeHtml(item)}</li>`)
            .join('');

          if (!renderedItems) {
            return '';
          }

          return `
            <div class="db-group">
              <div class="db-name">${escapeHtml(databaseName)}</div>
              <ul>${renderedItems}</ul>
            </div>
          `;
        })
        .filter(Boolean)
        .join('');

      if (!renderedGroups) {
        hideEdgeTooltip();
        return;
      }

      edgeTooltip.innerHTML = `<div class="tooltip-title">DB access</div>${renderedGroups}`;
      edgeTooltip.classList.add('node-tooltip');
      edgeTooltip.hidden = false;
      positionNodeTooltip(event.currentTarget);
    }
