const {
    generateDiagram,
    createMermaidGraphWriter,
    collectBidirectionalLinks,
    collectDirectionalLinks,
    dedupeLinks,
    buildLinkEdgeMap,
    renderSortedEdges
} = require('./diagramCommon');

async function generateInheritanceDiagram(context, uri, deps) {
    return generateDiagram(context, uri, deps, 'inheritance', generateMermaidInheritanceGraph);
}

function generateMermaidInheritanceGraph(dsMap, targetNode, deps, graphType = 'BT') {
    const allFileLinks = dsMap.dsMap.ttFileLink || [];
    const allFileNodes = dsMap.dsMap.ttFileNode || [];
    const startNodeId = targetNode.NodeId;

    function linkIsInheritance(link) {
        if (!link || !link.LinkType) return false;
        const lt = link.LinkType.toLowerCase();
        // Include inheritance relationships ('inherits')
        return  lt === 'inherits:';
    }

    const linksToRender = collectBidirectionalLinks(allFileLinks, startNodeId, linkIsInheritance);

    // Expand like the prior ttClassReference logic, but strictly from ttFileLink:
    // for each ancestor the start node inherits from, include that ancestor's full inheritor tree,
    // then recurse to the ancestor's own ancestor chain.
    const ancestorVisited = new Set();
    const downVisited = new Set();
    const reverseDownVisited = new Set();
    const sameNode = (a, b) => String(a) === String(b);

    function expandAncestorInheritanceTree(nodeId) {
        if (!nodeId || ancestorVisited.has(nodeId)) {
            return;
        }

        ancestorVisited.add(nodeId);

        collectDirectionalLinks(allFileLinks, nodeId, linkIsInheritance, {
            direction: 'down',
            visited: downVisited,
            linksToRender,
            looseEquality: true
        });

        // Defensive pass for maps that encode inheritance in reverse orientation.
        collectDirectionalLinks(allFileLinks, nodeId, linkIsInheritance, {
            direction: 'up',
            visited: reverseDownVisited,
            linksToRender,
            looseEquality: true
        });

        allFileLinks.forEach(link => {
            if (!linkIsInheritance(link)) {
                return;
            }

            // Parent -> Child orientation: current node inherits from Parent.
            if (sameNode(link.NodeId, nodeId)) {
                linksToRender.add(link);
                expandAncestorInheritanceTree(link.ParentNodeId);
            }

            // Child -> Parent orientation: current node inherits from NodeId.
            if (sameNode(link.ParentNodeId, nodeId)) {
                linksToRender.add(link);
                expandAncestorInheritanceTree(link.NodeId);
            }
        });
    }

    expandAncestorInheritanceTree(startNodeId);

    const hasOutgoingLinks = Array.from(linksToRender).some(link => link.ParentNodeId === startNodeId);
    const hasIncomingLinks = Array.from(linksToRender).some(link => link.NodeId === startNodeId);
    const graphWriter = createMermaidGraphWriter(targetNode, graphType);
    const { ensureNodeDeclaration, addEdge, getGraph } = graphWriter;

    // When the starting class neither extends any other class nor is extended by any other class,
    // the Inheritance Diagram should display only the class itself.
    if (!hasOutgoingLinks && !hasIncomingLinks) {
        return graphWriter.getGraph();
    }

    // Deduplicate links by (parent,node,linkType) key to avoid rendering duplicates
    const deduped = dedupeLinks(Array.from(linksToRender), link =>
        `${link.ParentNodeId}::${link.NodeId}::${(link.LinkType || '').toString()}`
    );

    const edges = buildLinkEdgeMap(deduped, allFileNodes, ensureNodeDeclaration);
    renderSortedEdges(edges, addEdge);

    return getGraph();
}

module.exports = {
    generateInheritanceDiagram
};
