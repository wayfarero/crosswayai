const { resolveWorkspaceRoot } = require('./diagramCommon');

function createMermaidViewer(deps) {
    const { vscode, fs, path, http, CrossWayAILog } = deps;

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
            if (message.type === 'openFile' && message.filePath) {
                vscodeApi.postMessage({ type: 'openFile', filePath: message.filePath });
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

    function buildViewerUrl(port, targetMdRelPath) {
        const viewerUrlPath = toUrlPath('html/mermaid-viewer.html');
        const fileQuery = '/' + toUrlPath(targetMdRelPath).replace(/^\/+/, '');
        const refreshToken = Date.now();
        return `http://127.0.0.1:${port}/${viewerUrlPath}?file=${fileQuery}&refresh=${refreshToken}`;
    }

    function queueViewerRefresh() {
        if (!mermaidViewerPanel || !activeMarkdownRelativePath || !mermaidServerPort || refreshInProgress) {
            return;
        }

        refreshInProgress = true;

        (async () => {
            try {
                const refreshUrl = buildViewerUrl(mermaidServerPort, activeMarkdownRelativePath);
                await mermaidViewerPanel.webview.postMessage({ type: 'navigate', url: refreshUrl });
                CrossWayAILog.appendLine(`Mermaid viewer refreshed: ${activeMarkdownRelativePath}`);
            } catch (error) {
                CrossWayAILog.appendLine(`Failed to refresh Mermaid viewer: ${error.message}`);
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
                requestPath = '/html/mermaid-viewer.html';
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
            const isViewerRequest = normalized === path.join('html', 'mermaid-viewer.html');
            const baseRoot = isViewerRequest ? mermaidServerExtensionRoot : mermaidServerRoot;

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
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            vscode.window.showErrorMessage('CrossWayAI: No workspace folder found.');
            return;
        }

        const workspaceRoot = resolveWorkspaceRoot(workspaceFolders);
        if (!workspaceRoot) {
            vscode.window.showErrorMessage('CrossWayAI: Unable to resolve workspace root.');
            return;
        }
        const extensionRoot = context && context.extensionPath ? context.extensionPath : path.resolve(__dirname, '..');
        const viewerPath = path.join(extensionRoot, 'html', 'mermaid-viewer.html');
        if (!fs.existsSync(viewerPath)) {
            vscode.window.showErrorMessage('CrossWayAI: html/mermaid-viewer.html not found in extension installation path.');
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
            const url = buildViewerUrl(port, targetMdRelPath);

            const viewerLabel = `CrossWayAI Viewer - ${path.basename(targetMdRelPath)}`;
            if (!mermaidViewerPanel) {
                mermaidViewerPanel = vscode.window.createWebviewPanel(
                    'crosswayaiMermaidViewer',
                    viewerLabel,
                    vscode.ViewColumn.Beside,
                    {
                        enableScripts: true,
                        retainContextWhenHidden: true
                    }
                );

                mermaidViewerPanel.onDidDispose(() => {
                    disposeMarkdownWatcher();
                    activeMarkdownRelativePath = null;
                    activeMarkdownFullPath = null;
                    mermaidViewerPanel = null;
                });

                mermaidViewerPanel.webview.onDidReceiveMessage((message) => {
                    if (message.type === 'openFile' && message.filePath) {
                        const filePath = message.filePath;
                        const fileUri = vscode.Uri.file(filePath);
                        vscode.workspace.openTextDocument(fileUri).then(
                            (doc) => vscode.window.showTextDocument(doc, {
                        viewColumn: vscode.ViewColumn.One,
                        preview: false,
                        preserveFocus: false
                    }),
                            (err) => {
                                CrossWayAILog.appendLine(`Failed to open file: ${filePath} - ${err.message}`);
                                vscode.window.showErrorMessage(`CrossWayAI: Could not open file: ${path.basename(filePath)}`);
                            }
                        );
                    }
                });

                mermaidViewerPanel.webview.html = getMermaidViewerHostHtml(url);
            } else {
                // Always update the tab label to reflect the current file
                mermaidViewerPanel.title = viewerLabel;
                mermaidViewerPanel.reveal(vscode.ViewColumn.Beside, false);
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

    return {
        openCrosswayAIViewer,
        deactivateMermaidViewer,
        persistMermaid
    };
}

module.exports = {
    createMermaidViewer
};

