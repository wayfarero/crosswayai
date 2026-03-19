const {
    generateDiagram,
    createMermaidGraphWriter,
    collectBidirectionalLinks,
    buildLinkEdgeMap,
    renderSortedEdges
} = require('./diagramCommon');

async function generateInstanceChainDiagram(context, uri, deps) {
    return generateDiagram(context, uri, deps, 'instance_chain', generateMermaidInstanceChainGraph);
}

function generateMermaidInstanceChainGraph(dsMap, targetNode, deps, graphType = 'LR') {
    const { vscode, getDsMapArray } = deps;
    const allFileLinks = getDsMapArray(dsMap, 'ttFileLink');
    const allFileNodes = getDsMapArray(dsMap, 'ttFileNode');
    const startNodeId = targetNode.NodeId;

    if (allFileLinks.length === 0 || allFileNodes.length === 0) {
        vscode.window.showWarningMessage('CrossWayAI: dsMap.json does not contain instance chain diagram data. Please regenerate the map.');
        return null;
    }

    const linksToRender = collectBidirectionalLinks(
        allFileLinks,
        startNodeId,
        link => link && link.LinkType === 'new'
    );

    if (linksToRender.size === 0) {
        vscode.window.showInformationMessage(`No instance chain references found for ${targetNode.FileName}.`);
        return null;
    }

    const graphWriter = createMermaidGraphWriter(targetNode, graphType);
    const { ensureNodeDeclaration, addEdge, getGraph } = graphWriter;
    const edges = buildLinkEdgeMap(Array.from(linksToRender), allFileNodes, ensureNodeDeclaration);

    renderSortedEdges(edges, addEdge);

    return getGraph();
}

module.exports = {
    generateInstanceChainDiagram
};
