function resolveDiagramContext(context, uri, deps, missingRelationshipMessage) {
    const { vscode, fs, path, getDsMapArray } = deps;
    let filePath = '';

    if (uri && uri.fsPath) {
        filePath = uri.fsPath;
    } else {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showInformationMessage('No active editor or file context found.');
            return null;
        }
        filePath = editor.document.uri.fsPath;
    }

    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
        vscode.window.showErrorMessage('CrossWayAI: No workspace folder found.');
        return null;
    }

    const workspaceRoot = workspaceFolders[0].uri.fsPath;
    const dsMapPath = path.join(workspaceRoot, '.crosswayai', 'dsMap.json');

    if (!fs.existsSync(dsMapPath)) {
        vscode.window.showErrorMessage('CrossWayAI: dsMap.json not found. Please generate the map first.');
        return null;
    }

    const dsMapContent = fs.readFileSync(dsMapPath, 'utf8');
    const dsMap = JSON.parse(dsMapContent);

    const fileNodes = getDsMapArray(dsMap, 'ttFileNode');
    const fileLinks = getDsMapArray(dsMap, 'ttFileLink');

    if (fileNodes.length === 0 || fileLinks.length === 0) {
        vscode.window.showWarningMessage(missingRelationshipMessage);
        return null;
    }

    const targetNode = fileNodes.find(node => node.FilePath && node.FilePath.toLowerCase() === filePath.toLowerCase());
    if (!targetNode) {
        vscode.window.showInformationMessage(`File ${path.basename(filePath)} not found in dsMap.json.`);
        return null;
    }

    return {
        workspaceRoot,
        dsMap,
        targetNode
    };
}

function getDiagramConfig(diagramType) {
    switch (diagramType) {
        case 'include':
            return {
                missingRelationshipMessage: 'CrossWayAI: dsMap.json is missing include relationship data. Regenerate the map first.',
                persistDiagramType: 'include',
                errorMessage: 'CrossWayAI: An error occurred during include diagram generation.'
            };
        case 'impact':
            return {
                missingRelationshipMessage: 'CrossWayAI: dsMap.json is missing dependency relationship data. Regenerate the map first.',
                persistDiagramType: 'impact',
                errorMessage: 'CrossWayAI: An error occurred during impact diagram generation.'
            };
        default:
            throw new Error(`Unsupported diagram type: ${diagramType}`);
    }
}

async function generateDiagram(context, uri, deps, diagramType, graphBuilder) {
    const { vscode, CrossWayAILog, openMermaidViewer, persistMermaid, getDsMapArray } = deps;
    const config = getDiagramConfig(diagramType);

    try {
        const resolvedContext = resolveDiagramContext(context, uri, deps, config.missingRelationshipMessage);
        if (!resolvedContext) {
            return;
        }

        const { dsMap, targetNode, workspaceRoot } = resolvedContext;
        const mermaidGraph = graphBuilder(dsMap, targetNode, { vscode, getDsMapArray });

        if (!mermaidGraph) {
            return;
        }

        const savedPath = persistMermaid(workspaceRoot, config.persistDiagramType, targetNode.FileName, mermaidGraph);
        if (savedPath) {
            await openMermaidViewer(context, vscode.Uri.file(savedPath));
            vscode.window.showInformationMessage(`Mermaid diagram saved: ${savedPath}`);
        }
    } catch (error) {
        CrossWayAILog.appendLine(`**Error generating ${diagramType} diagram: ${error.message}`);
        CrossWayAILog.show(true);
        vscode.window.showErrorMessage(config.errorMessage);
    }
}

function createMermaidGraphWriter(targetNode) {
    let mermaidGraph = 'graph LR;\n';
    const declaredNodes = new Set();

    function getMermaidNodeId(fileName) {
        return String(fileName || 'unknown').replace(/[^a-zA-Z0-9_]/g, '_');
    }

    function getMermaidNodeLabel(fileName) {
        return String(fileName || 'unknown').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    }

    function ensureNodeDeclaration(node) {
        if (!node || !node.FileName) {
            return null;
        }

        const nodeId = getMermaidNodeId(node.FileName);
        if (!declaredNodes.has(nodeId)) {
            const nodeLabel = getMermaidNodeLabel(node.FileName);
            mermaidGraph += `    ${nodeId}["${nodeLabel}"]\n`;
            declaredNodes.add(nodeId);
        }

        return nodeId;
    }

    const startNodeName = ensureNodeDeclaration(targetNode);
    mermaidGraph += `    style ${startNodeName} fill:#f9f,stroke:#333,stroke-width:4px\n`;

    function addEdge(sourceName, destName, label) {
        if (!sourceName || !destName) {
            return;
        }

        if (label) {
            mermaidGraph += `    ${sourceName} -- ${label} --> ${destName};\n`;
        } else {
            mermaidGraph += `    ${sourceName} --> ${destName};\n`;
        }
    }

    function getGraph() {
        return mermaidGraph;
    }

    return {
        ensureNodeDeclaration,
        addEdge,
        getGraph
    };
}

module.exports = {
    resolveDiagramContext,
    createMermaidGraphWriter,
    generateDiagram
};