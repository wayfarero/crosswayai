const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { generateDependencyMap } = require('./dependencyMap');
const { generateIncludeDiagram } = require('./includeDiagram');
const { generateImpactDiagram } = require('./impactDiagram');
const { sendToMermaid } = require('./sendToMermaid');
const { createMermaidViewer } = require('./mermaidviewer');

//Create output channel
let CrossWayAILog = vscode.window.createOutputChannel("CrossWayAILog");
const { openMermaidViewer, deactivateMermaidViewer } = createMermaidViewer({
    vscode,
    fs,
    path,
    http,
    CrossWayAILog
});

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
    CrossWayAILog.appendLine("CrossWayAI extension is now active!");

    const getDiagramDeps = () => ({
        vscode,
        fs,
        path,
        CrossWayAILog,
        openMermaidViewer,
        persistMermaid,
        getDsMapArray
    });

    const getDependencyMapDeps = () => ({
        vscode,
        fs,
        path,
        CrossWayAILog
    });

    const handleDependencyMap = (ctx) => generateDependencyMap(ctx, getDependencyMapDeps());
    const handleImpactDiagram = (ctx, uri) => generateImpactDiagram(ctx, uri, getDiagramDeps());
    const handleIncludeDiagram = (ctx, uri) => generateIncludeDiagram(ctx, uri, getDiagramDeps());
    const handleSendToMermaid = (ctx, uri) => sendToMermaid(ctx, uri, { vscode, fs });

    const commands = [
        { name: 'crosswayai.generateMap', handler: handleDependencyMap },
        { name: 'crosswayai.generateImpactDiagram', handler: handleImpactDiagram },
        { name: 'crosswayai.generateIncludeDiagram', handler: handleIncludeDiagram },
        { name: 'crosswayai.sendToMermaid', handler: handleSendToMermaid },
        { name: 'crosswayai.openMermaidViewer', handler: openMermaidViewer }
    ];

    commands.forEach(command => {
        let disposableCommand;
        if (command.handler) {
            disposableCommand = vscode.commands.registerCommand(command.name, (uri) => command.handler(context, uri));
        } else {
            disposableCommand = vscode.commands.registerCommand(command.name, () => {
                vscode.window.showInformationMessage(command.message);
            });
        }
        context.subscriptions.push(disposableCommand);
    });

}


/**
 * Persist mermaid graph text into the workspace .crosswayai/mermaid folder.
 * Returns the full path to the written file.
 */
function persistMermaid(workspaceRoot, diagramType, targetFileName, mermaidGraph) {
    try {
        const safeBase = `${diagramType}_${targetFileName}`.replace(/[^a-zA-Z0-9_\.\-]/g, '_');
        const fileName = safeBase + '.md';
        const dir = path.join(workspaceRoot, '.crosswayai', 'mermaid');
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        const outPath = path.join(dir, fileName);
        const fenced = '```mermaid\n' + mermaidGraph.trim() + '\n```\n';
        fs.writeFileSync(outPath, fenced, 'utf8');
        CrossWayAILog.appendLine(`Saved Mermaid ${diagramType} diagram to ${outPath}`);
        CrossWayAILog.show(true);
        return outPath;
    } catch (err) {
        CrossWayAILog.appendLine(`Failed to persist Mermaid ${diagramType} diagram: ${err.message}`);
        CrossWayAILog.show(true);
        return null;
    }
}

function getDsMapArray(dsMap, key) {
    if (!dsMap || typeof dsMap !== 'object' || !dsMap.dsMap || typeof dsMap.dsMap !== 'object') {
        return [];
    }

    const value = dsMap.dsMap[key];
    return Array.isArray(value) ? value : [];
}

function deactivate() {
    deactivateMermaidViewer();
}

module.exports = {
    activate,
    deactivate
}

