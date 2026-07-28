(function initPipelineProfileView(root) {
  'use strict';
  function init(options = {}) {
    const button = document.getElementById('pipeline-profile-btn');
    const dialog = document.getElementById('pipeline-profile-dialog');
    if (!button || !dialog || !root.PipelineProfileStore) return null;
    const store = root.PipelineProfileStore.createStore({ storage: options.storage });
    const select = dialog.querySelector('[data-profile-select]');
    const editor = dialog.querySelector('[data-profile-editor]');
    const status = dialog.querySelector('[data-profile-status]');
    const importInput = dialog.querySelector('[data-profile-import]');
    const setStatus = (text, kind = '') => { status.textContent = text; status.dataset.kind = kind; };
    const selected = () => store.get(select.value);
    const render = (profiles = store.list(), preferred = '') => {
      const previous = preferred || select.value;
      select.replaceChildren(...profiles.map((profile) => {
        const option = document.createElement('option'); option.value = profile.id;
        option.textContent = `${profile.title} · ${profile.version} · ${profile.status}`; return option;
      }));
      if (profiles.some((profile) => profile.id === previous)) select.value = previous;
      editor.value = JSON.stringify(selected() || profiles[0] || {}, null, 2);
    };
    store.subscribe(render);
    void store.restore().catch((error) => setStatus(error.message, 'error'));
    button.addEventListener('click', () => { render(); dialog.showModal(); });
    dialog.querySelector('[data-profile-close]').addEventListener('click', () => dialog.close());
    select.addEventListener('change', () => { editor.value = JSON.stringify(selected() || {}, null, 2); setStatus(''); });
    dialog.addEventListener('click', async (event) => {
      const action = event.target.closest('[data-profile-action]')?.dataset.profileAction;
      if (!action) return;
      try {
        if (action === 'validate') {
          const profile = JSON.parse(editor.value); const verdict = root.DebateProfileSchema.validate(profile);
          setStatus(verdict.ok ? 'Профиль корректен.' : verdict.errors.join(', '), verdict.ok ? 'ok' : 'error');
        }
        if (action === 'apply') {
          const profile = selected();
          if (!profile) throw new Error('Сначала выберите профиль.');
          const verdict = root.DebateProfileSchema.validate(profile);
          if (!verdict.ok) throw new Error(verdict.errors.join(', '));
          root.dispatchEvent(new CustomEvent('disput:profile-apply', { detail: { profile } }));
          setStatus(`Профиль «${profile.title}» применён к текущему pipeline.`, 'ok');
          dialog.close();
        }
        if (action === 'copy') {
          const source = selected(); const id = `${source.id}_COPY_${Date.now().toString(36).toUpperCase()}`;
          await store.copy(source.id, id); render(store.list(), id); setStatus('Копия создана. Её можно редактировать и сохранить.', 'ok');
        }
        if (action === 'save') {
          const profile = JSON.parse(editor.value); await store.save(profile); render(store.list(), profile.id); setStatus('Профиль проверен и сохранён.', 'ok');
        }
        if (action === 'export') {
          const blob = new Blob([store.exportAll()], { type: 'application/json' }); const link = document.createElement('a');
          link.href = URL.createObjectURL(blob); link.download = 'disput-pipeline-profiles.json'; link.click(); URL.revokeObjectURL(link.href);
          setStatus('Профили экспортированы.', 'ok');
        }
        if (action === 'import') importInput.click();
      } catch (error) { setStatus(error.message || String(error), 'error'); }
    });
    importInput.addEventListener('change', async () => {
      try { const text = await importInput.files?.[0]?.text?.(); if (text) await store.importAll(text); setStatus('Профили импортированы.', 'ok'); }
      catch (error) { setStatus(error.message || String(error), 'error'); }
      finally { importInput.value = ''; }
    });
    root.__pipelineProfileStore = store;
    render();
    return Object.freeze({ store, render, open: () => { render(); dialog.showModal(); } });
  }
  const api = Object.freeze({ init }); root.PipelineProfileView = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
