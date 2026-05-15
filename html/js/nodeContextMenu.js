    const FILE_ICON_SVG = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 1h7l4 4v10H3V1z" stroke="#9ca3af" stroke-width="1.2" fill="none"/><path d="M10 1v4h4" stroke="#9ca3af" stroke-width="1.2" fill="none"/></svg>';
    const XREF_ICON_SVG = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2.5 2.5h6l3 3v8h-9v-11z" stroke="#9ca3af" stroke-width="1.2" fill="none"/><path d="M8.5 2.5v3h3" stroke="#9ca3af" stroke-width="1.2" fill="none"/><path d="M5 8h4M5 10.5h6" stroke="#9ca3af" stroke-width="1.2" stroke-linecap="round"/></svg>';

    let hideNodeContextMenu = () => {};

    function attachNodeContextMenu({ nodeContextMenu, allNodes, getNodeIdentity, openNodeFile, openNodeXrefFile, stage, onBeforeShow }) {
      hideNodeContextMenu = function () {
        nodeContextMenu.hidden = true;
        nodeContextMenu.innerHTML = '';
      };

      function createMenuItem({ label, iconSvg, enabled, onClick }) {
        const item = document.createElement('div');
        item.className = 'ctx-item';
        item.innerHTML = `<span class="ctx-icon">${iconSvg}</span><span>${label}</span>`;

        if (enabled) {
          item.addEventListener('click', () => {
            hideNodeContextMenu();
            onClick();
          });
        } else {
          item.style.opacity = '0.4';
          item.style.cursor = 'default';
        }

        return item;
      }

      function showNodeContextMenu(nodeId, event) {
        const filePath = (window.CROSSWAY_FILE_MAP || {})[nodeId];

        nodeContextMenu.innerHTML = '';

        function applyMenuPosition(left, top) {
          nodeContextMenu.style.left = `${left}px`;
          nodeContextMenu.style.top = `${top}px`;
        }

        const menuActions = [
          {
            label: 'Open File',
            iconSvg: FILE_ICON_SVG,
            enabled: Boolean(filePath),
            onClick: () => openNodeFile(nodeId)
          },
          {
            label: 'Open XREF File',
            iconSvg: XREF_ICON_SVG,
            enabled: Boolean(filePath && openNodeXrefFile),
            onClick: () => openNodeXrefFile(nodeId)
          }
        ];

        menuActions.forEach((action) => {
          nodeContextMenu.appendChild(createMenuItem(action));
        });

        const offset = 2;
        let left = event.clientX + offset;
        let top = event.clientY + offset;
        nodeContextMenu.hidden = false;
        nodeContextMenu.style.visibility = 'hidden';

        requestAnimationFrame(() => {
          const rect = nodeContextMenu.getBoundingClientRect();
          if (left + rect.width > window.innerWidth - 8) {
            left = Math.max(8, event.clientX - rect.width);
          }
          if (top + rect.height > window.innerHeight - 8) {
            top = Math.max(8, event.clientY - rect.height);
          }
          applyMenuPosition(left, top);
          nodeContextMenu.style.visibility = '';
        });
      }

      allNodes.forEach((node) => {
        node.addEventListener('contextmenu', (event) => {
          event.preventDefault();
          event.stopPropagation();
          const nodeId = getNodeIdentity(node);
          if (!nodeId) return;
          if (typeof onBeforeShow === 'function') {
            onBeforeShow({ nodeId, event, node });
          }
          showNodeContextMenu(nodeId, event);
        });
      });

      document.addEventListener('click', (event) => {
        if (!nodeContextMenu.hidden && !nodeContextMenu.contains(event.target)) {
          hideNodeContextMenu();
        }
      }, true);

      stage.addEventListener('scroll', () => {
        if (!nodeContextMenu.hidden) {
          hideNodeContextMenu();
        }
      });

    }
