/** Peer sessions: placeholder until the workspace tools are wired in. */
const hops = new Map<string, number>();

/** A human message resets the chain counter of the session. */
export function humanTurn(sid: string) {
  hops.set(sid, 0);
}
