/**
 * The data-access client now lives in `forward-core/api` so the VS Code extension
 * talks to the centrally-hosted backend (apps/server) over its REST API — the
 * same path the dashboard and embedded canvas use — instead of writing to the
 * Firebase RTDB directly. This module is a thin re-export kept so the extension's
 * own imports (`./firebase.js`) and tests stay unchanged; the function names,
 * argument order and return types are a deliberate drop-in for the old
 * `rtdb-rest` twins (see packages/shared/src/api-rest.ts).
 */
export {
  bindApiToElement,
  createApiToken,
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
  listApiTokens,
  listElements,
  listProjects,
  patchTask,
  revokeApiToken,
  saveInfraEdge,
  saveInfraFlow,
  saveInfraNode,
  saveTask,
  unbindApiFromElement,
  type ApiConfig,
  type InfraPollState,
  type ProjectSummary,
  type ProjectTimelines,
} from "forward-core/api";
