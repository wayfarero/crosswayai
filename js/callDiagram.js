const {
    generateDiagram,
    createMermaidGraphWriter,
    collectDirectionalLinks,
    buildLinkEdgeMap,
    renderSortedEdges
} = require('./diagramCommon');

async function generateCallDiagram(context, uri, deps) {
    return generateDiagram(context, uri, deps, 'call', generateMermaidCallGraph);
}

function generateMermaidCallGraph(dsMap, targetNode, deps, graphType = 'LR') {
    const { vscode, getDsMapArray } = deps;
    const allFileLinks = getDsMapArray(dsMap, 'ttFileLink');
    const allFileNodes = getDsMapArray(dsMap, 'ttFileNode');
    const startNodeId = targetNode.NodeId;

    if (allFileLinks.length === 0 || allFileNodes.length === 0) {
        vscode.window.showWarningMessage('CrossWayAI: dsMap.json does not contain call diagram data. Please regenerate the map.');
        return null;
    }

    function filterCallLinks(link) {
        if (!link || !link.LinkType) return false;
        const lt = link.LinkType.toLowerCase();
        return lt.startsWith('invoke') || lt.startsWith('run');
    }

    const linksToRender = new Set();
    // Keep historical traversal order for stable label ordering:
    // first downstream calls, then upstream callers.
    collectDirectionalLinks(allFileLinks, startNodeId, filterCallLinks, {
        direction: 'down',
        visited: new Set(),
        linksToRender
    });
    collectDirectionalLinks(allFileLinks, startNodeId, filterCallLinks, {
        direction: 'up',
        visited: new Set(),
        linksToRender
    });

    if (linksToRender.size === 0) {
        vscode.window.showInformationMessage(`No invoke or run references found for ${targetNode.FileName}.`);
        return null;
    }

    const graphWriter = createMermaidGraphWriter(targetNode, graphType);
    const { ensureNodeDeclaration, addEdge, getGraph } = graphWriter;

    function extractCallLabel(link) {
        const rawLinkType = typeof link.LinkType === 'string' ? link.LinkType : '';
        if (rawLinkType.startsWith('invoke:') || rawLinkType.startsWith('run:')) {
            const parts = rawLinkType.split(':');
            if (parts.length > 1) {
                return parts[1].split(',')[0].trim();
            }
            return '';
        }

        return rawLinkType.split(':')[0].trim();
    }

    const edges = buildLinkEdgeMap(Array.from(linksToRender), allFileNodes, ensureNodeDeclaration, {
        includeLabels: true,
        labelExtractor: extractCallLabel
    });

    renderSortedEdges(edges, addEdge, {
        labelBuilder: edge => Array.from(edge.labels).join(', ')
    });

    return getGraph();
}

module.exports = {
    generateCallDiagram
};
