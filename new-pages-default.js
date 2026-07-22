(function initializeNewPagesDefault() {
    var stopped = false;
    var timers = [];

    function clearTimers() {
        while (timers.length) {
            clearTimeout(timers.pop());
        }
    }

    function stopDefaultBootstrap() {
        stopped = true;
        clearTimers();
    }

    function applyDefault() {
        if (stopped) return;
        var checkbox = document.getElementById('new-pages-checkbox');
        if (!checkbox) return;
        checkbox.checked = true;
        checkbox.defaultChecked = true;
        checkbox.setAttribute('checked', '');
    }

    function bindUserStop() {
        var checkbox = document.getElementById('new-pages-checkbox');
        if (!checkbox || checkbox.dataset.newPagesDefaultBound === 'true') return;
        checkbox.dataset.newPagesDefaultBound = 'true';
        var label = checkbox.closest ? checkbox.closest('.top-new-pages-toggle') : null;
        checkbox.addEventListener('change', stopDefaultBootstrap);
        checkbox.addEventListener('click', stopDefaultBootstrap);
        if (label) {
            label.addEventListener('pointerdown', stopDefaultBootstrap);
            label.addEventListener('keydown', function (event) {
                if (event.key === ' ' || event.key === 'Enter') stopDefaultBootstrap();
            });
        }
    }

    function scheduleDefaultPasses() {
        clearTimers();
        [0, 50, 150, 350, 750, 1500, 2500].forEach(function (delay) {
            timers.push(setTimeout(function () {
                applyDefault();
                bindUserStop();
            }, delay));
        });
    }

    window.__stopNewPagesDefaultBootstrap = stopDefaultBootstrap;
    applyDefault();
    bindUserStop();
    scheduleDefaultPasses();
    document.addEventListener('DOMContentLoaded', scheduleDefaultPasses);
    window.addEventListener('load', scheduleDefaultPasses);
    window.addEventListener('pageshow', scheduleDefaultPasses);
})();
