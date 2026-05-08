(function () {
  'use strict';

  function normalizeErKeySyntax(code) {
    return (code || '')
      .replace(/\bPK[_/ ]FK\b/gi, 'PK, FK')
      .replace(/\bFK[_/ ]PK\b/gi, 'FK, PK');
  }

  function organizeErDiagram(code) {
    const source = (code || '').replace(/\r\n/g, '\n');
    const lines = source.split('\n');
    const headerIndex = lines.findIndex((line) => /^\s*erDiagram\b/i.test(line));
    if (headerIndex === -1) {
      return code;
    }

    const entityBlocks = new Map();
    const relationships = [];
    const passthroughLines = [];
    const entityDeclPattern = /^\s*([A-Za-z0-9_]+)\s*\{\s*$/;
    const relationshipPattern = /^\s*([A-Za-z0-9_]+)\s+([^\s]+)\s+([A-Za-z0-9_]+)\s*:\s*(.+?)\s*$/;

    for (let i = headerIndex + 1; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }

      const entityMatch = line.match(entityDeclPattern);
      if (entityMatch) {
        const entityName = entityMatch[1];
        const blockLines = [line];
        let closed = false;

        for (i = i + 1; i < lines.length; i++) {
          blockLines.push(lines[i]);
          if (/^\s*}\s*$/.test(lines[i])) {
            closed = true;
            break;
          }
        }

        if (!closed) {
          return code;
        }

        entityBlocks.set(entityName, blockLines);
        continue;
      }

      const relMatch = line.match(relationshipPattern);
      if (relMatch && relMatch[2].includes('--')) {
        relationships.push({
          left: relMatch[1],
          right: relMatch[3],
          raw: trimmed
        });
        continue;
      }

      passthroughLines.push(trimmed);
    }

    if (entityBlocks.size < 2 || relationships.length === 0) {
      return code;
    }

    const nodeSet = new Set(entityBlocks.keys());
    const adjacency = new Map();
    nodeSet.forEach((name) => adjacency.set(name, new Set()));
    relationships.forEach((rel) => {
      if (!nodeSet.has(rel.left) || !nodeSet.has(rel.right)) {
        return;
      }
      adjacency.get(rel.left).add(rel.right);
      adjacency.get(rel.right).add(rel.left);
    });

    const degree = (name) => (adjacency.get(name) ? adjacency.get(name).size : 0);
    const nodes = Array.from(nodeSet).sort((a, b) => a.localeCompare(b));

    const components = [];
    const seen = new Set();
    for (const node of nodes) {
      if (seen.has(node)) continue;
      const queue = [node];
      seen.add(node);
      const comp = [];
      while (queue.length) {
        const cur = queue.shift();
        comp.push(cur);
        const neighbors = Array.from(adjacency.get(cur) || []).sort((a, b) => a.localeCompare(b));
        for (const next of neighbors) {
          if (seen.has(next)) continue;
          seen.add(next);
          queue.push(next);
        }
      }
      components.push(comp);
    }

    function buildComponentOrder(componentNodes) {
      if (componentNodes.length <= 1) {
        return componentNodes.slice();
      }

      const inComponent = new Set(componentNodes);
      const compEdges = [];
      for (const rel of relationships) {
        if (inComponent.has(rel.left) && inComponent.has(rel.right)) {
          compEdges.push([rel.left, rel.right]);
        }
      }

      function orderIndexMap(currentOrder) {
        return new Map(currentOrder.map((n, i) => [n, i]));
      }

      function edgeStats(currentOrder) {
        const idx = orderIndexMap(currentOrder);
        let edgeLength = 0;
        let crossings = 0;
        let sideCongestion = 0;
        const sideCounts = new Map();

        for (const nodeName of currentOrder) {
          sideCounts.set(nodeName, { left: 0, right: 0 });
        }

        for (let i = 0; i < compEdges.length; i++) {
          const [a1, b1] = compEdges[i];
          const l1 = idx.get(a1);
          const r1 = idx.get(b1);
          const s1 = Math.min(l1, r1);
          const e1 = Math.max(l1, r1);
          edgeLength += (e1 - s1);

          const leftNode = l1 < r1 ? a1 : b1;
          const rightNode = l1 < r1 ? b1 : a1;
          sideCounts.get(leftNode).right++;
          sideCounts.get(rightNode).left++;

          for (let j = i + 1; j < compEdges.length; j++) {
            const [a2, b2] = compEdges[j];
            const l2 = idx.get(a2);
            const r2 = idx.get(b2);
            const s2 = Math.min(l2, r2);
            const e2 = Math.max(l2, r2);
            const isCrossing = (s1 < s2 && s2 < e1 && e1 < e2) || (s2 < s1 && s1 < e2 && e2 < e1);
            if (isCrossing) {
              crossings++;
            }
          }
        }

        for (const counts of sideCounts.values()) {
          const leftOverflow = Math.max(0, counts.left - 2);
          const rightOverflow = Math.max(0, counts.right - 2);
          sideCongestion += (leftOverflow * leftOverflow) + (rightOverflow * rightOverflow);
        }

        return { crossings, edgeLength, sideCongestion };
      }

      function score(currentOrder) {
        const stats = edgeStats(currentOrder);
        return (stats.crossings * 200000) + (stats.edgeLength * 8) + (stats.sideCongestion * 500);
      }

      function buildBarycentricOrder(initialOrder, iterations) {
        const iterationCount = Number.isInteger(iterations) ? iterations : 12;
        let order = initialOrder.slice();
        for (let iteration = 0; iteration < iterationCount; iteration++) {
          const idx = orderIndexMap(order);
          const scored = order.map((name) => {
            const neighbors = Array.from(adjacency.get(name) || []).filter((n) => inComponent.has(n));
            if (!neighbors.length) {
              return { name, bary: idx.get(name), deg: degree(name) };
            }
            const avg = neighbors.reduce((sum, n) => sum + idx.get(n), 0) / neighbors.length;
            return { name, bary: avg, deg: degree(name) };
          });

          scored.sort((a, b) => {
            if (a.bary !== b.bary) return a.bary - b.bary;
            if (b.deg !== a.deg) return b.deg - a.deg;
            return a.name.localeCompare(b.name);
          });
          order = scored.map((s) => s.name);
        }
        return order;
      }

      function improveOrder(initialOrder) {
        let order = initialOrder.slice();
        let bestScore = score(order);
        let improved = true;
        let guard = 0;

        while (improved && guard < 300) {
          guard++;
          improved = false;

          for (let i = 0; i < order.length - 1; i++) {
            const candidate = order.slice();
            const tmp = candidate[i];
            candidate[i] = candidate[i + 1];
            candidate[i + 1] = tmp;
            const candidateScore = score(candidate);
            if (candidateScore < bestScore) {
              order = candidate;
              bestScore = candidateScore;
              improved = true;
            }
          }

          for (let i = 0; i < order.length; i++) {
            const node = order[i];
            let bestLocal = order;
            let bestLocalScore = bestScore;

            for (let target = 0; target < order.length; target++) {
              if (target === i) continue;
              const candidate = order.slice();
              candidate.splice(i, 1);
              candidate.splice(target, 0, node);
              const candidateScore = score(candidate);
              if (candidateScore < bestLocalScore) {
                bestLocal = candidate;
                bestLocalScore = candidateScore;
              }
            }

            if (bestLocalScore < bestScore) {
              order = bestLocal;
              bestScore = bestLocalScore;
              improved = true;
            }
          }
        }

        return order;
      }

      const baseOrder = componentNodes
        .slice()
        .sort((a, b) => {
          const d = degree(b) - degree(a);
          if (d !== 0) return d;
          return a.localeCompare(b);
        });

      const candidateOrders = [
        buildBarycentricOrder(baseOrder),
        buildBarycentricOrder(baseOrder.slice().reverse()),
        buildBarycentricOrder(componentNodes.slice().sort((a, b) => a.localeCompare(b))),
        buildBarycentricOrder(componentNodes.slice().sort((a, b) => b.localeCompare(a)))
      ];

      let bestOrder = candidateOrders[0];
      let bestOrderScore = score(bestOrder);
      for (let i = 1; i < candidateOrders.length; i++) {
        const candidateScore = score(candidateOrders[i]);
        if (candidateScore < bestOrderScore) {
          bestOrder = candidateOrders[i];
          bestOrderScore = candidateScore;
        }
      }

      const improved = improveOrder(bestOrder);
      const improvedReversed = improveOrder(bestOrder.slice().reverse());
      return score(improved) <= score(improvedReversed) ? improved : improvedReversed;
    }

    const orderedComponents = components
      .map((comp) => buildComponentOrder(comp))
      .sort((a, b) => {
        const aDegree = a.reduce((sum, name) => sum + degree(name), 0);
        const bDegree = b.reduce((sum, name) => sum + degree(name), 0);
        if (bDegree !== aDegree) return bDegree - aDegree;
        if (b.length !== a.length) return b.length - a.length;
        return a[0].localeCompare(b[0]);
      });

    const orderedEntities = orderedComponents.flat();
    const orderIndex = new Map(orderedEntities.map((name, idx) => [name, idx]));

    const orderedRelationships = relationships.slice().sort((a, b) => {
      const aMin = Math.min(orderIndex.get(a.left) ?? 999999, orderIndex.get(a.right) ?? 999999);
      const bMin = Math.min(orderIndex.get(b.left) ?? 999999, orderIndex.get(b.right) ?? 999999);
      if (aMin !== bMin) return aMin - bMin;

      const aSpan = Math.abs((orderIndex.get(a.left) ?? 999999) - (orderIndex.get(a.right) ?? 999999));
      const bSpan = Math.abs((orderIndex.get(b.left) ?? 999999) - (orderIndex.get(b.right) ?? 999999));
      if (aSpan !== bSpan) return aSpan - bSpan;

      const aLeft = orderIndex.get(a.left) ?? 999999;
      const bLeft = orderIndex.get(b.left) ?? 999999;
      if (aLeft !== bLeft) return aLeft - bLeft;

      const aRight = orderIndex.get(a.right) ?? 999999;
      const bRight = orderIndex.get(b.right) ?? 999999;
      if (aRight !== bRight) return aRight - bRight;

      return a.raw.localeCompare(b.raw);
    });

    const rebuilt = ['erDiagram'];
    for (const entityName of orderedEntities) {
      const block = entityBlocks.get(entityName);
      if (!block) continue;
      rebuilt.push(...block);
    }

    passthroughLines.forEach((line) => rebuilt.push(`  ${line}`));
    orderedRelationships.forEach((rel) => rebuilt.push(`  ${rel.raw}`));
    return rebuilt.join('\n');
  }

  window.CrosswayEntityRelations = {
    normalizeErKeySyntax,
    organizeErDiagram
  };
})();
