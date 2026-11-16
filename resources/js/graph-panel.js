/**
 * Floating relations graph. The header button opens a window (layouts/graph-panel.blade.php)
 * holding the relations web in embed mode, focused on the entity this page shows. The window
 * can be dragged, resized, minimized and maximized, and remembers all of it per campaign.
 * Every page load reloads the graph, so it reflects entities edited since.
 */
const panel = document.getElementById('graph-panel');
// The header button sits inside the Vue app, which replaces its DOM when it mounts, so look
// it up when needed and listen for its clicks on the document.
const toggle = () => document.getElementById('graph-panel-toggle');

const isSheet = () => window.matchMedia('(max-width: 767px)').matches;
const storageKey = panel ? 'chronicle.graph-panel.' + panel.dataset.campaign : null;

const readState = () => {
    try {
        return JSON.parse(window.localStorage.getItem(storageKey)) || {};
    } catch (e) {
        return {};
    }
};

let state = readState();

const saveState = () => {
    try {
        window.localStorage.setItem(storageKey, JSON.stringify(state));
    } catch (e) {
        // Storage can be unavailable (private windows); the panel just won't remember.
    }
};

const frameUrl = () => {
    const url = new URL(panel.dataset.src, window.location.href);
    if (panel.dataset.focus) {
        url.searchParams.set('focus', panel.dataset.focus);
    }
    return url.toString();
};

const loadFrame = () => {
    const body = panel.querySelector('.graph-panel-body');
    let frame = body.querySelector('iframe');
    if (!frame) {
        frame = document.createElement('iframe');
        frame.title = panel.querySelector('.graph-panel-title').textContent.trim();
        body.appendChild(frame);
    }
    frame.src = frameUrl();
};

// Keep the window reachable: at least its title bar stays on screen.
const clamp = () => {
    if (isSheet() || state.maximized || state.left === undefined) {
        return;
    }
    const width = panel.offsetWidth;
    state.left = Math.min(Math.max(state.left, 48 - width), window.innerWidth - 48);
    state.top = Math.min(Math.max(state.top, 48), window.innerHeight - 40);
    panel.style.left = state.left + 'px';
    panel.style.top = state.top + 'px';
};

const applyLayout = () => {
    panel.classList.toggle('is-minimized', !!state.minimized);
    panel.classList.toggle('is-maximized', !!state.maximized);

    const maximize = panel.querySelector('[data-graph-action="maximize"]');
    const label = state.maximized ? panel.dataset.labelRestore : panel.dataset.labelMaximize;
    maximize.title = label;
    maximize.setAttribute('aria-label', label);
    maximize.querySelector('i').className = 'fa-regular ' + (state.maximized ? 'fa-window-restore' : 'fa-window-maximize');

    if (state.left !== undefined) {
        panel.style.left = state.left + 'px';
        panel.style.top = state.top + 'px';
        panel.style.right = 'auto';
    }
    if (state.width) {
        panel.style.width = state.width + 'px';
        panel.style.height = state.height + 'px';
    }
    clamp();
};

const open = (moveFocus = false) => {
    panel.hidden = false;
    toggle()?.setAttribute('aria-expanded', 'true');
    if (!panel.querySelector('iframe')) {
        loadFrame();
    }
    state.open = true;
    saveState();
    // Opened from the button: put keyboard focus inside the window so Escape closes it.
    // Not when it reopens by itself on page load.
    if (moveFocus) {
        panel.focus({ preventScroll: true });
    }
};

const close = () => {
    panel.hidden = true;
    toggle()?.setAttribute('aria-expanded', 'false');
    state.open = false;
    saveState();
    toggle()?.focus();
};

// Drag the window by its title bar, or resize it from the corner, with mouse, pen or touch.
const track = (event, onMove) => {
    if (isSheet() || state.maximized || event.button > 0) {
        return;
    }
    event.preventDefault();
    const rect = panel.getBoundingClientRect();
    const start = { x: event.clientX, y: event.clientY, rect };
    panel.classList.add('is-moving');

    const move = (e) => onMove(e.clientX - start.x, e.clientY - start.y, start.rect);
    const stop = () => {
        panel.classList.remove('is-moving');
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', stop);
        window.removeEventListener('pointercancel', stop);
        saveState();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
};

const init = () => {
    if (!panel) {
        return;
    }

    document.addEventListener('click', (event) => {
        if (event.target.closest('#graph-panel-toggle')) {
            panel.hidden ? open(true) : close();
        }
    });

    panel.querySelector('[data-graph-drag]').addEventListener('pointerdown', (event) => {
        if (event.target.closest('button, a')) {
            return;
        }
        track(event, (dx, dy, rect) => {
            state.left = rect.left + dx;
            state.top = rect.top + dy;
            applyLayout();
        });
    });

    panel.querySelector('[data-graph-resize]').addEventListener('pointerdown', (event) => {
        track(event, (dx, dy, rect) => {
            state.left = rect.left;
            state.top = rect.top;
            state.width = Math.max(288, Math.min(rect.width + dx, window.innerWidth - rect.left - 8));
            state.height = Math.max(192, Math.min(rect.height + dy, window.innerHeight - rect.top - 8));
            applyLayout();
        });
    });

    panel.addEventListener('click', (event) => {
        const action = event.target.closest('[data-graph-action]')?.dataset.graphAction;
        if (action === 'close') {
            close();
        } else if (action === 'refresh') {
            loadFrame();
        } else if (action === 'minimize') {
            state.minimized = !state.minimized;
            state.maximized = false;
            applyLayout();
            saveState();
        } else if (action === 'maximize') {
            state.maximized = !state.maximized;
            state.minimized = false;
            applyLayout();
            saveState();
        }
    });

    panel.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            close();
        }
    });

    window.addEventListener('resize', clamp);

    applyLayout();
    if (state.open) {
        open();
    }
    // Re-sync the button once the Vue app has replaced the header.
    window.addEventListener('load', () => toggle()?.setAttribute('aria-expanded', String(!panel.hidden)));
};

init();
