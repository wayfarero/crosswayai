const {
    generateDiagram,
    createMermaidGraphWriter,
    collectBidirectionalLinks,
    buildLinkEdgeMap,
    renderSortedEdges
} = require('./diagramCommon');

async function generateIncludeDiagram(context, uri, deps) {
    return generateDiagram(context, uri, deps, 'include', generateMermaidIncludeGraph);
}

function generateMermaidIncludeGraph(dsMap, targetNode, deps, graphType = 'TD') {
    const { vscode, getDsMapArray } = deps;
    const allFileLinks = getDsMapArray(dsMap, 'ttFileLink');
    const allFileNodes = getDsMapArray(dsMap, 'ttFileNode');
    const startNodeId = targetNode.NodeId;

    if (allFileLinks.length === 0 || allFileNodes.length === 0) {
        vscode.window.showWarningMessage('CrossWayAI: dsMap.json does not contain include diagram data. Please regenerate the map.');
        return null;
    }

    const linksToRender = collectBidirectionalLinks(
        allFileLinks,
        startNodeId,
        link => link && link.LinkType === 'include'
    );

    if (linksToRender.size === 0) {
        vscode.window.showInformationMessage(`No include references found for ${targetNode.FileName}.`);
        return null;
    }

    const graphWriter = createMermaidGraphWriter(targetNode, graphType);
    const { ensureNodeDeclaration, addEdge, getGraph } = graphWriter;
    const edges = buildLinkEdgeMap(Array.from(linksToRender), allFileNodes, ensureNodeDeclaration);

    renderSortedEdges(edges, addEdge);

    return getGraph();
}

module.exports = {
    generateIncludeDiagram
};
