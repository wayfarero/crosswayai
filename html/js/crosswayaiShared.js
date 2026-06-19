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
  if (signature) {
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
