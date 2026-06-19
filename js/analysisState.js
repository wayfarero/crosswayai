let isAnalysisRunning = false;

function setAnalysisRunning(value) {
    isAnalysisRunning = value;
}

function getAnalysisRunning() {
    return isAnalysisRunning;
}

module.exports = {
    setAnalysisRunning,
    getAnalysisRunning
};
