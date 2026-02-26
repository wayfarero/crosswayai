const { generateDiagram } = require('./diagramCommon');

async function generateInterfaceDiagram(context, uri, deps) {
    return generateDiagram(context, uri, deps, 'interface', generateMermaidInterfaceGraph);
}

function generateMermaidInterfaceGraph(dsMap, targetNode) {
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

    let mermaidGraph = 'graph BT;\n';
    const declaredNodes = new Set();

    function getMermaidNodeId(fileName) {
        return String(fileName || 'unknown').replace(/[^a-zA-Z0-9_]/g, '_');
    }

    function getMermaidNodeLabel(fileName) {
        return String(fileName || 'unknown').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    }

    function ensureNodeDeclaration(node) {
        if (!node || !node.FileName) {
            return null;
        }

        const nodeId = getMermaidNodeId(node.FileName);
        if (!declaredNodes.has(nodeId)) {
            const nodeLabel = getMermaidNodeLabel(node.FileName);
            mermaidGraph += `    ${nodeId}["${nodeLabel}"]\n`;
            declaredNodes.add(nodeId);
        }

        return nodeId;
    }

    const startNodeName = ensureNodeDeclaration(targetNode);
    mermaidGraph += `    style ${startNodeName} fill:#ff9,stroke:#333,stroke-width:4px\n`;

    // When the starting class neither implements any other class nor is implemented by any other class,
    // the Interface Diagram should display only the class itself.
    if (!hasOutgoingLinks && !hasIncomingLinks) {
        return mermaidGraph;
    }

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

        if (sourceNode && destNode) {
            const sourceName = ensureNodeDeclaration(sourceNode);
            const destName = ensureNodeDeclaration(destNode);
            // Emit source --> dest; in graph BT, dest (interface for interface links) renders above
            mermaidGraph += `    ${sourceName} --> ${destName};\n`;
        }
    });

    return mermaidGraph;
}

module.exports = {
    generateInterfaceDiagram
};