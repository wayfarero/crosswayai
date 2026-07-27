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

function appendToLogFile(workspaceRoot, message) {
    if (!workspaceRoot || !message) {
        return;
    }

    try {
        const logDirectory = path.join(workspaceRoot, '.crosswayai');
        const logFile = path.join(logDirectory, 'crosswayai.log');

        fs.mkdirSync(logDirectory, { recursive: true });
        fs.appendFileSync(logFile, `${new Date().toISOString()} ${message}\n`);
    } catch (error) {
        logCrossWayAI(`>Warning: failed to write to crosswayai.log file: ${error.message}`);
    }
}

module.exports = {
    setCrossWayAILog,
    getCrossWayAILog,
    logCrossWayAI,
    appendToLogFile
};
