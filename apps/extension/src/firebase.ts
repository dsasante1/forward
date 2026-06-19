/**
 * The RTDB REST client now lives in `forward-core` so the VS Code extension and
 * the MCP server (apps/mcp) write through one identical code path — the project's
 * single-source-of-truth rule. This module is a thin re-export kept so the
 * extension's own imports (`./firebase.js`) and tests stay unchanged.
 */
export {
  bindApiToElement,
  deleteInfraFlow,
  deleteInfraNode,
  deleteTask,
  fetchElements,
  fetchElementsConditional,
  fetchFlows,
  fetchInfra,
  fetchInfraConditional,
  fetchTasks,
  fetchTasksConditional,
  fetchTimelinesConditional,
  listElements,
  patchTask,
  saveInfraEdge,
  saveInfraFlow,
  saveInfraNode,
  saveTask,
  unbindApiFromElement,
  type FirebaseConfig,
  type InfraPollState,
  type ProjectTimelines,
} from "forward-core";
