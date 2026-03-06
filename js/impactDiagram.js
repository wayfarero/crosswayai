const { generateDiagram, createMermaidGraphWriter } = require('./diagramCommon');

async function generateImpactDiagram(context, uri, deps) {
    return generateDiagram(context, uri, deps, 'impact', generateMermaidImpactGraph);
}

function generateMermaidImpactGraph(dsMap, targetNode, deps, graphType = 'LR') {
    const { vscode, getDsMapArray } = deps;
    const allFileLinks = getDsMapArray(dsMap, 'ttFileLink');
    const allFileNodes = getDsMapArray(dsMap, 'ttFileNode');
    const startNodeId = targetNode.NodeId;

    if (allFileLinks.length === 0 || allFileNodes.length === 0) {
        vscode.window.showWarningMessage('CrossWayAI: dsMap.json does not contain impact diagram data. Please regenerate the map.');
        return null;
    }

    const linksToRender = new Set();

    // Determine whether a ttFileLink entry represents a meaningful
    // dependency for impact analysis.  Impact diagrams should include only
    // links that correspond to actual code relationships (method calls,
    // include statements, inheritance, etc.).  Incidental or bookkeeping
    // entries such as "new" are deliberately excluded to keep graphs
    // focused and readable.
    function isImpactLink(link) {
        if (!link || !link.LinkType) return false;
        const lt = link.LinkType.toLowerCase();
        // filter by well‑known link type prefixes or exact types
        return (
            lt.startsWith('invoke') ||
            lt.startsWith('run') ||
            lt === 'include' ||
            lt === 'inherits:' ||
            lt === 'extends:'
        );
    }

    function findImpactedLinks(nodeId, visitedNodes) {
        if (!nodeId) return;

        const parentLinks = allFileLinks.filter(
            link => link.NodeId === nodeId && isImpactLink(link)
        );

        parentLinks.forEach(parentLink => {
            linksToRender.add(parentLink);

            if (!visitedNodes.has(parentLink.ParentNodeId)) {
                visitedNodes.add(parentLink.ParentNodeId);
                findImpactedLinks(parentLink.ParentNodeId, visitedNodes);
            }
        });
    }

    function findDependencyLinks(nodeId, visitedNodes) {
        if (!nodeId) return;

        const childLinks = allFileLinks.filter(
            link => link.ParentNodeId === nodeId && isImpactLink(link)
        );

        childLinks.forEach(link => {
            linksToRender.add(link);

            if (!visitedNodes.has(link.NodeId)) {
                visitedNodes.add(link.NodeId);
                findDependencyLinks(link.NodeId, visitedNodes);
            }
        });
    }

    const visitedUp = new Set([startNodeId]);
    const visitedDown = new Set([startNodeId]);

    findImpactedLinks(startNodeId, visitedUp);
    findDependencyLinks(startNodeId, visitedDown);

    if (linksToRender.size === 0) {
        vscode.window.showInformationMessage(`No impact or dependency references found for ${targetNode.FileName}.`);
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
            const firstLinkTypeEntry = rawLinkType.split(':')[0].trim();
            if (firstLinkTypeEntry) {
                edges.get(edgeKey).labels.add(firstLinkTypeEntry);
            }
        }
    });

    // identify any bidirectional pairs so we can style them specially
    const bidirectional = new Set();
    edges.forEach((_, key) => {
        const [src, dst] = key.split('->');
        const revKey = `${dst}->${src}`;
        if (edges.has(revKey)) {
            bidirectional.add(key);
            bidirectional.add(revKey);
        }
    });

    // iterate in deterministic order for stable diagrams
    const sortedEntries = Array.from(edges.entries()).sort((a, b) => a[0].localeCompare(b[0]));
    let edgeIndex = 0;
    const styleLines = [];

    sortedEntries.forEach(([key, edge]) => {
        const labels = Array.from(edge.labels).join(', ');
        addEdge(edge.sourceNode, edge.destNode, labels);

        if (bidirectional.has(key)) {
            // mark this edge red using mermaid's linkStyle syntax
            styleLines.push(`    linkStyle ${edgeIndex} stroke:red,stroke-width:2px`);
        }
        edgeIndex++;
    });

    let graph = getGraph();
    if (styleLines.length) {
        graph += '\n' + styleLines.join('\n') + '\n';
    }

    return graph;
}

module.exports = {
    generateImpactDiagram
};
