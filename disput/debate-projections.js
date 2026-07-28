// Read models derived from the canonical Debate event stream.
(function initDebateProjections(root) {
  'use strict';

  const eventTypes = () => root.DebateRunStore?.EVENTS || {};
  const eventsOf = (source) => Array.isArray(source) ? source : (Array.isArray(source?.events) ? source.events : []);

  function projectTurns(source, { sessionId = null } = {}) {
    const types = eventTypes();
    const accepted = new Set([types.MODERATOR_TURN_RECORDED, types.MODEL_TURN_RECORDED, types.VERDICT_RECORDED]);
    return eventsOf(source)
      .filter((event) => accepted.has(event.type))
      .filter((event) => sessionId == null || String(event.payload?.sessionId || '1') === String(sessionId))
      .map((event) => ({
        turnId: String(event.payload?.turnId || event.id),
        sessionId: String(event.payload?.sessionId || '1'),
        kind: event.type === types.MODEL_TURN_RECORDED ? 'model' : (event.type === types.VERDICT_RECORDED ? 'verdict' : 'moderator'),
        model: String(event.payload?.model || (event.type === types.MODERATOR_TURN_RECORDED ? 'Moderator' : '')),
        role: String(event.payload?.role || ''),
        text: String(event.payload?.text || ''),
        html: String(event.payload?.html || ''),
        status: String(event.payload?.status || 'approved'),
        at: event.at
      }));
  }

  function projectTimeline(source) {
    const type = eventTypes().TIMELINE_EVENT_RECORDED;
    return eventsOf(source)
      .filter((event) => event.type === type)
      .map((event) => ({ at: new Date(event.at).toISOString(), ...event.payload }));
  }

  function projectSessions(source) {
    const sessions = new Map();
    projectTurns(source).forEach((turn) => {
      if (!sessions.has(turn.sessionId)) sessions.set(turn.sessionId, { id: turn.sessionId, turns: [] });
      sessions.get(turn.sessionId).turns.push(turn);
    });
    return Array.from(sessions.values());
  }

  const api = Object.freeze({ projectTurns, projectTimeline, projectSessions });
  root.DebateProjections = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
