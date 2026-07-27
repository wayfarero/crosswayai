// crosswayaiShared.js
// Shared utility functions for crosswayaiViewer.js and edgeTooltip.js

function openNodeFile(nodeId, targetType, targetName, signature) {
  if (window.CROSSWAY_VIRTUAL_NODES && window.CROSSWAY_VIRTUAL_NODES.has(nodeId)) {
    return false;
  }

  const filePath = (window.CROSSWAY_FILE_MAP || {})[nodeId];
  if (!filePath) {
    return false;
  }

  // Pass targetType and targetName if provided
  const message = { type: 'openFile', filePath: filePath };
  if (targetType) {
    message.targetType = targetType;
  }
  if (targetName) {
    message.targetName = targetName;
  }
  // Use an explicit undefined/null check (not truthiness) so that an empty
  // signature string – which represents the no-parameter overload, e.g. the
  // "( )" entry – is still forwarded. Dropping it here would make the editor
  // fall back to the first method definition with that name.
  if (signature !== null) {
    message.signature = signature;
  }
  // Debug: log the outgoing message for troubleshooting
  console.log('[openNodeFile] Sending message:', JSON.stringify(message));
  window.parent.postMessage(message, '*');
  return true;
}

function openNodeXrefFile(nodeId) {
  return openNodeTargetFile(nodeId, 'openXrefFile');
}

function openNodeProparseFile(nodeId) {
  return openNodeTargetFile(nodeId, 'openProparseFile');
}

function openNodeTargetFile(nodeId, targetName) {
  const filePath = (window.CROSSWAY_FILE_MAP || {})[nodeId];
  if (!filePath) {
    return false;
  }
  window.parent.postMessage({ type: targetName, filePath: filePath }, '*');
  return true;
}

// Export for module systems (if needed)
if (typeof window !== 'undefined') {
  window.openNodeFile = openNodeFile;
  window.openNodeXrefFile = openNodeXrefFile;
  window.openNodeProparseFile = openNodeProparseFile;
}
