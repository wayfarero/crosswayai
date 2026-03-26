const { runABLScript, cleanupDirectory } = require('./diagramCommon');

async function dumpDfFile(context, deps, dbName, workspaceRoot, pfFilePath) {
    // Pass param and parameterFile as extra arguments
    const extraArgs = ['-param', JSON.stringify({ dbName, workspaceRoot })];
    
    if (pfFilePath) {
        extraArgs.push('-pf', pfFilePath);
    }
    return runABLScript({
        context,
        workspaceRoot,
        deps,
        scriptName: 'core/dumpDfFile.p',
        args: extraArgs
    });
}

async function dumpAllDBDefinitions(context, deps) {
    const { vscode, fs, path, CrossWayAILog } = deps;
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
        vscode.window.showErrorMessage('CrossWayAI: No workspace folder found.');
        return;
    }
    const workspaceRoot = workspaceFolders[0].uri.fsPath;
    const projectPath = path.join(workspaceRoot, 'openedge-project.json');
    if (!fs.existsSync(projectPath)) {
        CrossWayAILog.appendLine('>CrossWayAI: openedge-project.json not found.');
        CrossWayAILog.show(true);
        vscode.window.showErrorMessage('CrossWayAI: openedge-project.json not found.');
        return;
    }
    let dbConnections;
    try {
        const projectCfg = JSON.parse(fs.readFileSync(projectPath, 'utf8'));
        dbConnections = projectCfg.dbConnections || [];
    } catch (e) {
        CrossWayAILog.appendLine('>CrossWayAI: Failed to parse openedge-project.json.');
        CrossWayAILog.show(true);
        vscode.window.showErrorMessage('CrossWayAI: Failed to parse openedge-project.json.');
        return;
    }
    if (!Array.isArray(dbConnections) || dbConnections.length === 0) {
        CrossWayAILog.appendLine('>CrossWayAI: No database connections defined in openedge-project.json.');
        CrossWayAILog.show(true);
        vscode.window.showInformationMessage('CrossWayAI: No database connections defined in openedge-project.json.');
        return;
    }

    CrossWayAILog.appendLine('Starting dumpAllDBDefinitions...');
    CrossWayAILog.show(true);
    const pfFilePath = path.join(workspaceRoot, `.crosswayai/temp/dbConn.pf`);
    const connectValues = dbConnections.map(dbConn => dbConn.connect).filter(Boolean);
    await preparePfFile(connectValues, pfFilePath, fs);

    for (const dbConn of dbConnections) {
        const dbName = dbConn.name;
        if (dbName) {
            CrossWayAILog.appendLine(`Calling dumpDfFile for DB: ${dbName}`);
            CrossWayAILog.show(true);
            await dumpDfFile(context, deps, dbName, workspaceRoot, pfFilePath);
        }
    }
    
    // Clean up temp directory after all databases have been processed
    const tempDir = path.join(workspaceRoot, '.crosswayai/temp');
    await cleanupDirectory(tempDir, fs, CrossWayAILog);
    
    CrossWayAILog.appendLine('Completed dumpAllDBDefinitions.');
    CrossWayAILog.show(true);
}


/**
 * Prepares a .pf file with all connect values, one per line.
 * @param {Array<string>} connectValues - Array of connect strings.
 * @param {string} pfFilePath - Path to the .pf file to write.
 * @param {object} fs - Node.js fs module (dependency injected).
 * @returns {Promise<void>}
 */
/**
 * Prepares a .pf file with all connect values, one per line.
 * @param {Array<string>} connectValues - Array of connect strings.
 * @param {string} pfFilePath - Path to the .pf file to write.
 * @param {object} fs - Node.js fs module (dependency injected).
 * @returns {Promise<void>}
 */
async function preparePfFile(connectValues, pfFilePath, fs) {
    const path = require('path');
    await fs.promises.mkdir(path.dirname(pfFilePath), { recursive: true });
    const content = connectValues.join('\n');
    await fs.promises.writeFile(pfFilePath, content, 'utf8');
}

module.exports = {
    dumpDfFile,
    dumpAllDBDefinitions,
    preparePfFile
};
