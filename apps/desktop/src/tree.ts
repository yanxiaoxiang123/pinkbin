import type { Node } from './types';

/**
 * DFS 收集所有被 scaffoldId 标记的节点，不递归进已匹配的子节点。
 * 匹配段天然互斥（一个 scaffold 不会在同一子树内重复标记），
 * 因此每个 match 的 size/children 不重叠。
 * 返回结果**不排序**，调用方按需自行排序。
 */
export function collectScaffoldMatches(root: Node | null, scaffoldId: string): Node[] {
  if (!root) return [];
  const out: Node[] = [];
  const dfs = (n: Node) => {
    if (n.scaffold_id === scaffoldId) {
      out.push(n);
      return;
    }
    for (const c of n.children ?? []) dfs(c);
  };
  dfs(root);
  return out;
}