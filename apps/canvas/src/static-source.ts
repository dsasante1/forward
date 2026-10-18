import {
  withoutBinding,
  type DesignElement,
  type ProjectTimelineEvent,
  type SaveableElement,
} from "forward-core";
import type { ProjectBundle } from "forward-core/repo";
import type {
  AgentSnapshot,
  CanvasSource,
  ElementSnapshot,
  EntitySnapshot,
  InfraSnapshot,
} from "./source.js";

/**
 * A read-only CanvasSource over a {@link ProjectBundle} — the whole project in
 * one JSON file, written by `forward export`. This is what a GitHub Pages site
 * serves: anyone with the link can browse the design, docs, infra, data model
 * and history of a branch without a server or an account.
 *
 * Every optional writer is omitted, so the canvas hides its authoring tools.
 * `saveElement`/`deleteElement` are required by the contract; they succeed in
 * memory only, so dragging something around never errors but never persists.
 */
export class StaticSource implements CanvasSource {
  constructor(private readonly bundle: ProjectBundle) {}

  subscribe(onChange: (elements: ElementSnapshot[]) => void): () => void {
    onChange(
      this.bundle.elements.map((element) => ({
        element,
        timeline: this.bundle.timelines[element.id] ?? [],
      })),
    );
    return () => {};
  }

  subscribeInfra(onChange: (infra: InfraSnapshot) => void): () => void {
    onChange(this.bundle.infra);
    return () => {};
  }

  subscribeEntities(onChange: (snapshot: EntitySnapshot) => void): () => void {
    onChange(this.bundle.entities);
    return () => {};
  }

  subscribeAgents(onChange: (snapshot: AgentSnapshot) => void): () => void {
    onChange(this.bundle.agents);
    return () => {};
  }

  subscribeTasks(onChange: (tasks: ProjectBundle["tasks"]) => void): () => void {
    onChange(this.bundle.tasks);
    return () => {};
  }

  subscribeCheckpoints(onChange: (cps: ProjectBundle["checkpoints"]) => void): () => void {
    onChange(this.bundle.checkpoints);
    return () => {};
  }

  subscribeProjectTimeline(onChange: (events: ProjectTimelineEvent[]) => void): () => void {
    onChange(this.bundle.timeline);
    return () => {};
  }

  async saveElement(element: SaveableElement): Promise<DesignElement> {
    const stored = this.bundle.elements.find((e) => e.id === element.id)?.apiBinding;
    return { ...withoutBinding(element as DesignElement), ...(stored ? { apiBinding: stored } : {}) };
  }

  async deleteElement(): Promise<void> {}
}
