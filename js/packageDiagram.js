const {
    generateDiagram,
    getDsMapArray
} = require('./diagramCommon');

async function generatePackageDiagram(context, uri, deps) {
    return generateDiagram(context, uri, deps, 'package', generateMermaidPackageGraph);
}

function generateMermaidPackageGraph(dsMap, targetNode, deps) {
    const { vscode, workspaceRoot, path } = deps;
    const allFileNodes = getDsMapArray(dsMap, 'ttFileNode');
    const projectName = workspaceRoot && path ? path.basename(workspaceRoot) : 'Project';

    if (allFileNodes.length === 0) {
        vscode.window.showWarningMessage('CrossWayAI: dsMap.json does not contain package diagram data. Please regenerate the map.');
        return null;
    }

    const targetClassName = String((targetNode && targetNode.ClassName) || '').trim();
    const targetRootPackage = targetClassName.split('.').map(item => item.trim()).filter(Boolean)[0] || '';

    if (!targetRootPackage) {
        vscode.window.showInformationMessage(`No ClassName found for ${targetNode.FileName}. Package diagram requires a class with package notation.`);
        return null;
    }

    const targetRootPackageLower = targetRootPackage.toLowerCase();
    const classNodes = allFileNodes.filter(node => {
        if (typeof node.ClassName !== 'string') {
            return false;
        }

        const className = node.ClassName.trim();
        if (!className) {
            return false;
        }

        const classNameLower = className.toLowerCase();
        return classNameLower === targetRootPackageLower || classNameLower.startsWith(`${targetRootPackageLower}.`);
    });
    if (classNodes.length === 0) {
        vscode.window.showInformationMessage(`No classes found under package root '${targetRootPackage}'.`);
        return null;
    }

    const defaultSource = String(classNodes[0].source || '').trim() || 'abl';

    const packageOrder = [];
    const packageMap = new Map();

    function ensurePackage(pathKey, name, parentPath) {
        if (!packageMap.has(pathKey)) {
            packageMap.set(pathKey, { name, parentPath });
            packageOrder.push(pathKey);
        }
    }

    const classes = [];

    classNodes.forEach(node => {
        const className = String(node.ClassName || '').trim();
        const parts = className.split('.').map(item => item.trim()).filter(Boolean);
        if (parts.length === 0) {
            return;
        }

        const classSimpleName = parts[parts.length - 1];
        const packageParts = parts.slice(0, -1);

        let parentPath = targetRootPackage;
        let currentPath = targetRootPackage;

        packageParts.slice(1).forEach(part => {
            currentPath = `${currentPath}.${part}`;
            ensurePackage(currentPath, part, parentPath);
            parentPath = currentPath;
        });

        classes.push({
            fileName: node.FileName,
            className,
            classSimpleName,
            packagePath: parentPath
        });
    });

    if (packageMap.size === 0 && classes.length === 0) {
        vscode.window.showInformationMessage(`No package structure found for ${targetNode.FileName}.`);
        return null;
    }

    let mermaidGraph = 'graph TD;\n';
    const declaredNodes = new Set();
    let edgeCounter = 0;
    const edgeStyleIndices = new Map();

    const branchPalette = [
        '#F6D8AE',
        '#CDEAC0',
        '#C7DDF2',
        '#E7C6FF',
        '#FFD6E0',
        '#D7F9F1',
        '#FAEDCB',
        '#D9ED92'
    ];

    const branchRoots = [];
    const branchRootSet = new Set();

    function pushBranchRoot(key) {
        if (key && !branchRootSet.has(key)) {
            branchRootSet.add(key);
            branchRoots.push(key);
        }
    }

    function hexToRgb(hex) {
        const normalized = String(hex || '').replace('#', '');
        const full = normalized.length === 3
            ? normalized.split('').map(ch => ch + ch).join('')
            : normalized.padStart(6, '0').slice(0, 6);

        return {
            r: parseInt(full.slice(0, 2), 16),
            g: parseInt(full.slice(2, 4), 16),
            b: parseInt(full.slice(4, 6), 16)
        };
    }

    function rgbToHex(rgb) {
        const r = Math.max(0, Math.min(255, Math.round(rgb.r)));
        const g = Math.max(0, Math.min(255, Math.round(rgb.g)));
        const b = Math.max(0, Math.min(255, Math.round(rgb.b)));
        return `#${[r, g, b].map(value => value.toString(16).padStart(2, '0')).join('')}`;
    }

    function mixColors(colorA, colorB, ratio) {
        const start = hexToRgb(colorA);
        const end = hexToRgb(colorB);
        const weight = Math.max(0, Math.min(1, ratio));
        return rgbToHex({
            r: start.r + (end.r - start.r) * weight,
            g: start.g + (end.g - start.g) * weight,
            b: start.b + (end.b - start.b) * weight
        });
    }

    function getBranchIndex(branchKey) {
        const index = branchRoots.indexOf(branchKey);
        return index === -1 ? 0 : index;
    }

    function getBranchColor(branchKey, depth) {
        const paletteColor = branchPalette[getBranchIndex(branchKey) % branchPalette.length];
        const adjustedDepth = Math.max(0, depth || 0);
        const ratio = Math.min(0.45, adjustedDepth * 0.12);
        return mixColors(paletteColor, '#ffffff', ratio);
    }

    function getTextColor(fillColor) {
        const rgb = hexToRgb(fillColor);
        const luminance = (rgb.r * 299 + rgb.g * 587 + rgb.b * 114) / 1000;
        return luminance >= 160 ? '#1f2937' : '#ffffff';
    }

    const pkgIdByKey = new Map();
    const clsIdByKey = new Map();

    function shortId(prefix, index) {
        return `${prefix}${index.toString(36)}`;
    }

    function packageNodeId(key) {
        const normalizedKey = String(key || 'root');
        if (!pkgIdByKey.has(normalizedKey)) {
            pkgIdByKey.set(normalizedKey, shortId('p', pkgIdByKey.size));
        }
        return pkgIdByKey.get(normalizedKey);
    }

    function classNodeId(key) {
        const normalizedKey = String(key || 'root');
        if (!clsIdByKey.has(normalizedKey)) {
            clsIdByKey.set(normalizedKey, shortId('c', clsIdByKey.size));
        }
        return clsIdByKey.get(normalizedKey);
    }

    function declareNode(id, label, style) {
        if (declaredNodes.has(id)) {
            return;
        }
        mermaidGraph += `    ${id}["${String(label || '').replace(/"/g, '\\"')}"]\n`;
        if (style) {
            mermaidGraph += `    style ${id} ${style}\n`;
        }
        declaredNodes.add(id);
    }

    function addStyledEdge(sourceId, destId, style) {
        mermaidGraph += `    ${sourceId} --> ${destId};\n`;
        if (style) {
            if (!edgeStyleIndices.has(style)) {
                edgeStyleIndices.set(style, []);
            }
            edgeStyleIndices.get(style).push(edgeCounter);
        }
        edgeCounter++;
    }

    function appendBatchedLinkStyles() {
        const MAX_INDICES_PER_LINE = 120;
        edgeStyleIndices.forEach((indices, style) => {
            for (let i = 0; i < indices.length; i += MAX_INDICES_PER_LINE) {
                const chunk = indices.slice(i, i + MAX_INDICES_PER_LINE);
                mermaidGraph += `    linkStyle ${chunk.join(',')} ${style}\n`;
            }
        });
    }

    const rootId = packageNodeId(targetRootPackage);
    const rootLabel = `${targetRootPackage}\n[${projectName}](${defaultSource})`;
    declareNode(rootId, rootLabel, `fill:#d1d5db,stroke-width:0px,color:#1f2937`);

    packageOrder.forEach(pkgPath => {
        const parentPath = packageMap.get(pkgPath).parentPath;
        if (parentPath === targetRootPackage) {
            pushBranchRoot(pkgPath);
        }
    });

    packageOrder.forEach(pkgPath => {
        const pkg = packageMap.get(pkgPath);
        const pkgId = packageNodeId(pkgPath);
        const branchKey = pkgPath.split('.').length === 2
            ? pkgPath
            : pkgPath.split('.').slice(0, 2).join('.');
        const depth = Math.max(1, pkgPath.split('.').length - 1);
        const fillColor = getBranchColor(branchKey, depth);
        const textColor = getTextColor(fillColor);
        declareNode(
            pkgId,
            pkg.name,
            `fill:${fillColor},stroke-width:0px,color:${textColor}`
        );

        if (pkg.parentPath) {
            addStyledEdge(
                packageNodeId(pkg.parentPath),
                pkgId,
                `stroke:${mixColors(fillColor, '#6b7280', 0.2)},stroke-width:2px`
            );
        }
    });

    classes
        .sort((a, b) => a.className.localeCompare(b.className))
        .forEach(cls => {
            const classKey = `${cls.className}|${cls.fileName || ''}`;
            const classId = classNodeId(classKey);
            const branchKey = cls.packagePath.split('.').length === 1
                ? cls.packagePath
                : cls.packagePath.split('.').slice(0, 2).join('.');
            const depth = cls.packagePath.split('.').length;
            const fillColor = getBranchColor(branchKey, depth + 1);
            const textColor = getTextColor(fillColor);
            const classDisplayName = cls.classSimpleName.toLowerCase().endsWith('.cls')
                ? cls.classSimpleName
                : `${cls.classSimpleName}.cls`;
            const isSelectedNode =
                cls.className.toLowerCase() === targetClassName.toLowerCase() &&
                String(cls.fileName || '').toLowerCase() === String((targetNode && targetNode.FileName) || '').toLowerCase();
            const selectedFillColor = isSelectedNode ? '#1f6feb' : mixColors(fillColor, '#ffffff', 0.18);
            const selectedTextColor = isSelectedNode ? '#ffffff' : textColor;
            const dashedSelection = isSelectedNode ? ',stroke-dasharray:5 4,stroke-width:3px' : '';
            declareNode(
                classId,
                classDisplayName,
                `fill:${selectedFillColor},stroke-width:0px,color:${selectedTextColor}${dashedSelection}`
            );

            addStyledEdge(
                packageNodeId(cls.packagePath),
                classId,
                `stroke:${mixColors(fillColor, '#6b7280', 0.2)},stroke-width:2px`
            );
        });

    appendBatchedLinkStyles();

    return mermaidGraph;
}

module.exports = {
    generatePackageDiagram
};
