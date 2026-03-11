const {
    generateDiagram,
    createMermaidGraphWriter,
    collectBidirectionalLinks,
    collectDirectionalLinks,
    dedupeLinks,
    buildLinkEdgeMap,
    renderSortedEdges
} = require('./diagramCommon');

async function generateInterfaceDiagram(context, uri, deps) {
    return generateDiagram(context, uri, deps, 'interface', generateMermaidInterfaceGraph);
}

function generateMermaidInterfaceGraph(dsMap, targetNode, deps, graphType = 'LR') {
    const allFileLinks = dsMap.dsMap.ttFileLink || [];
    const allFileNodes = dsMap.dsMap.ttFileNode || [];
    const startNodeId = targetNode.NodeId;

    function linkIsInterface(link) {
        if (!link || !link.LinkType) return false;
        const lt = link.LinkType.toLowerCase();
        // Only include actual interface relationships ('implements')
        return lt === 'implements:';
    }

    const linksToRender = collectBidirectionalLinks(allFileLinks, startNodeId, linkIsInterface);

    // If we discovered interface nodes from the start node (e.g. class -> interface),
    // scan the full link table using loose equality to find direct interface children,
    // add those links and then traverse up from each interface to capture other implementers.
    const discoveredInterfaceNodeIds = new Set();
    allFileLinks.forEach(link => {
        if (linkIsInterface(link) && link.ParentNodeId == startNodeId) {
            discoveredInterfaceNodeIds.add(link.NodeId);
            linksToRender.add(link);
        }
    });
    discoveredInterfaceNodeIds.forEach(interfaceNodeId => {
        collectDirectionalLinks(allFileLinks, interfaceNodeId, linkIsInterface, {
            direction: 'up',
            visited: new Set(),
            linksToRender
        });
    });

    // Also use ttClassReference (if present) to ensure we discover interfaces and all implementers
    const classRefs = (dsMap.dsMap.ttClassReference || []);
    const classNameToNodeId = {};
    allFileNodes.forEach(n => { if (n.ClassName) classNameToNodeId[n.ClassName] = n.NodeId; });

    if (targetNode.ClassName) {
        const startClassName = targetNode.ClassName;
        // find interfaces implemented by the start class
        classRefs.forEach(ref => {
            if (ref.ClassName === startClassName && ref.ReferenceType && ref.ReferenceType.toLowerCase().indexOf('implements') !== -1) {
                const interfaceName = ref.TargetClassName;
                const interfaceNodeId = classNameToNodeId[interfaceName];
                if (interfaceNodeId) {
                    // add link from start class to interface
                    linksToRender.add({ ParentNodeId: startNodeId, NodeId: interfaceNodeId, LinkType: ref.ReferenceType });

                    // add links from all classes that implement the same interface
                    classRefs.forEach(ref2 => {
                        if (ref2.TargetClassName === interfaceName && ref2.ReferenceType && ref2.ReferenceType.toLowerCase().indexOf('implements') !== -1) {
                            const implNodeId = classNameToNodeId[ref2.ClassName];
                            if (implNodeId) {
                                linksToRender.add({ ParentNodeId: implNodeId, NodeId: interfaceNodeId, LinkType: ref2.ReferenceType });
                            }
                        }
                    });

                    // also collect up via existing links to catch any other link types
                    collectDirectionalLinks(allFileLinks, interfaceNodeId, linkIsInterface, {
                        direction: 'up',
                        visited: new Set(),
                        linksToRender
                    });
                }
            }
        });
    }

    const hasOutgoingLinks = Array.from(linksToRender).some(link => link.ParentNodeId === startNodeId);
    const hasIncomingLinks = Array.from(linksToRender).some(link => link.NodeId === startNodeId);
    const graphWriter = createMermaidGraphWriter(targetNode, graphType);
    const { ensureNodeDeclaration, addEdge, getGraph } = graphWriter;

    if (!hasOutgoingLinks && !hasIncomingLinks) {
        return getGraph();
    }

    const deduped = dedupeLinks(Array.from(linksToRender), link =>
        `${link.ParentNodeId}::${link.NodeId}::${(link.LinkType || '').toString()}`
    );

    const edges = buildLinkEdgeMap(deduped, allFileNodes, ensureNodeDeclaration);
    renderSortedEdges(edges, addEdge);

    return getGraph();
}
module.exports = {
    generateInterfaceDiagram
};
