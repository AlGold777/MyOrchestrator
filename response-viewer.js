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
        } else {
            content.textContent = rawText;
        }
        document.title = `${model} response`;
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
})();
