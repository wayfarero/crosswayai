    // AI node summary overlay state and rendering.
    const nodeSummaryButton = document.getElementById('nodeSummaryButton');
    const nodeSummaryPopover = document.getElementById('nodeSummaryPopover');
    let nodeSummaryHoveredContext = null;
    let nodeSummaryLockedContext = null;
    let nodeSummaryPinnedContext = null;
    let nodeSummaryButtonHover = false;
    let nodeSummaryButtonHideTimer = null;
    let nodeSummaryPinnedText = '';

    function clearNodeSummaryButtonHideTimer() {
      if (nodeSummaryButtonHideTimer) {
        clearTimeout(nodeSummaryButtonHideTimer);
        nodeSummaryButtonHideTimer = null;
      }
    }

    function resolveNodeSummaryContext(nodeEl) {
      if (!nodeEl || typeof getNodeIdentity !== 'function') {
        return null;
      }

      const nodeId = getNodeIdentity(nodeEl);
      if (!nodeId) {
        return null;
      }

      const filePath = (window.CROSSWAY_FILE_MAP || {})[nodeId];
      if (!filePath) {
        return null;
      }

      const fileName = filePath ? String(filePath).split(/[\\/]/).pop() : '';
      const visibleLabel = nodeEl.querySelector('text')?.textContent?.trim() || '';
      return {
        nodeEl,
        nodeId,
        filePath,
        displayName: fileName || visibleLabel || nodeId
      };
    }

    function positionNodeSummaryOverlayElement(element, nodeEl, xOffset = 10, yOffset = 0) {
      if (!element || !nodeEl) {
        return;
      }

      const rect = nodeEl.getBoundingClientRect();
      const elementRect = element.getBoundingClientRect();
      let left = rect.right + xOffset;
      let top = rect.top + yOffset;

      const activeTooltipAnchor = window.CROSSWAY_NODE_TOOLTIP_ANCHOR || null;
      const isSameNodeAsTooltipAnchor = Boolean(activeTooltipAnchor && activeTooltipAnchor === nodeEl);

      if (element === nodeSummaryButton && nodeTooltipList && !nodeTooltipList.hidden && isSameNodeAsTooltipAnchor) {
        const tooltipRect = nodeTooltipList.getBoundingClientRect();
        left = rect.right + 2;
        top = tooltipRect.top - elementRect.height - 2;
      }

      if (left + elementRect.width > window.innerWidth - 8) {
        left = Math.max(8, rect.left - elementRect.width - 8);
      }
      if (top + elementRect.height > window.innerHeight - 8) {
        top = Math.max(8, window.innerHeight - elementRect.height - 8);
      }
      if (top < 8) {
        top = 8;
      }

      element.style.left = `${Math.round(left)}px`;
      element.style.top = `${Math.round(top)}px`;
    }

    function showNodeSummaryButton(nodeContext) {
      if (!nodeContext || !nodeSummaryButton) {
        return;
      }

      clearNodeSummaryButtonHideTimer();
      nodeSummaryHoveredContext = nodeContext;
      nodeSummaryButton.hidden = false;
      positionNodeSummaryOverlayElement(nodeSummaryButton, nodeContext.nodeEl, 2, 0);
    }

    function lockNodeSummaryButton(nodeContext) {
      nodeSummaryLockedContext = nodeContext || null;
      if (nodeSummaryLockedContext) {
        showNodeSummaryButton(nodeSummaryLockedContext);
      }
    }

    function clearLockedNodeSummaryButton() {
      nodeSummaryLockedContext = null;
      if (!nodeSummaryButtonHover && !nodeSummaryPinnedContext) {
        scheduleNodeSummaryButtonHide();
      }
    }

    function hideNodeSummaryButton(force = false) {
      if (!nodeSummaryButton) {
        return;
      }
      if (!force && (nodeSummaryButtonHover || nodeSummaryLockedContext || (!nodeSummaryPinnedContext && nodeSummaryHoveredContext))) {
        return;
      }

      clearNodeSummaryButtonHideTimer();
      if (!nodeSummaryPinnedContext && !nodeSummaryLockedContext) {
        nodeSummaryHoveredContext = null;
      }
      nodeSummaryButton.hidden = true;
    }

    function scheduleNodeSummaryButtonHide() {
      clearNodeSummaryButtonHideTimer();
      nodeSummaryButtonHideTimer = setTimeout(() => {
        if (!nodeSummaryButtonHover && !nodeSummaryPinnedContext && !nodeSummaryLockedContext) {
          nodeSummaryHoveredContext = null;
          hideNodeSummaryButton(true);
        }
      }, 240);
    }

    function renderNodeSummaryFrame(nodeLabel, bodyHtml, options = {}) {
      if (!nodeSummaryPopover) {
        return;
      }
      const showCopy = options.showCopy === true;
      nodeSummaryPopover.innerHTML = `
        <div class="summary-title">AI Summary: ${nodeLabel}</div>
        ${bodyHtml}
        <div class="summary-footer">
          ${showCopy ? '<button class="summary-copy" type="button" aria-label="Copy summary" title="Copy summary">⧉</button>' : ''}
        </div>
      `;
    }

    function renderNodeSummaryLoading(nodeContext) {
      const nodeLabel = escapeHtml(nodeContext?.displayName || 'Node');
      nodeSummaryPinnedText = '';
      renderNodeSummaryFrame(
        nodeLabel,
        '<div class="summary-body">Generating summary...</div>'
      );
    }

    function renderNodeSummarySuccess(nodeContext, summaryText) {
      const nodeLabel = escapeHtml(nodeContext?.displayName || 'Node');
      nodeSummaryPinnedText = String(summaryText || '');
      renderNodeSummaryFrame(
        nodeLabel,
        `<div class="summary-body">${escapeHtml(summaryText || '')}</div>`,
        { showCopy: true }
      );
    }

    function renderNodeSummaryError(nodeContext, errorText) {
      const nodeLabel = escapeHtml(nodeContext?.displayName || 'Node');
      nodeSummaryPinnedText = '';
      renderNodeSummaryFrame(
        nodeLabel,
        `<div class="summary-body summary-error">${escapeHtml(errorText || 'Unable to generate summary.')}</div>`
      );
    }

    function getNodeSummaryErrorMessage(reason) {
      const normalized = String(reason || '').trim();
      switch (normalized) {
        case 'VSCODE_LM_QUOTA_EXHAUSTED':
          return 'Your VS Code AI quota is exhausted. Choose a different AI provider in .crosswayai/crosswayai_settings.json or try again later.';
        case 'OPENAI_QUOTA_EXHAUSTED':
          return 'Your OpenAI API quota is exhausted. Update billing or use a different API key.';
        case 'NO_AI_PROVIDER':
          return 'AI Summary is disabled or not configured. Enable it in .crosswayai/crosswayai_settings.json.';
        case 'FILE_NODE_ONLY':
          return 'AI summaries are available only for file nodes.';
        case 'FILE_READ_FAILED':
        case 'FILE_NOT_FOUND':
          return 'This file could not be read for summary generation.';
        case 'PROMPT_TEMPLATE_READ_FAILED':
          return 'The AI summary prompt template could not be read.';
        case 'EMPTY_AI_RESPONSE':
          return 'The AI provider returned an empty summary. Please try again.';
        case 'AI_GENERATION_FAILED':
          return 'AI summary generation failed. Please try again in a moment.';
        default:
          return normalized || 'Unable to generate summary.';
      }
    }

    function positionNodeSummaryPopover(nodeContext) {
      if (!nodeContext || !nodeSummaryPopover || nodeSummaryPopover.hidden) {
        return;
      }

      positionNodeSummaryOverlayElement(nodeSummaryPopover, nodeContext.nodeEl, 18, 0);
    }

    function hideNodeSummaryPopover() {
      if (!nodeSummaryPopover) {
        return;
      }
      nodeSummaryPinnedContext = null;
      nodeSummaryPinnedText = '';
      nodeSummaryPopover.hidden = true;
      nodeSummaryPopover.innerHTML = '';
      if (!nodeSummaryButtonHover) {
        nodeSummaryHoveredContext = nodeSummaryLockedContext;
        if (nodeSummaryLockedContext) {
          showNodeSummaryButton(nodeSummaryLockedContext);
        } else {
          hideNodeSummaryButton(true);
        }
      }
    }

    function openNodeSummary(nodeContext) {
      if (!nodeContext || !nodeSummaryPopover) {
        return;
      }

      nodeSummaryPinnedContext = nodeContext;
      nodeSummaryHoveredContext = nodeContext;
      nodeSummaryButtonHover = false;
      renderNodeSummaryLoading(nodeContext);
      nodeSummaryPopover.hidden = false;
      positionNodeSummaryPopover(nodeContext);
      hideNodeSummaryButton(true);

      window.parent.postMessage({
        type: 'generateNodeSummary',
        nodeId: nodeContext.nodeId,
        filePath: nodeContext.filePath
      }, '*');
    }

    function refreshNodeSummaryAnchors() {
      const buttonContext = nodeSummaryLockedContext || nodeSummaryHoveredContext;
      if (buttonContext && nodeSummaryButton && !nodeSummaryButton.hidden) {
        positionNodeSummaryOverlayElement(nodeSummaryButton, buttonContext.nodeEl, 2, 0);
      }
      if (nodeSummaryPinnedContext && nodeSummaryPopover && !nodeSummaryPopover.hidden) {
        positionNodeSummaryPopover(nodeSummaryPinnedContext);
      }
    }

    if (nodeSummaryButton) {
      nodeSummaryButton.addEventListener('mouseenter', () => {
        nodeSummaryButtonHover = true;
        clearNodeSummaryButtonHideTimer();
      });

      nodeSummaryButton.addEventListener('mouseleave', () => {
        nodeSummaryButtonHover = false;
        if (!nodeSummaryPinnedContext) {
          scheduleNodeSummaryButtonHide();
        }
      });

      nodeSummaryButton.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        const targetContext = nodeSummaryHoveredContext || nodeSummaryPinnedContext;
        if (!targetContext) {
          return;
        }
        openNodeSummary(targetContext);
      });
    }

    if (nodeSummaryPopover) {
      nodeSummaryPopover.addEventListener('click', async (event) => {
        
        const clickTarget = event.target instanceof Element
                          ? event.target
                          : event.target && event.target.parentElement;

        const copyButton = clickTarget?.closest('.summary-copy');
        if (!copyButton) {
          return;
        }

        event.preventDefault();
        event.stopPropagation();

        const summaryText = String(nodeSummaryPinnedText || '').trim();
        if (!summaryText) {
          return;
        }

        let copySuccess = false;

        // Fallback to older execCommand method for restricted iframe contexts
        try {
          const textarea = document.createElement('textarea');
          textarea.value = summaryText;
          textarea.style.position = 'fixed';
          textarea.style.opacity  = '0';
          document.body.appendChild(textarea);
          textarea.select();
          const result = document.execCommand('copy');
          document.body.removeChild(textarea);

          if (result) {
            copySuccess = true;
          } else {
            logger.logToOutput(`[NodeSummary] : copy action failed`); 
          }
        } catch (err) {
            logger.logToOutput(`[NodeSummary] ERROR : copy action failed`);
        }

        // Update UI only if copy succeeded
        if (copySuccess) {
          copyButton.textContent = '✓';
          copyButton.setAttribute('title', 'Copied');
          copyButton.setAttribute('aria-label', 'Copied');

          setTimeout(() => {
            if (nodeSummaryPopover.contains(copyButton)) {
              copyButton.textContent = '⧉';
              copyButton.setAttribute('title', 'Copy summary');
              copyButton.setAttribute('aria-label', 'Copy summary');
            }
          }, 1200);
        } else {
            logger.logToOutput(`[NodeSummary] : All copy methods failed`);
        }

      });
    }

    document.addEventListener('click', (event) => {
      if (!nodeSummaryPopover || nodeSummaryPopover.hidden) {
        return;
      }
      if (!nodeSummaryPopover.contains(event.target) && event.target !== nodeSummaryButton) {
        hideNodeSummaryPopover();
      }
    }, true);

    window.addEventListener('resize', refreshNodeSummaryAnchors);

    window.addEventListener('message', (event) => {
      const message = event.data || {};
      if (!message || typeof message.type !== 'string') {
        return;
      }

      if (message.type === 'nodeSummaryResult') {
        if (!nodeSummaryPinnedContext) {
          return;
        }
        const activeNodeId = nodeSummaryPinnedContext.nodeId || null;
        const activeFilePath = nodeSummaryPinnedContext.filePath || null;
        const messageNodeId = message.nodeId || null;
        const messageFilePath = message.filePath || null;

        if (messageNodeId !== activeNodeId || messageFilePath !== activeFilePath) {
          return;
        }

        if (message.ok) {
          renderNodeSummarySuccess(nodeSummaryPinnedContext, message.summary || '');
        } else {
          renderNodeSummaryError(nodeSummaryPinnedContext, getNodeSummaryErrorMessage(message.reason));
        }
        positionNodeSummaryPopover(nodeSummaryPinnedContext);
      }
    });
