const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { generateDependencyMap } = require('./dependencyMap');
const { setupXrefWatcher } = require('./xrefWatcher');
const { generateIncludeDiagram } = require('./includeDiagram');
const { generateImpactDiagram } = require('./impactDiagram');
const { generateInterfaceDiagram } = require('./interfaceDiagram');
const { generateCallDiagram } = require('./callDiagram');
const { generateInheritanceDiagram } = require('./inheritanceDiagram');
const { generatePackageDiagram } = require('./packageDiagram');
const { generateInstanceChainDiagram } = require('./instanceChainDiagram');
const { generateTableRelationsDiagram } = require('./tableRelationsDiagram');
const { createMermaidViewer } = require('./mermaidviewer');
const { dumpDfFile, dumpAllDBDefinitions } = require('./dumpDfFile');

//Create output channel
let CrossWayAILog = vscode.window.createOutputChannel("CrossWayAILog");
const { openCrosswayAIViewer, deactivateMermaidViewer, persistMermaid } = createMermaidViewer({
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
        openCrosswayAIViewer,
        persistMermaid,
        getDsMapArray
    });

    const getCommonDeps = () => ({
        vscode,
        fs,
        path,
        CrossWayAILog
    });

    const handleDependencyMap = (ctx) => generateDependencyMap(ctx, getCommonDeps());
    const handleImpactDiagram = (ctx, uri) => generateImpactDiagram(ctx, uri, getDiagramDeps());
    const handleIncludeDiagram = (ctx, uri) => generateIncludeDiagram(ctx, uri, getDiagramDeps());
    const handleInterfaceDiagram = (ctx, uri) => generateInterfaceDiagram(ctx, uri, getDiagramDeps());
    const handleCallDiagram = (ctx, uri) => generateCallDiagram(ctx, uri, getDiagramDeps());
    const handleInheritanceDiagram = (ctx, uri) => generateInheritanceDiagram(ctx, uri, getDiagramDeps());
    const handlePackageDiagram = (ctx, uri) => generatePackageDiagram(ctx, uri, getDiagramDeps());
    const handleInstanceChainDiagram = (ctx, uri) => generateInstanceChainDiagram(ctx, uri, getDiagramDeps());
    const handleTableRelationsDiagram = (ctx, uri) => generateTableRelationsDiagram(ctx, uri, getCommonDeps());
    const handleDumpDfFile = (ctx, dbName, workspaceRoot, pfFilePath) => dumpDfFile(ctx, getCommonDeps(), dbName, workspaceRoot, pfFilePath);
    const handleDumpAllDBDefinitions = (ctx) => dumpAllDBDefinitions(ctx, getCommonDeps());

    const commands = [
        { name: 'crosswayai.generateMap', handler: handleDependencyMap },
        { name: 'crosswayai.generateImpactDiagram', handler: handleImpactDiagram },
        { name: 'crosswayai.generateIncludeDiagram', handler: handleIncludeDiagram },
        { name: 'crosswayai.generateInterfaceDiagram', handler: handleInterfaceDiagram },
        { name: 'crosswayai.generateCallDiagram', handler: handleCallDiagram },
        { name: 'crosswayai.generateInheritanceDiagram', handler: handleInheritanceDiagram },
        { name: 'crosswayai.openCrosswayAIViewer', handler: openCrosswayAIViewer },
        { name: 'crosswayai.dumpDfFile', handler: handleDumpDfFile },
        { name: 'crosswayai.dumpAllDBDefinitions', handler: handleDumpAllDBDefinitions },
        { name: 'crosswayai.generateTableRelationsDiagram', handler: handleTableRelationsDiagram },
        { name: 'crosswayai.generatePackageDiagram', handler: handlePackageDiagram },
        { name: 'crosswayai.generateInstanceChainDiagram', handler: handleInstanceChainDiagram }
    ];

    setupXrefWatcher(context, getCommonDeps());

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
