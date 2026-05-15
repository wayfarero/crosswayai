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
const { generatePropertyAccessDiagram } = require('./propertyAccessDiagram');
const { generateTableRelationsDiagram } = require('./tableRelationsDiagram');
const { createMermaidViewer } = require('./crosswayaiContainer');
const { dumpDfFile, dumpAllDBDefinitions } = require('./dumpDfFile');
const { getWorkspaceRoot } = require('./diagramCommon');
const { openXrefFile } = require('./fileHandling');
const { setCrossWayAILog } = require('./crosswayaiLogger');

const KNOWN_OE_VERSIONS = ['11.7', '12.8'];

//Create output channel
let CrossWayAILog = vscode.window.createOutputChannel("CrossWayAILog");
setCrossWayAILog(CrossWayAILog);
const { openCrosswayAIViewer, deactivateMermaidViewer, persistMermaid, isMermaidViewerVisible } = createMermaidViewer({
    http,
});

let activeGeneratedDiagram = null;

/**
 * Ensures the default extension settings file exists.
 * Copies the template from resources if .crosswayai/crosswayai_settings.json does not exist.
 * @param {vscode.ExtensionContext} context
 */
function ensureDefaultExtensionSettings(context) {
    try {
        const workspaceRoot = getWorkspaceRoot();
        if (!workspaceRoot) {
            return;
        }

        const crosswayaiDir = path.join(workspaceRoot, '.crosswayai');
        const settingsPath = path.join(crosswayaiDir, 'crosswayai_settings.json');

        // If settings file already exists, do nothing
        if (fs.existsSync(settingsPath)) {
            return;
        }

        // Create .crosswayai directory if it doesn't exist
        if (!fs.existsSync(crosswayaiDir)) {
            fs.mkdirSync(crosswayaiDir, { recursive: true });
        }

        // Copy default settings from resources
        const defaultSettingsPath = path.join(context.extensionPath, 'resources', 'crosswayai_settings.json');
        if (fs.existsSync(defaultSettingsPath)) {
            fs.copyFileSync(defaultSettingsPath, settingsPath);
            CrossWayAILog.appendLine(`Created default settings file at ${settingsPath}`);
        } else {
            CrossWayAILog.appendLine(`Warning: Default settings template not found at ${defaultSettingsPath}`);
        }
    } catch (error) {
        CrossWayAILog.appendLine(`Warning: Failed to ensure default settings file: ${error.message}`);
    }
}

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
    CrossWayAILog.appendLine("CrossWayAI extension is now active!");

    // Ensure default settings file exists
    ensureDefaultExtensionSettings(context);

    async function refreshActiveMermaidDiagram() {
        if (!activeGeneratedDiagram) {
            return;
        }

        if (!isMermaidViewerVisible()) {
            return;
        }

        try {
            CrossWayAILog.appendLine('Regenerating active Mermaid diagram after xref update.');
            await activeGeneratedDiagram.handler(context, activeGeneratedDiagram.uri);
        } catch (error) {
            CrossWayAILog.appendLine(`Failed to regenerate active Mermaid diagram after xref update: ${error.message}`);
        }
    }

    const getDiagramDeps = () => ({
        openCrosswayAIViewer,
        persistMermaid,
        getDsMapArray,
        knownOEVersions: KNOWN_OE_VERSIONS
    });

    const getCommonDeps = () => ({
        refreshActiveMermaidDiagram,
        knownOEVersions: KNOWN_OE_VERSIONS
    });

    const handleDependencyMap = (ctx) => generateDependencyMap(ctx, getCommonDeps());
    const handleImpactDiagram = (ctx, uri) => generateImpactDiagram(ctx, uri, getDiagramDeps());
    const handleIncludeDiagram = (ctx, uri) => generateIncludeDiagram(ctx, uri, getDiagramDeps());
    const handleInterfaceDiagram = (ctx, uri) => generateInterfaceDiagram(ctx, uri, getDiagramDeps());
    const handleCallDiagram = (ctx, uri) => generateCallDiagram(ctx, uri, getDiagramDeps());
    const handleInheritanceDiagram = (ctx, uri) => generateInheritanceDiagram(ctx, uri, getDiagramDeps());
    const handlePackageDiagram = (ctx, uri) => generatePackageDiagram(ctx, uri, getDiagramDeps());
    const handleInstanceChainDiagram = (ctx, uri) => generateInstanceChainDiagram(ctx, uri, getDiagramDeps());
    const handlePropertyAccessDiagram = (ctx, uri) => generatePropertyAccessDiagram(ctx, uri, getDiagramDeps());
    const handleTableRelationsDiagram = (ctx, uri) => generateTableRelationsDiagram(ctx, uri, getCommonDeps());
    const handleDumpDfFile = (ctx, dbName, workspaceRoot, pfFilePath) => dumpDfFile(ctx, getCommonDeps(), dbName, workspaceRoot, pfFilePath);
    const handleDumpAllDBDefinitions = (ctx) => dumpAllDBDefinitions(ctx, getCommonDeps());
    const handleOpenXrefFile = (ctx, uri) => openXrefFile(ctx, uri);

    const commands = [
        { name: 'crosswayai.generateMap', handler: handleDependencyMap },
        { name: 'crosswayai.generateImpactDiagram', handler: handleImpactDiagram, trackDiagram: true },
        { name: 'crosswayai.generateIncludeDiagram', handler: handleIncludeDiagram, trackDiagram: true },
        { name: 'crosswayai.generateInterfaceDiagram', handler: handleInterfaceDiagram, trackDiagram: true },
        { name: 'crosswayai.generateCallDiagram', handler: handleCallDiagram, trackDiagram: true },
        { name: 'crosswayai.generateInheritanceDiagram', handler: handleInheritanceDiagram, trackDiagram: true },
        { name: 'crosswayai.openCrosswayAIViewer', handler: openCrosswayAIViewer },
        { name: 'crosswayai.dumpDfFile', handler: handleDumpDfFile },
        { name: 'crosswayai.dumpAllDBDefinitions', handler: handleDumpAllDBDefinitions },
        { name: 'crosswayai.generateTableRelationsDiagram', handler: handleTableRelationsDiagram },
        { name: 'crosswayai.generatePackageDiagram', handler: handlePackageDiagram, trackDiagram: true },
        { name: 'crosswayai.generateInstanceChainDiagram', handler: handleInstanceChainDiagram, trackDiagram: true },
        { name: 'crosswayai.generatePropertyAccessDiagram', handler: handlePropertyAccessDiagram, trackDiagram: true },
        { name: 'crosswayai.openXrefFile', handler: handleOpenXrefFile }
    ];

    setupXrefWatcher(context, getCommonDeps());

    commands.forEach(command => {
        let disposableCommand;
        if (command.handler) {
            disposableCommand = vscode.commands.registerCommand(command.name, async (uri) => {
                ensureDefaultExtensionSettings(context);
                const sourceUri = command.trackDiagram
                    ? (uri || (vscode.window.activeTextEditor && vscode.window.activeTextEditor.document.uri))
                    : null;

                await command.handler(context, uri);

                if (sourceUri && sourceUri.fsPath) {
                    activeGeneratedDiagram = { handler: command.handler, uri: sourceUri };
                }
            });
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
