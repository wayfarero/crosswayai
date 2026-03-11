const {
    generateDiagram,
    createMermaidGraphWriter,
    collectBidirectionalLinks,
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
        // Include inheritance relationships ('extends', 'inherits')
        return lt === 'extends:' || lt === 'inherits:';
    }

    const linksToRender = collectBidirectionalLinks(allFileLinks, startNodeId, linkIsInheritance);

    // Also use ttClassReference (if present) to ensure we discover all inheritance relationships
    const classRefs = (dsMap.dsMap.ttClassReference || []);
    const classNameToNodeId = {};
    allFileNodes.forEach(n => { if (n.ClassName) classNameToNodeId[n.ClassName] = n.NodeId; });

    if (targetNode.ClassName) {
        const startClassName = targetNode.ClassName;
        // find classes/procedures that the start class extends or inherits from
        classRefs.forEach(ref => {
            if (ref.ClassName === startClassName && ref.ReferenceType && 
                (ref.ReferenceType.toLowerCase().indexOf('extends') !== -1 || 
                 ref.ReferenceType.toLowerCase().indexOf('inherits') !== -1)) {
                const parentClassName = ref.TargetClassName;
                const parentNodeId = classNameToNodeId[parentClassName];
                if (parentNodeId) {
                    // add link from child to parent
                    linksToRender.add({ ParentNodeId: startNodeId, NodeId: parentNodeId, LinkType: ref.ReferenceType });

                    // add links from all other classes that inherit from the same parent
                    classRefs.forEach(ref2 => {
                        if (ref2.TargetClassName === parentClassName && 
                            (ref2.ReferenceType.toLowerCase().indexOf('extends') !== -1 || 
                             ref2.ReferenceType.toLowerCase().indexOf('inherits') !== -1)) {
                            const childNodeId = classNameToNodeId[ref2.ClassName];
                            if (childNodeId) {
                                linksToRender.add({ ParentNodeId: childNodeId, NodeId: parentNodeId, LinkType: ref2.ReferenceType });
                            }
                        }
                    });

                    // also collect up via existing links to catch any other inheritance chains
                    collectBidirectionalLinks(allFileLinks, parentNodeId, linkIsInheritance, {
                        linksToRender,
                        downVisited: new Set([parentNodeId])
                    });
                }
            }
        });
    }

    const hasOutgoingLinks = Array.from(linksToRender).some(link => link.ParentNodeId === startNodeId);
    const hasIncomingLinks = Array.from(linksToRender).some(link => link.NodeId === startNodeId);
    const graphWriter = createMermaidGraphWriter(targetNode, graphType);
    const { ensureNodeDeclaration, addEdge, getGraph } = graphWriter;

    // When the starting class neither extends any other class nor is extended by any other class,
    // the Inheritance Diagram should display only the class itself.
    if (!hasOutgoingLinks && !hasIncomingLinks) {
        return graphWriter.getGraph();
    }

    // Deduplicate links by (parent,node,linkType) key to avoid rendering duplicates from mixed sources
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
