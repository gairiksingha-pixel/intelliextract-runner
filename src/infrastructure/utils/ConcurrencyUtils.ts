export interface OperationPair {
  tenant: string | null;
  purchaser: string | null;
}

export function hasOverlap(
  scopeA: {
    tenant?: string | null;
    purchaser?: string | null;
    pairs?: OperationPair[] | null;
  },
  scopeB: {
    tenant?: string | null;
    purchaser?: string | null;
    pairs?: OperationPair[] | null;
  },
): boolean {
  // 1. Convert both to pairs for comparison
  const pairsA = getPairs(scopeA);
  const pairsB = getPairs(scopeB);

  // 2. If either is "Global" (empty pairs and no specific tenant), it overlaps with everything
  // Note: In this system, if tenant is null and pairs is null/empty, it usually means "Run for all accessible"
  const isGlobalA =
    !scopeA.tenant && (!scopeA.pairs || scopeA.pairs.length === 0);
  const isGlobalB =
    !scopeB.tenant && (!scopeB.pairs || scopeB.pairs.length === 0);

  if (isGlobalA || isGlobalB) return true;

  // 3. Check for specific pair intersection
  for (const pa of pairsA) {
    for (const pb of pairsB) {
      if (pa.tenant === pb.tenant && pa.purchaser === pb.purchaser) {
        return true;
      }
    }
  }

  // 4. Check for tenant-level intersection if no pairs but specific tenant
  if (scopeA.tenant && scopeB.tenant && scopeA.tenant === scopeB.tenant) {
    // If purchasers are different, maybe it's fine?
    // But usually one brand = one folder/lock. Let's be safe.
    if (
      !scopeA.purchaser ||
      !scopeB.purchaser ||
      scopeA.purchaser === scopeB.purchaser
    ) {
      return true;
    }
  }

  return false;
}

function getPairs(scope: {
  tenant?: string | null;
  purchaser?: string | null;
  pairs?: OperationPair[] | null;
}): OperationPair[] {
  if (scope.pairs && scope.pairs.length > 0) return scope.pairs;
  if (scope.tenant && scope.purchaser) {
    return [{ tenant: scope.tenant, purchaser: scope.purchaser }];
  }
  return [];
}
