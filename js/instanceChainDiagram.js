const {
    generateDiagram,
    generateMermaidRelationshipChainGraph
} = require('./diagramCommon');

async function generateInstanceChainDiagram(context, uri) {
    return generateDiagram(context, uri, 'instance_chain', generateMermaidInstanceChainGraph);
}

function generateMermaidInstanceChainGraph(dsMap, targetNode, graphType = 'LR') {
    return generateMermaidRelationshipChainGraph(dsMap, targetNode, {
        graphType,
        diagramTypeName: 'instance chain',
        relationshipTypes: ['new']
    });
}

module.exports = {
    generateInstanceChainDiagram
};
