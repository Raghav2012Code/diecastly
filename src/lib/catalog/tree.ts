/**
 * Category tree helpers.
 *
 * A category may point at a parent, and nothing in the schema or the input
 * schema prevented a cycle: the manager only excluded a category from its own
 * parent options, not its descendants. Setting A's parent to B, where B's
 * parent is A, saved cleanly and left a loop. Nothing walks the tree
 * recursively today, which is exactly why it is cheap to fix now and expensive
 * after the first recursive consumer.
 */

export type CategoryNode = { id: string; parent_id: string | null };

/**
 * Ids that may not be chosen as a category's parent: the category itself and
 * everything beneath it. Choosing any of them would create a cycle.
 *
 * Safe on malformed input: a cycle already present in the data terminates the
 * walk instead of hanging, because a node is only expanded the first time it
 * is reached.
 */
export function forbiddenParentIds(categories: CategoryNode[], categoryId: string): Set<string> {
  const byParent = new Map<string, string[]>();
  for (const category of categories) {
    if (!category.parent_id) continue;
    const siblings = byParent.get(category.parent_id);
    if (siblings) siblings.push(category.id);
    else byParent.set(category.parent_id, [category.id]);
  }

  const forbidden = new Set<string>([categoryId]);
  const queue = [categoryId];
  while (queue.length > 0) {
    const current = queue.shift() as string;
    for (const child of byParent.get(current) ?? []) {
      if (forbidden.has(child)) continue;
      forbidden.add(child);
      queue.push(child);
    }
  }
  return forbidden;
}
