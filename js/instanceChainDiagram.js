const {
    generateDiagram,
    generateMermaidRelationshipChainGraph
} = require('./diagramCommon');

async function generateInstanceChainDiagram(context, uri, deps) {
    return generateDiagram(context, uri, deps, 'instance_chain', generateMermaidInstanceChainGraph);
}

function generateMermaidInstanceChainGraph(dsMap, targetNode, deps, graphType = 'LR') {
    return generateMermaidRelationshipChainGraph(dsMap, targetNode, deps, {
        graphType,
        diagramTypeName: 'instance chain',
        relationshipTypes: ['new']
    });
}

module.exports = {
    generateInstanceChainDiagram
};
