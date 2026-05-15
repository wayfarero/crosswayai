// Node tooltip rendering and positioning.
// Depends on globals from edgeTooltip.js (escapeHtml).

const nodeTooltipList = document.getElementById('nodeTooltip');
window.CROSSWAY_NODE_TOOLTIP_ANCHOR = null;

function isNodeTooltipPinned() {
  return Boolean(window.CROSSWAY_NODE_TOOLTIP_PINNED);
}

function clearPinnedNodeTooltip() {
  window.CROSSWAY_NODE_TOOLTIP_PINNED = false;
}

function hideNodeTooltip(force = false) {
  if (!force && isNodeTooltipPinned()) {
    return;
  }
  nodeTooltipList.hidden = true;
  nodeTooltipList.innerHTML = '';
  window.CROSSWAY_NODE_TOOLTIP_ANCHOR = null;
}

function positionNodeTooltip(anchorElement) {
  if (nodeTooltipList.hidden || !anchorElement || !anchorElement.getBoundingClientRect) {
    return;
  }

  window.CROSSWAY_NODE_TOOLTIP_ANCHOR = anchorElement;

  const offset = 12;
  const anchorRect = anchorElement.getBoundingClientRect();
  const tooltipRect = nodeTooltipList.getBoundingClientRect();
  let left = anchorRect.right + offset - 5;
  let top = anchorRect.bottom + offset - 10;

  if (left + tooltipRect.width > window.innerWidth - 8) {
    left = Math.max(8, anchorRect.right - tooltipRect.width);
  }
  if (top + tooltipRect.height > window.innerHeight - 8) {
    top = Math.max(8, anchorRect.bottom - tooltipRect.height - 10);
  }

  nodeTooltipList.style.left = `${left}px`;
  nodeTooltipList.style.top = `${top}px`;
}

function showNodeTooltip(itemsByDatabase, event) {
  if (!itemsByDatabase || typeof itemsByDatabase !== 'object') {
    hideNodeTooltip();
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
    hideNodeTooltip();
    return;
  }

  nodeTooltipList.innerHTML = `<div class="tooltip-title">DB access</div>${renderedGroups}`;
  nodeTooltipList.hidden = false;
  window.CROSSWAY_NODE_TOOLTIP_ANCHOR = event.currentTarget || null;
  positionNodeTooltip(event.currentTarget);
  refreshNodeSummaryAnchors();
}
