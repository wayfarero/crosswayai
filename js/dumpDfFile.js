const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const { runABLScript, cleanupDirectory } = require('./diagramCommon');
const { getWorkspaceRoot, getProjectOEVersion, resolveProjectRootFromName } = require('./workspaceProjects');
const { getCrossWayAILog } = require('./crosswayaiLogger');

/**
 * Resolves relative paths in a connect string to absolute paths.
 * Handles patterns like: -db db/business.db, -db "path/to/db.db", etc.
 * @param {string} connectString - The connect string with potential relative paths
 * @param {string} workspaceRoot - The workspace root directory
 * @param {object} path - Node.js path module
 * @returns {string} Connect string with resolved paths
 */
function resolveConnectString(connectString, workspaceRoot) {
    if (!connectString) 
        return connectString;
    
    // Regex that will match -db, quote (if any), db path 
    const dbPathRegex = /(-db\s+)(['"]?)([^'"\s]+)\2/gi;
    
    return connectString.replace(dbPathRegex, (match, prefix, quote, dbPath) => {
        // Only resolve if the path is relative 
        if (dbPath && !path.isAbsolute(dbPath)) {
            const resolvedPath = path.join(workspaceRoot, dbPath);
            return `${prefix}${quote}${resolvedPath}${quote}`;
        }
        return match;
    });
}

/**
 * Returns true only for connect strings that use -db without -H and -S.
 * @param {string} connectString
 * @returns {boolean}
 */
function shouldResolveConnectString(connectString) {
    if (!connectString) {
        return false;
    }

    const hasDb = /(?:^|\s)-db(?:\s|$)/i.test(connectString);
    const hasHostOrService = /(?:^|\s)-(?:H|S)(?:\s|$)/i.test(connectString);
    return hasDb && !hasHostOrService;
}

/**
 * Calls the dumpDfFile.p ABL script to dump the definition of a database file.
 * @param {object} context extension context object
 * @param {string} dbName  name of the database to dump
 * @param {string} workspaceRoot path of the workspace root directory
 * @param {string} projectName name of the project (used for logging and output file naming)
 * @param {string} pfFilePath path to the parameter file
 * @returns 
 */
async function dumpDfFile(context, dbName, workspaceRoot, projectName, pfFilePath) {
    const CrossWayAILog = getCrossWayAILog();

    // If projectName is not provided, use the workspace Root folder name as the project name
    if (!projectName || projectName.trim() === "") {
        projectName = path.basename(workspaceRoot);
    }

    const projectRoot = resolveProjectRootFromName(projectName, workspaceRoot) || workspaceRoot;
    const oeversion = getProjectOEVersion(projectRoot);

    // Pass param and parameterFile as extra arguments
    const extraArgs = ['-param', JSON.stringify({ dbName, workspaceRoot, projectName })];
    
    if (pfFilePath) {
        extraArgs.push('-pf', pfFilePath);
    }
    return runABLScript({
        context,
        workspaceRoot,
        oeversion,
        scriptName: 'core/dumpDfFile.p',
        args: extraArgs
    });
}

/**
 * Dumps the definitions of all databases in the workspace.
 * @param {object} context extension context object
 * @returns {Promise<void>}
 */
async function dumpAllDBDefinitions(context) {
    const CrossWayAILog = getCrossWayAILog();

    // Create .crosswayai directory in project root folder
    const workspaceRoot = getWorkspaceRoot();
    if (!workspaceRoot) {
        return;
    }

    const crossWayDir   = path.join (workspaceRoot, '.crosswayai');

    if (!fs.existsSync(crossWayDir)) {
        fs.mkdirSync(crossWayDir);
    }

    // Find all workspace roots that contain openedge-project.json
    const workspaceFolders = vscode.workspace.workspaceFolders || [];
    const projectRoots = [];
    for (const folder of workspaceFolders) {
        const projectPath = path.join(folder.uri.fsPath, 'openedge-project.json');
        if (fs.existsSync(projectPath)) {
            projectRoots.push({ root: folder.uri.fsPath, projectPath });
        }
    }

    if (projectRoots.length === 0) {
        CrossWayAILog.appendLine('>CrossWayAI: openedge-project.json not found in any workspace folder.');
        CrossWayAILog.show(true);
        vscode.window.showErrorMessage('CrossWayAI: openedge-project.json not found in any workspace folder.');
        return;
    }

    CrossWayAILog.appendLine('\nStarting dumpAllDBDefinitions...');
    CrossWayAILog.show(true);

    for (const { root: projectRoot, projectPath } of projectRoots) {
        CrossWayAILog.appendLine(`>Processing project: ${projectRoot}`);
        CrossWayAILog.show(true);
        
        let dbConnections;
        try {
            const projectCfg = JSON.parse(fs.readFileSync(projectPath, 'utf8'));
            dbConnections = projectCfg.dbConnections || [];
        } catch (e) {
            CrossWayAILog.appendLine(`>CrossWayAI: Failed to parse openedge-project.json in ${projectRoot}.`);
            CrossWayAILog.show(true);
            vscode.window.showErrorMessage(`CrossWayAI: Failed to parse openedge-project.json in ${projectRoot}.`);
            continue;
        }

        if (!Array.isArray(dbConnections) || dbConnections.length === 0) {
            CrossWayAILog.appendLine(`>CrossWayAI: No database connections defined in ${projectRoot}.`);
            CrossWayAILog.show(true);
            continue;
        }

        const pfFilePath = path.join(workspaceRoot, `.crosswayai/temp/dbConn.pf`);
        const connectValues = dbConnections
            .map(dbConn => {
                const connectString = dbConn && dbConn.connect;
                return shouldResolveConnectString(connectString)
                    ? resolveConnectString(connectString, projectRoot)
                    : connectString;
            })
            .filter(Boolean);
        await preparePfFile(connectValues, pfFilePath);

        for (const dbConn of dbConnections) {
            const dbName = dbConn.name;
            if (dbName) {
                CrossWayAILog.appendLine(`>Calling dumpDfFile for DB: ${dbName}`);
                CrossWayAILog.show(true);
                await dumpDfFile(context, dbName, workspaceRoot, path.basename(projectRoot), pfFilePath);
            }
        }
        
        // Clean up temp directory for this project
        const tempDir = path.join(workspaceRoot, '.crosswayai/temp');
        await cleanupDirectory(tempDir);
    }
    
    CrossWayAILog.appendLine('Completed dumpAllDBDefinitions.\n');
    CrossWayAILog.show(true);
}


/**
 * Prepares a .pf file with all connect values, one per line.
 * @param {Array<string>} connectValues - Array of connect strings.
 * @param {string} pfFilePath - Path to the .pf file to write.
 * @param {object} fs - Node.js fs module (dependency injected).
 * @returns {Promise<void>}
 */
async function preparePfFile(connectValues, pfFilePath) {
    await fs.promises.mkdir(path.dirname(pfFilePath), { recursive: true });
    const content = connectValues.join('\n');
    await fs.promises.writeFile(pfFilePath, content, 'utf8');
}

module.exports = {
    dumpDfFile,
    dumpAllDBDefinitions,
    preparePfFile
};
