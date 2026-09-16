(function initResponseViewer() {
    'use strict';

    const shell = document.getElementById('viewer-shell');
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
        if (!viewerId) return;
        const key = `llmResponseViewer.${viewerId}`;
        let payload = null;
        try {
            if (chrome.storage?.session) {
                const stored = await chrome.storage.session.get(key);
                payload = stored?.[key] || null;
            }
        } catch (_) {}
        if (!payload) {
            try {
                const stored = await chrome.storage.local.get(key);
                payload = stored?.[key] || null;
            } catch (_) {}
        }
        if (!payload) {
            try {
                const response = await chrome.runtime.sendMessage({ type: 'RESPONSE_VIEWER_GET_CONTENT', key });
                payload = response?.payload || null;
            } catch (_) {}
        }
        if (payload) render(payload);
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
