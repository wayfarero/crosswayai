    const legend = document.getElementById('legend');

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

    function buildLegendRow(type, label) {
      const color = LINK_TYPE_COLORS[type] || '#6b7280';
      return `<div class="legend-row"><span class="legend-line" style="border-top-color:${color};"></span><span class="legend-label">${label}</span></div>`;
    }

    function updateLegend(mermaidCode, markdownPath) {
      const showLegend = !isTableRelationsDiagram(mermaidCode) && !isPackageDiagram(mermaidCode, markdownPath);
      if (!showLegend) {
        legend.hidden = true;
        legend.innerHTML = '';
        return;
      }

      legend.innerHTML = [
        '<div class="legend-header">',
        '<div class="legend-title">Legend</div>',
        '</div>',
        '<div class="legend-body">',
        buildLegendRow('include', 'include'),
        buildLegendRow('call', 'run / invoke'),
        buildLegendRow('cast', 'cast'),
        buildLegendRow('new', 'new'),
        buildLegendRow('property', 'property'),
        buildLegendRow('inherits', 'inherits'),
        buildLegendRow('implements', 'implements'),
        buildLegendRow('circular', 'circular'),
        buildLegendRow('selected', 'Selected'),
        buildLegendRow('undefined', 'multiple'),
        '</div>'
      ].join('');

      // Prevent dragging/panning while interacting with legend.
      legend.onmousedown = (event) => event.stopPropagation();
      legend.hidden = false;
    }
