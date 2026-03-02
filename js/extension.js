const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { generateDependencyMap } = require('./dependencyMap');
const { generateIncludeDiagram } = require('./includeDiagram');
const { generateImpactDiagram } = require('./impactDiagram');
const { generateInterfaceDiagram } = require('./interfaceDiagram');
const { generateCallDiagram } = require('./callDiagram');
const { generateInheritanceDiagram } = require('./inheritanceDiagram');
const { sendToMermaid } = require('./sendToMermaid');
const { createMermaidViewer } = require('./mermaidviewer');
const { dumpDfFile, dumpAllDBDefinitions } = require('./dumpDfFile');

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
    const handleInheritanceDiagram = (ctx, uri) => generateInheritanceDiagram(ctx, uri, getDiagramDeps());
    const handleSendToMermaid = (ctx, uri) => sendToMermaid(ctx, uri, { vscode, fs });
    const getDumpDfFileDeps = () => ({
        vscode,
        fs,
        path,
        CrossWayAILog
    });
    // Updated to support new dumpDfFile signature with optional arguments
    const handleDumpDfFile = (ctx, dbName, workspaceRoot, pfFilePath) => dumpDfFile(ctx, getDumpDfFileDeps(), dbName, workspaceRoot, pfFilePath);
    const handleDumpAllDBDefinitions = (ctx) => dumpAllDBDefinitions(ctx, getDumpDfFileDeps());
    
    const handleTableRelationsDiagram = async (ctx, uri) => {
        if (!uri || !uri.fsPath) {
            vscode.window.showErrorMessage('No file selected');
            return;
        }
        
        try {
            // Get the filename without extension (database name)
            const fileName = path.basename(uri.fsPath, path.extname(uri.fsPath));
            
            // Read the template file
            const templatePath = path.join(ctx.extensionPath, 'resources', 'mermaid_prompts', '@mermaid_table_relations');
            const templateContent = fs.readFileSync(templatePath, 'utf8');
            
            // Replace <databasename> with actual database name
            const prompt = templateContent.replace(/<databasename>/g, fileName);
            
            // Open chat and pre-fill it with the prompt
            await vscode.commands.executeCommand('workbench.action.chat.open', { query: `@mermaid\n${prompt}` });
        } catch (error) {
            vscode.window.showErrorMessage(`Error processing table relations: ${error.message}`);
        }
    };

    const commands = [
        { name: 'crosswayai.generateMap', handler: handleDependencyMap },
        { name: 'crosswayai.generateImpactDiagram', handler: handleImpactDiagram },
        { name: 'crosswayai.generateIncludeDiagram', handler: handleIncludeDiagram },
        { name: 'crosswayai.generateInterfaceDiagram', handler: handleInterfaceDiagram },
        { name: 'crosswayai.generateCallDiagram', handler: handleCallDiagram },
        { name: 'crosswayai.generateInheritanceDiagram', handler: handleInheritanceDiagram },
        { name: 'crosswayai.sendToMermaid', handler: handleSendToMermaid },
        { name: 'crosswayai.openMermaidViewer', handler: openMermaidViewer },
        { name: 'crosswayai.dumpDfFile', handler: handleDumpDfFile },
        { name: 'crosswayai.dumpAllDBDefinitions', handler: handleDumpAllDBDefinitions },
        { name: 'crosswayai.generateTableRelationsDiagram', handler: handleTableRelationsDiagram }
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
