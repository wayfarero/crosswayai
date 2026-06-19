const vscode = require('vscode');
const {
    generateDiagram,
    createMermaidGraphWriter,
    collectDirectionalLinks,
    buildLinkEdgeMap,
    renderSortedEdges,
    prependEdgeDetailsMetadata,
    getDsMapArray
} = require('./diagramCommon');
const {
    edgeDetailLabelExtractor
} = require('./edgeInfo');

async function generateCallDiagram(context, uri) {
    return generateDiagram(context, uri, 'call', generateMermaidCallGraph);
}

function generateMermaidCallGraph(dsMap, targetNode, graphType = 'LR') {
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



    const edges = buildLinkEdgeMap(Array.from(linksToRender), allFileNodes, ensureNodeDeclaration, {
        includeLabels: false, // Do not show labels on the diagram
        // labelExtractor is omitted since labels are not shown
        includeDetailLabels: true,
        detailLabelExtractor: edgeDetailLabelExtractor
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
