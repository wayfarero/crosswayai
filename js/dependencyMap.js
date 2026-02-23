const { spawn } = require('child_process');

async function generateDependencyMap(context, deps) {
    const { vscode, fs, path, CrossWayAILog } = deps;

    CrossWayAILog.appendLine("Started generating dependency map...");
    CrossWayAILog.show(true);
    vscode.window.showInformationMessage('CrossWayAI: Generating dependency map...');

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

    const workspaceRoot = workspaceFolders[0].uri.fsPath;
    const crosswayaiDir = path.join(workspaceRoot, '.crosswayai');
    CrossWayAILog.appendLine(">workspaceRoot: " + workspaceRoot);
    CrossWayAILog.appendLine(">crosswayaiDir: " + crosswayaiDir);
    CrossWayAILog.show(true);

    try {
        if (!fs.existsSync(crosswayaiDir)) {
            fs.mkdirSync(crosswayaiDir);
        }

        const projectCfg = loadOpenEdgeProjectConfig(workspaceRoot, { vscode, fs, path });
        const sourcePaths = (projectCfg.buildPath || [])
            .filter(p => p.type === 'source' && p.path)
            .map(p => p.path);

        CrossWayAILog.appendLine(">sourcePaths: " + sourcePaths);
        CrossWayAILog.show(true);

        const dsMap = await findSourceFiles(workspaceRoot, sourcePaths, { fs, path, CrossWayAILog });
        const dsMapPath = path.join(crosswayaiDir, 'dsMap.json');
        fs.writeFileSync(dsMapPath, JSON.stringify(dsMap, null, 2));

        CrossWayAILog.appendLine(`>Found ${dsMap.dsMap.ttFile.length} files. Initial dsMap.json created.`);
        CrossWayAILog.show(true);
        vscode.window.showInformationMessage(`CrossWayAI: Found ${dsMap.dsMap.ttFile.length} files. Initial dsMap.json created.`);

        vscode.window.showInformationMessage('CrossWayAI: Handing off to ABL script for deep analysis...');
        await runABLAnalysis(context, workspaceRoot, { vscode, fs, path, CrossWayAILog });
    } catch (error) {
        CrossWayAILog.appendLine(`**Error during map generation: ${error.message}`);
        CrossWayAILog.show(true);
        vscode.window.showErrorMessage('CrossWayAI: An error occurred during map generation. See console for details.');
    }
}

async function runABLAnalysis(context, workspaceRoot, deps) {
    const { vscode, fs, path, CrossWayAILog } = deps;
    const dlcEnv = process.env.DLC || process.env.dlc;

    if (!dlcEnv) {
        vscode.window.showErrorMessage('Environment variable DLC is not set. Please set %DLC% to your OpenEdge installation path and restart VS Code.');
        return;
    }

    const crosswayaiDir = path.join(workspaceRoot, '.crosswayai');
    const logFile = path.join(crosswayaiDir, 'crosswayai.log');
    const logStream = fs.createWriteStream(logFile, { flags: 'a' });

    const extensionAblPath = path.join(context.extensionPath, 'crosswayai.pl');
    const runScriptPath = path.join('core', 'runAnalysis.p');

    const propath = [
        extensionAblPath
    ].join(',');

    const executable = path.join(dlcEnv, 'bin', '_progres');
    const args = [
        '-b',
        '-p',
        runScriptPath,
        '-baseADE',
        propath,
        '-param',
        `${workspaceRoot}`
    ];

    CrossWayAILog.appendLine(`>Spawning ABL process: ${executable} ${args.join(' ')}`);
    CrossWayAILog.appendLine(`>Logging to: ${logFile}`);
    CrossWayAILog.show(true);

    return new Promise((resolve, reject) => {
        const ablProcess = spawn(executable, args);

        ablProcess.stdout.pipe(logStream);
        ablProcess.stderr.pipe(logStream);

        ablProcess.on('error', (error) => {
            console.error(`spawn error: ${error}`);
            vscode.window.showErrorMessage(`ABL script execution failed. Make sure '${executable}' is in your system's PATH. Error: ${error.message}`);
            reject(error);
        });

        ablProcess.on('close', (code) => {
            if (code !== 0) {
                console.error(`ABL process exited with code ${code}`);
                vscode.window.showErrorMessage(`ABL script execution failed with code ${code}. See ${logFile} for details.`);
                reject(new Error(`ABL process exited with code ${code}`));
            } else {
                console.log('ABL process finished successfully.');
                vscode.window.showInformationMessage('CrossWayAI: Dependency map generation complete!');
                resolve();
            }
        });
    });
}

function findProjectRoot(startDir, deps) {
    const { fs, path } = deps;
    let currentDir = startDir;
    const fsRoot = path.parse(startDir).root;
    while (currentDir !== fsRoot) {
        const oedgeProjectFile = path.join(currentDir, 'openedge-project.json');
        if (fs.existsSync(oedgeProjectFile)) {
            return currentDir;
        }
        currentDir = path.dirname(currentDir);
    }

    const oedgeProjectFile = path.join(currentDir, 'openedge-project.json');
    if (fs.existsSync(oedgeProjectFile)) {
        return currentDir;
    }

    return null;
}

function loadOpenEdgeProjectConfig(filePath, deps) {
    const { vscode, fs, path } = deps;
    let cfg = {};
    let oeProjectRoot = findProjectRoot(filePath, { fs, path });
    if (!oeProjectRoot) {
        oeProjectRoot = filePath;
    }

    const openedgeProjectJsonPath = path.join(oeProjectRoot, 'openedge-project.json');

    if (fs.existsSync(openedgeProjectJsonPath)) {
        try {
            const raw = fs.readFileSync(openedgeProjectJsonPath, 'utf8');
            cfg = JSON.parse(raw);
        } catch (err) {
            vscode.window.showErrorMessage('Failed to load openedge-project.json: ' + (err.message || err.toString()));
        }
    }

    return cfg;
}

async function findSourceFiles(workspaceRoot, sourcePaths = [], deps) {
    const { fs, path, CrossWayAILog } = deps;
    const allFiles = [];
    const sourceExtensions = ['.p', '.w', '.cls', '.i'];
    const ignoreDirs = ['node_modules', '.git', '.vscode', '.idea', 'target', 'build', 'dist', 'ablunit-output'];

    async function discoverFiles(currentPath, currentSourcePath) {
        try {
            const dirents = fs.readdirSync(currentPath, { withFileTypes: true });
            for (const dirent of dirents) {
                const fullPath = path.join(currentPath, dirent.name);
                if (dirent.isDirectory()) {
                    if (!ignoreDirs.includes(dirent.name.toLowerCase()) && !dirent.name.startsWith('.')) {
                        await discoverFiles(fullPath, currentSourcePath);
                    }
                } else if (sourceExtensions.includes(path.extname(dirent.name).toLowerCase())) {
                    allFiles.push({ fullPath, sourcePath: currentSourcePath });
                }
            }
        } catch (error) {
            CrossWayAILog.appendLine(`>Error reading directory: ${currentPath} - ${error.message}`);
        }
    }

    for (const sourcePath of sourcePaths) {
        const absolutePath = path.isAbsolute(sourcePath) ? sourcePath : path.join(workspaceRoot, sourcePath);
        if (fs.existsSync(absolutePath)) {
            await discoverFiles(absolutePath, sourcePath);
        } else {
            CrossWayAILog.appendLine(`>Source path not found: ${absolutePath}`);
        }
    }

    return {
        dsMap: {
            ttFile: allFiles.map(item => ({
                fileName: path.basename(item.fullPath),
                filePath: item.fullPath,
                source: item.sourcePath === '.' ? '' : item.sourcePath
            }))
        }
    };
}

module.exports = {
    generateDependencyMap
};
