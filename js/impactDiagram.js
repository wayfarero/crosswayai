const vscode = require('vscode');
const {
    generateDiagram,
    createMermaidGraphWriter,
    buildLinkEdgeMap,
    getCircularEdgeKeys,
    renderSortedEdges,
    prependEdgeDetailsMetadata,
    collectBidirectionalLinks,
    getDsMapArray
} = require('./diagramCommon');
const {
    parseCallRelationLabel,
    edgeLabelExtractor,
    edgeDetailLabelExtractor
} = require('./edgeInfo');

async function generateImpactDiagram(context, uri) {
    return generateDiagram(context, uri, 'impact', generateMermaidImpactGraph);
}

function generateMermaidImpactGraph(dsMap, targetNode, graphType = 'LR') {
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



    const edges = buildLinkEdgeMap(Array.from(linksToRender), allFileNodes, ensureNodeDeclaration, {
        includeLabels: true,
        labelExtractor: edgeLabelExtractor,
        includeDetailLabels: true,
        detailLabelExtractor: edgeDetailLabelExtractor,
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
