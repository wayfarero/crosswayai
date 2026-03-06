const { generateDiagram, createMermaidGraphWriter } = require('./diagramCommon');

async function generateInheritanceDiagram(context, uri, deps) {
    return generateDiagram(context, uri, deps, 'inheritance', generateMermaidInheritanceGraph);
}

function generateMermaidInheritanceGraph(dsMap, targetNode, deps, graphType = 'BT') {
    const allFileLinks = dsMap.dsMap.ttFileLink || [];
    const allFileNodes = dsMap.dsMap.ttFileNode || [];
    const startNodeId = targetNode.NodeId;

    const linksToRender = new Set();

    function linkIsInheritance(link) {
        if (!link || !link.LinkType) return false;
        const lt = link.LinkType.toLowerCase();
        // Include inheritance relationships ('extends', 'inherits')
        return lt === 'extends:' || lt === 'inherits:';
    }

    // Traverse up (who this class inherits from)
    function collectUp(nodeId, visited) {
        if (!nodeId || visited.has(nodeId)) return;
        visited.add(nodeId);

        const parentLinks = allFileLinks.filter(link => link.NodeId === nodeId && linkIsInheritance(link));
        parentLinks.forEach(link => {
            linksToRender.add(link);
            collectUp(link.ParentNodeId, visited);
        });
    }

    // Traverse down (what inherits from this class)
    function collectDown(nodeId, visited) {
        if (!nodeId || visited.has(nodeId)) return;
        visited.add(nodeId);

        const childLinks = allFileLinks.filter(link => link.ParentNodeId === nodeId && linkIsInheritance(link));
        childLinks.forEach(link => {
            linksToRender.add(link);
            collectDown(link.NodeId, visited);
        });
    }

    collectUp(startNodeId, new Set());
    collectDown(startNodeId, new Set());

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
                    collectUp(parentNodeId, new Set());
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

    const renderedEdges = new Set();

    // Deduplicate links by (parent,node,linkType) key to avoid rendering duplicates from mixed sources
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

        const edgeKey = `${sourceNode.NodeId}->${destNode.NodeId}`;

        if (!renderedEdges.has(edgeKey)) {

            let label = '';

            if (typeof link.LinkType === 'string') {
                label = link.LinkType.split(':')[0].trim();
            }

            addEdge(sourceNode, destNode);

            renderedEdges.add(edgeKey);
        }
    });

    return getGraph();
}

module.exports = {
    generateInheritanceDiagram
};
