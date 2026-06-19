const {
    generateDiagram,
    generateMermaidRelationshipChainGraph
} = require('./diagramCommon');
const {
    edgeDetailLabelExtractor
} = require('./edgeInfo');

const PROPERTY_RELATIONSHIP_TYPES = ['property', 'public-property', 'inherited-property'];

async function generatePropertyAccessDiagram(context, uri) {
    return generateDiagram(context, uri, 'property_access', generateMermaidPropertyAccessGraph);
}

function generateMermaidPropertyAccessGraph(dsMap, targetNode, graphType = 'LR') {
    return generateMermaidRelationshipChainGraph(dsMap, targetNode, {
        graphType,
        diagramTypeName: 'property access',
        relationshipTypes: PROPERTY_RELATIONSHIP_TYPES,
        includeDetailLabels: true,
        detailLabelExtractor: edgeDetailLabelExtractor
    });
}

module.exports = {
    generatePropertyAccessDiagram
};
