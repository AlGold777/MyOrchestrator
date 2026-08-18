(function installResponseFindReplace(root) {
    'use strict';

    const DIALOG_ID = 'response-find-replace-dialog';
    const SCOPE_SELECTOR = '.output, .debate-model-card-output';
    let dialog = null;
    let activeScope = null;
    let currentMatch = -1;
    let matches = [];

    const textOf = (scope) => String(scope?.innerText || scope?.textContent || '');
    const escapeRegExp = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    function ensureDialog() {
        if (dialog) return dialog;
        dialog = document.createElement('dialog');
        dialog.id = DIALOG_ID;
        dialog.className = 'response-find-replace';
        dialog.innerHTML = `
            <form method="dialog" class="response-find-replace-form">
                <header><strong>Найти и заменить</strong><button type="button" data-fr-close aria-label="Закрыть">×</button></header>
                <label>Найти<input name="find" type="search" autocomplete="off" spellcheck="false"></label>
                <label>Заменить на<input name="replace" type="text" autocomplete="off" spellcheck="false"></label>
                <label class="response-find-replace-case"><input name="matchCase" type="checkbox"> Учитывать регистр</label>
                <output data-fr-status aria-live="polite"></output>
                <footer>
                    <button type="button" data-fr-next>Следующее</button>
                    <button type="button" data-fr-one>Заменить</button>
                    <button type="button" data-fr-all>Заменить все</button>
                </footer>
            </form>`;
        document.body.appendChild(dialog);
        dialog.addEventListener('click', (event) => {
            if (event.target === dialog || event.target.closest('[data-fr-close]')) close();
            const button = event.target.closest('button');
            if (!button) return;
            if (button.matches('[data-fr-next]')) selectNext();
            if (button.matches('[data-fr-one]')) replaceOne();
            if (button.matches('[data-fr-all]')) replaceAll();
        });
        dialog.querySelectorAll('input').forEach((input) => input.addEventListener('input', refresh));
        return dialog;
    }

    function input(name) { return dialog?.querySelector(`[name="${name}"]`); }
    function status(message) { const node = dialog?.querySelector('[data-fr-status]'); if (node) node.textContent = message; }

    function collectMatches() {
        const find = String(input('find')?.value || '');
        if (!activeScope || !find) return [];
        const flags = input('matchCase')?.checked ? 'g' : 'gi';
        const regex = new RegExp(escapeRegExp(find), flags);
        const found = [];
        const walker = document.createTreeWalker(activeScope, NodeFilter.SHOW_TEXT);
        let node;
        while ((node = walker.nextNode())) {
            let match;
            regex.lastIndex = 0;
            while ((match = regex.exec(node.nodeValue || ''))) {
                found.push({ node, start: match.index, end: match.index + match[0].length });
                if (!match[0]) regex.lastIndex += 1;
            }
        }
        return found;
    }

    function selectMatch(index) {
        if (!matches.length) { currentMatch = -1; status('Совпадений нет'); return; }
        currentMatch = (index + matches.length) % matches.length;
        const match = matches[currentMatch];
        const selection = window.getSelection();
        const range = document.createRange();
        range.setStart(match.node, match.start);
        range.setEnd(match.node, match.end);
        selection.removeAllRanges();
        selection.addRange(range);
        match.node.parentElement?.scrollIntoView?.({ block: 'nearest' });
        status(`${currentMatch + 1} из ${matches.length}`);
    }

    function selectNext() { selectMatch(currentMatch + 1); }
    function refresh() {
        matches = collectMatches();
        selectMatch(matches.length ? Math.min(Math.max(currentMatch, 0), matches.length - 1) : 0);
    }

    function dispatchChange() {
        if (!activeScope) return;
        activeScope.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertReplacementText' }));
        if (activeScope.matches('.debate-model-card-output')) {
            activeScope.closest('.debate-model-card')?.dispatchEvent(new CustomEvent('response-find-replace-change', { bubbles: true }));
        }
    }

    function replaceOne() {
        const match = matches[currentMatch];
        if (!match) { status('Совпадений нет'); return; }
        const replacement = String(input('replace')?.value || '');
        match.node.nodeValue = `${match.node.nodeValue.slice(0, match.start)}${replacement}${match.node.nodeValue.slice(match.end)}`;
        dispatchChange();
        refresh();
    }

    function replaceAll() {
        const find = String(input('find')?.value || '');
        if (!activeScope || !find) return;
        const replacement = String(input('replace')?.value || '');
        const flags = input('matchCase')?.checked ? 'g' : 'gi';
        const regex = new RegExp(escapeRegExp(find), flags);
        let count = 0;
        const walker = document.createTreeWalker(activeScope, NodeFilter.SHOW_TEXT);
        const nodes = [];
        let node;
        while ((node = walker.nextNode())) nodes.push(node);
        nodes.forEach((textNode) => {
            const before = textNode.nodeValue || '';
            const after = before.replace(regex, () => { count += 1; return replacement; });
            if (after !== before) textNode.nodeValue = after;
        });
        if (count) dispatchChange();
        refresh();
        status(count ? `Заменено: ${count}` : 'Совпадений нет');
    }

    function close() {
        dialog?.close?.();
        activeScope = null;
        matches = [];
        currentMatch = -1;
    }

    function open(scope) {
        activeScope = scope;
        const view = ensureDialog();
        currentMatch = -1;
        if (!view.open) view.show();
        input('find')?.focus();
        refresh();
    }

    function resolveScope(target) {
        const direct = target?.closest?.(SCOPE_SELECTOR);
        if (direct) return direct;
        const card = target?.closest?.('.llm-panel, .debate-model-card');
        return card?.querySelector?.(SCOPE_SELECTOR) || null;
    }

    function init() {
        document.addEventListener('keydown', (event) => {
            if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'f') return;
            const scope = resolveScope(event.target);
            if (!scope) return;
            event.preventDefault();
            open(scope);
        }, true);
        document.addEventListener('response-find-replace-change', (event) => {
            const card = event.target.closest?.('.debate-model-card');
            if (!card || typeof root.patchDebateCardMessage !== 'function') return;
            const output = card.querySelector('.debate-model-card-output');
            root.patchDebateCardMessage(card, { text: textOf(output).trim(), html: output?.innerHTML || '' });
            root.syncDebateCardOutputLayout?.(card);
        });
    }

    root.ResponseFindReplace = Object.freeze({ open, replaceAll });
    if (typeof module !== 'undefined' && module.exports) module.exports = { escapeRegExp };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
    else init();
})(typeof window !== 'undefined' ? window : globalThis);
