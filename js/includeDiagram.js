const {
    generateDiagram,
    generateMermaidRelationshipChainGraph
} = require('./diagramCommon');

async function generateIncludeDiagram(context, uri, deps) {
    return generateDiagram(context, uri, deps, 'include', generateMermaidIncludeGraph);
}

function generateMermaidIncludeGraph(dsMap, targetNode, deps, graphType = 'TD') {
    return generateMermaidRelationshipChainGraph(dsMap, targetNode, deps, {
        graphType,
        diagramTypeName: 'include',
        relationshipTypes: ['include']
    });
}

module.exports = {
    generateIncludeDiagram
};
