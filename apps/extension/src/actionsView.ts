import * as vscode from "vscode";

/**
 * The Forward sidebar (Activity Bar) view: a static tree of every action the
 * extension offers, grouped by data layer, so users can discover and run them
 * without knowing the Command Palette names. Clicking a leaf runs its command.
 *
 * Keep this list in sync with `contributes.commands` in package.json — a
 * command missing here is invisible to sidebar users.
 */

interface Action {
  readonly label: string;
  readonly command: string;
  /** Codicon id (no `$()` wrapper), e.g. "sign-in". */
  readonly icon: string;
  readonly tooltip: string;
}

interface Group {
  readonly label: string;
  readonly icon: string;
  readonly actions: readonly Action[];
}

const GROUPS: readonly Group[] = [
  {
    label: "Project",
    icon: "repo",
    actions: [
      {
        label: "Initialize Project in This Repository",
        command: "forward.initRepo",
        icon: "add",
        tooltip: "Create .forward/ here. The project is versioned with your code.",
      },
      {
        label: "Set Up MCP for AI Agents",
        command: "forward.setupMcp",
        icon: "copy",
        tooltip: "Copy a claude mcp add command for this repository.",
      },
    ],
  },
  {
    label: "Canvas",
    icon: "layout",
    actions: [
      {
        label: "Open Design Canvas",
        command: "forward.openCanvas",
        icon: "open-preview",
        tooltip: "Open the shared design canvas in a read-only panel.",
      },
    ],
  },
  {
    label: "API Documentation",
    icon: "book",
    actions: [
      {
        label: "Document API on Design Element",
        command: "forward.connectEndpoint",
        icon: "plug",
        tooltip: "Attach API documentation to a design element on the canvas.",
      },
      {
        label: "Insert Anchor at Cursor (@adc)",
        command: "forward.insertAnchor",
        icon: "link",
        tooltip:
          "Insert an @adc anchor for a design element at the cursor — pick by name, no id to transcribe.",
      },
      {
        label: "Show Endpoint History",
        command: "forward.showHistory",
        icon: "history",
        tooltip: "Browse the documentation timeline of an endpoint.",
      },
      {
        label: "Catch Up on Endpoint Changes",
        command: "forward.catchUp",
        icon: "sync",
        tooltip: "Digest of endpoints added, modified or removed since a baseline.",
      },
      {
        label: "Remove API Documentation",
        command: "forward.removeDocumentation",
        icon: "trash",
        tooltip: "Detach API documentation from a design element.",
      },
    ],
  },
  {
    label: "Infrastructure",
    icon: "server",
    actions: [
      {
        label: "Add Infrastructure Node",
        command: "forward.addInfraNode",
        icon: "add",
        tooltip: "Add a service, database, queue… to the infrastructure diagram.",
      },
      {
        label: "Link Infrastructure Nodes",
        command: "forward.linkInfraNodes",
        icon: "link",
        tooltip: "Draw an edge between two infrastructure nodes.",
      },
      {
        label: "Remove Infrastructure Node",
        command: "forward.removeInfraNode",
        icon: "trash",
        tooltip: "Delete a node (and its edges) from the infrastructure diagram.",
      },
    ],
  },
  {
    label: "Flows",
    icon: "list-ordered",
    actions: [
      {
        label: "Add Flow (Sequence Diagram)",
        command: "forward.addFlow",
        icon: "add",
        tooltip: "Start a narrated flow over the infrastructure nodes.",
      },
      {
        label: "Add Step to Flow",
        command: "forward.addFlowStep",
        icon: "arrow-right",
        tooltip: "Append a hop to an existing flow.",
      },
      {
        label: "Remove Flow",
        command: "forward.removeFlow",
        icon: "trash",
        tooltip: "Delete a flow and its steps.",
      },
    ],
  },
  {
    label: "Agents & MCP",
    icon: "hubot",
    actions: [
      {
        label: "Add MCP Server",
        command: "forward.addMcpServer",
        icon: "add",
        tooltip: "Document an MCP server in the agent layer.",
      },
      {
        label: "Add Agent",
        command: "forward.addAgent",
        icon: "add",
        tooltip: "Document an AI agent in the agent layer.",
      },
      {
        label: "Remove MCP Server",
        command: "forward.removeMcpServer",
        icon: "trash",
        tooltip: "Delete an MCP server from the agent layer.",
      },
      {
        label: "Remove Agent",
        command: "forward.removeAgent",
        icon: "trash",
        tooltip: "Delete an agent from the agent layer.",
      },
    ],
  },
  {
    label: "Tasks",
    icon: "checklist",
    actions: [
      {
        label: "Create Task",
        command: "forward.createTask",
        icon: "add",
        tooltip: "File a task, optionally linked to an element, flow or endpoint.",
      },
      {
        label: "Update Task Status",
        command: "forward.updateTaskStatus",
        icon: "tasklist",
        tooltip: "Move a task between todo / in progress / done.",
      },
    ],
  },
];

type Node = Group | Action;

class ActionsProvider implements vscode.TreeDataProvider<Node> {
  getTreeItem(node: Node): vscode.TreeItem {
    if ("actions" in node) {
      const item = new vscode.TreeItem(
        node.label,
        vscode.TreeItemCollapsibleState.Expanded,
      );
      item.iconPath = new vscode.ThemeIcon(node.icon);
      return item;
    }
    const item = new vscode.TreeItem(
      node.label,
      vscode.TreeItemCollapsibleState.None,
    );
    item.iconPath = new vscode.ThemeIcon(node.icon);
    item.tooltip = node.tooltip;
    item.command = { command: node.command, title: node.label };
    return item;
  }

  getChildren(node?: Node): Node[] {
    if (!node) return [...GROUPS];
    return "actions" in node ? [...node.actions] : [];
  }
}

/** Contributed as view `forwardActions` inside the `forward` Activity Bar container. */
export function registerActionsView(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider("forwardActions", new ActionsProvider()),
  );
}
