const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const { getCrossWayAILog } = require('./crosswayaiLogger');
const { resolveWorkspaceRoot,
        getOpenEdgeProjectConfig,
        resolveProjectSourceDirs,
        getProjectOEVersion,
        getRuntimeDLC } = require('./workspaceProjects');
const { buildProparsePropath,
        buildCombinedSchema,
        resolveJavaPath,
        spawnProparse } = require('./proparseContext');

const PROPARSE_DIR = 'proparse';  // subdirectory under resources/

/**
 * Proparse All Projects
 *
 * For every workspace folder that contains an openedge-project.json:
 *   - Reads the source directories declared in buildPath (type: "source").
 *   - Runs Proparser in batch mode against each source directory.
 *   - Writes one .ast.json file per source file under:
 *       .crosswayai/.proparse/<projectName>/<relative-source-dir>/<filename>.ast.json
 *
 * Supports single-project and multi-project workspaces.
 *
 * @param {Object} context - VS Code extension context.
 */
async function proparseAllProjects(context) {

    const CrossWayAILog = getCrossWayAILog();

    CrossWayAILog.appendLine('\n>Proparse All Projects: Starting...');
    CrossWayAILog.show(true);

    // ── 1. Validate Java ───────────────────────────────────────────────────
    const javaExe = await resolveJavaPath();
    if (!javaExe) {
        vscode.window.showErrorMessage(
            'CrossWayAI: Java not found. Install a JDK and add it to your PATH.'
        );
        return;
    }

    // ── 2. Validate workspace ──────────────────────────────────────────────
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
        vscode.window.showErrorMessage('CrossWayAI: No workspace folder found.');
        return;
    }

    // ── 3. Locate the proparse directory ────────────────────────────────
    const proparsePath = path.join(context.extensionPath, 'resources', PROPARSE_DIR);
    if (!fs.existsSync(proparsePath)) {
        vscode.window.showErrorMessage('CrossWayAI: resources/proparse/ directory not found. The extension may be incomplete.');
        return;
    }

    // ── 4. Resolve workspace root and output base ──────────────────────────
    const workspaceRoot  = resolveWorkspaceRoot(workspaceFolders);
    const proparseOutBase = path.join(workspaceRoot, '.crosswayai', '.proparse');

    // Ensure base output directory exists
    fs.mkdirSync(proparseOutBase, { recursive: true });

    // ── 5. Collect projects ────────────────────────────────────────────────
    const projectRoots = [];
    for (const folder of workspaceFolders) {
        const projectJsonPath = path.join(folder.uri.fsPath, 'openedge-project.json');
        if (fs.existsSync(projectJsonPath)) {
            projectRoots.push({ root: folder.uri.fsPath, projectJsonPath });
        }
    }

    if (projectRoots.length === 0) {
        vscode.window.showErrorMessage('CrossWayAI: openedge-project.json not found in any workspace folder.');
        return;
    }

    CrossWayAILog.appendLine(`>Proparse All Projects: Found ${projectRoots.length} project(s).`);

    let totalSuccess = 0;
    let totalError   = 0;

    // ── 6. Process each project ────────────────────────────────────────────
    for (const { root: projectRoot, projectJsonPath } of projectRoots) {
        const projectName = path.basename(projectRoot);
        CrossWayAILog.appendLine(`\n>Proparse All Projects: Processing project "${projectName}"...`);

        // Load project config
        const projectCfg = getOpenEdgeProjectConfig(projectRoot);
        if (!projectCfg) {
            CrossWayAILog.appendLine('>Proparse All Projects: Failed to parse openedge-project.json');
            vscode.window.showErrorMessage(`CrossWayAI: Failed to parse openedge-project.json in ${projectRoot}.`);
            continue;
        }

        const proversion = getProjectOEVersion(projectRoot);
        const dlcPath = getRuntimeDLC(proversion);
        if (!dlcPath) {
            CrossWayAILog.appendLine(`>Proparse All Projects: No runtime path configured for OpenEdge version "${proversion}" in project "${projectName}". Skipping.`);
            vscode.window.showErrorMessage(`CrossWayAI: No runtime path configured for OpenEdge version ${proversion}. Please configure abl.configuration.runtimes.`);
            totalError++;
            continue;
        }

        // Build PROPATH
        const propath = buildProparsePropath(projectCfg, projectRoot, dlcPath);
        CrossWayAILog.appendLine(`>Proparse All Projects: PROPATH built (${propath.split(',').length} entries)`);

        // Build combined schema
        const dumpDir  = path.join(workspaceRoot, '.crosswayai', 'dump', projectName);
        const schemaPath = buildCombinedSchema(dumpDir, workspaceRoot, projectName);

        if (!schemaPath) {
            CrossWayAILog.appendLine(
                `>Proparse All Projects: No schema found for "${projectName}". ` +
                `Continuing without schema (DB table references will not be resolved).`
            );
            // Not a fatal error — Proparse can still parse syntax without a schema
        }

        // Get source directories
        const sourceDirs = resolveProjectSourceDirs(projectRoot);
        if (sourceDirs.length === 0) {
            CrossWayAILog.appendLine(`>Proparse All Projects: No source directories declared in "${projectName}". Skipping.`);
            continue;
        }

        CrossWayAILog.appendLine(`>Proparse All Projects: Source directories: ${sourceDirs.join(', ')}`);

        // Process each source directory
        for (const srcDir of sourceDirs) {
            if (!fs.existsSync(srcDir)) {
                CrossWayAILog.appendLine(`>Proparse All Projects: Source dir not found, skipping: ${srcDir}`);
                continue;
            }

            // Mirror the source dir's relative path (from project root) in the output
            const srcRelFromProject = path.relative(projectRoot, srcDir);
            const outDir = path.join(proparseOutBase, projectName, srcRelFromProject);
            fs.mkdirSync(outDir, { recursive: true });

            CrossWayAILog.appendLine(`>Proparse All Projects: Parsing "${srcDir}" → "${outDir}"...`);

            const javaArgs = [
                '--srcdir',     srcDir,
                '--outdir',     outDir,
                '--propath',    propath,
                '--proversion', proversion,
                ...(schemaPath ? ['--schema', schemaPath] : [])
            ];

            try {
                const output = await spawnProparse(javaExe, proparsePath, javaArgs);

                // Write detailed output to the physical crosswayai.log file
                const logFile = path.join(workspaceRoot, '.crosswayai', 'crosswayai.log');
                fs.appendFileSync(logFile, `\n--- Proparse Batch: ${srcDir} ---\n${output}\n`);

                // Extract counts from summary line
                const match = output.match(/Parsed (\d+) file\(s\), (\d+) error\(s\)/);
                if (match) {
                    CrossWayAILog.appendLine(`>Proparse All Projects: Batch complete for "${srcDir}". Parsed ${match[1]} file(s), ${match[2]} error(s).`);
                    totalSuccess += parseInt(match[1], 10);
                    totalError   += parseInt(match[2], 10);
                } else {
                    CrossWayAILog.appendLine(`>Proparse All Projects:\n${output.trim()}`);
                }
            } catch (error) {
                CrossWayAILog.appendLine(`>Proparse All Projects: Error processing "${srcDir}": ${error.message}`);
                totalError++;
            }
        }
    }

    // ── 7. Summary ─────────────────────────────────────────────────────────
    const logFile = path.join(workspaceRoot, '.crosswayai', 'crosswayai.log');
    const summary = `>Proparse All Projects: Done. ${totalSuccess} file(s) parsed, ${totalError} error(s). Output: ${proparseOutBase}\n>For full details, check: ${logFile}`;
    CrossWayAILog.appendLine(`\n${summary}`);
    CrossWayAILog.show(true);

    if (totalError === 0) {
        vscode.window.showInformationMessage(
            `CrossWayAI: Proparse complete — ${totalSuccess} file(s) parsed. See CrossWayAILog for details.`
        );
    } else {
        vscode.window.showWarningMessage(
            `CrossWayAI: Proparse completed with ${totalError} error(s). See CrossWayAILog for details.`
        );
    }
}

module.exports = { proparseAllProjects };
