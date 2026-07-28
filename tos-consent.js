// tos-consent.js
// First-run consent overlay: blocks the results page until the user acknowledges automation risks.
(function initTosConsent() {
  'use strict';

  const STORAGE_KEY = 'tos_acknowledged_v1';

  function buildOverlay() {
    const overlay = document.createElement('div');
    overlay.id = 'tosConsentOverlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,0.75);display:flex;align-items:center;justify-content:center;';
    const card = document.createElement('div');
    card.style.cssText = 'max-width:560px;background:#fff;color:#222;border-radius:8px;padding:24px;font-size:14px;line-height:1.5;';
    card.innerHTML = [
      '<h2 style="margin-top:0">Before you start</h2>',
      '<p>This extension automates the web interfaces of third-party AI services using your own accounts.</p>',
      '<ul>',
      '<li>Automated use may violate the Terms of Service of those providers.</li>',
      '<li>Your accounts may be rate-limited or suspended by the providers.</li>',
      '<li>You are responsible for complying with the terms of every service you connect.</li>',
      '</ul>',
      '<label style="display:flex;gap:8px;align-items:flex-start;margin:16px 0">',
      '<input type="checkbox" id="tosConsentCheckbox" style="margin-top:3px">',
      '<span>I understand and accept these risks.</span>',
      '</label>',
      '<button id="tosConsentAccept" disabled style="padding:8px 20px">Continue</button>'
    ].join('');
    overlay.appendChild(card);
    return overlay;
  }

  function init() {
    chrome.storage.local.get(STORAGE_KEY, (data) => {
      if (data && data[STORAGE_KEY] === true) return;
      const overlay = buildOverlay();
      document.body.appendChild(overlay);
      const checkbox = overlay.querySelector('#tosConsentCheckbox');
      const button = overlay.querySelector('#tosConsentAccept');
      checkbox.addEventListener('change', () => {
        button.disabled = !checkbox.checked;
      });
      button.addEventListener('click', () => {
        chrome.storage.local.set({ [STORAGE_KEY]: true }, () => overlay.remove());
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
