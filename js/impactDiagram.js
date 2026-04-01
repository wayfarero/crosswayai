const {
    generateDiagram,
    createMermaidGraphWriter,
    toMermaidNodeId,
    buildLinkEdgeMap,
    getCircularEdgeKeys,
    renderSortedEdges
} = require('./diagramCommon');

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
    // include statements, inheritance, instantiation, etc.).
    function isImpactLink(link) {
        if (!link || !link.LinkType) return false;
        if (link.NodeId && link.ParentNodeId && link.NodeId === link.ParentNodeId) {
            return false;
        }
        const lt = link.LinkType.toLowerCase();
        // filter by well-known link type prefixes or exact types
        return (
            lt.startsWith('invoke') ||
            lt.startsWith('run') ||
            lt.startsWith('public-property:') ||
            lt === 'include' ||
            lt === 'inherits:' ||
            lt === 'implements:' ||
            lt === 'new'
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
    const edgeDetails = {};

    function parseCallRelationLabel(rawLinkType) {
        if (typeof rawLinkType !== 'string') {
            return '';
        }

        const normalized = rawLinkType.trim();
        if (!normalized) {
            return '';
        }

        const lower = normalized.toLowerCase();
        if (lower.startsWith('invoke:') || lower.startsWith('run:')) {
            const parts = normalized.split(':');
            if (parts.length > 1) {
                const methodOrProcedure = parts[1].split(',')[0].trim();
                if (methodOrProcedure) {
                    const relationType = lower.startsWith('invoke:') ? 'invoke' : 'run';
                    return `${methodOrProcedure.replace(/\s+/g, ' ')} (${relationType})`;
                }
            }
            return '';
        }

        if (lower.startsWith('public-property:')) {
            const parts = normalized.split(':');
            if (parts.length > 1) {
                const propertyName = parts.slice(1).join(':').trim();
                if (propertyName) {
                    return `${propertyName.replace(/\s+/g, ' ')} (public-property)`;
                }
            }
            return '';
        }

        return '';
    }

    const edges = buildLinkEdgeMap(Array.from(linksToRender), allFileNodes, ensureNodeDeclaration, {
        includeLabels: true,
        labelExtractor: link => {
            const rawLinkType = typeof link.LinkType === 'string' ? link.LinkType : '';
            return rawLinkType.split(':')[0].trim();
        },
        includeDetailLabels: true,
        detailLabelExtractor: link => parseCallRelationLabel(link.LinkType),
        preserveLinkTypeCase: false
    });

    const circular = getCircularEdgeKeys(edges);

    renderSortedEdges(edges, addEdge, {
        circularEdgeKeys: circular,
        labelBuilder: edge => Array.from(edge.labels).join(', ')
    });

    Array.from(edges.entries())
        .sort((a, b) => a[0].localeCompare(b[0]))
        .forEach(([, edge]) => {
        const sourceNodeId = toMermaidNodeId(edge.sourceNode.NodeId || edge.sourceNode.FilePath || edge.sourceNode.FileName);
        const destNodeId = toMermaidNodeId(edge.destNode.NodeId || edge.destNode.FilePath || edge.destNode.FileName);
        const metadataKey = `${sourceNodeId}->${destNodeId}`;
        const details = Array.from(edge.detailLabels)
            .map(item => String(item || '').replace(/\r?\n/g, ' ').trim())
            .filter(Boolean)
            .sort((a, b) => a.localeCompare(b));
        if (details.length > 0) {
            edgeDetails[metadataKey] = details;
        }
        });

    const graph = getGraph();
    const serializedEdgeDetails = JSON.stringify(edgeDetails);
    if (serializedEdgeDetails && serializedEdgeDetails !== '{}') {
        return `%%CROSSWAY_EDGE_DETAILS:${serializedEdgeDetails}\n${graph}`;
    }

    return graph;
}

module.exports = {
    generateImpactDiagram
};
