// Замок на покрытие дайджеста: он обязан читать все типы событий, на которых
// стоят семь диагностических пресетов.
//
// Регрессия, которую он ловит: дайджест знал 20 из 34 нужных пресетам типов —
// восемь не имели правила вообще, одиннадцать были в IGNORED целиком. На
// практике это значило, что prompt-not-sent был слеп на 8 типах из 11, а
// prompt-not-inserted на 7 из 10: дайджест физически не мог разобрать эти
// классы сбоя и на коротком прогоне выдавал одну строку «no terminal at all».
//
// Список нужных типов вычисляется здесь из REPORT_EVENT_TYPES, а не
// переписывается руками, поэтому новый тип события в пресете уронит тест, а не
// тихо расширит слепую зону.
const fs = require('fs');
const path = require('path');

const DIGEST_PATH = path.join(__dirname, '..', 'shared', 'telemetry-digest.js');
const TelemetryDigest = require(DIGEST_PATH);
const { REPORT_EVENT_TYPES } = require(path.join(__dirname, '..', 'shared', 'proof-oriented-telemetry.js'));

const source = fs.readFileSync(DIGEST_PATH, 'utf8');
const frozenList = (name) => {
    const match = source.match(new RegExp(`${name}\\s*=\\s*Object\\.freeze\\(\\[([\\s\\S]*?)\\]\\)`));
    return match ? [...match[1].matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]) : [];
};
const exceptionTypes = () => {
    const start = source.indexOf('const EXCEPTION_TYPES');
    const end = source.indexOf('const READ_TYPES');
    return [...source.slice(start, end).matchAll(/^ {2}([A-Z_]+):\s*\(/gm)].map((m) => m[1]);
};

const READ_TYPES = frozenList('READ_TYPES');
const PROGRESS_TYPES = frozenList('PROGRESS_TYPES');
const EXCEPTION_KEYS = exceptionTypes();
const covered = new Set([...READ_TYPES, ...PROGRESS_TYPES, ...EXCEPTION_KEYS]);

const requiredByPresets = [...new Set(
    Object.values(REPORT_EVENT_TYPES || {}).flatMap((types) => types || [])
)].sort();

const proofEvent = (eventType, modelId, seq, extra = {}) => ({
    schemaVersion: 6,
    eventId: `event-${seq}`,
    seq,
    runSessionId: '1786174770340',
    wallTs: 1786174770000 + seq,
    eventType,
    modelId,
    payload: { typed: { kind: 'unknown', state: 'unknown' }, metadata: {}, ...extra }
});
const digestOf = (events) => TelemetryDigest.buildDigest({
    manifest: { createdAt: 'x' },
    sharedConfig: { extensionVersion: 'test' },
    ledger: { events }
});

describe('telemetry digest coverage', () => {
    test('every event type the seven presets rest on has a digest rule', () => {
        expect(requiredByPresets.length).toBeGreaterThan(30);
        const blind = requiredByPresets.filter((type) => !covered.has(type));
        expect(blind).toEqual([]);
    });

    test('no preset class is left mostly blind', () => {
        for (const [reportType, types] of Object.entries(REPORT_EVENT_TYPES || {})) {
            const blind = (types || []).filter((type) => !covered.has(type));
            expect({ reportType, blind }).toEqual({ reportType, blind: [] });
        }
    });

    test('the three lists never claim the same type twice', () => {
        const all = [...READ_TYPES, ...PROGRESS_TYPES, ...EXCEPTION_KEYS];
        expect(all.length).toBe(new Set(all).size);
    });

    test('a covered type is no longer reported as UNRECOGNISED', () => {
        // Симптом из отчёта: DISPATCH_STAGE_OBSERVED — 8 событий из 20 — помечался
        // «this digest has no rule for it», и дайджест требовал полный отчёт.
        const events = [proofEvent('DISPATCH_STAGE_OBSERVED', 'Gemini', 1)];
        const digest = digestOf(events);
        expect(digest.coverage.unknownTypes).toEqual([]);
        expect(TelemetryDigest.render(digest)).not.toContain('UNRECOGNISED');
    });

    test('the state trajectory is what a reader actually gets', () => {
        const events = [
            proofEvent('PROMPT_INSERTION_EVALUATED', 'Gemini', 1, {
                typed: { kind: 'prompt_insertion', state: 'inserted' },
                metadata: { promptLength: 196, composerLength: 200 }
            }),
            proofEvent('SUBMISSION_INFERRED', 'Gemini', 2, { typed: { kind: 'submission', state: 'confirmed' } })
        ];
        const text = TelemetryDigest.render(digestOf(events));
        expect(text).toContain('prompt_insertion:inserted');
        expect(text).toContain('promptLength=196');
        expect(text).toContain('submission:confirmed');
    });

    test('consecutive repeats collapse to an exact count', () => {
        const events = [1, 2, 3, 4].map((seq) => proofEvent('OBSERVATION_INTERVAL_CLOSED', 'Gemini', seq, {
            typed: { kind: 'observation_interval', state: 'closed' }
        }));
        const [row] = digestOf(events)[TelemetryDigest.SECTIONS.PROGRESS];
        expect(row.steps).toHaveLength(1);
        expect(row.steps[0].count).toBe(4);
    });

    test('a long run is capped, and states lost to the cap are named', () => {
        // Иначе обрезка молча ломает главное обещание контракта: «состояние,
        // которого нет в траектории, не происходило».
        // Событие-дедлайн получает seq из середины прогона: buildDigest
        // сортирует по seq, поэтому только так оно попадёт в выброшенную часть.
        const events = [];
        for (let i = 0; i < 200; i += 1) {
            events.push(proofEvent('TEXT_STATE_CHANGED', 'Gemini', i + 1, { typed: { kind: 'text', state: `s${i % 2}` } }));
        }
        events.push(proofEvent('TERMINAL_DEADLINE_REACHED', 'Gemini', 100.5, {
            typed: { kind: 'deadline', state: 'reached' }
        }));
        const [row] = digestOf(events)[TelemetryDigest.SECTIONS.PROGRESS];
        expect(row.steps.length).toBeLessThanOrEqual(60);
        expect(row.droppedSteps).toBeGreaterThan(0);
        expect(row.droppedOnlyLabels).toContain('deadline:reached');
        const text = TelemetryDigest.render(digestOf(events));
        expect(text).toContain('state changes omitted from the middle of this run');
        expect(text).toContain('states occurring ONLY in the omitted part: deadline:reached');
    });

    test('the reader contract states that absence is evidence for carried types', () => {
        const text = TelemetryDigest.render(digestOf([proofEvent('PROMPT_INSERTION_EVALUATED', 'Gemini', 1)]));
        expect(text).toContain('their absence IS evidence here');
    });
});
