(function initResponseViewer() {
    'use strict';

    const shell = document.getElementById('viewer-shell');
    const title = document.getElementById('viewer-title');
    const content = document.getElementById('viewer-content');
    const closeButton = document.getElementById('viewer-close');

    function close() {
        try {
            chrome.runtime.sendMessage({ type: 'RESPONSE_VIEWER_CLOSE' });
        } catch (_) {}
        window.close();
    }

    function render(message = {}) {
        const model = String(message.model || 'Response').trim() || 'Response';
        title.textContent = model;
        const rawHtml = String(message.html || '').trim();
        const rawText = String(message.text || '').trim();
        if (rawHtml && typeof DOMPurify !== 'undefined') {
            content.innerHTML = DOMPurify.sanitize(rawHtml);
            const firstHeading = content.querySelector('h1, h2, h3, h4, h5, h6');
            if (firstHeading && firstHeading.textContent.trim().toLocaleLowerCase() === model.toLocaleLowerCase()) {
                const children = Array.from(content.children);
                const before = children.slice(0, children.indexOf(firstHeading));
                if (!before.some((node) => node.textContent.trim())) firstHeading.remove();
            }
        } else {
            content.textContent = rawText;
        }
        document.title = `${model} response`;
    }

    async function loadStoredContent() {
        const viewerId = new URLSearchParams(window.location.search).get('viewerId');
        if (!viewerId || !chrome.storage?.session) return;
        try {
            const stored = await chrome.storage.session.get(`llmResponseViewer.${viewerId}`);
            render(stored?.[`llmResponseViewer.${viewerId}`] || {});
        } catch (_) {}
    }

    closeButton?.addEventListener('click', close);
    shell?.addEventListener('click', (event) => {
        if (event.target === shell) close();
    });
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') close();
    });
    chrome.runtime.onMessage.addListener((message) => {
        if (message?.type === 'RESPONSE_VIEWER_SET_CONTENT') render(message);
    });
    try { chrome.runtime.sendMessage({ type: 'RESPONSE_VIEWER_READY' }); } catch (_) {}
    loadStoredContent();
})();
