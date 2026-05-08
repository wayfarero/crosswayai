    let hideNodeContextMenu = () => {};

    function attachNodeContextMenu({ nodeContextMenu, allNodes, getNodeIdentity, openNodeFile, stage }) {
      hideNodeContextMenu = function () {
        nodeContextMenu.hidden = true;
        nodeContextMenu.innerHTML = '';
      };

      function showNodeContextMenu(nodeId, event) {
        const filePath = (window.CROSSWAY_FILE_MAP || {})[nodeId];

        nodeContextMenu.innerHTML = '';

        const openFileItem = document.createElement('div');
        openFileItem.className = 'ctx-item';
        openFileItem.innerHTML = `<span class="ctx-icon"><svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 1h7l4 4v10H3V1z" stroke="#9ca3af" stroke-width="1.2" fill="none"/><path d="M10 1v4h4" stroke="#9ca3af" stroke-width="1.2" fill="none"/></svg></span><span>Open File</span>`;

        if (filePath) {
          openFileItem.addEventListener('click', () => {
            hideNodeContextMenu();
            openNodeFile(nodeId);
          });
        } else {
          openFileItem.style.opacity = '0.4';
          openFileItem.style.cursor = 'default';
        }

        nodeContextMenu.appendChild(openFileItem);

        const offset = 2;
        let left = event.clientX + offset;
        let top = event.clientY + offset;
        nodeContextMenu.hidden = false;

        requestAnimationFrame(() => {
          const rect = nodeContextMenu.getBoundingClientRect();
          if (left + rect.width > window.innerWidth - 8) {
            left = Math.max(8, event.clientX - rect.width);
          }
          if (top + rect.height > window.innerHeight - 8) {
            top = Math.max(8, event.clientY - rect.height);
          }
          nodeContextMenu.style.left = `${left}px`;
          nodeContextMenu.style.top = `${top}px`;
        });

        nodeContextMenu.style.left = `${left}px`;
        nodeContextMenu.style.top = `${top}px`;
      }

      allNodes.forEach((node) => {
        node.addEventListener('contextmenu', (event) => {
          event.preventDefault();
          event.stopPropagation();
          const nodeId = getNodeIdentity(node);
          if (!nodeId) return;
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
