// Helper to resolve and open the target node from metadataKey
function handleEdgeTooltipDoubleClick(metadataKey, targetName, signature, targetType) {
  let targetNodeId = null;
  if (typeof metadataKey === 'string' && metadataKey.includes('->')) {
    targetNodeId = metadataKey.split('->')[1];
  }
  if (targetNodeId && typeof window.openNodeFile === 'function') {
    window.openNodeFile(targetNodeId, targetType, targetName, signature);
  } else {
    console.log('Could not resolve target nodeId for openNodeFile:', { target: targetName, signature: signature, metadataKey });
  }
}
// Edge tooltip rendering, positioning, and pin-state management.

const tooltipList = document.getElementById('edgeTooltip');
const edgeTooltipDetail = document.getElementById('edgeTooltipDetail');

function escapeHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function isEdgeTooltipPinned() {
  return Boolean(window.CROSSWAY_EDGE_TOOLTIP_PINNED || window.CROSSWAY_EDGE_DETAIL_TOOLTIP_PINNED);
}

function isAnyTooltipPinned() {
  return isEdgeTooltipPinned() || Boolean(window.CROSSWAY_NODE_TOOLTIP_PINNED);
}

function clearPinnedEdgeDetail() {
  window.CROSSWAY_EDGE_DETAIL_TOOLTIP_PINNED = false;
  window.CROSSWAY_EDGE_DETAIL_PINNED_KEY = null;
}

function clearAllPinnedEdgeTooltips() {
  window.CROSSWAY_EDGE_TOOLTIP_PINNED = false;
  clearPinnedEdgeDetail();
  window.CROSSWAY_NODE_TOOLTIP_PINNED = false;
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
  if (!force && isEdgeTooltipPinned()) {
    return;
  }
  clearPinnedEdgeDetail();
  tooltipList.hidden = true;
  tooltipList.innerHTML = '';
  hideEdgeTooltipDetail();
}

function positionEdgeTooltip(clientX, clientY) {
  if (tooltipList.hidden) {
    return;
  }

  const offset = 12;
  let left = clientX + offset;
  let top = clientY + offset;
  const rect = tooltipList.getBoundingClientRect();

  if (left + rect.width > window.innerWidth - 8) {
    left = Math.max(8, clientX - rect.width - offset);
  }
  if (top + rect.height > window.innerHeight - 8) {
    top = Math.max(8, clientY - rect.height - offset);
  }

  tooltipList.style.left = `${left}px`;
  tooltipList.style.top = `${top}px`;
}

function getEdgeTooltipSection(itemText) {
  const text = String(itemText || '').trim();
  const lower = text.toLowerCase();

  if (/\(invoke\)\s*$/i.test(text) || lower === 'invoke' || lower.startsWith('invoke:')) {
    return 'invoke';
  }

  if (/\(run\)\s*$/i.test(text) || lower === 'run' || lower.startsWith('run:')) {
    return 'run';
  }

  if (
    /\((property|public-property|inherited-property)\)\s*$/i.test(text)
    || lower === 'property'
    || lower === 'public-property'
    || lower === 'inherited-property'
    || lower.startsWith('property:')
    || lower.startsWith('public-property:')
    || lower.startsWith('inherited-property:')
  ) {
    return 'property';
  }

  return 'other';
}

function getEdgeTooltipDisplayText(itemText) {
  const text = String(itemText || '').trim();
  return text
    .replace(/\s*\(invoke\)\s*$/i, '')
    .replace(/\s*\(run\)\s*$/i, '')
    .replace(/\s*\((property|public-property|inherited-property)\)\s*$/i, '')
    .trim();
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
        .map(entry => entry.params);
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
      const methodKey = item
        .replace(/\s*\((invoke|run)\)\s*$/i, '')
        .replace(/\s*\((property|public-property|inherited-property)\)\s*$/i, '')
        .trim();
      const displayItem = isParams ? item : getEdgeTooltipDisplayText(item);
      const signatures = getMethodSignatures(methodKey);
      const isCall = /\((invoke|run)\)\s*$/i.test(item) || signatures.length > 0;
      // Only assign method-item class if this is a method (not property or run)
      let cls = '';
      if (isParams) {
        cls = ' class="param-line"';
      } else if (getEdgeTooltipSection(item) === 'invoke' || getEdgeTooltipSection(item) === 'run' || getEdgeTooltipSection(item) === 'method') {
        cls = ' class="method-item"';
      }
      const sigAttr = isParams
        ? ''
        : ` data-signature="${escapeHtml(signatures.join('|||'))}" data-method="${escapeHtml(methodKey)}" data-is-call="${isCall ? 'true' : 'false'}"`;
      // Add data-original attribute for later type detection
      const section = getEdgeTooltipSection(item);
      return {
        section,
        html: `<li${cls}${sigAttr} data-original="${escapeHtml(item)}" data-section="${section}">${escapeHtml(displayItem)}</li>`
      };
    })
    .filter((entry) => entry && entry.html);

  if (renderedItems.length === 0) {
    hideEdgeTooltip();
    return;
  }

  const sectionOrder = ['invoke', 'run', 'property'];
  const sectionTitleByKey = {
    invoke: 'Invoke',
    run: 'Run',
    property: 'Property'
  };

  const renderedSections = sectionOrder
    .map((sectionKey) => {
      const sectionItems = renderedItems
        .filter((entry) => entry.section === sectionKey)
        .map((entry) => entry.html)
        .join('');

      if (!sectionItems) {
        return '';
      }

      const title = sectionTitleByKey[sectionKey] || 'Links';
      return `<div class="edge-tooltip-section edge-tooltip-section-${sectionKey}"><div class="tooltip-section-title">${escapeHtml(title)}</div><ul>${sectionItems}</ul></div>`;
    })
    .join('');

  if (!renderedSections) {
    hideEdgeTooltip();
    return;
  }

  tooltipList.innerHTML = renderedSections;
  tooltipList.hidden = false;
  positionEdgeTooltip(event.clientX, event.clientY);
  clearPinnedEdgeDetail();
  hideEdgeTooltipDetail();

  if (edgeTooltipDetail) {
    const tooltipRows = tooltipList.querySelectorAll('li');
    tooltipRows.forEach((li) => {
      const isMethodRow = li.classList.contains('method-item');
      const renderDetailTooltip = () => {
        const callItemName = li.getAttribute('data-method') || '';
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
          .map(entry => `<li class="signature-item">${escapeHtml(entry)}</li>`)
          .join('');
        const signatureListHtml = signatureItems ? `<ul>${signatureItems}</ul>` : '';
        edgeTooltipDetail.innerHTML = `<div class="detail-title">${escapeHtml(callItemName)}</div>${signatureListHtml}`;
        edgeTooltipDetail.hidden = false;
        const tooltipRect = tooltipList.getBoundingClientRect();
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

        // Add double-click handler to detail title
        const detailTitle = edgeTooltipDetail.querySelector('.detail-title');
        const detailSection = li.getAttribute('data-section') || getEdgeTooltipSection(li.getAttribute('data-original') || callItemName);
        const detailTargetType = detailSection === 'run' ? 'procedure' : 'method';
        if (detailTitle) {
          detailTitle.addEventListener('dblclick', (event) => {
            event.preventDefault();
            event.stopPropagation();
            handleEdgeTooltipDoubleClick(metadataKey, callItemName, '', detailTargetType);
          });
        }

        // Add double-click handler to detail signature <li> elements
        const signatureLis = edgeTooltipDetail.querySelectorAll('li.signature-item');
        signatureLis.forEach((sigLi, idx) => {
          sigLi.addEventListener('dblclick', (event) => {
            event.preventDefault();
            event.stopPropagation();
            // Pass the specific signature if available
            let sig = '';
            if (entries[idx]) {
              sig = entries[idx].replace(/^\(|\)$/g, '').trim(); // Remove surrounding parens
            }
            const signatureForOpen = detailTargetType === 'procedure' ? '' : sig;
            handleEdgeTooltipDoubleClick(metadataKey, callItemName, signatureForOpen, detailTargetType);
          });
        });
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
        const detailKey = getDetailKey();
        if (window.CROSSWAY_EDGE_DETAIL_TOOLTIP_PINNED && window.CROSSWAY_EDGE_DETAIL_PINNED_KEY && window.CROSSWAY_EDGE_DETAIL_PINNED_KEY !== detailKey) {
          return;
        }
        renderDetailTooltip();
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
        const detailKey = getDetailKey();
        const isAlreadyPinned = window.CROSSWAY_EDGE_DETAIL_TOOLTIP_PINNED && window.CROSSWAY_EDGE_DETAIL_PINNED_KEY === detailKey;
        if (isAlreadyPinned) {
          clearPinnedEdgeDetail();
          li.classList.remove('active-method');
          hideEdgeTooltipDetail();
          return;
        }
        tooltipList.querySelectorAll('.method-item.active-method').forEach((item) => {
          item.classList.remove('active-method');
        });
        li.classList.add('active-method');
        pinEdgeDetail(detailKey);
        renderDetailTooltip();
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

      // Double-click event to resolve the target node of the edge
      li.addEventListener('dblclick', (event) => {
        event.preventDefault();
        event.stopPropagation();
        let targetName = li.getAttribute('data-method') || '';
        const signatureRaw = li.getAttribute('data-signature') || '';
        const originalText = li.getAttribute('data-original') || li.textContent || targetName;
        const section = li.getAttribute('data-section') || getEdgeTooltipSection(originalText);
        let targetType;
        if (section === 'invoke') {
          targetType = 'method';
        } else if (section === 'run') {
          targetType = 'procedure';
        } else if (section === 'property') {
          targetType = 'property';
          targetName = getEdgeTooltipDisplayText(originalText);
        } else {
          targetType = section;
        }
        handleEdgeTooltipDoubleClick(metadataKey, targetName, '', targetType);
      });
    });
  }
}
