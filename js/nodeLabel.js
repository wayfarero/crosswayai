
const diagramColors = require('../resources/diagram-colors.json');
const LABEL_TEXT_COLORS = diagramColors.labelTextColors;

function buildNodeLabel(augumentedNode) {
    const firstLine = augumentedNode.LabelPrefix ? `${augumentedNode.LabelPrefix}${augumentedNode.FileName}` : augumentedNode.FileName;

    const sourceDirLabelColor = augumentedNode.isRefNode
        ? LABEL_TEXT_COLORS.referencedNodeSourceDirectory
        : LABEL_TEXT_COLORS.sourceDirectory;
    const projectLabelColor = LABEL_TEXT_COLORS.projectName;
    const escapedFirst = firstLine.replace(/"/g, '\\"');
    const escapedProject = augumentedNode.ProjectName
        ? `<span style='color:${projectLabelColor}'>[${augumentedNode.ProjectName}]</span>`.replace(/"/g, '\\"')
        : '';
    const escapedSourceDir = augumentedNode.SourceDirectory
        ? (`<span style='color:${sourceDirLabelColor}'>(${augumentedNode.SourceDirectory})</span>`).replace(/"/g, '\\"')
        : '';
    const escapedRelFolder = augumentedNode.RelativeFolderPath
        ? augumentedNode.RelativeFolderPath
            .replace(/^(\(\.pl\))/i, `<span style='color:${LABEL_TEXT_COLORS.sourceDirectory}'>$&</span>`)
            .replace(/"/g, '\\"')
        : '';

    const parts = [escapedProject, escapedSourceDir, escapedRelFolder].filter(Boolean);
    if (parts.length > 0) {
        return `${escapedFirst}\\n${parts.join('/')}`;
    }
    return escapedFirst;
}

module.exports = {
    buildNodeLabel
};
