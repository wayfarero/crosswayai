let refreshActiveMermaidDiagramHandler = null;

function setRefreshActiveMermaidDiagramHandler(handler) {
    refreshActiveMermaidDiagramHandler = typeof handler === 'function' ? handler : null;
}

async function refreshActiveMermaidDiagram(context) {
    if (typeof refreshActiveMermaidDiagramHandler !== 'function') {
        return;
    }

    await refreshActiveMermaidDiagramHandler(context);
}

module.exports = {
    setRefreshActiveMermaidDiagramHandler,
    refreshActiveMermaidDiagram
};