import { Fragment, useMemo } from "react";
import type { Task } from "forward-core";
import type { Member } from "../api/client.js";
import { buildGanttModel } from "./gantt-model.js";
import { personOf, tint } from "./tasks-format.js";
import { AvatarStack } from "./Avatar.js";

/**
 * Timeline (Gantt) view of the project's tasks: bars run from each task's
 * createdAt to its dueDate, grouped into sections by status, over a day axis
 * with weekend shading and a "today" marker. Clicking a row or bar opens the
 * task. All layout maths lives in {@link buildGanttModel}.
 */
export function TaskGantt({
  tasks,
  members,
  myUid,
  onOpen,
}: {
  tasks: Task[] | undefined;
  members: Member[] | undefined;
  myUid: string | undefined;
  onOpen: (id: string) => void;
}) {
  const model = useMemo(() => buildGanttModel(tasks ?? []), [tasks]);

  if (!model) {
    return <p className="muted">No tasks to plot on the timeline yet.</p>;
  }

  return (
    <div className="tk-gantt-scroll">
      <div className="tk-gantt" style={{ minWidth: model.labelW + model.timelineW }}>
        {/* header: corner label + week/day rulers */}
        <div className="tk-gantt-head">
          <div className="tk-gantt-corner" style={{ width: model.labelW }}>
            Tasks ({model.plottedCount})
          </div>
          <div style={{ width: model.timelineW, flex: "none" }}>
            <div className="tk-gantt-weeks" style={{ width: model.timelineW }}>
              {model.weeks.map((w) => (
                <div key={w.label} className="tk-gantt-week" style={{ width: w.widthPx }}>
                  {w.label}
                </div>
              ))}
            </div>
            <div className="tk-gantt-days" style={{ width: model.timelineW }}>
              {model.days.map((d) => (
                <div
                  key={d.xPx}
                  className={`tk-gantt-day${d.weekend ? " weekend" : ""}`}
                  style={{ width: model.dayW }}
                >
                  <span className={d.today ? "tk-gantt-today-num" : ""}>{d.dayNum}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* body: left labels + timeline */}
        <div className="tk-gantt-body">
          <div className="tk-gantt-labels" style={{ width: model.labelW }}>
            {model.sections.map((sec) => (
              <Fragment key={sec.status}>
                <div className="tk-gantt-sec-head" style={{ height: model.secH }}>
                  <span>{sec.label.toUpperCase()}</span>
                  <span className="tk-gantt-sec-count">{sec.count}</span>
                </div>
                {sec.rows.map((r) => (
                  <button
                    key={r.task.id}
                    type="button"
                    className="tk-gantt-row-label"
                    style={{ height: model.rowH }}
                    onClick={() => onOpen(r.task.id)}
                  >
                    {r.milestone ? (
                      <span
                        className="tk-gantt-row-diamond"
                        style={{ background: tint(r.color, 0.16), borderColor: r.color }}
                      />
                    ) : (
                      <span className="tk-gantt-row-dot" style={{ background: r.color }} />
                    )}
                    <span
                      className="tk-gantt-row-name"
                      style={r.milestone ? { fontWeight: 600 } : undefined}
                    >
                      {r.task.title}
                    </span>
                    {!r.milestone && (
                      <AvatarStack
                        people={r.task.assignees.map((u) => personOf(u, members, myUid))}
                        size={22}
                      />
                    )}
                  </button>
                ))}
              </Fragment>
            ))}
          </div>

          <div
            className="tk-gantt-timeline"
            style={{ width: model.timelineW, height: model.bodyH }}
          >
            {/* weekend shading — full-height columns behind the rows */}
            {model.days.map((d) =>
              d.weekend ? (
                <div
                  key={d.xPx}
                  className="tk-gantt-shade"
                  style={{ left: d.xPx, width: model.dayW }}
                />
              ) : null,
            )}

            {/* today marker */}
            {model.today && (
              <>
                <div className="tk-gantt-today-line" style={{ left: model.today.xPx }} />
                <div className="tk-gantt-today-pill" style={{ left: model.today.xPx }}>
                  {model.today.label}
                </div>
              </>
            )}

            {/* rows + bars (mirror the left labels' heights) */}
            {model.sections.map((sec) => (
              <Fragment key={sec.status}>
                <div className="tk-gantt-sec-spacer" style={{ height: model.secH }} />
                {sec.rows.map((r) =>
                  r.milestone ? (
                    <div
                      key={r.task.id}
                      className="tk-gantt-rowcell"
                      style={{ height: model.rowH }}
                    >
                      <button
                        type="button"
                        className="tk-gantt-diamond"
                        title={r.task.title}
                        onClick={() => onOpen(r.task.id)}
                        style={{
                          left: r.xPx,
                          background: r.color,
                          boxShadow: `0 0 0 1px ${r.color}`,
                        }}
                      />
                      <div
                        className="tk-gantt-mlabel"
                        style={{ left: r.xPx + 14, borderColor: tint(r.color, 0.5) }}
                      >
                        {r.task.title}
                      </div>
                    </div>
                  ) : (
                    <div
                      key={r.task.id}
                      className="tk-gantt-rowcell"
                      style={{ height: model.rowH }}
                    >
                      <button
                        type="button"
                        className="tk-gantt-bar"
                        title={r.task.title}
                        onClick={() => onOpen(r.task.id)}
                        style={{
                          left: r.xPx,
                          width: r.wPx,
                          background: tint(r.color, 0.16),
                          borderColor: tint(r.color, r.done ? 0.3 : 0.55),
                        }}
                      >
                        <span
                          className="tk-gantt-bar-fill"
                          style={{
                            width: `${Math.round(r.progress * 100)}%`,
                            background: tint(r.color, r.done ? 0.3 : 0.78),
                          }}
                        />
                        <span className="tk-gantt-bar-label">{r.task.title}</span>
                      </button>
                    </div>
                  ),
                )}
              </Fragment>
            ))}

            {/* dependency connectors, drawn over the bars */}
            {model.connectors.length > 0 && (
              <svg
                className="tk-gantt-conns"
                width={model.timelineW}
                height={model.bodyH}
                aria-hidden="true"
              >
                {model.connectors.map((c) => (
                  <g key={c.path}>
                    <path d={c.path} fill="none" stroke={c.color} strokeWidth={1.5} />
                    <circle cx={c.dotCx} cy={c.dotCy} r={3} fill={c.color} />
                  </g>
                ))}
              </svg>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
