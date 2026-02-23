const { generateDiagram, createMermaidGraphWriter } = require('./diagramCommon');

async function generateImpactDiagram(context, uri, deps) {
    return generateDiagram(context, uri, deps, 'impact', generateMermaidImpactGraph);
}

function generateMermaidImpactGraph(dsMap, targetNode, deps) {
    const { vscode, getDsMapArray } = deps;
    const allFileLinks = getDsMapArray(dsMap, 'ttFileLink');
    const allFileNodes = getDsMapArray(dsMap, 'ttFileNode');
    const startNodeId = targetNode.NodeId;

    if (allFileLinks.length === 0 || allFileNodes.length === 0) {
        vscode.window.showWarningMessage('CrossWayAI: dsMap.json does not contain impact diagram data. Please regenerate the map.');
        return null;
    }

    const linksToRender = new Set();

    function findImpactedLinks(nodeId, visitedNodes) {
        if (!nodeId || visitedNodes.has(nodeId)) {
            return;
        }
        visitedNodes.add(nodeId);

        const parentLinks = allFileLinks.filter(link => link.NodeId === nodeId);
        parentLinks.forEach(parentLink => {
            linksToRender.add(parentLink);
            const parentNodeId = parentLink.ParentNodeId;

            const siblingLinks = allFileLinks.filter(link => link.ParentNodeId === parentNodeId);
            siblingLinks.forEach(siblingLink => {
                linksToRender.add(siblingLink);
            });

            findImpactedLinks(parentNodeId, visitedNodes);
        });
    }

    function findDependencyLinks(nodeId, visitedNodes) {
        if (!nodeId || visitedNodes.has(nodeId)) {
            return;
        }
        visitedNodes.add(nodeId);

        const childLinks = allFileLinks.filter(link => link.ParentNodeId === nodeId);
        childLinks.forEach(link => {
            linksToRender.add(link);
            findDependencyLinks(link.NodeId, visitedNodes);
        });
    }

    findImpactedLinks(startNodeId, new Set());
    findDependencyLinks(startNodeId, new Set());

    if (linksToRender.size === 0) {
        vscode.window.showInformationMessage(`No impact or dependency references found for ${targetNode.FileName}.`);
        return null;
    }

    const graphWriter = createMermaidGraphWriter(targetNode);
    const { ensureNodeDeclaration, addEdge, getGraph } = graphWriter;

    const edges = new Map();

    linksToRender.forEach(link => {
        const sourceNode = allFileNodes.find(f => f.NodeId === link.ParentNodeId);
        const destNode = allFileNodes.find(f => f.NodeId === link.NodeId);

        if (sourceNode && destNode) {
            const sourceName = ensureNodeDeclaration(sourceNode);
            const destName = ensureNodeDeclaration(destNode);
            const edgeKey = `${sourceNode.NodeId}->${destNode.NodeId}`;
            if (!edges.has(edgeKey)) {
                edges.set(edgeKey, {
                    sourceName,
                    destName,
                    labels: new Set()
                });
            }

            const rawLinkType = typeof link.LinkType === 'string' ? link.LinkType : '';
            const firstLinkTypeEntry = rawLinkType.split(':')[0].trim();
            if (firstLinkTypeEntry) {
                edges.get(edgeKey).labels.add(firstLinkTypeEntry);
            }
        }
    });

    edges.forEach(edge => {
        const labels = Array.from(edge.labels).join(', ');
        addEdge(edge.sourceName, edge.destName, labels);
    });

    return getGraph();
}

module.exports = {
    generateImpactDiagram
};
