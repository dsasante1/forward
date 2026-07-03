/**
 * Deterministic geometry for nodes the AI produced without coordinates.
 *
 * The rule that keeps a canvas sane across many CI runs: never move a node that
 * already exists (reuse its stored x/y), and drop genuinely new nodes onto a
 * grid in a fresh band *below* everything that is already there — so an
 * automated run can never stomp a layout a human arranged by hand.
 */

export interface Geom {
  x: number;
  y: number;
  width: number;
  height: number;
  parentId: string | null;
}

export interface Sized {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  parentId?: string | null;
}

/** Hands out grid slots starting on a clean row below the existing content. */
export class GridPlacer {
  private col = 0;
  private row = 0;
  private readonly startY: number;

  constructor(
    existing: Iterable<Geom>,
    private readonly originX = 0,
    private readonly cellW = 220,
    private readonly cellH = 180,
    private readonly cols = 5,
    gap = 48,
  ) {
    let maxBottom = -Infinity;
    for (const g of existing) maxBottom = Math.max(maxBottom, g.y + g.height);
    this.startY = Number.isFinite(maxBottom) ? maxBottom + gap : 0;
  }

  private next(): { x: number; y: number } {
    const x = this.originX + this.col * this.cellW;
    const y = this.startY + this.row * this.cellH;
    if (++this.col >= this.cols) {
      this.col = 0;
      this.row++;
    }
    return { x, y };
  }

  /**
   * Resolve final geometry for one node: an explicit position wins, then the
   * node's previously-stored position (update in place), then a fresh grid slot.
   */
  place(input: Sized, previous: Geom | undefined, defW: number, defH: number): Geom {
    const width = input.width ?? previous?.width ?? defW;
    const height = input.height ?? previous?.height ?? defH;
    const parentId = input.parentId ?? previous?.parentId ?? null;

    if (input.x != null && input.y != null) {
      return { x: input.x, y: input.y, width, height, parentId };
    }
    if (previous) {
      return { x: previous.x, y: previous.y, width, height, parentId };
    }
    const { x, y } = this.next();
    return { x, y, width, height, parentId };
  }
}
