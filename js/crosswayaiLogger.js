const fs = require('fs');
const path = require('path');

let CrossWayAILog = null;

function setCrossWayAILog(logger) {
    CrossWayAILog = logger || null;
}

function getCrossWayAILog() {
    return CrossWayAILog;
}

function logCrossWayAI(message) {
    if (CrossWayAILog && typeof CrossWayAILog.appendLine === 'function') {
        CrossWayAILog.appendLine(message);
    }
}

// Absolute path of the on-disk .crosswayai/crosswayai.log file — distinct from
// getCrossWayAILog(), which returns the VS Code output channel.
function getCrosswayaiLogFilePath(workspaceRoot) {
    return path.join(workspaceRoot, '.crosswayai', 'crosswayai.log');
}

function appendToLogFile(workspaceRoot, message) {
    if (!workspaceRoot || !message) {
        return;
    }

    try {
        const logFile = getCrosswayaiLogFilePath(workspaceRoot);

        fs.mkdirSync(path.dirname(logFile), { recursive: true });
        fs.appendFileSync(logFile, `${new Date().toISOString()} ${message}\n`);
    } catch (error) {
        logCrossWayAI(`>Warning: failed to write to crosswayai.log file: ${error.message}`);
    }
}

module.exports = {
    setCrossWayAILog,
    getCrossWayAILog,
    logCrossWayAI,
    getCrosswayaiLogFilePath,
    appendToLogFile
};
