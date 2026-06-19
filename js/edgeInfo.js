// edgeInfo.js
// Extracted edge label and tooltip logic from impactDiagram.js

const { getCallLabel, getFirstLinkTypeEntry, parseNamedRelationLabel } = require('./diagramCommon');

function parseCallRelationLabel(rawLinkType) {
    if (typeof rawLinkType !== 'string') {
        return '';
    }
    const normalized = rawLinkType.trim();
    if (!normalized) {
        return '';
    }
    const callLabel = getCallLabel(normalized, { includeRelationSuffix: true });
    if (callLabel) {
        return callLabel;
    }
    const lower = normalized.toLowerCase();
    if (lower.startsWith('public-property:') || lower.startsWith('inherited-property:')) {
        return parseNamedRelationLabel(normalized, ['public-property', 'inherited-property']);
    }
    return '';
}

function edgeLabelExtractor(link) {
    return getFirstLinkTypeEntry(link.LinkType, { toLowerCase: false });
}

function edgeDetailLabelExtractor(link) {
    return parseCallRelationLabel(link.LinkType);
}

module.exports = {
    parseCallRelationLabel,
    edgeLabelExtractor,
    edgeDetailLabelExtractor
};
