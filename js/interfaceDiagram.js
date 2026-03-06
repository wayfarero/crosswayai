const { generateDiagram, createMermaidGraphWriter } = require('./diagramCommon');

async function generateInterfaceDiagram(context, uri, deps) {
    return generateDiagram(context, uri, deps, 'interface', generateMermaidInterfaceGraph);
}

function generateMermaidInterfaceGraph(dsMap, targetNode, deps, graphType = 'LR') {
    const allFileLinks = dsMap.dsMap.ttFileLink || [];
    const allFileNodes = dsMap.dsMap.ttFileNode || [];
    const startNodeId = targetNode.NodeId;

    const linksToRender = new Set();

    function linkIsInterface(link) {
        if (!link || !link.LinkType) return false;
        const lt = link.LinkType.toLowerCase();
        // Only include actual interface relationships ('implements')
        return lt === 'implements:';
    }

    // Traverse up (who references this file via interface constructs)
    function collectUp(nodeId, visited) {
        if (!nodeId || visited.has(nodeId)) return;
        visited.add(nodeId);

        const parentLinks = allFileLinks.filter(link => link.NodeId === nodeId && linkIsInterface(link));
        parentLinks.forEach(link => {
            linksToRender.add(link);
            collectUp(link.ParentNodeId, visited);
        });
    }

    // Traverse down (what this file references via interface constructs)
    function collectDown(nodeId, visited) {
        if (!nodeId || visited.has(nodeId)) return;
        visited.add(nodeId);

        const childLinks = allFileLinks.filter(link => link.ParentNodeId === nodeId && linkIsInterface(link));
        childLinks.forEach(link => {
            linksToRender.add(link);
            collectDown(link.NodeId, visited);
        });
    }

    collectUp(startNodeId, new Set());
    collectDown(startNodeId, new Set());

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
        collectUp(interfaceNodeId, new Set());
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
                    collectUp(interfaceNodeId, new Set());
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

    const deduped = [];
    const seen = new Set();

    Array.from(linksToRender).forEach(link => {
        const key = `${link.ParentNodeId}::${link.NodeId}::${(link.LinkType || '').toString()}`;

        if (!seen.has(key)) {
            seen.add(key);
            deduped.push(link);
        }
    });

    deduped.forEach(link => {

        const sourceNode = allFileNodes.find(f => f.NodeId === link.ParentNodeId);
        const destNode = allFileNodes.find(f => f.NodeId === link.NodeId);

        if (!sourceNode || !destNode) {
            return;
        }

        ensureNodeDeclaration(sourceNode);
        ensureNodeDeclaration(destNode);

        let label = '';

        if (typeof link.LinkType === 'string') {
            label = link.LinkType.split(':')[0].trim();
        }

        addEdge(sourceNode, destNode);
    });

    return getGraph();
}
module.exports = {
    generateInterfaceDiagram
};
