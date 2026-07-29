// shared/proof-telemetry-audit.js
// Post-terminal audit and anomaly-trigger planning for schema 5 telemetry.

(function initProofTelemetryAudit(root) {
  'use strict';

  function sameScope(left, right) {
    return root.ProofTelemetryPolicy?.sameScope?.(left, right)
      || (String(left?.runSessionId) === String(right?.runSessionId)
        && Number(left?.runGeneration) === Number(right?.runGeneration)
        && String(left?.modelId) === String(right?.modelId)
        && Boolean(left?.dispatchId)
        && String(left?.dispatchId) === String(right?.dispatchId)
        && Number(left?.generationEpoch) === Number(right?.generationEpoch));
  }

  function sourceType(event) {
    return String(event?.payload?.sourceEventType || '').toUpperCase();
  }

  function numberFrom(event, keys) {
    const metadata = event?.payload?.metadata || {};
    for (const key of keys) {
      const value = Number(metadata[key]);
      if (Number.isFinite(value) && value >= 0) return value;
    }
    return null;
  }

  function stringFrom(event, keys) {
    const metadata = event?.payload?.metadata || {};
    for (const key of keys) {
      if (metadata[key]) return String(metadata[key]);
    }
    return null;
  }

  function isRelevantPostTerminalObservation(event) {
    return /(ANSWER|TEXT|RESPONSE|EXTRACT|LIFECYCLE|CANDIDATE|SELECTOR|MUTATION)/.test(sourceType(event));
  }

  function anomalyKind(event) {
    const source = sourceType(event);
    if (/SELECTOR.*(FAIL|MISS|ERROR)|CANDIDATE.*AMBIG/.test(source)) return 'selector-anomaly';
    if (/SCRIPT_HEALTH_FAIL|OBSERVER.*(UNAVAILABLE|FAIL)|CONTENT_SCRIPT.*FAIL/.test(source)) return 'observer-anomaly';
    if (/CONTRADICTION|DIVERGENCE|MISMATCH/.test(source)) return 'contradiction';
    if (String(event?.payload?.sourceLevel || '').toLowerCase() === 'error') return 'runtime-error';
    return null;
  }

  function planAfterEvent(sourceEvent, eventsIncludingSource) {
    const descriptors = [];
    const prior = eventsIncludingSource.filter((event) => event.seq < sourceEvent.seq && sameScope(event, sourceEvent));
    const terminal = [...prior].reverse().find((event) => event.eventType === 'MODEL_TERMINAL_RECORDED');

    if (sourceEvent.eventType === 'MODEL_TERMINAL_RECORDED') {
      descriptors.push({
        eventType: 'MISSING_EVIDENCE_RECORDED',
        layer: 'decision',
        evidenceRefs: [sourceEvent.eventId],
        payload: {
          missingEvidence: 'post_terminal_observation',
          status: 'pending',
          impact: 'terminal decision is not yet confirmed by a later observation'
        }
      });
    } else if (terminal && isRelevantPostTerminalObservation(sourceEvent)) {
      const acceptedLength = numberFrom(terminal, ['answerLength', 'answerLen', 'textLength']);
      const observedLength = numberFrom(sourceEvent, ['answerLength', 'answerLen', 'textLength']);
      const acceptedHash = stringFrom(terminal, ['answerHash', 'textHash', 'normalizedHash']);
      const observedHash = stringFrom(sourceEvent, ['answerHash', 'textHash', 'normalizedHash']);
      const lengthsComparable = acceptedLength !== null && observedLength !== null;
      const hashesComparable = Boolean(acceptedHash && observedHash);
      const auditPossible = lengthsComparable || hashesComparable;
      const growthChars = lengthsComparable ? Math.max(0, observedLength - acceptedLength) : null;
      const growthPct = lengthsComparable
        ? (acceptedLength > 0 ? (growthChars / acceptedLength) * 100 : (growthChars > 0 ? 100 : 0))
        : null;
      const hashChanged = Boolean(acceptedHash && observedHash && acceptedHash !== observedHash);
      const contradicted = (growthPct !== null && growthPct > 0.5) || hashChanged;
      descriptors.push({
        eventType: 'POST_TERMINAL_AUDIT_COMPLETED',
        layer: 'audit',
        evidenceRefs: [terminal.eventId, sourceEvent.eventId],
        payload: {
          terminalEventId: terminal.eventId,
          observationEventId: sourceEvent.eventId,
          acceptedLength,
          observedLength,
          growthChars,
          growthPct,
          hashChanged,
          conclusion: auditPossible ? (contradicted ? 'contradicted' : 'confirmed') : 'unknown',
          auditPossible
        }
      });
      if (!auditPossible) {
        descriptors.push({
          eventType: 'MISSING_EVIDENCE_RECORDED',
          layer: 'decision',
          evidenceRefs: [terminal.eventId, sourceEvent.eventId],
          payload: {
            missingEvidence: 'post_terminal_comparable_measurement',
            status: 'unavailable',
            impact: 'post-terminal growth cannot be confirmed or refuted without comparable length or hash evidence'
          }
        });
      }
      if (contradicted) {
        descriptors.push({
          eventType: 'SELECTOR_FORENSIC_SNAPSHOT_CAPTURED',
          layer: 'audit',
          evidenceRefs: [terminal.eventId, sourceEvent.eventId],
          payload: {
            attachmentType: 'redacted-dom-fragment',
            anomalyTrigger: 'post_terminal_answer_change',
            captureAvailable: false,
            omissionReason: 'automatic DOM body capture disabled by metadata-only privacy policy',
            impact: 'hash/length change is proven; hidden node structure is unavailable'
          }
        });
      }
    }

    const anomaly = anomalyKind(sourceEvent);
    if (anomaly) {
      descriptors.push({
        eventType: 'SELECTOR_FORENSIC_SNAPSHOT_CAPTURED',
        layer: 'audit',
        evidenceRefs: [sourceEvent.eventId],
        payload: {
          attachmentType: anomaly === 'selector-anomaly' ? 'selector-candidate-list' : 'content-script-failure-context',
          anomalyTrigger: anomaly,
          captureAvailable: false,
          omissionReason: 'forensic body unavailable at canonical event boundary',
          impact: 'safe event metadata remains available; raw DOM/context was not persisted'
        }
      });
    }
    return descriptors;
  }

  const api = Object.freeze({
    isRelevantPostTerminalObservation,
    anomalyKind,
    planAfterEvent
  });
  root.ProofTelemetryAudit = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
