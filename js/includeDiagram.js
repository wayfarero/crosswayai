const { generateDiagram, createMermaidGraphWriter } = require('./diagramCommon');

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

    const linksToRender = new Set();

    // Traverse up (files that reference the starting include file)
    function collectUpstream(nodeId, visited) {
        if (!nodeId || visited.has(nodeId)) return;
        visited.add(nodeId);
        
        const parentLinks = allFileLinks.filter(link => link.NodeId === nodeId && link.LinkType === 'include');
        parentLinks.forEach(link => {
            linksToRender.add(link);
            collectUpstream(link.ParentNodeId, visited);
        });
    }

    // Traverse down (files referenced by the starting include file)
    function collectDownstream(nodeId, visited) {
        if (!nodeId || visited.has(nodeId)) return;
        visited.add(nodeId);

        const childLinks = allFileLinks.filter(link => link.ParentNodeId === nodeId && link.LinkType === 'include');
        childLinks.forEach(link => {
            linksToRender.add(link);
            collectDownstream(link.NodeId, visited);
        });
    }

    collectUpstream(startNodeId, new Set());
    collectDownstream(startNodeId, new Set());

    if (linksToRender.size === 0) {
        vscode.window.showInformationMessage(`No include references found for ${targetNode.FileName}.`);
        return null;
    }

    const graphWriter = createMermaidGraphWriter(targetNode, graphType);
    const { ensureNodeDeclaration, addEdge, getGraph } = graphWriter;
    const renderedEdges = new Set();

    linksToRender.forEach(link => {
        const sourceNode = allFileNodes.find(f => f.NodeId === link.ParentNodeId);
        const destNode = allFileNodes.find(f => f.NodeId === link.NodeId);

        if (sourceNode && destNode) {
            const sourceName = ensureNodeDeclaration(sourceNode);
            const destName = ensureNodeDeclaration(destNode);
            const edgeKey = `${sourceName}->${destName}`;
            if (!renderedEdges.has(edgeKey)) {
                addEdge(sourceName, destName);
                renderedEdges.add(edgeKey);
            }
        }
    });

    return getGraph();
}

module.exports = {
    generateIncludeDiagram
};
