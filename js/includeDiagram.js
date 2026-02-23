const { generateDiagram, createMermaidGraphWriter } = require('./diagramCommon');

async function generateIncludeDiagram(context, uri, deps) {
    return generateDiagram(context, uri, deps, 'include', generateMermaidIncludeGraph);
}

function generateMermaidIncludeGraph(dsMap, targetNode, deps) {
    const { vscode, getDsMapArray } = deps;
    const allFileLinks = getDsMapArray(dsMap, 'ttFileLink');
    const allFileNodes = getDsMapArray(dsMap, 'ttFileNode');
    const startNodeId = targetNode.NodeId;

    if (allFileLinks.length === 0 || allFileNodes.length === 0) {
        vscode.window.showWarningMessage('CrossWayAI: dsMap.json does not contain include diagram data. Please regenerate the map.');
        return null;
    }

    const linksToRender = new Set();
    const roots = new Set();
    const visitedForRoots = new Set();

    function findRoots(nodeId) {
        if (!nodeId || visitedForRoots.has(nodeId)) {
            return;
        }
        visitedForRoots.add(nodeId);

        const parentLinks = allFileLinks.filter(link => link.NodeId === nodeId && link.LinkType === 'include');
        if (parentLinks.length === 0) {
            roots.add(nodeId);
        } else {
            parentLinks.forEach(parentLink => {
                findRoots(parentLink.ParentNodeId);
            });
        }
    }

    findRoots(startNodeId);

    if (roots.size === 0 && visitedForRoots.has(startNodeId)) {
        roots.add(startNodeId);
    }

    const visitedForGraph = new Set();
    function collectAllLinks(nodeId) {
        if (!nodeId || visitedForGraph.has(nodeId)) {
            return;
        }
        visitedForGraph.add(nodeId);

        const childLinks = allFileLinks.filter(link => link.ParentNodeId === nodeId && link.LinkType === 'include');
        childLinks.forEach(link => {
            linksToRender.add(link);
            collectAllLinks(link.NodeId);
        });
    }

    roots.forEach(rootId => {
        collectAllLinks(rootId);
    });

    if (linksToRender.size === 0) {
        const hasIncludes = allFileLinks.some(link => link.ParentNodeId === startNodeId && link.LinkType === 'include');
        const isIncluded = allFileLinks.some(link => link.NodeId === startNodeId && link.LinkType === 'include');
        if (!hasIncludes && !isIncluded) {
            vscode.window.showInformationMessage(`No include references found for ${targetNode.FileName}.`);
            return null;
        }
    }

    const graphWriter = createMermaidGraphWriter(targetNode);
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
