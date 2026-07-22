/** @jest-environment jsdom */
const Exporter = require('../results/debate-export');

test('builds one session export and escapes headings', () => {
  document.body.innerHTML = `<div id="feed"><article class="debate-model-card" data-session-id="1" data-llm-name="&lt;GPT&gt;"><span class="debate-model-card-time">10:00</span><div class="debate-model-card-output"><b>safe</b></div></article><article class="debate-model-card" data-session-id="2"><div class="debate-model-card-output">other</div></article></div>`;
  const html = Exporter.buildFeedDocument(document.getElementById('feed'), '1');
  expect(html).toContain('&lt;GPT&gt;');
  expect(html).toContain('<b>safe</b>');
  expect(html).not.toContain('other');
  expect(html).toContain('class="saved-at"');
});

test('uses requested month-year filename stamp and machine-readable saved time', () => {
  const date = new Date(2026, 6, 17, 18, 30);
  expect(Exporter.fileStamp(date)).toBe('jul26 18-30');
  expect(Exporter.cardFileStamp(date)).toBe('jul26 18-30');
  expect(Exporter.savedStamp(date)).toBe('2026-07-17_18-30');
});

test('strips executable markup defensively', () => {
  document.body.innerHTML = `<article class="debate-model-card" data-session-id="1"><div class="debate-model-card-output"><img src="javascript:alert(1)" onerror="alert(2)"><script>alert(3)</script><b>ok</b></div></article>`;
  const html = Exporter.buildFeedDocument(document.body, '1');
  expect(html).toContain('<b>ok</b>');
  expect(html).not.toMatch(/javascript:|onerror=|<script/i);
});
