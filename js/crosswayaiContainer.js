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
const { getMultipleViewerInstancesSetting } = require('./crosswayaiSettings');
const { FILE_TYPES } = require('./extensionConstants');

let mermaidViewerInstance = null;

function createMermaidViewer() {
    if (mermaidViewerInstance) {
        return mermaidViewerInstance;
    }

    const CrossWayAILog = getCrossWayAILog();

    let mermaidServer = null;
    let mermaidServerRoot = null;
    let mermaidServerExtensionRoot = null;
    let mermaidServerPort = null;
    let multipleViewerInstances = null;
    let singleViewerState = null;
    const viewerStates = new Map();
    const viewerViewportStates = new Map();

    function setViewerOpenContext(isOpen) {
        vscode.commands.executeCommand('setContext', 'crosswayai.viewerOpen', isOpen).then(undefined, (error) => {
            CrossWayAILog.appendLine(`Failed to update viewer context: ${error.message}`);
        });
    }

    function normalizePathIdentity(filePath) {
        const normalizedPath = path.normalize(filePath);
        return process.platform === 'win32' ? normalizedPath.toLowerCase() : normalizedPath;
    }

    function normalizeMarkdownPath(markdownPath) {
        return normalizePathIdentity(path.resolve(markdownPath));
    }

    function postNodeSummaryResult(viewerState, message) {
        if (!viewerState || !viewerState.panel) {
            return Promise.resolve(false);
        }
        return viewerState.panel.webview.postMessage(message).then(
            () => true,
            () => false
        );
    }

    function persistMermaid(workspaceRoot, diagramType, targetFileName, mermaidGraph, relativeDir = '') {
        try {
            const safeBase = `${diagramType}_${targetFileName}`.replace(/[^a-zA-Z0-9_\.\-]/g, '_');
            const fileName = safeBase + '.md';
            const mermaidRoot = path.join(workspaceRoot, '.crosswayai', 'mermaid');
            // Mirror the original source folder structure (project/source/...) under
            // the mermaid root so that files sharing a base name across folders or
            // projects do not overwrite each other. Fall back to the flat root when
            // no relative directory could be resolved, or if it escapes the root.
            let dir = mermaidRoot;
            if (relativeDir) {
                const candidate = path.resolve(mermaidRoot, relativeDir);
                const rel = path.relative(mermaidRoot, candidate);
                if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) {
                    dir = candidate;
                }
            }
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            const outPath = path.join(dir, fileName);
            const fenced = '```mermaid\n' + mermaidGraph.trim() + '\n```\n';
            fs.writeFileSync(outPath, fenced, 'utf8');
            CrossWayAILog.appendLine(`Saved Mermaid ${diagramType} diagram to ${outPath}`);
            return outPath;
        } catch (error) {
            CrossWayAILog.appendLine(`Failed to persist Mermaid ${diagramType} diagram: ${error.message}`);
            vscode.window.showErrorMessage(`CrossWayAI: Could not save the ${diagramType} Mermaid diagram. See CrossWayAILog for details.`);
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
        html, body { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; background: #020617; }
        #viewerFrame { border: 0; width: 100vw; height: 100vh; display: block; }
    </style>
</head>
<body>
    <iframe id="viewerFrame" src="about:blank"></iframe>
    <script>
        const vscodeApi = acquireVsCodeApi();
        const frame = document.getElementById('viewerFrame');
        let viewerReady = false;
        const pendingShowInViewerMessages = [];
        function navigate(url) {
            if (typeof url !== 'string' || !url) {
                return;
            }
            viewerReady = false;
            frame.src = url;
        }

        navigate(${initialUrlJson});

        window.addEventListener('message', (event) => {
            const message = event.data || {};
            if (message.type === 'navigate') {
                navigate(message.url);
            }
            if (message.type === 'showFileInViewer') {
                if (viewerReady) {
                    frame.contentWindow?.postMessage(message, '*');
                } else {
                    pendingShowInViewerMessages.push(message);
                }
            }
            if (message.type === 'viewerReady') {
                viewerReady = true;
                pendingShowInViewerMessages.splice(0).forEach((pendingMessage) => {
                    frame.contentWindow?.postMessage(pendingMessage, '*');
                });
            }
            if (message.type === 'showFileInViewerResult') {
                vscodeApi.postMessage(message);
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
                    filePath: message.filePath || null,
                    forceRefresh: message.forceRefresh === true
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

    function disposeMarkdownWatcher(viewerState) {
        if (!viewerState) {
            return;
        }

        if (viewerState.markdownFileWatcher) {
            try {
                viewerState.markdownFileWatcher.dispose();
            } catch (_) {
            }
            viewerState.markdownFileWatcher = null;
        }

        if (viewerState.markdownSaveListener) {
            try {
                viewerState.markdownSaveListener.dispose();
            } catch (_) {
            }
            viewerState.markdownSaveListener = null;
        }
    }

    function buildViewerPath(targetMdRelPath) {
        const fileQuery = '/' + toUrlPath(targetMdRelPath).replace(/^\/+/, '');
        const refreshToken = Date.now();
        const viewportState = viewerViewportStates.get(normalizePathIdentity(String(targetMdRelPath || ''))) || null;
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

    function queueViewerRefresh(viewerState) {
        if (!viewerState || !viewerState.panel || !viewerState.markdownRelativePath || !mermaidServerPort || viewerState.refreshInProgress) {
            return;
        }

        viewerState.refreshInProgress = true;

        (async () => {
            try {
                const refreshUrl = await resolveExternalViewerUrl(mermaidServerPort, viewerState.markdownRelativePath);
                await viewerState.panel.webview.postMessage({ type: 'navigate', url: refreshUrl });
                CrossWayAILog.appendLine(`Mermaid viewer refreshed: ${viewerState.markdownRelativePath} \n`);
            } catch (error) {
                CrossWayAILog.appendLine(`Failed to refresh Mermaid viewer: ${error.message}`);
            } finally {
                viewerState.refreshInProgress = false;
            }
        })();
    }

    function updateMarkdownWatcher(viewerState, workspaceRoot, targetMdRelPath) {
        disposeMarkdownWatcher(viewerState);

        if (!viewerState || !workspaceRoot || !targetMdRelPath) {
            return;
        }

        const normalizedRelPath = targetMdRelPath.split(path.sep).join('/');
        const filePattern = new vscode.RelativePattern(workspaceRoot, normalizedRelPath);
        viewerState.markdownFileWatcher = vscode.workspace.createFileSystemWatcher(filePattern, false, false, false);

        viewerState.markdownFileWatcher.onDidChange(() => queueViewerRefresh(viewerState));
        viewerState.markdownFileWatcher.onDidCreate(() => queueViewerRefresh(viewerState));
        viewerState.markdownFileWatcher.onDidDelete(() => {
            if (viewerState.panel) {
                disposeViewerState(viewerState);
            }
        });

        viewerState.markdownSaveListener = vscode.workspace.onDidSaveTextDocument((document) => {
            if (!viewerState.markdownFullPath || !document || !document.uri || !document.uri.fsPath) {
                return;
            }

            if (normalizeMarkdownPath(document.uri.fsPath) === viewerState.markdownKey) {
                queueViewerRefresh(viewerState);
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

    function openTextFile(filePath, { failurePrefix = 'file' } = {}) {
        const fileUri = vscode.Uri.file(filePath);
        vscode.workspace.openTextDocument(fileUri).then(
            (doc) => vscode.window.showTextDocument(doc, {
                viewColumn: vscode.ViewColumn.One,
                preview: false,
                preserveFocus: false
            }),
            (error) => {
                CrossWayAILog.appendLine(`Failed to open ${failurePrefix}: ${filePath} - ${error.message}`);
                vscode.window.showErrorMessage(`CrossWayAI: Could not open ${failurePrefix}: ${path.basename(filePath)}`);
            }
        );
    }

    function getTargetRange(document, message) {
        let startLine = 0;
        let endLine = 0;

        if (message.targetType === 'property') {
            [startLine, endLine] = findPropertyRange(document, message.targetName);
        } else if (message.targetType === 'method' || message.targetType === 'constructor') {
            [startLine, endLine] = findMethodRange(document, message.targetName, message.signature);
        } else if (message.targetType === 'procedure') {
            [startLine, endLine] = findProcedureRange(document, message.targetName);
        }

        const startPosition = new vscode.Position(startLine, 0);
        const endPosition = new vscode.Position(endLine, document.lineAt(endLine).text.length);
        return new vscode.Range(startPosition, endPosition);
    }

    function revealRangeInEditor(editor, range) {
        editor.selection = new vscode.Selection(range.start, range.end);
        editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
    }

    function revealTargetInOpenEditors(document, range) {
        vscode.window.visibleTextEditors.forEach(editor => {
            if (editor.document.uri.toString() === document.uri.toString()) {
                revealRangeInEditor(editor, range);
            }
        });
    }

    function openFileAtTarget(message) {
        const fileUri = vscode.Uri.file(message.filePath);
        CrossWayAILog.appendLine(`Opening file: ${message.filePath} -> ${message.targetType} ${message.targetName} with signature ${message.signature}`);

        vscode.workspace.openTextDocument(fileUri).then((document) => {
            const targetRange = getTargetRange(document, message);
            vscode.window.showTextDocument(document, {
                viewColumn: vscode.ViewColumn.One,
                preview: false,
                preserveFocus: false
            }).then((editor) => {
                revealRangeInEditor(editor, targetRange);
                revealTargetInOpenEditors(document, targetRange);
            }, (error) => {
                CrossWayAILog.appendLine(`Failed to reveal target in file: ${message.filePath} - ${error.message}`);
                vscode.window.showErrorMessage(`CrossWayAI: Could not reveal target in file: ${path.basename(message.filePath)}`);
            });
        }, (error) => {
            CrossWayAILog.appendLine(`Failed to open file: ${message.filePath} - ${error.message}`);
            vscode.window.showErrorMessage(`CrossWayAI: Could not open file: ${path.basename(message.filePath)}`);
        });
    }

    function handleOpenFileMessage(message) {
        if (message.targetName && message.targetType) {
            openFileAtTarget(message);
            return;
        }

        openTextFile(message.filePath, { failurePrefix: 'file' });
    }

    async function sendNodeSummaryResult(viewerState, message) {
        const result = await generateNodeSummary({
            filePath: message.filePath || null,
            nodeId: message.nodeId || null,
            forceRefresh: message.forceRefresh === true
        });

        await postNodeSummaryResult(viewerState, {
            type: 'nodeSummaryResult',
            nodeId: message.nodeId || null,
            filePath: message.filePath || null,
            ok: Boolean(result && result.ok),
            summary: result && result.ok ? result.summary : undefined,
            aiSummaryTimestamp: result && result.ok ? result.aiSummaryTimestamp : undefined,
            aiSummaryStale: result && result.ok ? result.aiSummaryStale === true : undefined,
            generationErrorReason: result && result.ok ? result.generationErrorReason : undefined,
            reason: result && !result.ok ? result.reason : undefined
        });
    }

    function handleNodeSummaryMessage(viewerState, message) {
        CrossWayAILog.appendLine(`Node summary requested for node ${message.nodeId || 'unknown'} (${message.filePath || 'no file path'})`);

        sendNodeSummaryResult(viewerState, message).catch((error) => {
            CrossWayAILog.appendLine(`[NodeSummary] unexpected failure: ${error.message}`);
            postNodeSummaryResult(viewerState, {
                type: 'nodeSummaryResult',
                nodeId: message.nodeId || null,
                filePath: message.filePath || null,
                ok: false,
                reason: 'AI_GENERATION_FAILED'
            }).then(undefined, (postError) => {
                CrossWayAILog.appendLine(`[NodeSummary] failed to post failure response: ${postError.message}`);
            });
        });
    }

    function handleViewerViewportState(viewerState, message) {
        const normalizedViewport = normalizeViewerViewportState(message.viewport);
        if (!normalizedViewport) {
            return;
        }

        const markdownKey = normalizePathIdentity(String(viewerState && viewerState.markdownRelativePath || ''));
        if (!markdownKey) {
            return;
        }

        viewerViewportStates.set(markdownKey, normalizedViewport);
    }

    function handleViewerMessage(viewerState, message, workspaceRoot) {
        if (message.type === 'LOG' && message.message) {
            CrossWayAILog.appendLine(String(message.message));
            return;
        }

        if (message.type === 'openFile' && message.filePath) {
            handleOpenFileMessage(message);
            return;
        }

        if (message.type === 'openXrefFile' && message.filePath) {
            const lookupWorkspaceRoot = mermaidServerRoot || workspaceRoot;
            openTargetFileFromSourcePath(message.filePath, lookupWorkspaceRoot, FILE_TYPES.XREF);
            return;
        }

        if (message.type === 'openProparseFile' && message.filePath) {
            const lookupWorkspaceRoot = mermaidServerRoot || workspaceRoot;
            openTargetFileFromSourcePath(message.filePath, lookupWorkspaceRoot, FILE_TYPES.PROPARSE);
            return;
        }

        if (message.type === 'generateNodeSummary') {
            handleNodeSummaryMessage(viewerState, message);
            return;
        }

        if (message.type === 'viewerViewportState') {
            handleViewerViewportState(viewerState, message);
            return;
        }

        if (message.type === 'showFileInViewerResult' && !message.found) {
            vscode.window.showInformationMessage(
                `CrossWayAI: ${path.basename(message.filePath || 'The selected file')} is not part of the current diagram.`
            );
        }
    }

    async function showFileInViewer(uri) {
        if (!uri || !uri.fsPath) {
            return false;
        }

        const viewerState = Array.from(viewerStates.values()).find(state => state.panel && state.panel.active)
            || Array.from(viewerStates.values()).find(state => state.panel && state.panel.visible)
            || singleViewerState
            || viewerStates.values().next().value;
        if (!viewerState || !viewerState.panel) {
            return false;
        }

        viewerState.panel.reveal(viewerState.panel.viewColumn);
        return viewerState.panel.webview.postMessage({
            type: 'showFileInViewer',
            filePath: uri.fsPath,
            caseInsensitive: process.platform === 'win32'
        });
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
                resolve();
            });
        });

        return mermaidServerPort;
    }

    function removeViewerStateMapping(viewerState) {
        if (viewerState && viewerStates.get(viewerState.markdownKey) === viewerState) {
            viewerStates.delete(viewerState.markdownKey);
        }
    }

    function updateViewerStateTarget(viewerState, markdownRelativePath, markdownFullPath) {
        removeViewerStateMapping(viewerState);
        viewerState.markdownRelativePath = markdownRelativePath;
        viewerState.markdownFullPath = markdownFullPath;
        viewerState.markdownKey = normalizeMarkdownPath(markdownFullPath);
        viewerStates.set(viewerState.markdownKey, viewerState);
    }

    function disposeViewerState(viewerState, disposePanel = true) {
        if (!viewerState || viewerState.disposed) {
            return;
        }

        viewerState.disposed = true;
        disposeMarkdownWatcher(viewerState);
        removeViewerStateMapping(viewerState);

        if (singleViewerState === viewerState) {
            singleViewerState = null;
        }

        if (viewerStates.size === 0) {
            multipleViewerInstances = null;
            setViewerOpenContext(false);
        }

        const panel = viewerState.panel;
        viewerState.panel = null;
        if (disposePanel && panel) {
            try {
                panel.dispose();
            } catch (_) {
            }
        }
    }

    function createViewerState(panel, markdownRelativePath, markdownFullPath) {
        const viewerState = {
            panel,
            markdownRelativePath: null,
            markdownFullPath: null,
            markdownKey: null,
            markdownFileWatcher: null,
            markdownSaveListener: null,
            refreshInProgress: false,
            disposed: false
        };

        updateViewerStateTarget(viewerState, markdownRelativePath, markdownFullPath);
        panel.onDidDispose(() => disposeViewerState(viewerState, false));
        return viewerState;
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
        const targetMarkdownKey = normalizeMarkdownPath(targetMdFullPath);

        if (multipleViewerInstances === null) {
            multipleViewerInstances = getMultipleViewerInstancesSetting(workspaceRoot);
        }

        try {
            const port = await ensureMermaidServer(workspaceRoot, extensionRoot);
            const url = await resolveExternalViewerUrl(port, targetMdRelPath);

            const viewerLabel = `CrossWayAI Viewer - ${path.basename(targetMdRelPath)}`;
            let viewerState = multipleViewerInstances
                ? viewerStates.get(targetMarkdownKey)
                : singleViewerState;

            if (!viewerState) {
                const panel = vscode.window.createWebviewPanel(
                    'crosswayaiMermaidViewer',
                    viewerLabel,
                    vscode.ViewColumn.Beside,
                    {
                        enableScripts: true,
                        retainContextWhenHidden: true,
                        portMapping: [{ webviewPort: port, extensionHostPort: port }]
                    }
                );

                viewerState = createViewerState(panel, targetMdRelPath, targetMdFullPath);
                if (!multipleViewerInstances) {
                    singleViewerState = viewerState;
                }

                panel.webview.onDidReceiveMessage((message) => {
                    handleViewerMessage(viewerState, message, workspaceRoot);
                });

                panel.webview.html = getMermaidViewerHostHtml(url);
                setViewerOpenContext(true);
                if (!multipleViewerInstances) {
                    await lockActiveViewerGroup();
                }
            } else {
                updateViewerStateTarget(viewerState, targetMdRelPath, targetMdFullPath);
                viewerState.panel.title = viewerLabel;
                // Preserve editor focus during auto-refresh to avoid replacing the viewer tab on next Explorer click.
                viewerState.panel.reveal(vscode.ViewColumn.Beside, true);
                await viewerState.panel.webview.postMessage({ type: 'navigate', url });
            }

            updateMarkdownWatcher(viewerState, workspaceRoot, targetMdRelPath);

            if (!fs.existsSync(targetMdFullPath)) {
                vscode.window.showInformationMessage(`CrossWayAI: Viewer opened. Target markdown not found: ${targetMdRelPath}`);
            }
        } catch (error) {
            CrossWayAILog.appendLine(`Failed to open Mermaid viewer: ${error.message}`);
            vscode.window.showErrorMessage('CrossWayAI: Failed to open Mermaid viewer. See CrossWayAILog for details.');
        }
    }

    function deactivateMermaidViewer() {
        Array.from(viewerStates.values()).forEach(viewerState => disposeViewerState(viewerState));
        viewerStates.clear();
        singleViewerState = null;
        setViewerOpenContext(false);

        if (mermaidServer) {
            try {
                mermaidServer.close();
            } catch (_) {
            }
            mermaidServer = null;
            mermaidServerRoot = null;
            mermaidServerExtensionRoot = null;
            mermaidServerPort = null;
        }

        multipleViewerInstances = null;
        viewerViewportStates.clear();
        mermaidViewerInstance = null;
    }

    /**
     * @returns {boolean} True when the viewer was showing one of the removed diagrams
     *          and has been closed.
     */
    function closeMermaidViewerForFile(workspaceRoot, removedMarkdownPaths) {
        if (viewerStates.size === 0 || !workspaceRoot) {
            return false;
        }

        const removedPathKeys = new Set(
            (Array.isArray(removedMarkdownPaths) ? removedMarkdownPaths : [])
                .filter(removedPath => typeof removedPath === 'string' && removedPath)
                .map(normalizeMarkdownPath)
        );
        let closedViewer = false;

        Array.from(viewerStates.values()).forEach(viewerState => {
            if (removedPathKeys.has(viewerState.markdownKey)) {
                disposeViewerState(viewerState);
                closedViewer = true;
            }
        });

        return closedViewer;
    }

    function isMermaidViewerOpen(markdownPath) {
        if (!markdownPath) {
            return viewerStates.size > 0;
        }

        return viewerStates.has(normalizeMarkdownPath(markdownPath));
    }

    function isMermaidViewerVisible(markdownPath) {
        return isMermaidViewerOpen(markdownPath);
    }

    function usesMultipleViewerInstances() {
        return multipleViewerInstances === true;
    }

    mermaidViewerInstance = {
        openCrosswayAIViewer,
        showFileInViewer,
        deactivateMermaidViewer,
        closeMermaidViewerForFile,
        persistMermaid,
        isMermaidViewerOpen,
        isMermaidViewerVisible,
        usesMultipleViewerInstances
    };

    return mermaidViewerInstance;
}

/**
 * Removes old version Mermaid diagrams that live directly under .crosswayai/mermaid.
 * Diagrams are now persisted inside a project/source folder structure to avoid
 * name collisions between files that share a base name; any .md file sitting flat
 * in the mermaid root is a stale artifact from before that structure existed.
 * Subdirectories (the current, organized layout) are left untouched.
 * @param {string} workspaceRoot
 */
function cleanupLegacyMermaidDiagrams(workspaceRoot) {
    const CrossWayAILog = getCrossWayAILog();
    if (!workspaceRoot) {
        return;
    }

    const mermaidRoot = path.join(workspaceRoot, '.crosswayai', 'mermaid');
    let entries;
    try {
        if (!fs.existsSync(mermaidRoot)) {
            return;
        }
        entries = fs.readdirSync(mermaidRoot, { withFileTypes: true });
    } catch (error) {
        if (CrossWayAILog) {
            CrossWayAILog.appendLine(`Failed to scan mermaid directory for legacy diagram cleanup: ${error.message}`);
        }
        return;
    }

    let removedCount = 0;
    for (const entry of entries) {
        // Only remove .md files that sit directly in the mermaid root; leave the
        // organized project/source subfolders and any non-markdown files alone.
        if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== '.md') {
            continue;
        }

        const legacyPath = path.join(mermaidRoot, entry.name);
        try {
            fs.unlinkSync(legacyPath);
            removedCount++;
            if (CrossWayAILog) {
                CrossWayAILog.appendLine(`Removed old version Mermaid diagram: ${legacyPath}`);
            }
        } catch (error) {
            if (CrossWayAILog) {
                CrossWayAILog.appendLine(`Failed to remove old version Mermaid diagram ${legacyPath}: ${error.message}`);
            }
        }
    }

    if (removedCount > 0 && CrossWayAILog) {
        CrossWayAILog.appendLine(`Old version Mermaid diagram cleanup removed ${removedCount} flat file(s) from ${mermaidRoot}.`);
    }
}

module.exports = {
    createMermaidViewer,
    cleanupLegacyMermaidDiagrams
};

