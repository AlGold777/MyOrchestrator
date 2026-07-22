#!/usr/bin/env node
// attack-wave-check.js — проверка волны атак ручного прогона Gate 0.
//
// Делает два замера, ради которых волну вообще записывают в файл:
//   1. Gate 3 — JSON-валидность по слотам моделей: доля ответов, распарсившихся
//      с первой попытки (чистый JSON) / после извлечения из ограждений / прошедших схему.
//      Порог пула структурных операций: ≥70–75% schema-valid с первой попытки.
//   2. Дедупликация — доля семантических дублей внутри волны (по узлу-цели).
//      Порог из брифа: <20% дублей → дедуп в v1 не нужен.
//
// Формат входного файла (заполняется руками по ходу Gate 0):
// {
//   "wave": 1,
//   "entries": [
//     { "slot": "GPT",   "target_id": "n001", "raw": "<сырой ответ модели целиком>" },
//     { "slot": "Qwen",  "target_id": "n001", "raw": "..." }
//   ]
// }
//
// Запуск: node attack-wave-check.js wave1.json [--threshold 0.5]
// Дубли — кандидаты для ручной сверки, не приговор: скрипт мерит поверхностное
// сходство (шинглы слов), семантику подтверждает человек.

'use strict';

const fs = require('fs');

const ATTACK_TYPES = new Set([
  'no_source', 'term_substitution', 'hidden_assumption',
  'logic', 'applicability_boundary', 'context', 'other'
]);

function extractJsonCandidate(raw) {
  const text = String(raw || '').trim();
  if (!text) return null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) return fenced[1].trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) return text.slice(start, end + 1);
  return null;
}

function tryParse(text) {
  try { return { ok: true, value: JSON.parse(text) }; }
  catch (_) { return { ok: false, value: null }; }
}

// Схема ответа ATTACK: либо {attacks:[{attack_type,text,anchor_quote}]}, либо {status:"solid",reason}.
function validateAttackResponse(value, nodeTextBySlotTarget) {
  const problems = [];
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { valid: false, attacks: [], solid: false, problems: ['не объект'] };
  }
  if (value.status === 'solid') {
    if (!String(value.reason || '').trim()) problems.push('solid без reason');
    return { valid: problems.length === 0, attacks: [], solid: true, problems };
  }
  if (!Array.isArray(value.attacks) || value.attacks.length === 0) {
    return { valid: false, attacks: [], solid: false, problems: ['нет attacks[] и нет status:solid'] };
  }
  const attacks = [];
  value.attacks.forEach((attack, i) => {
    const label = `attacks[${i}]`;
    if (!attack || typeof attack !== 'object') { problems.push(`${label}: не объект`); return; }
    if (!ATTACK_TYPES.has(attack.attack_type)) problems.push(`${label}: attack_type "${attack.attack_type}" вне списка`);
    if (!String(attack.text || '').trim()) problems.push(`${label}: пустой text`);
    const quote = String(attack.anchor_quote || '').trim();
    if (!quote) problems.push(`${label}: пустой anchor_quote`);
    else if (nodeTextBySlotTarget && !nodeTextBySlotTarget.includes(normalizeForAnchor(quote))) {
      // A1 ANTI_STRAWMAN: цитата обязана находиться в тексте узла (если текст узла дан).
      problems.push(`${label}: anchor_quote не найден в тексте узла (A1)`);
    }
    attacks.push(attack);
  });
  return { valid: problems.length === 0, attacks, solid: false, problems };
}

function normalizeForAnchor(text) {
  return String(text || '').toLowerCase().replace(/[«»"'()‘’“”]/g, '').replace(/\s+/g, ' ').trim();
}

function normalizeWords(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-zа-яё0-9\s]/gi, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2);
}

function shingles(words, size = 3) {
  if (words.length < size) return new Set(words);
  const out = new Set();
  for (let i = 0; i <= words.length - size; i += 1) out.add(words.slice(i, i + size).join(' '));
  return out;
}

function jaccard(setA, setB) {
  if (!setA.size || !setB.size) return 0;
  let inter = 0;
  for (const item of setA) if (setB.has(item)) inter += 1;
  return inter / (setA.size + setB.size - inter);
}

function main() {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith('--'));
  if (!file) {
    console.error('Использование: node attack-wave-check.js wave.json [--threshold 0.5]');
    process.exit(1);
  }
  const thresholdArg = args.indexOf('--threshold');
  const threshold = thresholdArg >= 0 ? Number(args[thresholdArg + 1]) : 0.5;

  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const entries = Array.isArray(data.entries) ? data.entries : [];
  if (!entries.length) {
    console.error('В файле нет entries[].');
    process.exit(1);
  }
  const nodeTexts = data.nodes && typeof data.nodes === 'object' ? data.nodes : null; // опционально: {"n001": "текст узла"}

  // --- Замер 1: Gate 3 по слотам ---
  const perSlot = new Map();
  const allAttacks = []; // {slot, target_id, attack}
  entries.forEach((entry, index) => {
    const slot = String(entry.slot || `slot${index}`);
    if (!perSlot.has(slot)) {
      perSlot.set(slot, { total: 0, firstTry: 0, afterExtract: 0, schemaValid: 0, solid: 0, problems: [] });
    }
    const stats = perSlot.get(slot);
    stats.total += 1;

    const raw = String(entry.raw || '').trim();
    let parsed = tryParse(raw);
    if (parsed.ok) {
      stats.firstTry += 1;
      stats.afterExtract += 1;
    } else {
      const candidate = extractJsonCandidate(raw);
      parsed = candidate ? tryParse(candidate) : { ok: false, value: null };
      if (parsed.ok) stats.afterExtract += 1;
    }
    if (!parsed.ok) {
      stats.problems.push(`${entry.target_id || '?'}: JSON не распарсился`);
      return;
    }
    const nodeText = nodeTexts && entry.target_id ? normalizeForAnchor(nodeTexts[entry.target_id]) : null;
    const check = validateAttackResponse(parsed.value, nodeText);
    if (check.valid) stats.schemaValid += 1;
    else stats.problems.push(`${entry.target_id || '?'}: ${check.problems.join('; ')}`);
    if (check.solid) stats.solid += 1;
    check.attacks.forEach((attack) => allAttacks.push({ slot, target_id: String(entry.target_id || '?'), attack }));
  });

  console.log(`\n=== Gate 3: структурная валидность по слотам (волна ${data.wave ?? '?'}) ===`);
  const pct = (a, b) => (b ? `${Math.round((100 * a) / b)}%` : '—');
  for (const [slot, s] of perSlot) {
    console.log(`${slot.padEnd(12)} ответов=${s.total}  чистый JSON=${pct(s.firstTry, s.total)}  после извлечения=${pct(s.afterExtract, s.total)}  схема=${pct(s.schemaValid, s.total)}  solid=${s.solid}`);
    s.problems.forEach((p) => console.log(`    ! ${p}`));
  }

  // --- Замер 2: дубли внутри волны, по узлу-цели ---
  const byTarget = new Map();
  allAttacks.forEach((item, i) => {
    if (!byTarget.has(item.target_id)) byTarget.set(item.target_id, []);
    const words = normalizeWords(item.attack.text);
    byTarget.get(item.target_id).push({ ...item, index: i, words: new Set(words), sh: shingles(words) });
  });

  const parent = allAttacks.map((_, i) => i);
  const find = (x) => (parent[x] === x ? x : (parent[x] = find(parent[x])));
  const union = (a, b) => { parent[find(a)] = find(b); };

  const dupPairs = [];
  for (const [target, list] of byTarget) {
    for (let i = 0; i < list.length; i += 1) {
      for (let j = i + 1; j < list.length; j += 1) {
        // Шинглы ловят почти дословные повторы, множества слов — перефраз с
        // перестановкой; берём максимум, порог сверки всё равно ручной.
        const sim = Math.max(jaccard(list[i].sh, list[j].sh), jaccard(list[i].words, list[j].words));
        const sameType = list[i].attack.attack_type === list[j].attack.attack_type;
        // Совпадение типа снижает планку: одинаковый вектор + заметное пересечение слов — кандидат.
        const effectiveThreshold = sameType ? threshold * 0.7 : threshold;
        if (sim >= effectiveThreshold) {
          dupPairs.push({ target, a: list[i], b: list[j], sim, sameType });
          union(list[i].index, list[j].index);
        }
      }
    }
  }

  const clusterSizes = new Map();
  allAttacks.forEach((_, i) => {
    const root = find(i);
    clusterSizes.set(root, (clusterSizes.get(root) || 0) + 1);
  });
  let duplicates = 0;
  for (const size of clusterSizes.values()) duplicates += size - 1;

  console.log(`\n=== Дубли в волне атак (порог Jaccard ${threshold}, при совпадении типа ×0.7) ===`);
  console.log(`Всего атак: ${allAttacks.length}; узлов под атакой: ${byTarget.size}`);
  console.log(`Кандидатов-пар: ${dupPairs.length}; лишних атак (дублей): ${duplicates}`);
  const share = allAttacks.length ? Math.round((100 * duplicates) / allAttacks.length) : 0;
  console.log(`Доля дублей: ${share}%  →  ${share < 20 ? 'дедуп в v1 НЕ нужен (<20%)' : 'дедуп нужен (LLM внутри COMPRESS)'}`);
  dupPairs
    .sort((a, b) => b.sim - a.sim)
    .forEach((pair) => {
      console.log(`\n  [${pair.target}] sim=${pair.sim.toFixed(2)}${pair.sameType ? ' одинаковый тип' : ''}`);
      console.log(`    ${pair.a.slot}: ${String(pair.a.attack.text).slice(0, 120)}`);
      console.log(`    ${pair.b.slot}: ${String(pair.b.attack.text).slice(0, 120)}`);
    });
  console.log('\nНапоминание: пары выше — кандидаты для ручной сверки, решение о дубле принимает человек.');
}

main();
