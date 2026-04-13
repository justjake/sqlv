import { useKeyboard } from "@opentui/react";
import { useMemo, useState } from "react";

export type TreeNode = {
  key: string;
  name: string;
  children?: TreeNode[];
};

type FlatTreeNode = {
  node: TreeNode;
  key: string;
  idx: number;
  localIdx: number;
  lastLocal?: boolean;
  parentIdx: number;
  level: number;
};

type TreeProps = {
  nodes: TreeNode[];
  onFocus?: (idx: number, node: TreeNode) => void;
  onEnter?: (idx: number, node: TreeNode) => void;
};

export function TreeView(props: TreeProps) {
  const { nodes, onEnter } = props;
  const rows = useMemo(() => flattenTree(nodes), [nodes]);

  const [index, setIndex] = useState(0);

  useKeyboard((key) => {
    switch (key.name) {
      case "up":
        return setIndex((index) => Math.max(0, index - 1));
      case "down":
        return setIndex((index) => Math.min(rows.length - 1, index + 1));
      case "enter":
        const node = rows[index]?.node;
        if (!node) {
          throw new Error(
            `Logical error: expected to have tree node at idx=${index}`,
          );
        }
        onEnter?.(index, node);
    }
  });

  return (
    <box>
      {rows.map((node) => (
        <TreeNodeView key={node.key} {...node} />
      ))}
    </box>
  );
}

function TreeNodeView(props: FlatTreeNode) {
  return <box paddingLeft={props.level * 2}>{props.node.name}</box>;
}

function flattenTree(nodes: TreeNode[], parent?: FlatTreeNode): FlatTreeNode[] {
  parent = parent ?? {
    idx: 0,
    localIdx: 0,
    key: "",
    node: {
      key: "",
      name: "Root",
    },
    level: -1,
    parentIdx: -1,
  };

  const flat: FlatTreeNode[] = [];
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    if (!node) {
      throw new Error(`Logical error: should have node in tree`);
    }
    const flatNode: FlatTreeNode = {
      idx: parent.idx + i,
      localIdx: i,
      level: parent.level + 1,
      key: `${parent.key}.${node.key}`,
      node,
      parentIdx: parent.idx,
      lastLocal: i === nodes.length - 1,
    };
    flat.push(flatNode);
    if (node.children) {
      const children = flattenTree(node.children, flatNode);
      children.forEach((c) => flat.push(c));
    }
  }

  return flat;
}
