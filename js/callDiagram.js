const { generateDiagram, createMermaidGraphWriter } = require('./diagramCommon');

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

    const linksToRender = new Set();

    function filterCallLinks(link) {
        if (!link || !link.LinkType) return false;
        const lt = link.LinkType.toLowerCase();
        return lt.startsWith('invoke') || lt.startsWith('run');
    }

    function findCallLinks(nodeId, visitedNodes) {
        if (!nodeId || visitedNodes.has(nodeId)) {
            return;
        }
        visitedNodes.add(nodeId);

        const childLinks = allFileLinks.filter(link => link.ParentNodeId === nodeId && filterCallLinks(link));
        childLinks.forEach(link => {
            linksToRender.add(link);
            findCallLinks(link.NodeId, visitedNodes);
        });
    }

    function findCalledByLinks(nodeId, visitedNodes) {
        if (!nodeId || visitedNodes.has(nodeId)) {
            return;
        }
        visitedNodes.add(nodeId);

        const parentLinks = allFileLinks.filter(link => link.NodeId === nodeId && filterCallLinks(link));
        parentLinks.forEach(link => {
            linksToRender.add(link);
            findCalledByLinks(link.ParentNodeId, visitedNodes);
        });
    }

    findCallLinks(startNodeId, new Set());
    findCalledByLinks(startNodeId, new Set());

    if (linksToRender.size === 0) {
        vscode.window.showInformationMessage(`No invoke or run references found for ${targetNode.FileName}.`);
        return null;
    }

    const graphWriter = createMermaidGraphWriter(targetNode, graphType);
    const { ensureNodeDeclaration, addEdge, getGraph } = graphWriter;

    const edges = new Map();

    linksToRender.forEach(link => {
        const sourceNode = allFileNodes.find(f => f.NodeId === link.ParentNodeId);
        const destNode = allFileNodes.find(f => f.NodeId === link.NodeId);

        if (sourceNode && destNode) {
            ensureNodeDeclaration(sourceNode);
            ensureNodeDeclaration(destNode);

            const edgeKey = `${sourceNode.NodeId}->${destNode.NodeId}`;
            if (!edges.has(edgeKey)) {
                edges.set(edgeKey, {
                    sourceNode,
                    destNode,
                    labels: new Set()
                });
            }

            const rawLinkType = typeof link.LinkType === 'string' ? link.LinkType : '';
            let label = '';
            if (rawLinkType.startsWith('invoke:') || rawLinkType.startsWith('run:')) {
                // Use the method name after 'invoke:' or 'run:'
                const parts = rawLinkType.split(':');
                if (parts.length > 1) {
                    // Optionally include parameters after comma
                    label = parts[1].split(',')[0].trim();
                }
            } else {
                label = rawLinkType.split(':')[0].trim();
            }
            if (label) {
                edges.get(edgeKey).labels.add(label);
            }
        }
    });

    Array.from(edges.entries())
        .sort((a,b) => a[0].localeCompare(b[0]))
        .forEach(([key, edge]) => {
            const labels = Array.from(edge.labels).join(', ');
            addEdge(edge.sourceNode, edge.destNode, labels);
        });

    return getGraph();
}

module.exports = {
    generateCallDiagram
};
