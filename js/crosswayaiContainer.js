const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { findMethodRange, 
        findPropertyRange, 
        findProcedureRange, 
        openTargetFileFromSourcePath } = require('./fileHandling');
const { getWorkspaceRoot } = require('./workspaceProjects');
const { generateNodeSummary } = require('./nodeSummary');
const { getCrossWayAILog } = require('./crosswayaiLogger');
const { FILE_TYPES } = require('./extensionConstants');

function createMermaidViewer() {
    const CrossWayAILog = getCrossWayAILog();

    let mermaidServer = null;
    let mermaidServerRoot = null;
    let mermaidServerExtensionRoot = null;
    let mermaidServerPort = null;
    let mermaidViewerPanel = null;
    let activeMarkdownRelativePath = null;
    let activeMarkdownFullPath = null;
    let markdownFileWatcher = null;
    let markdownSaveListener = null;
    let refreshInProgress = false;
    const viewerViewportStates = new Map();

    function postNodeSummaryResult(message) {
        if (!mermaidViewerPanel) {
            return Promise.resolve(false);
        }
        return mermaidViewerPanel.webview.postMessage(message).then(
            () => true,
            () => false
        );
    }

    function persistMermaid(workspaceRoot, diagramType, targetFileName, mermaidGraph) {
        try {
            const safeBase = `${diagramType}_${targetFileName}`.replace(/[^a-zA-Z0-9_\.\-]/g, '_');
            const fileName = safeBase + '.md';
            const dir = path.join(workspaceRoot, '.crosswayai', 'mermaid');
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            const outPath = path.join(dir, fileName);
            const fenced = '```mermaid\n' + mermaidGraph.trim() + '\n```\n';
            fs.writeFileSync(outPath, fenced, 'utf8');
            CrossWayAILog.appendLine(`Saved Mermaid ${diagramType} diagram to ${outPath}`);
            CrossWayAILog.show(true);
            return outPath;
        } catch (err) {
            CrossWayAILog.appendLine(`Failed to persist Mermaid ${diagramType} diagram: ${err.message}`);
            CrossWayAILog.show(true);
            return null;
        }
    }

    function sanitizeExportFileName(fileName, format = 'png') {
        const rawName = typeof fileName === 'string' ? fileName.trim() : '';
        const safeFormat = format === 'svg' ? 'svg' : 'png';
        const fallbackName = `diagram_${Date.now()}.${safeFormat}`;
        const normalized = (rawName || fallbackName)
            .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
            .replace(/\s+/g, '_');

        const ext = path.extname(normalized).toLowerCase();
        const base = ext ? normalized.slice(0, -ext.length) : normalized;
        const safeBase = (base || `diagram_${Date.now()}`).slice(0, 120);
        return `${safeBase}.${safeFormat}`;
    }

    function formatErrorResponse(res, statusCode, message) {
        res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, error: message }));
    }

    function getMermaidViewerHostHtml(initialUrl) {
        const initialUrlJson = JSON.stringify(initialUrl || 'about:blank');
        return `<!doctype html>
<html lang="en">
<head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <style>
        html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; background: #020617; }
        #viewerFrame { border: 0; width: 100vw; height: 100vh; display: block; }
    </style>
</head>
<body>
    <iframe id="viewerFrame" src="about:blank"></iframe>
    <script>
        const vscodeApi = acquireVsCodeApi();
        const frame = document.getElementById('viewerFrame');
        function navigate(url) {
            if (typeof url !== 'string' || !url) {
                return;
            }
            frame.src = url;
        }

        navigate(${initialUrlJson});

        window.addEventListener('message', (event) => {
            const message = event.data || {};
            if (message.type === 'navigate') {
                navigate(message.url);
            }
            if ( ( message.type === 'openFile'           || 
                   message.type === 'openXrefFile'       || 
                   message.type === 'openProparseFile' ) && 
                message.filePath ) {
                vscodeApi.postMessage(message);
            }
            if (message.type === 'generateNodeSummary') {
                vscodeApi.postMessage({
                    type: 'generateNodeSummary',
                    nodeId: message.nodeId || null,
                    filePath: message.filePath || null
                });
            }
            if (message.type === 'viewerViewportState') {
                vscodeApi.postMessage({
                    type: 'viewerViewportState',
                    viewport: message.viewport || null
                });
            }
            if (message.type === 'nodeSummaryResult') {
                try {
                    frame.contentWindow?.postMessage(message, '*');
                } catch (_) {
                }
            }
            if (message.type === 'LOG' && message.message) {
                vscodeApi.postMessage(message);
            }
        });
    </script>
</body>
</html>`;
    }

    function toUrlPath(relativePath) {
        return relativePath
            .split(path.sep)
            .join('/')
            .split('/')
            .map(segment => encodeURIComponent(segment))
            .join('/');
    }

    function disposeMarkdownWatcher() {
        if (markdownFileWatcher) {
            try {
                markdownFileWatcher.dispose();
            } catch (_) {
            }
            markdownFileWatcher = null;
        }

        if (markdownSaveListener) {
            try {
                markdownSaveListener.dispose();
            } catch (_) {
            }
            markdownSaveListener = null;
        }

    }

    function buildViewerPath(targetMdRelPath) {
        const fileQuery = '/' + toUrlPath(targetMdRelPath).replace(/^\/+/, '');
        const refreshToken = Date.now();
        const viewportState = viewerViewportStates.get(String(targetMdRelPath || '').toLowerCase()) || null;
        let viewportQuery = '';

        if (viewportState) {
            try {
                viewportQuery = `&viewport=${encodeURIComponent(JSON.stringify(viewportState))}`;
            } catch (_) {
                viewportQuery = '';
            }
        }

        return `file=${encodeURIComponent(fileQuery)}&refresh=${refreshToken}${viewportQuery}`;
    }

    function buildViewerUrl(port, targetMdRelPath) {
        const viewerUrlPath = toUrlPath('html/crosswayaiViewer.html');
        const query = buildViewerPath(targetMdRelPath);
        return `http://127.0.0.1:${port}/${viewerUrlPath}?${query}`;
    }

    async function resolveExternalViewerUrl(port, targetMdRelPath) {
        const viewerUrlPath = toUrlPath('html/crosswayaiViewer.html');
        const internalBase = vscode.Uri.parse(`http://127.0.0.1:${port}/${viewerUrlPath}`);
        const query = buildViewerPath(targetMdRelPath);
        if (vscode.env && typeof vscode.env.asExternalUri === 'function') {
            try {
                const externalBase = await vscode.env.asExternalUri(internalBase);
                return `${externalBase.toString()}?${query}`;
            } catch (error) {
                CrossWayAILog.appendLine(`Mermaid viewer asExternalUri failed: ${error.message}`);
                CrossWayAILog.show(true);
            }
        }
        return `${internalBase.toString()}?${query}`;
    }

    async function lockActiveViewerGroup() {
        try {
            // Keep the viewer in a dedicated group so normal file opens do not share its tab strip.
            await vscode.commands.executeCommand('workbench.action.lockEditorGroup');
        } catch (error) {
            CrossWayAILog.appendLine(`Unable to lock viewer editor group: ${error.message}`);
            CrossWayAILog.show(true);
        }
    }

    function normalizeViewerViewportState(viewport) {
        if (!viewport || typeof viewport !== 'object') {
            return null;
        }

        const zoom = Number(viewport.zoom);
        const scrollLeft = Number(viewport.scrollLeft);
        const scrollTop = Number(viewport.scrollTop);

        if (!Number.isFinite(zoom) || !Number.isFinite(scrollLeft) || !Number.isFinite(scrollTop)) {
            return null;
        }

        return {
            zoom: Math.min(10, Math.max(0.1, zoom)),
            scrollLeft: Math.max(0, scrollLeft),
            scrollTop: Math.max(0, scrollTop)
        };
    }

    function queueViewerRefresh() {
        if (!mermaidViewerPanel || !activeMarkdownRelativePath || !mermaidServerPort || refreshInProgress) {
            return;
        }

        refreshInProgress = true;

        (async () => {
            try {
                const refreshUrl = await resolveExternalViewerUrl(mermaidServerPort, activeMarkdownRelativePath);
                await mermaidViewerPanel.webview.postMessage({ type: 'navigate', url: refreshUrl });
                CrossWayAILog.appendLine(`Mermaid viewer refreshed: ${activeMarkdownRelativePath} \n`);
                CrossWayAILog.show(true);
            } catch (error) {
                CrossWayAILog.appendLine(`Failed to refresh Mermaid viewer: ${error.message}`);
                CrossWayAILog.show(true);
            } finally {
                refreshInProgress = false;
            }
        })();
    }

    function updateMarkdownWatcher(workspaceRoot, targetMdRelPath) {
        disposeMarkdownWatcher();

        if (!workspaceRoot || !targetMdRelPath) {
            return;
        }

        const normalizedRelPath = targetMdRelPath.split(path.sep).join('/');
        const filePattern = new vscode.RelativePattern(workspaceRoot, normalizedRelPath);
        markdownFileWatcher = vscode.workspace.createFileSystemWatcher(filePattern, false, false, false);

        markdownFileWatcher.onDidChange(() => queueViewerRefresh());
        markdownFileWatcher.onDidCreate(() => queueViewerRefresh());
        markdownFileWatcher.onDidDelete(() => queueViewerRefresh());

        markdownSaveListener = vscode.workspace.onDidSaveTextDocument((document) => {
            if (!activeMarkdownFullPath || !document || !document.uri || !document.uri.fsPath) {
                return;
            }

            if (document.uri.fsPath.toLowerCase() === activeMarkdownFullPath.toLowerCase()) {
                queueViewerRefresh();
            }
        });

        CrossWayAILog.appendLine(`Watching Mermaid markdown: ${normalizedRelPath}`);
        CrossWayAILog.show(true);
    }

    function extractFsPath(candidate) {
        if (!candidate) {
            return null;
        }

        if (Array.isArray(candidate) && candidate.length > 0) {
            return extractFsPath(candidate[0]);
        }

        if (typeof candidate === 'string') {
            return candidate;
        }

        if (typeof candidate.fsPath === 'string' && candidate.fsPath) {
            return candidate.fsPath;
        }

        if (typeof candidate.path === 'string' && candidate.path) {
            return candidate.path;
        }

        return null;
    }

    function resolveMermaidMarkdownTarget(uri, workspaceRoot) {
        function toRelativeIfValid(candidatePath) {
            if (!candidatePath || path.extname(candidatePath).toLowerCase() !== '.md') {
                return null;
            }

            const rootResolved = path.resolve(workspaceRoot);
            const candidateResolved = path.resolve(candidatePath);
            const rel = path.relative(rootResolved, candidateResolved);
            if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
                return null;
            }
            return rel.split(path.sep).join('/');
        }

        const uriPath = extractFsPath(uri);
        if (uriPath && uriPath.toLowerCase().endsWith('.md')) {
            const fromUri = toRelativeIfValid(uriPath);
            if (fromUri) {
                return fromUri;
            }
        }

        const activeEditor = vscode.window.activeTextEditor;
        if (activeEditor && activeEditor.document && activeEditor.document.uri && activeEditor.document.uri.fsPath) {
            const activePath = activeEditor.document.uri.fsPath;
            const fromEditor = toRelativeIfValid(activePath);
            if (fromEditor) {
                return fromEditor;
            }
        }

        return null;
    }

    function openTextFile(filePath, { failurePrefix = 'file' } = {}) {
        const fileUri = vscode.Uri.file(filePath);
        vscode.workspace.openTextDocument(fileUri).then(
            (doc) => vscode.window.showTextDocument(doc, {
                viewColumn: vscode.ViewColumn.One,
                preview: false,
                preserveFocus: false
            }),
            (err) => {
                CrossWayAILog.appendLine(`Failed to open ${failurePrefix}: ${filePath} - ${err.message}`);
                CrossWayAILog.show(true);
                vscode.window.showErrorMessage(`CrossWayAI: Could not open ${failurePrefix}: ${path.basename(filePath)}`);
            }
        );
    }

    async function promptForMarkdownTarget(workspaceRoot) {
        const picked = await vscode.window.showOpenDialog({
            canSelectMany: false,
            canSelectFiles: true,
            canSelectFolders: false,
            defaultUri: vscode.Uri.file(path.join(workspaceRoot, '.crosswayai', 'mermaid')),
            filters: {
                'Markdown': ['md']
            },
            openLabel: 'View diagram'
        });

        if (!picked || picked.length === 0) {
            return null;
        }

        return resolveMermaidMarkdownTarget(picked[0], workspaceRoot);
    }

    async function ensureMermaidServer(workspaceRoot, extensionRoot) {
        if (mermaidServer && mermaidServerRoot === workspaceRoot && mermaidServerExtensionRoot === extensionRoot && mermaidServerPort) {
            return mermaidServerPort;
        }

        if (mermaidServer) {
            await new Promise(resolve => {
                try {
                    mermaidServer.close(() => resolve());
                } catch (_) {
                    resolve();
                }
            });
            mermaidServer = null;
            mermaidServerRoot = null;
            mermaidServerPort = null;
        }

        mermaidServerRoot = workspaceRoot;
        mermaidServerExtensionRoot = extensionRoot;

        mermaidServer = http.createServer((req, res) => {
            const requestUrl = (req.url || '/').split('?')[0];
            let requestPath = decodeURIComponent(requestUrl);

            if (req.method === 'POST' && requestPath === '/__crosswayai/export') {
                const maxPayloadBytes = 12 * 1024 * 1024;
                let size = 0;
                const chunks = [];

                req.on('data', chunk => {
                    size += chunk.length;
                    if (size > maxPayloadBytes) {
                        formatErrorResponse(res, 413, 'Payload too large.');
                        req.destroy();
                        return;
                    }
                    chunks.push(chunk);
                });

                req.on('end', () => {
                    try {
                        const bodyText = Buffer.concat(chunks).toString('utf8');
                        const payload = JSON.parse(bodyText || '{}');
                        const format = payload.format === 'svg' ? 'svg' : 'png';
                        const fileName = sanitizeExportFileName(payload.fileName, format);

                        let bytesToWrite;
                        if (format === 'svg') {
                            const svgText = typeof payload.svgText === 'string' ? payload.svgText.trim() : '';
                            if (!svgText || !svgText.includes('<svg')) {
                                formatErrorResponse(res, 400, 'Invalid SVG payload.');
                                return;
                            }
                            bytesToWrite = Buffer.from(svgText, 'utf8');
                        } else {
                            const dataUrl = typeof payload.dataUrl === 'string' ? payload.dataUrl : '';
                            const prefix = 'data:image/png;base64,';
                            if (!dataUrl.startsWith(prefix)) {
                                formatErrorResponse(res, 400, 'Invalid image data.');
                                return;
                            }

                            const base64 = dataUrl.slice(prefix.length);
                            bytesToWrite = Buffer.from(base64, 'base64');
                        }

                        if (!bytesToWrite.length) {
                            formatErrorResponse(res, 400, 'Image payload is empty.');
                            return;
                        }

                        const exportDir = path.join(mermaidServerRoot, '.crosswayai', 'exports');
                        fs.mkdirSync(exportDir, { recursive: true });

                        const fullPath = path.join(exportDir, fileName);
                        fs.writeFileSync(fullPath, bytesToWrite);

                        const relativePath = path.relative(mermaidServerRoot, fullPath).split(path.sep).join('/');
                        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                        res.end(JSON.stringify({ ok: true, relativePath }));
                    } catch (error) {
                        formatErrorResponse(res, 500, `Failed to export image: ${error.message}`);
                    }
                });

                req.on('error', () => {
                    formatErrorResponse(res, 500, 'Failed to read request body.');
                });
                return;
            }

            if (requestPath === '/' || requestPath === '') {
                requestPath = '/html/crosswayaiViewer.html';
            }

            if (requestPath === '/__crosswayai/diagram-colors.json') {
                const colorsPath = path.join(mermaidServerExtensionRoot, 'resources', 'diagram-colors.json');
                fs.readFile(colorsPath, (err, data) => {
                    if (err) {
                        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
                        res.end('Not found');
                        return;
                    }
                    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                    res.end(data);
                });
                return;
            }

            const normalized = path.normalize(requestPath.replace(/^\/+/, ''));
            const isExtensionAsset = normalized.startsWith('html' + path.sep) || normalized.startsWith('html/');
            const baseRoot = isExtensionAsset ? mermaidServerExtensionRoot : mermaidServerRoot;

            if (!baseRoot) {
                res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
                res.end('Server root is not initialized');
                return;
            }

            const fullPath = path.join(baseRoot, normalized);

            if (!fullPath.startsWith(baseRoot)) {
                res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
                res.end('Forbidden');
                return;
            }

            fs.readFile(fullPath, (err, data) => {
                if (err) {
                    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
                    res.end('Not found');
                    return;
                }

                const ext = path.extname(fullPath).toLowerCase();
                const mimeTypes = {
                    '.html': 'text/html; charset=utf-8',
                    '.js': 'application/javascript; charset=utf-8',
                    '.css': 'text/css; charset=utf-8',
                    '.json': 'application/json; charset=utf-8',
                    '.md': 'text/markdown; charset=utf-8',
                    '.svg': 'image/svg+xml'
                };
                res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'text/plain; charset=utf-8' });
                res.end(data);
            });
        });

        await new Promise((resolve, reject) => {
            mermaidServer.once('error', reject);
            mermaidServer.listen(0, '127.0.0.1', () => {
                const addressInfo = mermaidServer.address();
                mermaidServerPort = addressInfo && addressInfo.port ? addressInfo.port : null;
                CrossWayAILog.appendLine(`Mermaid viewer server running at http://127.0.0.1:${mermaidServerPort}`);
                CrossWayAILog.show(true);
                resolve();
            });
        });

        return mermaidServerPort;
    }

    async function openCrosswayAIViewer(context, uri) {
        const workspaceRoot = getWorkspaceRoot();
        if (!workspaceRoot) {
            return;
        }
        const extensionRoot = context && context.extensionPath ? context.extensionPath : path.resolve(__dirname, '..');
        const viewerPath = path.join(extensionRoot, 'html', 'crosswayaiViewer.html');
        if (!fs.existsSync(viewerPath)) {
            vscode.window.showErrorMessage('CrossWayAI: html/crosswayaiViewer.html not found in extension installation path.');
            return;
        }

        let targetMdRelPath = resolveMermaidMarkdownTarget(uri, workspaceRoot);
        if (!targetMdRelPath) {
            targetMdRelPath = await promptForMarkdownTarget(workspaceRoot);
        }
        if (!targetMdRelPath) {
            vscode.window.showErrorMessage('CrossWayAI: Please select a .md file inside the current workspace.');
            return;
        }

        const targetMdFullPath = path.join(workspaceRoot, targetMdRelPath);
        activeMarkdownRelativePath = targetMdRelPath;
        activeMarkdownFullPath = targetMdFullPath;

        try {
            const port = await ensureMermaidServer(workspaceRoot, extensionRoot);
            const url = await resolveExternalViewerUrl(port, targetMdRelPath);

            const viewerLabel = `CrossWayAI Viewer - ${path.basename(targetMdRelPath)}`;
            if (!mermaidViewerPanel) {
                mermaidViewerPanel = vscode.window.createWebviewPanel(
                    'crosswayaiMermaidViewer',
                    viewerLabel,
                    vscode.ViewColumn.Beside,
                    {
                        enableScripts: true,
                        retainContextWhenHidden: true,
                        portMapping: [{ webviewPort: port, extensionHostPort: port }]
                    }
                );

                mermaidViewerPanel.onDidDispose(() => {
                    disposeMarkdownWatcher();
                    activeMarkdownRelativePath = null;
                    activeMarkdownFullPath = null;
                    mermaidViewerPanel = null;
                });

                mermaidViewerPanel.webview.onDidReceiveMessage((message) => {

                    if (message.type === 'LOG' && message.message) {
                      CrossWayAILog.appendLine(String(message.message));
                      return;
                    }

                    if (message.type === 'openFile' && message.filePath) {
                        // If targetName and targetType are provided, open file and reveal the definition
                        if (message.targetName && message.targetType) {
                            const fileUri = vscode.Uri.file(message.filePath);
                            CrosswayAILog = getCrossWayAILog(); 
                            CrosswayAILog.appendLine(`Opening file: ${message.filePath} -> ${message.targetType} ${message.targetName} with signature ${message.signature}`);
                            CrosswayAILog.show(true);

                            vscode.workspace.openTextDocument(fileUri).then((doc) => {
                                let startLine = 0;
                                let endLine = 0;
                                if (message.targetType === 'property') {
                                    [startLine, endLine] = findPropertyRange(doc, message.targetName);
                                } else if (message.targetType === 'method') {
                                    [startLine, endLine] = findMethodRange(doc, message.targetName, message.signature);
                                } else if (message.targetType === 'procedure') {
                                    [startLine, endLine] = findProcedureRange(doc, message.targetName);
                                }
                                vscode.window.showTextDocument(doc, {
                                    viewColumn: vscode.ViewColumn.One,
                                    preview: false,
                                    preserveFocus: false
                                }).then((editor) => {
                                    // Highlight the method/property block if found, else just the definition line
                                    const startPos = new vscode.Position(startLine, 0);
                                    const endPos = new vscode.Position(endLine, doc.lineAt(endLine).text.length);
                                    editor.selection = new vscode.Selection(startPos, endPos);
                                    editor.revealRange(new vscode.Range(startPos, endPos), vscode.TextEditorRevealType.InCenter);
                                    // If there are multiple visible editors for this file, reveal in all
                                    vscode.window.visibleTextEditors.forEach(ed => {
                                        if (ed.document.uri.toString() === doc.uri.toString()) {
                                            ed.selection = new vscode.Selection(startPos, endPos);
                                            ed.revealRange(new vscode.Range(startPos, endPos), vscode.TextEditorRevealType.InCenter);
                                        }
                                    });
                                });
                            }, (err) => {
                                CrossWayAILog.appendLine(`Failed to open file: ${message.filePath} - ${err.message}`);
                                CrossWayAILog.show(true);
                                vscode.window.showErrorMessage(`CrossWayAI: Could not open file: ${path.basename(message.filePath)}`);
                            });
                        } else {
                            openTextFile(message.filePath, { failurePrefix: 'file' });
                        }
                    }
                    if (message.type === 'openXrefFile' && message.filePath) {
                        const lookupWorkspaceRoot = mermaidServerRoot || workspaceRoot;
                        openTargetFileFromSourcePath(message.filePath, lookupWorkspaceRoot, FILE_TYPES.XREF);
                    }

                    if (message.type === 'openProparseFile' && message.filePath) {
                        const lookupWorkspaceRoot = mermaidServerRoot || workspaceRoot;
                        openTargetFileFromSourcePath(message.filePath, lookupWorkspaceRoot, FILE_TYPES.PROPARSE);
                    }

                    if (message.type === 'generateNodeSummary') {
                        CrossWayAILog.appendLine(`Node summary requested for node ${message.nodeId || 'unknown'} (${message.filePath || 'no file path'})`);
                        CrossWayAILog.show(true);
                        (async () => {
                            const result = await generateNodeSummary({
                                filePath: message.filePath || null,
                                nodeId: message.nodeId || null,
                            });

                            await postNodeSummaryResult({
                                type: 'nodeSummaryResult',
                                nodeId: message.nodeId || null,
                                filePath: message.filePath || null,
                                ok: Boolean(result && result.ok),
                                summary: result && result.ok ? result.summary : undefined,
                                reason: result && !result.ok ? result.reason : undefined
                            });
                        })().catch((error) => {
                            CrossWayAILog.appendLine(`[NodeSummary] unexpected failure: ${error.message}`);
                            CrossWayAILog.show(true);
                            postNodeSummaryResult({
                                type: 'nodeSummaryResult',
                                nodeId: message.nodeId || null,
                                filePath: message.filePath || null,
                                ok: false,
                                reason: 'AI_GENERATION_FAILED'
                            }).then(undefined, () => {});
                        });
                    }
                    if (message.type === 'viewerViewportState') {
                        const normalizedViewport = normalizeViewerViewportState(message.viewport);
                        if (!normalizedViewport) {
                            return;
                        }

                        const markdownKey = String(activeMarkdownRelativePath || '').toLowerCase();
                        if (!markdownKey) {
                            return;
                        }

                        viewerViewportStates.set(markdownKey, normalizedViewport);
                    }
                });

                mermaidViewerPanel.webview.html = getMermaidViewerHostHtml(url);
                await lockActiveViewerGroup();
            } else {
                // Always update the tab label to reflect the current file
                mermaidViewerPanel.title = viewerLabel;
                // Preserve editor focus during auto-refresh to avoid replacing the viewer tab on next Explorer click.
                mermaidViewerPanel.reveal(vscode.ViewColumn.Beside, true);
                await mermaidViewerPanel.webview.postMessage({ type: 'navigate', url });
            }

            updateMarkdownWatcher(workspaceRoot, targetMdRelPath);

            if (!fs.existsSync(targetMdFullPath)) {
                vscode.window.showInformationMessage(`CrossWayAI: Viewer opened. Target markdown not found: ${targetMdRelPath}`);
            }
        } catch (error) {
            CrossWayAILog.appendLine(`Failed to open Mermaid viewer: ${error.message}`);
            CrossWayAILog.show(true);
            vscode.window.showErrorMessage('CrossWayAI: Failed to open Mermaid viewer. See CrossWayAILog for details.');
        }
    }

    function deactivateMermaidViewer() {
        disposeMarkdownWatcher();
        activeMarkdownRelativePath = null;
        activeMarkdownFullPath = null;

        if (mermaidViewerPanel) {
            try {
                mermaidViewerPanel.dispose();
            } catch (_) {
            }
            mermaidViewerPanel = null;
        }

        if (mermaidServer) {
            try {
                mermaidServer.close();
            } catch (_) {
            }
            mermaidServer = null;
            mermaidServerRoot = null;
            mermaidServerPort = null;
        }
    }

    function isMermaidViewerOpen() {
        return Boolean(mermaidViewerPanel);
    }

    function isMermaidViewerVisible() {
        return Boolean(mermaidViewerPanel);
    }

    return {
        openCrosswayAIViewer,
        deactivateMermaidViewer,
        persistMermaid,
        isMermaidViewerOpen,
        isMermaidViewerVisible
    };
}

module.exports = {
    createMermaidViewer
};

