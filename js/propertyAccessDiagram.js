const {
    generateDiagram,
    generateMermaidRelationshipChainGraph,
    parseNamedRelationLabel
} = require('./diagramCommon');

const PROPERTY_RELATIONSHIP_TYPES = ['property', 'public-property', 'inherited-property'];

async function generatePropertyAccessDiagram(context, uri, deps) {
    return generateDiagram(context, uri, deps, 'property_access', generateMermaidPropertyAccessGraph);
}

function generateMermaidPropertyAccessGraph(dsMap, targetNode, deps, graphType = 'LR') {
    return generateMermaidRelationshipChainGraph(dsMap, targetNode, deps, {
        graphType,
        diagramTypeName: 'property access',
        relationshipTypes: PROPERTY_RELATIONSHIP_TYPES,
        includeDetailLabels: true,
        detailLabelExtractor: link => parseNamedRelationLabel(
            link && link.LinkType,
            PROPERTY_RELATIONSHIP_TYPES
        )
    });
}

module.exports = {
    generatePropertyAccessDiagram
};
