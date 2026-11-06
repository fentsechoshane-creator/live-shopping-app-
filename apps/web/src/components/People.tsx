import type { Person } from "../api";
import { Avatar as Round } from "./Avatar";

/** A person's round picture, or their first letter. */
export function Avatar({ person, size = 40 }: { person: Pick<Person, "name" | "avatarUrl">; size?: number }) {
  return <Round url={person.avatarUrl} name={person.name} size={size} />;
}
