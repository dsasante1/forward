import type { Person } from "./tasks-format.js";

/** A coloured initials bubble for a roster member. Shared by the task list,
 * detail and timeline so avatars look identical everywhere. */
export function Avatar({
  person,
  size,
  className = "",
}: {
  person: Person;
  size: number;
  className?: string;
}) {
  return (
    <span
      className={`tk-avatar ${className}`}
      style={{
        width: size,
        height: size,
        background: person.color,
        fontSize: Math.round(size * 0.38),
      }}
      title={person.name}
    >
      {person.initials}
    </span>
  );
}

/** Overlapping row of avatars (assignees). Renders nothing when empty. */
export function AvatarStack({ people, size = 24 }: { people: Person[]; size?: number }) {
  if (people.length === 0) return null;
  return (
    <div className="tk-avatar-stack">
      {people.map((p) => (
        <Avatar key={p.uid} person={p} size={size} className="tk-stacked" />
      ))}
    </div>
  );
}
