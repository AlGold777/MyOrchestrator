(function initTelemetryExportBootstrap(root) {
    'use strict';

    if (root.__TELEMETRY_EXPORT_BOOTSTRAP_READY__) return;
    root.__TELEMETRY_EXPORT_BOOTSTRAP_READY__ = true;

    let loaderPromise = null;

    const loadTelemetryDevtools = () => {
        if (root.__DEVTOOLS_TELEMETRY_READY__) return Promise.resolve(true);
        if (loaderPromise) return loaderPromise;

        loaderPromise = new Promise((resolve, reject) => {
            let script = document.querySelector('script[data-telemetry-devtools]');
            const handleLoad = () => resolve(true);
            const handleError = () => {
                loaderPromise = null;
                reject(new Error('telemetry_devtools_load_failed'));
            };
            const shouldAppend = !script;
            if (shouldAppend) {
                script = document.createElement('script');
                script.src = chrome.runtime.getURL('results-devtools.js');
                script.dataset.telemetryDevtools = 'true';
            }
            script.addEventListener('load', handleLoad, { once: true });
            script.addEventListener('error', handleError, { once: true });
            if (shouldAppend) document.head.appendChild(script);
        });
        return loaderPromise;
    };

    root.ensureTelemetryDevtoolsLoaded = loadTelemetryDevtools;

    document.addEventListener('click', (event) => {
        const button = event.target?.closest?.('#telemetry-export-json-btn');
        if (!button || root.__DEVTOOLS_TELEMETRY_READY__) return;

        event.preventDefault();
        event.stopImmediatePropagation();
        root.__PENDING_TELEMETRY_JSON_EXPORT__ = true;
        root.__TELEMETRY_EXPORT_CLICKED_AT__ = Date.now();
        button.disabled = true;
        button.setAttribute('aria-busy', 'true');
        const status = document.getElementById('telemetry-status');
        if (status) status.textContent = 'Loading JSON exporter…';

        void loadTelemetryDevtools()
            .then(() => {
                document.dispatchEvent(new CustomEvent('telemetry-export-json-request'));
            })
            .catch((error) => {
                root.__PENDING_TELEMETRY_JSON_EXPORT__ = false;
                button.disabled = false;
                button.removeAttribute('aria-busy');
                if (status) status.textContent = `JSON exporter failed to load: ${error?.message || 'unknown error'}`;
            });
    }, true);
})(typeof window !== 'undefined' ? window : self);
