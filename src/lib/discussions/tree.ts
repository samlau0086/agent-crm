export interface DiscussionTreeItem {
  id: string;
  parentId?: string;
  createdAt: string;
}

export interface DiscussionTreeNode<T extends DiscussionTreeItem> {
  message: T;
  children: DiscussionTreeNode<T>[];
  depth: number;
  visualDepth: number;
}

export function buildDiscussionTree<T extends DiscussionTreeItem>(messages: T[]): DiscussionTreeNode<T>[] {
  const sorted = [...messages].sort(compareDiscussionItems);
  const nodes = new Map(sorted.map((message) => [message.id, { message, children: [], depth: 0, visualDepth: 0 } as DiscussionTreeNode<T>]));
  const roots: DiscussionTreeNode<T>[] = [];
  for (const message of sorted) {
    const node = nodes.get(message.id)!;
    const parent = message.parentId && message.parentId !== message.id ? nodes.get(message.parentId) : undefined;
    if (parent && !isNodeDescendant(node, parent)) parent.children.push(node);
    else roots.push(node);
  }
  const assignDepth = (node: DiscussionTreeNode<T>, depth: number) => {
    node.depth = depth;
    node.visualDepth = Math.min(depth, 4);
    node.children.sort((left, right) => compareDiscussionItems(left.message, right.message));
    node.children.forEach((child) => assignDepth(child, depth + 1));
  };
  roots.sort((left, right) => compareDiscussionItems(left.message, right.message));
  roots.forEach((root) => assignDepth(root, 0));
  return roots;
}

export function groupDiscussionMessageIdsByRoot(messages: DiscussionTreeItem[]): Map<string, string[]> {
  const byId = new Map(messages.map((message) => [message.id, message]));
  const rootMemo = new Map<string, string>();
  const rootFor = (id: string, visiting = new Set<string>()): string => {
    const memoized = rootMemo.get(id);
    if (memoized) return memoized;
    const message = byId.get(id);
    if (!message?.parentId || !byId.has(message.parentId) || visiting.has(id)) {
      rootMemo.set(id, id);
      return id;
    }
    visiting.add(id);
    const rootId = rootFor(message.parentId, visiting);
    visiting.delete(id);
    rootMemo.set(id, rootId);
    return rootId;
  };
  const groups = new Map<string, string[]>();
  for (const message of messages) {
    const rootId = rootFor(message.id);
    groups.set(rootId, [...(groups.get(rootId) ?? []), message.id]);
  }
  return groups;
}

export function discussionAncestorIds(messages: DiscussionTreeItem[], messageIds: string[]): string[] {
  const byId = new Map(messages.map((message) => [message.id, message]));
  const requested = new Set(messageIds);
  const ancestors = new Set<string>();
  for (const id of messageIds) {
    let parentId = byId.get(id)?.parentId;
    const visited = new Set<string>();
    while (parentId && !requested.has(parentId) && !visited.has(parentId)) {
      visited.add(parentId);
      ancestors.add(parentId);
      parentId = byId.get(parentId)?.parentId;
    }
  }
  return [...ancestors];
}

function compareDiscussionItems(left: DiscussionTreeItem, right: DiscussionTreeItem) {
  return left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id);
}

function isNodeDescendant<T extends DiscussionTreeItem>(candidate: DiscussionTreeNode<T>, ancestor: DiscussionTreeNode<T>): boolean {
  if (candidate === ancestor) return true;
  return candidate.children.some((child) => isNodeDescendant(child, ancestor));
}
