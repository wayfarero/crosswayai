const {
    generateDiagram,
    createMermaidGraphWriter,
    collectDirectionalLinks,
    buildLinkEdgeMap,
    renderSortedEdges,
    prependEdgeDetailsMetadata,
    getInvokeRunDisplayLabel,
    getFirstLinkTypeEntry
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
        const invokeRunLabel = getInvokeRunDisplayLabel(rawLinkType);
        if (invokeRunLabel) {
            return invokeRunLabel;
        }
        return getFirstLinkTypeEntry(rawLinkType, { toLowerCase: false });
    }

    const edges = buildLinkEdgeMap(Array.from(linksToRender), allFileNodes, ensureNodeDeclaration, {
        includeLabels: true,
        labelExtractor: extractCallLabel
    });

    renderSortedEdges(edges, addEdge);

    const graph = getGraph();
    return prependEdgeDetailsMetadata(graph, edges, {
        includeEdgeIndexKeys: true,
        includeEdgeMethodSigs: true,
        includeGlobalMethodSigs: true,
        linkFilter: filterCallLinks,
        links: linksToRender,
        allFileNodes
    });
}

module.exports = {
    generateCallDiagram
};
