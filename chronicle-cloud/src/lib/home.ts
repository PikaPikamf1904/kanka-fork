/** Only a recorded play date establishes chronology; import/update time does not. */
export function latestDatedSession<T extends { session_date: string | null }>(sessions: readonly T[]): T | null {
  return sessions.reduce<T | null>((latest, session) => {
    if (!session.session_date) return latest;
    return !latest?.session_date || session.session_date > latest.session_date ? session : latest;
  }, null);
}
