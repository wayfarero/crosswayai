const {
    generateDiagram,
    createMermaidGraphWriter,
    buildLinkEdgeMap,
    getCircularEdgeKeys,
    renderSortedEdges,
    getInvokeRunDisplayLabel,
    getFirstLinkTypeEntry,
    prependEdgeDetailsMetadata,
    parseNamedRelationLabel,
    collectBidirectionalLinks
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
            lt.startsWith('inherited-property:') ||
            lt === 'inherited-property' ||
            lt === 'include' ||
            lt === 'inherits:' ||
            lt === 'implements:' ||
            lt === 'new' ||
            lt === 'cast'
        );
    }

    collectBidirectionalLinks(allFileLinks, startNodeId, isImpactLink, { linksToRender });

    if (linksToRender.size === 0) {
        vscode.window.showInformationMessage(`No impact or dependency references found for ${targetNode.FileName}.`);
        return null;
    }

    const graphWriter = createMermaidGraphWriter(targetNode, graphType);
    const { ensureNodeDeclaration, addEdge, getGraph } = graphWriter;

    function parseCallRelationLabel(rawLinkType) {
        if (typeof rawLinkType !== 'string') {
            return '';
        }

        const normalized = rawLinkType.trim();
        if (!normalized) {
            return '';
        }

        const invokeRunLabel = getInvokeRunDisplayLabel(normalized, { includeRelationSuffix: true });
        if (invokeRunLabel) {
            return invokeRunLabel;
        }

        const lower = normalized.toLowerCase();

        if (lower.startsWith('public-property:') || lower.startsWith('inherited-property:')) {
            return parseNamedRelationLabel(normalized, ['public-property', 'inherited-property']);
        }

        return '';
    }

    const edges = buildLinkEdgeMap(Array.from(linksToRender), allFileNodes, ensureNodeDeclaration, {
        includeLabels: true,
        labelExtractor: link => getFirstLinkTypeEntry(link.LinkType, { toLowerCase: false }),
        includeDetailLabels: true,
        detailLabelExtractor: link => parseCallRelationLabel(link.LinkType),
        preserveLinkTypeCase: false
    });

    const circular = getCircularEdgeKeys(edges);

    renderSortedEdges(edges, addEdge, {
        circularEdgeKeys: circular
    });

    const graph = getGraph();
    return prependEdgeDetailsMetadata(graph, edges, {
        includeEdgeIndexKeys: true,
        includeEdgeMethodSigs: true,
        links: linksToRender,
        allFileNodes
    });
}

module.exports = {
    generateImpactDiagram
};
