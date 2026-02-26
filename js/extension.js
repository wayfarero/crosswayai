const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { generateDependencyMap } = require('./dependencyMap');
const { generateIncludeDiagram } = require('./includeDiagram');
const { generateImpactDiagram } = require('./impactDiagram');
const { generateInterfaceDiagram } = require('./interfaceDiagram');
const { generateCallDiagram } = require('./callDiagram');
const { sendToMermaid } = require('./sendToMermaid');
const { createMermaidViewer } = require('./mermaidviewer');

//Create output channel
let CrossWayAILog = vscode.window.createOutputChannel("CrossWayAILog");
const { openMermaidViewer, deactivateMermaidViewer, persistMermaid } = createMermaidViewer({
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
    const handleInterfaceDiagram = (ctx, uri) => generateInterfaceDiagram(ctx, uri, getDiagramDeps());
    const handleCallDiagram = (ctx, uri) => generateCallDiagram(ctx, uri, getDiagramDeps());
    const handleSendToMermaid = (ctx, uri) => sendToMermaid(ctx, uri, { vscode, fs });

    const commands = [
        { name: 'crosswayai.generateMap', handler: handleDependencyMap },
        { name: 'crosswayai.generateImpactDiagram', handler: handleImpactDiagram },
        { name: 'crosswayai.generateIncludeDiagram', handler: handleIncludeDiagram },
        { name: 'crosswayai.generateInterfaceDiagram', handler: handleInterfaceDiagram },
        { name: 'crosswayai.generateCallDiagram', handler: handleCallDiagram },
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
