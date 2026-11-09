    const legend = document.getElementById('legend');
    const LEGEND_FILTERABLE_LINK_TYPES = [
      ['include', 'include'],
      ['call', 'run / invoke'],
      ['cast', 'cast'],
      ['new', 'new'],
      ['property', 'property'],
      ['enum', 'enum'],
      ['inherits', 'inherits'],
      ['implements', 'implements']
    ];

    function isTableRelationsDiagram(mermaidCode) {
      const source = String(mermaidCode || '');
      if (/^\s*%%CROSSWAY_SOURCE_NODE:/m.test(source)) {
        return true;
      }

      const knownColors = Object.values(LINK_TYPE_COLORS)
        .map(color => color.replace('#', '\\#'))
        .join('|');

      return new RegExp(`stroke\\s*:\\s*(?:${knownColors})`, 'i').test(source);
    }

    function buildLegendRow(type, label, filterable = false) {
      const color = LINK_TYPE_COLORS[type] || '#6b7280';
      const toggleControl = filterable
        ? `<input class="legend-toggle" type="checkbox" value="${type}" aria-label="Show ${label} links" checked />`
        : '<span class="legend-toggle-spacer" aria-hidden="true"></span>';
      const tagName = filterable ? 'label' : 'div';
      return `<${tagName} class="legend-row">${toggleControl}<span class="legend-line" style="border-top-color:${color};"></span><span class="legend-label">${label}</span></${tagName}>`;
    }

    function dispatchLegendFilterChange(enabledTypesOverride = null) {
      const enabledTypes = enabledTypesOverride || Array.from(legend.querySelectorAll('.legend-toggle:checked'))
        .map(checkbox => checkbox.value);
      window.dispatchEvent(new CustomEvent('crosswayai:legend-filter-change', {
        detail: { enabledTypes }
      }));
    }

    function updateLegend(mermaidCode, markdownPath) {
      const showLegend = !isTableRelationsDiagram(mermaidCode) && !isPackageDiagram(mermaidCode, markdownPath);
      if (!showLegend) {
        legend.hidden = true;
        legend.innerHTML = '';
        dispatchLegendFilterChange(LEGEND_FILTERABLE_LINK_TYPES.map(([type]) => type));
        return;
      }

      legend.innerHTML = [
        '<div class="legend-header">',
        '<div class="legend-title">Legend</div>',
        '</div>',
        '<div class="legend-body">',
        ...LEGEND_FILTERABLE_LINK_TYPES.map(([type, label]) => buildLegendRow(type, label, true)),
        buildLegendRow('circular', 'circular'),
        buildLegendRow('selected', 'selected'),
        buildLegendRow('undefined', 'multiple'),
        '</div>'
      ].join('');

      // Prevent dragging/panning while interacting with legend.
      legend.onmousedown = (event) => event.stopPropagation();
      legend.querySelectorAll('.legend-toggle').forEach(checkbox => {
        checkbox.addEventListener('change', () => dispatchLegendFilterChange());
      });
      legend.hidden = false;
      dispatchLegendFilterChange();
    }
