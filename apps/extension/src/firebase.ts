/**
 * The RTDB REST client now lives in `schema-nexus-core` so the VS Code extension and
 * the MCP server (apps/mcp) write through one identical code path — the project's
 * single-source-of-truth rule. This module is a thin re-export kept so the
 * extension's own imports (`./firebase.js`) and tests stay unchanged.
 */
export {
  bindApiToElement,
  deleteInfraNode,
  fetchElements,
  fetchElementsConditional,
  fetchInfra,
  fetchInfraConditional,
  fetchTimelinesConditional,
  listElements,
  saveInfraEdge,
  saveInfraNode,
  unbindApiFromElement,
  type FirebaseConfig,
  type InfraPollState,
  type ProjectTimelines,
} from "schema-nexus-core";
