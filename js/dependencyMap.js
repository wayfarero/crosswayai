const { runABLScript, resolveWorkspaceRoot, cleanupDirectory } = require('./diagramCommon');

function getProjectNameForFolder(folder, path) {
    return folder.name || path.basename(folder.uri.fsPath);
}

function getDsMapFileCount(dsMapPath, fs) {
    if (!fs.existsSync(dsMapPath)) {
        return 0;
    }
    try {
        const data = JSON.parse(fs.readFileSync(dsMapPath, 'utf8'));
        return (data.dsMap && data.dsMap.ttFile) ? data.dsMap.ttFile.length : 0;
    } catch (e) {
        return 0;
    }
}

function normalizeSourcePathForWorkspace(absolutePath, workspaceRoot, path) {
    const relative = path.relative(workspaceRoot, absolutePath);
    return relative || '.';
}

async function generateDependencyMap(context, deps) {
    const { vscode, fs, path, CrossWayAILog } = deps;

    vscode.window.showInformationMessage('CrossWayAI: Generating dependency map...');

    const workspaceRoot = resolveWorkspaceRoot(vscode.workspace.workspaceFolders, fs, CrossWayAILog);
    CrossWayAILog.appendLine(`Started generating dependency map for workspace: ${workspaceRoot} ...`);
    CrossWayAILog.show(true);
    
    const crosswayaiDir = path.join(workspaceRoot, '.crosswayai');
    
    if (!fs.existsSync(crosswayaiDir)) {
        fs.mkdirSync(crosswayaiDir);
    }
    CrossWayAILog.appendLine(`>crosswayaiDir created: ${crosswayaiDir}`);
    CrossWayAILog.show(true);
    
    const dlcEnv = process.env.DLC || process.env.dlc;
    if (!dlcEnv) {
        vscode.window.showErrorMessage('Environment variable DLC is not set. Please set %DLC% to your OpenEdge installation path and restart VS Code.');
        return;
    }

    CrossWayAILog.appendLine(">dlc: " + dlcEnv);
    CrossWayAILog.show(true);

    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
        CrossWayAILog.appendLine("**No workspace folder found. Please open a workspace.");
        CrossWayAILog.show(true);
        vscode.window.showErrorMessage('CrossWayAI: No workspace folder found. Please open a workspace.');
        return;
    }

    const projectResults = [];

    const workspaceSourcePathMap = new Map();
    
    for (const folder of workspaceFolders) {
        const projectRoot = folder.uri.fsPath;
        
        // Skip the workspace root folder in multi-project workspaces
        if (workspaceFolders.length > 1 && path.normalize(projectRoot) === path.normalize(workspaceRoot)) {
            continue;
        }

        const projectCfg = loadOpenEdgeProjectConfig(folder, { vscode, fs, path, CrossWayAILog });
        const sourcePaths = (projectCfg.buildPath || [])
            .filter(p => p.type === 'source' && p.path)
            .map(p => p.path);

        workspaceSourcePathMap.set(projectRoot, sourcePaths);
       
    }

          
    const dsMapPath = path.join(crosswayaiDir, 'dsMap.json');
    if (fs.existsSync(dsMapPath)) {
        fs.unlinkSync(dsMapPath);
    }
    
    for (const folder of workspaceFolders) {
        const projectRoot = folder.uri.fsPath;
        const projectName = getProjectNameForFolder(folder, path);
        const projectSubPath = path.relative(workspaceRoot, projectRoot) || '';


        // Skip the workspace root folder in multi-project workspaces
        if (workspaceFolders.length > 1 && path.normalize(projectRoot) === path.normalize(workspaceRoot)) {
            continue;
        }       

        try {

            const sourcePaths = workspaceSourcePathMap.get(projectRoot) || [];

            CrossWayAILog.appendLine(`>projectName (${projectName}), projectSubPath (${projectSubPath}), sourcePaths: ${sourcePaths}`);
            CrossWayAILog.show(true);

            const dsMap = await findSourceFiles(projectRoot, sourcePaths, { vscode, fs, path, CrossWayAILog }, projectSubPath);

            const prevCount = getDsMapFileCount(dsMapPath, fs);

            // Append to existing dsMap.json if it exists from a previous iteration
            if (fs.existsSync(dsMapPath)) {
                try {
                    const existing = JSON.parse(fs.readFileSync(dsMapPath, 'utf8'));
                    if (existing.dsMap && existing.dsMap.ttFile) {
                        dsMap.dsMap.ttFile = existing.dsMap.ttFile.concat(dsMap.dsMap.ttFile);
                    }
                } catch (e) { /* ignore parse errors, start fresh */ }
            }
            fs.writeFileSync(dsMapPath, JSON.stringify(dsMap, null, 2));

            const totalCount = getDsMapFileCount(dsMapPath, fs);
            const deltaCount = totalCount - prevCount;
            projectResults.push({ projectName, projectRoot, fileCount: deltaCount, success: true });
            CrossWayAILog.appendLine(`>Found ${deltaCount} files for ${projectName} (total: ${totalCount}).`);
            CrossWayAILog.show(true);

        } catch (error) {
            projectResults.push({ projectName, projectRoot, success: false, error });
            CrossWayAILog.appendLine(`**Error during map generation for ${projectName}: ${error.message}`);
            CrossWayAILog.show(true);
        }
    }

    const failedProjects = projectResults.filter(result => !result.success);
    const successfulProjects = projectResults.filter(result => result.success);

    if (successfulProjects.length === 0) {
        CrossWayAILog.appendLine("**No successful projects. Aborting analysis.");
        CrossWayAILog.show(true);
        const failedNames = failedProjects.map(project => project.projectName).join(', ');
        vscode.window.showWarningMessage(`CrossWayAI: Dependency map generation failed for all projects: ${failedNames}. See CrossWayAILog for details.`);
        return;
    }

    CrossWayAILog.appendLine(`>Running ABL analysis...`);
    CrossWayAILog.show(true);
    try {
        await runABLAnalysis(context, workspaceRoot, { vscode, fs, path, CrossWayAILog });
    } catch (error) {
        CrossWayAILog.appendLine(`**Error during ABL analysis: ${error.message}`);
        CrossWayAILog.show(true);
    }

    CrossWayAILog.appendLine("Done generating dependency map.");
    CrossWayAILog.show(true);

    if (failedProjects.length > 0) {
        const failedNames = failedProjects.map(project => project.projectName).join(', ');
        vscode.window.showWarningMessage(`CrossWayAI: Dependency map generation completed with errors. Failed projects: ${failedNames}. See CrossWayAILog for details.`);
        return;
    }

    if (successfulProjects.length === 1) {
        vscode.window.showInformationMessage('CrossWayAI: Dependency map generation complete.');
        return;
    }

    vscode.window.showInformationMessage(`CrossWayAI: Dependency map generation complete for ${successfulProjects.length} projects.`);
}

async function runABLAnalysis(context, workspaceRoot, deps) {
    const extraArgs = ['-param', JSON.stringify({ workspaceRoot })];
    await runABLScript({ context, workspaceRoot, deps, scriptName: 'core/runAnalysis.p', args: extraArgs });
    const { fs, path, CrossWayAILog } = deps;
    const tempDir = path.join(workspaceRoot, '.crosswayai/temp');
    await cleanupDirectory(tempDir, fs, CrossWayAILog);
}


function loadOpenEdgeProjectConfig(folder, deps) {
    
    const projectRoot = folder.uri.fsPath;
    const { vscode, fs, path, CrossWayAILog } = deps;
    const projectName = getProjectNameForFolder(folder, path);
    let cfg = {};
    
    const openedgeProjectJsonPath = path.join(projectRoot, 'openedge-project.json');

    if (fs.existsSync(openedgeProjectJsonPath)) {
        CrossWayAILog.appendLine(`>OpenEdge project config found for project : ${projectName}`);
        CrossWayAILog.show(true);        
        try {
            const raw = fs.readFileSync(openedgeProjectJsonPath, 'utf8');
            cfg = JSON.parse(raw);
        } catch (err) {
            vscode.window.showErrorMessage('Failed to load openedge-project.json: ' + (err.message || err.toString()));
        }
    }

    return cfg;
}

async function findSourceFiles(projectRoot, sourcePaths = [], deps, projectName) {
    const { fs, path, CrossWayAILog } = deps;
    const sourceExtensions = ['.p', '.w', '.cls', '.i'];
    const ttFile = [];

    for (const sourcePath of sourcePaths) {
        const normalizedSourcePath = sourcePath.replace(/[\\/]/g, path.sep);
        const sourceDir = path.isAbsolute(normalizedSourcePath)
            ? normalizedSourcePath
            : path.resolve(projectRoot, normalizedSourcePath);

        if (!fs.existsSync(sourceDir)) {
            CrossWayAILog.appendLine(`>Source path not found: ${sourceDir}`);
            continue;
        }

        const source = normalizeSourcePathForWorkspace(sourceDir, projectRoot, path);
        const normalizedSource = (source === '.') ? '' : source;

        const queue = [{ fsPath: sourceDir, rawPath: sourceDir }];
        while (queue.length > 0) {
            const { fsPath, rawPath } = queue.shift();
            let dirents;
            try {
                dirents = fs.readdirSync(fsPath, { withFileTypes: true });
            } catch (error) {
                CrossWayAILog.appendLine(`>Error reading directory: ${fsPath} - ${error.message}`);
                continue;
            }
            for (const dirent of dirents) {
                const childFsPath = path.join(fsPath, dirent.name);
                const childRawPath = `${rawPath}${path.sep}${dirent.name}`;
                if (dirent.isDirectory()) {
                    if (!dirent.name.startsWith('.')) {
                        queue.push({ fsPath: childFsPath, rawPath: childRawPath });
                    }
                } else if (sourceExtensions.includes(path.extname(dirent.name).toLowerCase())) {
                    ttFile.push({
                        fileName: dirent.name,
                        filePath: childRawPath,
                        source: normalizedSource,
                        project: projectName
                    });
                }
            }
        }
    }

    return { dsMap: { ttFile } };
}

module.exports = {
    generateDependencyMap
};
