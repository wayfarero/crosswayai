const {
    generateDiagram,
    generateMermaidRelationshipChainGraph
} = require('./diagramCommon');

async function generateIncludeDiagram(context, uri) {
    return generateDiagram(context, uri, 'include', generateMermaidIncludeGraph);
}

function generateMermaidIncludeGraph(dsMap, targetNode, graphType = 'TD') {
    return generateMermaidRelationshipChainGraph(dsMap, targetNode, {
        graphType,
        diagramTypeName: 'include',
        relationshipTypes: ['include']
    });
}

module.exports = {
    generateIncludeDiagram
};
