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

module.exports = {
    setCrossWayAILog,
    getCrossWayAILog,
    logCrossWayAI
};
