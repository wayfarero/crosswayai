// Edge tooltip rendering, positioning, and pin-state management.
// Loaded before nodeTooltip.js and crosswayaiViewer.js.

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

  tooltipList.innerHTML = `<ul>${renderedItems}</ul>`;
  tooltipList.hidden = false;
  positionEdgeTooltip(event.clientX, event.clientY);
  clearPinnedEdgeDetail();
  hideEdgeTooltipDetail();

  if (edgeTooltipDetail) {
    const tooltipRows = tooltipList.querySelectorAll('li');
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
        tooltipList.querySelectorAll('.method-item.active-method').forEach((item) => {
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
