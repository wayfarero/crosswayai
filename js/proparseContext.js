const vscode = require('vscode');
const path = require('path');
const fs = require('fs');
const { getCrossWayAILog } = require('./crosswayaiLogger');
const { exec, spawn } = require('child_process');
const { DEFAULT_DLC_PROPATH_ENTRIES } = require('./extensionConstants');


// ─── PROPATH ─────────────────────────────────────────────────────────────────

/**
 * Build a fully-resolved, comma-separated PROPATH string for Proparse.
 *
 * 1. Reads all entries from openedge-project.json's `buildPath` array.
 * 2. Resolves ${DLC} / @{DLC} placeholders to the actual DLC path.
 * 3. Makes relative paths absolute (relative to projectRoot).
 * 4. Normalizes all path separators to the OS convention.
 * 5. Appends default DLC entries (OpenEdge built-in libraries).
 * 6. Removes duplicates while preserving order.
 *
 * @param {Object} projectCfg  - Parsed openedge-project.json object.
 * @param {string} projectRoot - Absolute path to the project root directory.
 * @param {string} dlcPath     - Absolute path to the DLC (OpenEdge installation) directory.
 * @returns {string} Comma-separated PROPATH string with absolute paths.
 */
function buildProparsePropath(projectCfg, projectRoot, dlcPath) {
    const collected = [];

    // Step 1: Process buildPath entries from openedge-project.json
    if (Array.isArray(projectCfg.buildPath)) {
        for (const entry of projectCfg.buildPath) {
            if (entry && entry.path) {
                let entryPath = entry.path;

                // Replace ${DLC}, @{DLC} (case-insensitive) with the actual DLC path
                entryPath = entryPath.replace(/@\{[Dd][Ll][Cc]\}|\$\{[Dd][Ll][Cc]\}/g, dlcPath);

                // Make relative paths absolute
                if (!path.isAbsolute(entryPath)) {
                    entryPath = path.join(projectRoot, entryPath);
                }

                // Normalize separators
                entryPath = path.normalize(entryPath);

                collected.push(entryPath);
            }
        }
    }

    // Step 1.5: Always add the project root itself to the PROPATH.
    // This solves the issue where files use `{src/include/file.i}` but only `src` is in the buildPath.
    collected.push(path.normalize(projectRoot));

    // Step 2: Append default DLC entries
    for (const subPath of DEFAULT_DLC_PROPATH_ENTRIES) {
        const fullPath = path.normalize(
            subPath ? path.join(dlcPath, subPath) : dlcPath
        );
        collected.push(fullPath);
    }

    // Step 3: Remove duplicates (case-insensitive on Windows) while preserving order
    const seen = new Set();
    const unique = [];
    for (const p of collected) {
        if (!p) continue;
        const key = p.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        unique.push(p);
    }

    return unique.join(',');
}

// ─── Schema ───────────────────────────────────────────────────────────────────

/**
 * Concatenates all per-database *.proparse.schema files for a project into a
 * single combined schema file written to .crosswayai/temp/<projectName>.proparse.schema
 *
 * Database sections are renumbered sequentially (1, 2, 3, ...).
 * The dictdb section (system tables) is always appended last with number 0.
 *
 * @param {string} dumpDir       - Path to .crosswayai/dump/<projectName>/
 * @param {string} workspaceRoot - Workspace root (where .crosswayai lives).
 * @param {string} projectName   - Used to name the combined output file.
 * @returns {string|null} Absolute path to the combined schema file, or null if
 *                        no schema files were found.
 */
function buildCombinedSchema(dumpDir, workspaceRoot, projectName) {
    if (!fs.existsSync(dumpDir)) return null;

    const allFiles = fs.readdirSync(dumpDir).filter(f => f.endsWith('.proparse.schema'));
    if (allFiles.length === 0) return null;

    const dictdbFile = allFiles.find(f => f === 'dictdb.proparse.schema');
    const dbFiles    = allFiles.filter(f => f !== 'dictdb.proparse.schema');

    let combined = '';
    let dbNum    = 1;

    for (const file of dbFiles) {
        let content = fs.readFileSync(path.join(dumpDir, file), 'utf8');
        // Replace the placeholder db number in the header with the correct sequential number
        content = content.replace(/^:: (.+?) \d+/m, `:: $1 ${dbNum}`);
        combined += content;
        if (!combined.endsWith('\n')) combined += '\n';
        dbNum++;
    }

    if (dictdbFile) {
        const dictdbContent = fs.readFileSync(path.join(dumpDir, dictdbFile), 'utf8');
        combined += dictdbContent;
        if (!combined.endsWith('\n')) combined += '\n';
    }

    const tempDir = path.join(workspaceRoot, '.crosswayai', 'temp');
    if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
    }

    const combinedPath = path.join(tempDir, `${projectName}.proparse.schema`);
    fs.writeFileSync(combinedPath, combined, 'utf8');

    const CrossWayAILog = getCrossWayAILog();
    if (CrossWayAILog) {
        CrossWayAILog.appendLine(`>Proparse: Combined ${dbFiles.length} DB schema(s)${dictdbFile ? ' + dictdb' : ''} → ${combinedPath}`);
    }

    return combinedPath;
}

// ─── Java ─────────────────────────────────────────────────────────────────────

/**
 * Resolves the path to the Java executable.
 * Checks the system PATH by running `java -version`.
 *
 * @returns {Promise<string|null>} Resolved java executable path, or null.
 */
function resolveJavaPath() {

    const CrossWayAILog = getCrossWayAILog();

    return new Promise((resolve) => {
        exec('java -version', (error) => {
            if (error) {
                if (CrossWayAILog) CrossWayAILog.appendLine('>Proparse: Java not found in PATH.');
                resolve(null);
            } else {
                resolve('java');
            }
        });
    });
}

/**
 * Resolves the exact javac version string used for Proparser compilation.
 *
 * @returns {Promise<string|null>} The javac version output, or null if javac is unavailable.
 */
function resolveJavacVersion() {

    const CrossWayAILog = getCrossWayAILog();

    return new Promise((resolve) => {
        exec('javac -version', (error, stdout, stderr) => {
            if (error) {
                if (CrossWayAILog) CrossWayAILog.appendLine('>Proparse: javac not found in PATH.');
                resolve(null);
                return;
            }

            const version = `${stdout || ''}${stderr || ''}`.trim();
            resolve(version || null);
        });
    });
}

function compileProparser(proparsePath) {

    const CrossWayAILog = getCrossWayAILog();
    const classpath = [
        proparsePath,
        path.join(proparsePath, 'proparse.jar'),
        path.join(proparsePath, 'lib', '*')
    ].join(path.delimiter);
    const sourcePath = path.join(proparsePath, 'Proparser.java');
    const args = ['-cp', classpath, '-d', proparsePath, sourcePath];

    return new Promise((resolve, reject) => {
        const proc = spawn('javac', args, {
            cwd: proparsePath,
            windowsHide: true
        });

        let stdout = '';
        let stderr = '';

        proc.stdout.on('data', d => { stdout += d.toString(); });
        proc.stderr.on('data', d => { stderr += d.toString(); });

        proc.on('error', err => {
            reject(new Error(`Failed to start javac: ${err.message}`));
        });

        proc.on('close', code => {
            if (stdout && CrossWayAILog) {
                CrossWayAILog.appendLine(`>Proparse: javac stdout:\n${stdout.trim()}`);
            }
            if (stderr && CrossWayAILog) {
                CrossWayAILog.appendLine(`>Proparse: javac stderr:\n${stderr.trim()}`);
            }

            if (code !== 0) {
                const details = [stderr, stdout].map(output => output.trim()).filter(Boolean).join('\n');
                reject(new Error(`javac exited with code ${code}.${details ? ` ${details}` : ''}`));
                return;
            }

            resolve();
        });
    });
}

/**
 * Ensures Proparser.class exists and matches the current javac version.
 *
 * @param {Object} context - VS Code extension context.
 * @returns {Promise<boolean>} true when Proparser is ready; false when compilation failed.
 */
async function ensureProparserCompiled(context) {

    const CrossWayAILog = getCrossWayAILog();
    const proparsePath = path.join(context.extensionPath, 'resources', 'proparse');
    const classPath = path.join(proparsePath, 'Proparser.class');
    const versionPath = path.join(proparsePath, 'Proparser.javac-version');

    const javacVersion = await resolveJavacVersion();
    if (!javacVersion) {
        vscode.window.showWarningMessage(
            'CrossWayAI: javac not found. Proparser.java could not be compiled. Install a JDK and add javac to your PATH.'
        );
        return false;
    }

    let storedVersion = null;
    if (fs.existsSync(versionPath)) {
        storedVersion = fs.readFileSync(versionPath, 'utf8').trim();
    }

    const hasClassFile = fs.existsSync(classPath);
    const needsCompile = !hasClassFile || storedVersion !== javacVersion;

    if (!needsCompile) {
        CrossWayAILog.appendLine(`>Proparse: Proparser.class is current for ${javacVersion}.`);
        return true;
    }

    const reason = !hasClassFile
        ? 'Proparser.class is missing'
        : 'javac version changed or version metadata is missing';
    CrossWayAILog.appendLine(`>Proparse: ${reason}. Compiling with ${javacVersion}...`);

    try {
        await compileProparser(proparsePath);
        if (!fs.existsSync(classPath)) {
            throw new Error('Proparser.class was not created.');
        }
        fs.writeFileSync(versionPath, `${javacVersion}\n`, 'utf8');
        CrossWayAILog.appendLine(`>Proparse: Proparser.class compiled with ${javacVersion}.`);
        return true;
    } catch (error) {
        CrossWayAILog.appendLine(`>Proparse: Failed to compile Proparser.java: ${error.message}`);
        CrossWayAILog.show(true);
        vscode.window.showWarningMessage('CrossWayAI: Failed to compile Proparser.java. See CrossWayAILog for details.');
        return false;
    }
}

/**
 * Spawns Proparser using the classpath approach.
 * The resources/proparse/ directory contains proparse.jar, dependency JARs in lib/,
 * and Proparser.class. We use -cp to include all JARs and the directory.
 *
 * @param {string}   javaExecutable - Java executable resolved from PATH.
 * @param {string}   proparsePath   - Absolute path to resources/proparse/ directory.
 * @param {string[]} parserArgs     - Arguments for Proparser.
 * @returns {Promise<string>} Resolves with the full stdout, or rejects on non-zero exit.
 */
function spawnProparse(javaExecutable, proparsePath, parserArgs) {

    return new Promise((resolve, reject) => {
        // Classpath: all JARs in directory + lib folder + the directory itself (for .class files)
        const classpath = `${proparsePath}${path.delimiter}${path.join(proparsePath, '*')}${path.delimiter}${path.join(proparsePath, 'lib', '*')}`;
        const fullArgs = ['-cp', classpath, 'Proparser', ...parserArgs];
        const proc = spawn(javaExecutable, fullArgs);

        let stdout = '';
        let stderr = '';

        proc.stdout.on('data', d => { stdout += d.toString(); });
        proc.stderr.on('data', d => { stderr += d.toString(); });

        proc.on('error', err => {
            reject(new Error(`Failed to start Java: ${err.message}`));
        });

        proc.on('close', code => {
            const CrossWayAILog = getCrossWayAILog();
            if (stderr && CrossWayAILog) {
                CrossWayAILog.appendLine(`>Proparse: Java stderr:\n${stderr.trim()}`);
            }
            if (code !== 0) {
                reject(new Error(`Java process exited with code ${code}. ${stderr.trim()}`));
            } else {
                resolve(stdout);
            }
        });
    });
}

module.exports = {
    buildProparsePropath,
    buildCombinedSchema,
    resolveJavaPath,
    ensureProparserCompiled,
    spawnProparse
};
