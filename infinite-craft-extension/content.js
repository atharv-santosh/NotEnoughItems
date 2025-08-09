// Content script for NotEnoughItems
// This script runs in the context of the Infinite Craft page

console.log('[NotEnoughItems] Content script loaded');

// Keep a live set of discovered items from the page by data attribute
const itemSet = new Set();

function scanNodeForItems(root) {
    if (!root) return;
    const isElement = root.nodeType === Node.ELEMENT_NODE;
    const isFragment = root.nodeType === Node.DOCUMENT_FRAGMENT_NODE; // e.g., shadowRoot
    if (!isElement && !isFragment) return;

    if (isElement) {
        const el = root;
        if (el.hasAttribute && el.hasAttribute('data-item-text')) {
            const v = el.getAttribute('data-item-text');
            if (v && v.trim()) itemSet.add(v.trim());
        }
        // Dive into open shadow DOM
        if (el.shadowRoot) {
            scanNodeForItems(el.shadowRoot);
        }
    }

    // Find all descendants with the attribute within this root (works for DocumentFragment too)
    const matches = root.querySelectorAll ? root.querySelectorAll('[data-item-text]') : [];
    matches.forEach(node => {
        const val = node.getAttribute('data-item-text');
        if (val && val.trim()) itemSet.add(val.trim());
        // Dive into their shadow roots if any
        if (node.shadowRoot) scanNodeForItems(node.shadowRoot);
    });

    // Also traverse all descendants to enter their shadow roots
    if (root.querySelectorAll) {
        root.querySelectorAll('*').forEach(el => {
            if (el.shadowRoot) scanNodeForItems(el.shadowRoot);
        });
    }
}

function initialScan() {
    try {
        scanNodeForItems(document.documentElement);
    } catch (e) {
        console.warn('[NotEnoughItems] initialScan error', e);
    }
}

// Observe DOM changes to keep the set updated
const observer = new MutationObserver(mutations => {
    try {
        for (const m of mutations) {
            if (m.type === 'childList') {
                m.addedNodes.forEach(n => scanNodeForItems(n));
            } else if (m.type === 'attributes' && m.attributeName === 'data-item-text') {
                const t = m.target;
                if (t && t.getAttribute) {
                    const v = t.getAttribute('data-item-text');
                    if (v && v.trim()) itemSet.add(v.trim());
                }
            }
        }
    } catch (e) {
        console.warn('[NotEnoughItems] MutationObserver error', e);
    }
});

function startObservingWhenReady() {
    const body = document.body;
    if (body) {
        observer.observe(body, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-item-text'] });
        initialScan();
    } else {
        // Retry shortly if body not ready yet
        setTimeout(startObservingWhenReady, 250);
    }
}

startObservingWhenReady();

function getAllItems() {
    // Ensure we include any that may have appeared but not captured yet
    try { scanNodeForItems(document.body || document.documentElement); } catch {}
    return Array.from(itemSet).sort((a, b) => a.localeCompare(b));
}

// Optional: provide page HTML if needed in the future
function getPageHTML() {
    try { return document.documentElement.outerHTML; } catch { return ''; }
}

// Utilities for automation inside the page
function cssEscapeSafe(s) {
    try { return (window.CSS && window.CSS.escape) ? window.CSS.escape(s) : s.replace(/"/g, '\\"'); } catch { return s; }
}

function findSearchInput() {
    // Heuristics to locate the search bar
    const selectors = [
        'input[placeholder*="search" i]',
        'input[type="search"]',
        '[role="search"] input',
        'input[aria-label*="search" i]'
    ];
    for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el) return el;
    }
    return null;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function focusAndType(el, text) {
    if (!el) return false;
    setAction(`Search: ${text}`);
    // Click to ensure focus & onFocus handlers run
    el.click();
    el.focus({ preventScroll: true });
    if (el.select) try { el.select(); } catch {}
    el.value = '';
    el.dispatchEvent(new InputEvent('input', { bubbles: true }));
    el.value = text;
    el.dispatchEvent(new InputEvent('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
}

function findItemElementByText(name) {
    const escaped = cssEscapeSafe(name);
    let node = document.querySelector(`[data-item-text="${escaped}"]`);
    if (node) return node;
    // Fallback: scan all candidates and match textContent
    const candidates = document.querySelectorAll('[data-item-text]');
    for (const c of candidates) {
        const val = c.getAttribute('data-item-text') || c.textContent || '';
        if (val.trim().toLowerCase() === name.trim().toLowerCase()) return c;
    }
    return null;
}

function isVisible(el) {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    const style = window.getComputedStyle(el);
    return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
}

async function ensureItemVisible(name, timeoutMs = 1500) {
    let el = findItemElementByText(name);
    if (el && isVisible(el)) return el;
    const input = findSearchInput();
    if (input) {
        focusAndType(input, name);
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
            await sleep(100);
            el = findItemElementByText(name);
            if (el && isVisible(el)) return el;
        }
    }
    return findItemElementByText(name);
}

function simulateHTML5DragAndDrop(source, target) {
    if (!source || !target) return false;
    const dt = new DataTransfer();
    const srcRect = source.getBoundingClientRect();
    const tgtRect = target.getBoundingClientRect();
    const startX = Math.floor(srcRect.left + srcRect.width / 2);
    const startY = Math.floor(srcRect.top + srcRect.height / 2);
    const endX = Math.floor(tgtRect.left + tgtRect.width / 2);
    const endY = Math.floor(tgtRect.top + tgtRect.height / 2);

    function fire(type, el, x, y, extra = {}) {
        const opts = { bubbles: true, cancelable: true, clientX: x, clientY: y, ...extra };
        const evt = new DragEvent(type, opts);
        Object.defineProperty(evt, 'dataTransfer', { value: dt });
        return el.dispatchEvent(evt);
    }

    function mouse(type, el, x, y) {
        const evt = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y });
        return el.dispatchEvent(evt);
    }

    mouse('mousedown', source, startX, startY);
    fire('dragstart', source, startX, startY);
    mouse('mousemove', document.elementFromPoint(startX, startY) || source, startX, startY);
    fire('dragenter', target, endX, endY);
    fire('dragover', target, endX, endY);
    mouse('mousemove', target, endX, endY);
    fire('drop', target, endX, endY);
    mouse('mouseup', target, endX, endY);
    source.dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true }));
    return true;
}

function simulatePointerDrag(source, target) {
    if (!source || !target) return false;
    const srcRect = source.getBoundingClientRect();
    const tgtRect = target.getBoundingClientRect();
    const startX = Math.floor(srcRect.left + srcRect.width / 2);
    const startY = Math.floor(srcRect.top + srcRect.height / 2);
    const endX = Math.floor(tgtRect.left + tgtRect.width / 2);
    const endY = Math.floor(tgtRect.top + tgtRect.height / 2);

    function ev(type, el, x, y) {
        const evt = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y });
        return el.dispatchEvent(evt);
    }

    ev('mousedown', source, startX, startY);
    ev('mousemove', document.elementFromPoint(startX, startY) || source, startX, startY);
    ev('mousemove', target, endX, endY);
    ev('mouseup', target, endX, endY);
    return true;
}

function elCenter(el) {
    const r = el.getBoundingClientRect();
    return { x: Math.floor(r.left + r.width / 2), y: Math.floor(r.top + r.height / 2) };
}

function dispatchPointer(type, target, x, y, extra = {}) {
    const opts = {
        bubbles: true,
        cancelable: true,
        clientX: x,
        clientY: y,
        pointerId: 1,
        pointerType: 'mouse',
        isPrimary: true,
        buttons: type === 'pointerdown' ? 1 : (type === 'pointermove' ? 1 : 0),
        button: 0,
        ...extra,
    };
    const evt = new PointerEvent(type, opts);
    return target.dispatchEvent(evt);
}

function dispatchMouse(type, target, x, y) {
    const buttons = type === 'mousedown' ? 1 : (type === 'mousemove' ? 1 : 0);
    const evt = new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        clientX: x,
        clientY: y,
        button: 0,
        buttons
    });
    return target.dispatchEvent(evt);
}

// Toast helper to show short messages in-page
function showToast(msg, ms = 1800) {
    try {
        const t = document.createElement('div');
        t.style.position = 'fixed';
        t.style.left = '50%';
        t.style.top = '16px';
        t.style.transform = 'translateX(-50%)';
        t.style.background = 'rgba(0,0,0,0.8)';
        t.style.color = '#fff';
        t.style.font = '12px/1.4 system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
        t.style.padding = '8px 10px';
        t.style.borderRadius = '6px';
        t.style.zIndex = '2147483647';
        t.textContent = msg;
        document.body.appendChild(t);
        setTimeout(() => { try { t.remove(); } catch {} }, ms);
    } catch {}
}

// Config storage and calibration
let config = { dropOffset: null, pickupOffset: null, restricted: [], baseViewport: null, clearPoints: null };

function loadConfig() {
    chrome.storage.local.get(['botConfig'], (res) => {
        if (res && res.botConfig) config = { ...config, ...res.botConfig };
        ensureBaseViewport();
    });
}

function saveConfig() {
    return new Promise(resolve => {
        chrome.storage.local.set({ botConfig: config }, () => resolve());
    });
}

// Ensure we have a base viewport stored for proportional scaling of absolute coordinates
function ensureBaseViewport() {
    try {
        const w = window.innerWidth || document.documentElement.clientWidth;
        const h = window.innerHeight || document.documentElement.clientHeight;
        if (!config.baseViewport || !config.baseViewport.width || !config.baseViewport.height) {
            config.baseViewport = { width: w, height: h };
            saveConfig();
        }
    } catch {}
}

// Scale a client point from the base viewport to the current viewport
function scaleClientPoint(pt) {
    if (!pt || typeof pt.x !== 'number' || typeof pt.y !== 'number') return pt;
    const base = config.baseViewport;
    const cw = window.innerWidth || document.documentElement.clientWidth || 1;
    const ch = window.innerHeight || document.documentElement.clientHeight || 1;
    if (base && base.width > 0 && base.height > 0) {
        return {
            x: Math.round(pt.x * cw / base.width),
            y: Math.round(pt.y * ch / base.height)
        };
    }
    return { x: Math.round(pt.x), y: Math.round(pt.y) };
}

loadConfig();
loadRecipesDB();

function makeOverlayPrompt(text = 'Click to set point (Esc to cancel)') {
    const overlay = document.createElement('div');
    overlay.style.position = 'fixed';
    overlay.style.inset = '0';
    overlay.style.background = 'rgba(0,0,0,0.15)';
    overlay.style.zIndex = '2147483647';
    overlay.style.cursor = 'crosshair';
    overlay.style.display = 'flex';
    overlay.style.alignItems = 'center';
    overlay.style.justifyContent = 'center';
    overlay.style.color = '#fff';
    overlay.style.font = '14px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
    overlay.textContent = text;
    document.body.appendChild(overlay);
    return overlay;
}

function calibrateDropPoint() {
    return new Promise((resolve) => {
        const overlay = makeOverlayPrompt('Click the canvas drop point (Esc to cancel)');
        function cleanup() {
            try { overlay.remove(); } catch {}
            window.removeEventListener('keydown', onKey, true);
            window.removeEventListener('click', onClick, true);
        }
        function onKey(e) { if (e.key === 'Escape') { cleanup(); resolve(null); } }
        function onClick(e) {
            e.preventDefault();
            e.stopPropagation();
            const canvas = getCanvasDropTarget();
            const r = canvas.getBoundingClientRect();
            const clientX = e.clientX, clientY = e.clientY;
            const relX = clientX - r.left;
            const relY = clientY - r.top;
            const xPct = (relX / Math.max(1, r.width));
            const yPct = (relY / Math.max(1, r.height));
            config.dropOffset = { xPct: Math.min(Math.max(xPct, 0), 1), yPct: Math.min(Math.max(yPct, 0), 1) };
            saveConfig().then(() => {
                showToast(`Drop set: client=(${clientX|0},${clientY|0}) | canvas%=(${(xPct*100).toFixed(2)}%, ${(yPct*100).toFixed(2)}%)`);
                cleanup();
                resolve({ dropOffset: config.dropOffset, dropClient: { x: clientX, y: clientY }, canvasRect: { left: r.left, top: r.top, width: r.width, height: r.height } });
            });
        }
        window.addEventListener('keydown', onKey, true);
        window.addEventListener('click', onClick, true);
    });
}

function calibratePickupPoint() {
    return new Promise((resolve) => {
        const overlay = makeOverlayPrompt('Click a sidebar item to set pickup point (Esc to cancel)');
        function cleanup() {
            try { overlay.remove(); } catch {}
            window.removeEventListener('keydown', onKey, true);
            window.removeEventListener('click', onClick, true);
        }
        function onKey(e) { if (e.key === 'Escape') { cleanup(); resolve(null); } }
        function onClick(e) {
            e.preventDefault();
            e.stopPropagation();
            const el = e.target.closest ? (e.target.closest('[data-item-text]') || e.target) : e.target;
            const r = el.getBoundingClientRect();
            const clientX = e.clientX, clientY = e.clientY;
            const relX = clientX - r.left;
            const relY = clientY - r.top;
            const xPct = (relX / Math.max(1, r.width));
            const yPct = (relY / Math.max(1, r.height));
            config.pickupOffset = { xPct: Math.min(Math.max(xPct, 0), 1), yPct: Math.min(Math.max(yPct, 0), 1) };
            saveConfig().then(() => {
                showToast(`Pickup set: client=(${clientX|0},${clientY|0}) | item%=(${(xPct*100).toFixed(2)}%, ${(yPct*100).toFixed(2)}%)`);
                cleanup();
                resolve({ pickupOffset: config.pickupOffset, pickupClient: { x: clientX, y: clientY }, elementRect: { left: r.left, top: r.top, width: r.width, height: r.height } });
            });
        }
        window.addEventListener('keydown', onKey, true);
        window.addEventListener('click', onClick, true);
    });
}

// Hardcoded coordinates (client pixels). Enable to force absolute positions like craftbot.py
const HARDCODED_POINTS = {
    enabled: true,
    pickupClient: { x: 1191, y: 27 },   // start
    dropClient:   { x: 600,  y: 600 }   // drop
};

function getCanvasDropPoint() {
    // If hardcoded, use absolute client coords (scaled for current viewport)
    if (HARDCODED_POINTS.enabled && HARDCODED_POINTS.dropClient) {
        const p = scaleClientPoint(HARDCODED_POINTS.dropClient);
        return { x: p.x, y: p.y };
    }
    const canvas = getCanvasDropTarget();
    const r = canvas.getBoundingClientRect();
    if (config.dropOffset && typeof config.dropOffset.xPct === 'number') {
        return {
            x: Math.floor(r.left + r.width * config.dropOffset.xPct),
            y: Math.floor(r.top + r.height * config.dropOffset.yPct)
        };
    }
    return {
        x: Math.floor(r.left + r.width * 0.55),
        y: Math.floor(r.top + r.height * 0.5)
    };
}

function getElementStartPoint(el) {
    // If hardcoded, use absolute client coords for pickup (scaled for current viewport)
    if (HARDCODED_POINTS.enabled && HARDCODED_POINTS.pickupClient) {
        const p = scaleClientPoint(HARDCODED_POINTS.pickupClient);
        return { x: p.x, y: p.y };
    }
    const r = el.getBoundingClientRect();
    if (config.pickupOffset && typeof config.pickupOffset.xPct === 'number') {
        return {
            x: Math.floor(r.left + r.width * config.pickupOffset.xPct),
            y: Math.floor(r.top + r.height * config.pickupOffset.yPct)
        };
    }
    return elCenter(el);
}

async function pointerDragElementToPoint(source, endX, endY, steps = 16) {
    if (!source) return false;
    source.scrollIntoView({ block: 'center', inline: 'center' });
    await sleep(50);
    const start = getElementStartPoint(source);
    pulseDot(start.x, start.y, '#ffa500'); // start marker (orange)
    let current = document.elementFromPoint(start.x, start.y) || source;
    try { source.setPointerCapture && source.setPointerCapture(1); } catch {}
    dispatchAllPointerAndMouse('pointerdown', start.x, start.y, current);
    moveDragDot(start.x, start.y);

    for (let i = 1; i <= steps; i++) {
        const x = Math.round(start.x + (endX - start.x) * (i / steps));
        const y = Math.round(start.y + (endY - start.y) * (i / steps));
        const moveEl = document.elementFromPoint(x, y) || current;
        dispatchAllPointerAndMouse('pointermove', x, y, moveEl);
        current = moveEl;
        moveDragDot(x, y);
        await sleep(12);
    }

    const endEl = document.elementFromPoint(endX, endY) || current;
    dispatchAllPointerAndMouse('pointerup', endX, endY, endEl);
    pulseDot(endX, endY, '#00ff6a'); // end marker (green)
    hideDragDot();
    try { source.releasePointerCapture && source.releasePointerCapture(1); } catch {}
    return true;
}

// Absolute pointer helpers to mimic pyautogui when using hardcoded coords
function pointerDownAt(x, y) {
    const el = document.elementFromPoint(x, y) || document.body;
    dispatchAllPointerAndMouse('pointerdown', x, y, el);
}
function pointerMoveAt(x, y) {
    const el = document.elementFromPoint(x, y) || document.body;
    dispatchAllPointerAndMouse('pointermove', x, y, el);
}
function pointerUpAt(x, y) {
    const el = document.elementFromPoint(x, y) || document.body;
    dispatchAllPointerAndMouse('pointerup', x, y, el);
}
async function pointerDragFromPointToPoint(startX, startY, endX, endY, steps = 20) {
    pulseDot(startX, startY, '#ffa500');
    moveDragDot(startX, startY);
    pointerDownAt(startX, startY);
    for (let i = 1; i <= steps; i++) {
        const x = Math.round(startX + (endX - startX) * (i / steps));
        const y = Math.round(startY + (endY - startY) * (i / steps));
        pointerMoveAt(x, y);
        moveDragDot(x, y);
        await sleep(10);
    }
    pointerUpAt(endX, endY);
    pulseDot(endX, endY, '#00ff6a');
    hideDragDot();
    await sleep(30);
    return true;
}

// Override placement to use canvas-based drop point and validate
async function placeItemOnCanvas(name, waitMs = 900) {
    setAction(`Place: ${name}`);
    // If hardcoded absolute coords are enabled, don't wait for DOM items
    if (typeof HARDCODED_POINTS !== 'undefined' && HARDCODED_POINTS.enabled) {
        const input = findSearchInput();
        if (input) { focusAndType(input, name); }
        await sleep(150); // allow sidebar to update
        const start = scaleClientPoint(HARDCODED_POINTS.pickupClient);
        const dp = getCanvasDropPoint();
        await pointerDragFromPointToPoint(start.x, start.y, dp.x, dp.y);
        await sleep(waitMs);
        return { ok: true, dropX: dp.x, dropY: dp.y };
    }

    // Ensure we include any that may have appeared but not captured yet
    try { scanNodeForItems(document.body || document.documentElement); } catch {}
    const input = findSearchInput();
    if (input) focusAndType(input, name);

    const t0 = Date.now();
    let item = findSidebarItemByText(name);
    while (!item && Date.now() - t0 < 3000) {
        await sleep(100);
        item = findSidebarItemByText(name);
    }
    if (!item) return { ok: false, reason: 'sidebar-item-not-found' };

    const dp = getCanvasDropPoint();
    const dropTarget = document.elementFromPoint(dp.x, dp.y) || getCanvasContainer();

    const ok = await pointerDragElementToPoint(item, dp.x, dp.y) || simulateHTML5DragAndDrop(item, dropTarget) || simulatePointerDrag(item, dropTarget);
    await sleep(waitMs);

    // Validate by checking if an item with same text exists near the drop area
    let canvasEl = findCanvasItemByText(name);
    if (!canvasEl) {
        // Try to locate any element at drop area and its parents
        const near = document.elementFromPoint(dp.x, dp.y);
        if (near && near.closest) canvasEl = near.closest('[data-item-text]');
    }

    return { ok: !!ok, canvasEl, dropX: dp.x, dropY: dp.y };
}

async function combinePairOnCanvas(a, b) {
    setAction(`Combine: ${a} + ${b}`);
    // Absolute path first (no DOM dependency)
    if (typeof HARDCODED_POINTS !== 'undefined' && HARDCODED_POINTS.enabled) {
        const aPlaced = await placeItemOnCanvas(a);
        if (!aPlaced.ok) return { ok: false, step: 'place-a' };
        const input = findSearchInput();
        if (input) { focusAndType(input, b); }
        await sleep(180); // allow sidebar update
        const start = scaleClientPoint(HARDCODED_POINTS.pickupClient);
        await pointerDragFromPointToPoint(start.x, start.y, aPlaced.dropX, aPlaced.dropY);
        await sleep(900); // extra wait for combine animation
        return { ok: true, targetX: aPlaced.dropX, targetY: aPlaced.dropY };
    }

    const aPlaced = await placeItemOnCanvas(a);
    if (!aPlaced.ok) return { ok: false, step: 'place-a', reason: aPlaced.reason };

    const aCanvas = aPlaced.canvasEl || findCanvasItemByText(a);
    const aPoint = aCanvas ? elCenter(aCanvas) : { x: aPlaced.dropX, y: aPlaced.dropY };

    // Prepare B and drag straight onto A's position
    const input = findSearchInput();
    if (input) focusAndType(input, b);
    let bItem = findSidebarItemByText(b);
    const start = Date.now();
    while (!bItem && Date.now() - start < 2500) {
        await sleep(100);
        bItem = findSidebarItemByText(b);
    }
    if (!bItem) return { ok: false, step: 'find-b', reason: 'sidebar-item-not-found' };

    const dragged = await pointerDragElementToPoint(bItem, aPoint.x, aPoint.y) || (aCanvas && await pointerDragElementToElement(bItem, aCanvas));
    await sleep(900); // extra wait

    return { ok: !!dragged, targetX: aPoint.x, targetY: aPoint.y };
}

async function combinePartnerOntoPoint(partnerName, targetX, targetY) {
    setAction(`Chain combine: ${partnerName} -> (${targetX},${targetY})`);
    if (typeof HARDCODED_POINTS !== 'undefined' && HARDCODED_POINTS.enabled) {
        const input = findSearchInput();
        if (input) { focusAndType(input, partnerName); }
        await sleep(180);
        const start = scaleClientPoint(HARDCODED_POINTS.pickupClient);
        await pointerDragFromPointToPoint(start.x, start.y, targetX, targetY);
        await sleep(800);
        return { ok: true };
    }
    // DOM-based fallback
    const input = findSearchInput();
    if (input) focusAndType(input, partnerName);
    let item = findSidebarItemByText(partnerName);
    const t0 = Date.now();
    while (!item && Date.now() - t0 < 2500) {
        await sleep(100);
        item = findSidebarItemByText(partnerName);
    }
    if (!item) return { ok: false, reason: 'sidebar-item-not-found' };
    const dragged = await pointerDragElementToPoint(item, targetX, targetY) || simulatePointerDrag(item, document.elementFromPoint(targetX, targetY) || getCanvasContainer());
    await sleep(800);
    return { ok: !!dragged };
}

// Persistent tried-pair tracking
let running = false;
let currentLoop = null;
let triedPairs = new Set();

function pairKey(a, b) {
    // Use unordered pair to avoid retrying swapped combos
    const [x, y] = [String(a).trim(), String(b).trim()].sort((m, n) => m.localeCompare(n));
    return `${x}||${y}`;
}

async function loadState() {
    return new Promise(resolve => {
        chrome.storage.local.get(['triedPairs', 'knownItems'], (res) => {
            const tp = res.triedPairs || {};
            triedPairs = new Set(Object.keys(tp));
            const ki = res.knownItems || [];
            ki.forEach(v => itemSet.add(v));
            resolve();
        });
    });
}

async function persistState() {
    const tpObj = {};
    triedPairs.forEach(k => tpObj[k] = true);
    const itemsArr = Array.from(itemSet);
    return new Promise(resolve => {
        chrome.storage.local.set({ triedPairs: tpObj, knownItems: itemsArr }, () => resolve());
    });
}

async function markTried(a, b) {
    triedPairs.add(pairKey(a, b));
    await persistState();
}

function getItemsSet() {
    return new Set(getAllItems());
}

function getNewItems(beforeSet, afterSet) {
    const out = [];
    afterSet.forEach(v => { if (!beforeSet.has(v)) out.push(v); });
    return out;
}

function isRestricted(name) {
    try {
        const n = String(name || '').trim().toLowerCase();
        const list = Array.isArray(config.restricted) ? config.restricted : [];
        return list.some(x => String(x).trim().toLowerCase() === n);
    } catch { return false; }
}

function isNumberItem(name) {
    const s = String(name || '').trim();
    return /^-?\d+(?:\.\d+)?$/.test(s);
}

async function saveHtmlSnapshot(tag = 'after-combine') {
    try {
        const html = getPageHTML();
        const ts = Date.now();
        chrome.storage.local.set({ lastHTML: html, lastHTMLAt: ts, lastHTMLTag: tag });
        // Note: Do NOT rebuild itemSet from HTML here because the page may virtualize the list
        // and the HTML snapshot would be incomplete. We rely on harvestAllSidebarItemsExact() instead.
        console.debug('[Bot] HTML snapshot', tag, html ? html.length : 0);
    } catch (e) {
        console.warn('[Bot] snapshot failed', e);
    }
}

async function clickAt(x, y) {
    const el = document.elementFromPoint(x, y) || document.body;
    // press
    dispatchAllPointerAndMouse('pointerdown', x, y, el);
    await sleep(120);
    // release
    dispatchAllPointerAndMouse('pointerup', x, y, el);
    await sleep(60);
    // click event for good measure
    try { el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 })); } catch {}
}

// Default clear points (in client pixels for a reference viewport). Will be scaled.
const DEFAULT_CLEAR_POINTS = [
    { x: 1100, y: 850 },
    { x: 717,  y: 453 }
];

function getClearPoints() {
    const pts = (config.clearPoints && Array.isArray(config.clearPoints) && config.clearPoints.length === 2)
        ? config.clearPoints : DEFAULT_CLEAR_POINTS;
    return pts.map(p => scaleClientPoint(p));
}

async function clearField() {
    // Clicks to clear the field, scaled to current viewport
    await sleep(250);
    const [p1, p2] = getClearPoints();
    await clickAt(p1.x, p1.y);
    await sleep(450);
    await clickAt(p2.x, p2.y);
    await sleep(300);
}

// Selection logic (weighted), modeled after the provided script
const API_LOOP_DELAY_MS = 300; // base delay to avoid 429; we also honor Retry-After

function weightedRNG(weights) {
    let total = weights.reduce((a,b)=>a+b, 0);
    if (total <= 0) return 0;
    let r = Math.random() * total;
    for (let i = 0; i < weights.length; i++) {
        if (r < weights[i]) return i;
        r -= weights[i];
    }
    return 0;
}
function weightedWeights(objs) {
    return objs.map(x => {
        const ti = Number(x.timesIngredient || 0);
        const tf = Number(x.timesFail || 0);
        const td = Number(x.timesDupe || 0);
        let w = (ti + 1) - tf * 0.5 - td * 0.05;
        return w > 0 ? w : 0;
    });
}
function compareRecipes(recipe1, recipe2) {
    return (recipe1[0] === recipe2[0] && recipe1[1] === recipe2[1]) || (recipe1[0] === recipe2[1] && recipe1[1] === recipe2[0]);
}
function selectItemsFromDB() {
    const rawItems = recipesDB.items || [];
    // Only consider items actually present in current HTML (ground truth), non-numeric, not restricted, and below Nothing threshold
    const htmlSet = new Set(getItemsViaHTMLSnapshot());
    const items = rawItems.filter(it => htmlSet.has(it.product) && !isNumberItem(it.product) && !isRestricted(it.product) && (it.timesNothing || 0) < 2);
    if (!items.length) return [-1, -1];
    const w1 = weightedWeights(items);
    const idx1 = weightedRNG(w1);
    const item1Product = items[idx1].product;
    const allKnownPairs = [
        ...rawItems.flatMap(x => Array.isArray(x.recipes) ? x.recipes : [])
    ];
    const failedPairs = Array.isArray(recipesDB.failedRecipes) ? recipesDB.failedRecipes : [];
    const combinedPairs = allKnownPairs.concat(failedPairs);
    const related = new Set(combinedPairs
        .filter(r => r && (r[0] === item1Product || r[1] === item1Product))
        .map(r => (r[0] === item1Product ? r[1] : r[0])));
    let item2Candidates = [];
    if (related.size === 0) item2Candidates = items; else {
        item2Candidates = items.filter(x => x.product !== item1Product && !related.has(x.product));
        if (!item2Candidates.length) item2Candidates = items;
    }
    const w2 = weightedWeights(item2Candidates);
    const pick2 = weightedRNG(w2);
    const item2Product = item2Candidates[pick2].product;
    const idx2 = rawItems.findIndex(x => x.product === item2Product);
    return [rawItems.findIndex(x => x.product === item1Product), idx2 >= 0 ? idx2 : pick2];
}

async function runBotLoop() {
    await loadState();
    await loadRecipesDB();
    mergeHtmlItemsIntoDB();
    if (!recipesDB.items || recipesDB.items.length === 0) {
        const seed = ['Water','Fire','Wind','Earth'];
        const html = getItemsViaHTMLSnapshot();
        (html.length ? html : seed).slice(0, 50).forEach(n => ensureItemRecord(n, ''));
        await saveRecipesDB();
    }
    running = true;
    setAction('Bot started');
    while (running) {
        const [i1, i2] = selectItemsFromDB();
        if (i1 < 0 || i2 < 0) { await sleep(500); continue; }
        const a = recipesDB.items[i1].product;
        const b = recipesDB.items[i2].product;
        const htmlBefore = new Set(getItemsViaHTMLSnapshot());
        const dbBefore = new Set((recipesDB.items || []).map(it => it.product));
        const knownBeforeUnion = new Set([...htmlBefore, ...dbBefore]);
        setAction(`API check: ${a} + ${b}`);
        const apiRes = await recordPairResult(a, b);
        const product = apiRes && apiRes.ok ? (apiRes.product || '') : '';
        addComboLogEntry(`${a} + ${b} => ${product || 'Nothing'}`);
        let isNew = product && product !== 'Nothing' && !knownBeforeUnion.has(product);
        if (isNew) {
            // Final pre-combine check against current HTML to avoid duplicates
            const htmlNow = new Set(getItemsViaHTMLSnapshot());
            if (htmlNow.has(product)) {
                isNew = false;
            }
        }
        if (isNew) {
            setAction(`Physical combine: ${a} + ${b}`);
            await combinePairOnCanvas(a, b);
            await saveHtmlSnapshot('after-physical');
            setAction('Clearing field');
            await clearField();
        }
        mergeHtmlItemsIntoDB();
        await sleep(API_LOOP_DELAY_MS);
    }
    console.log('[NotEnoughItems] Bot stopped');
}

// Backtick hotkey to stop
window.addEventListener('keydown', (e) => {
    if (e.key === '`') {
        stopBot();
    }
});

// Utilities for automation inside the page
function findCanvasDropTarget() {
    // Heuristic: find the largest visible canvas element
    const canvases = document.querySelectorAll('canvas');
    let maxArea = 0;
    let targetCanvas = null;
    canvases.forEach(c => {
        const r = c.getBoundingClientRect();
        const area = r.width * r.height;
        if (area > maxArea) {
            maxArea = area;
            targetCanvas = c;
        }
    });
    return targetCanvas;
}

function getCanvasContainer() {
    // Heuristic: find a likely container for the canvas
    let el = findCanvasDropTarget();
    if (el) {
        while (el.parentElement) {
            el = el.parentElement;
            const style = window.getComputedStyle(el);
            if (style.display !== 'none' && style.visibility !== 'hidden') {
                return el;
            }
        }
    }
    return null;
}

function findCanvasItemByText(name) {
    const escaped = cssEscapeSafe(name);
    let node = document.querySelector(`[data-item-text="${escaped}"]`);
    if (node) return node;
    // Fallback: scan all canvas items and match textContent
    const canvasItems = document.querySelectorAll('canvas [data-item-text]');
    for (const c of canvasItems) {
        const val = c.getAttribute('data-item-text') || c.textContent || '';
        if (val.trim().toLowerCase() === name.trim().toLowerCase()) return c;
    }
    return null;
}

function dispatchAllPointerAndMouse(type, x, y, target) {
    // Dispatch pointer event
    dispatchPointer(type, target, x, y);
    // Mirror with corresponding mouse event
    let mouseType = null;
    if (type === 'pointerdown') mouseType = 'mousedown';
    else if (type === 'pointermove') mouseType = 'mousemove';
    else if (type === 'pointerup' || type === 'pointercancel') mouseType = 'mouseup';
    if (mouseType) dispatchMouse(mouseType, target, x, y);
}

// Drag item to canvas by its visible text name
async function dragItemToCanvasByName(name, waitMs = 900) {
    console.debug('[Bot] dragItemToCanvasByName', name);
    const input = findSearchInput();
    if (input) focusAndType(input, name);

    const t0 = Date.now();
    let item = findSidebarItemByText(name);
    while (!item && Date.now() - t0 < 3000) {
        await sleep(100);
        item = findSidebarItemByText(name);
    }
    if (!item) return { ok: false, reason: 'sidebar-item-not-found' };

    const dp = getCanvasDropPoint();
    const dropTarget = document.elementFromPoint(dp.x, dp.y) || getCanvasContainer();

    const ok = await pointerDragElementToPoint(item, dp.x, dp.y) || simulateHTML5DragAndDrop(item, dropTarget) || simulatePointerDrag(item, dropTarget);
    await sleep(waitMs);

    return { ok: !!ok, dropX: dp.x, dropY: dp.y };
}

// Combine two items by their visible text names
async function combineItemsByNames(a, b) {
    console.debug('[Bot] combineItemsByNames', a, b);
    const aRes = await dragItemToCanvasByName(a);
    if (!aRes.ok) return { ok: false, step: 'place-a', reason: aRes.reason };

    const aPoint = { x: aRes.dropX, y: aRes.dropY };
    const bRes = await dragItemToCanvasByName(b);
    if (!bRes.ok) return { ok: false, step: 'place-b', reason: bRes.reason };

    const bPoint = { x: bRes.dropX, y: bRes.dropY };
    const midPoint = { x: (aPoint.x + bPoint.x) / 2, y: (aPoint.y + bPoint.y) / 2 };

    const dragged = await pointerDragElementToPoint(bRes.canvasEl, midPoint.x, midPoint.y) || pointerDragElementToElement(bRes.canvasEl, aRes.canvasEl);
    await sleep(500);

    return { ok: !!dragged };
}

// Listen for messages from popup/background
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === 'getElements') {
        // Count via HTML + API DB union
        loadRecipesDB().then(() => {
            mergeHtmlItemsIntoDB();
            sendResponse({ elements: getAllKnownProducts() });
        });
        return true;
    }
    if (msg.action === 'getPageHTML') {
        sendResponse({ html: getPageHTML() });
        return true;
    }
    if (msg.action === 'search') {
        const input = findSearchInput();
        const ok = focusAndType(input, msg.query || '');
        sendResponse({ ok });
        return true;
    }
    if (msg.action === 'dragToCanvas') {
        dragItemToCanvasByName(msg.name).then(res => sendResponse(res));
        return true;
    }
    if (msg.action === 'combine') {
        combineItemsByNames(msg.a, msg.b).then(res => sendResponse(res));
        return true;
    }
    if (msg.action === 'startBot') {
        if (!running) {
            currentLoop = runBotLoop();
        }
        sendResponse({ running: true });
        return true;
    }
    if (msg.action === 'stopBot') {
        stopBot();
        sendResponse({ running: false });
        return true;
    }
    if (msg.action === 'getStatus') {
        loadRecipesDB().then(() => {
            mergeHtmlItemsIntoDB();
            const count = getAllKnownProducts().length;
            sendResponse({ running, items: count, triedPairs: triedPairs.size });
        });
        return true;
    }
    if (msg.action === 'calibrateDropPoint') {
        calibrateDropPoint().then(res => sendResponse({ ok: !!res, ...res }));
        return true;
    }
    if (msg.action === 'calibratePickupPoint') {
        calibratePickupPoint().then(res => sendResponse({ ok: !!res, ...res }));
        return true;
    }
    if (msg.action === 'getRestricted') {
        sendResponse({ restricted: Array.isArray(config.restricted) ? config.restricted : [] });
        return true;
    }
    if (msg.action === 'addRestricted') {
        const name = String(msg.name || '').trim();
        if (name) {
            if (!Array.isArray(config.restricted)) config.restricted = [];
            const exists = config.restricted.some(x => String(x).trim().toLowerCase() === name.toLowerCase());
            if (!exists) config.restricted.push(name);
            saveConfig().then(() => sendResponse({ ok: true, restricted: config.restricted }));
        } else {
            sendResponse({ ok: false, error: 'empty' });
        }
        return true;
    }
    if (msg.action === 'removeRestricted') {
        const name = String(msg.name || '').trim();
        if (name && Array.isArray(config.restricted)) {
            config.restricted = config.restricted.filter(x => String(x).trim().toLowerCase() !== name.toLowerCase());
            saveConfig().then(() => sendResponse({ ok: true, restricted: config.restricted }));
        } else {
            sendResponse({ ok: false, error: 'not-found' });
        }
        return true;
    }
    // New: allow setting/getting base viewport so coordinates scale across window sizes
    if (msg.action === 'setBaseViewport') {
        const width = Number(msg.width);
        const height = Number(msg.height);
        if (width > 0 && height > 0) {
            config.baseViewport = { width, height };
            saveConfig().then(() => sendResponse({ ok: true, baseViewport: config.baseViewport }));
        } else {
            sendResponse({ ok: false, error: 'invalid-dimensions' });
        }
        return true;
    }
    if (msg.action === 'getBaseViewport') {
        const current = { width: window.innerWidth || 0, height: window.innerHeight || 0 };
        sendResponse({ baseViewport: config.baseViewport || null, currentViewport: current });
        return true;
    }
});

// Lightweight periodic rescan to catch shadow DOM changes not seen by the main observer
setInterval(() => {
    try { scanNodeForItems(document.documentElement); } catch {}
}, 1000);

// ===== Visual Overlays (status + drag markers) =====
let actionBox = null;
let dragDot = null;

function ensureActionBox() {
    if (actionBox) return actionBox;
    actionBox = document.createElement('div');
    Object.assign(actionBox.style, {
        position: 'fixed',
        right: '10px',
        bottom: '10px',
        padding: '8px 10px',
        background: 'rgba(0,0,0,0.75)',
        color: '#fff',
        font: '12px/1.4 system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
        borderRadius: '6px',
        zIndex: 2147483647,
        pointerEvents: 'none',
        boxShadow: '0 2px 8px rgba(0,0,0,0.35)'
    });
    actionBox.textContent = 'Idle';
    document.body.appendChild(actionBox);
    return actionBox;
}

function setAction(text) {
    const box = ensureActionBox();
    box.textContent = String(text);
}

function clearAction() {
    if (actionBox) actionBox.textContent = 'Idle';
}

function ensureDragDot() {
    if (dragDot) return dragDot;
    dragDot = document.createElement('div');
    Object.assign(dragDot.style, {
        position: 'fixed',
        width: '12px',
        height: '12px',
        marginLeft: '-6px',
        marginTop: '-6px',
        borderRadius: '50%',
        background: '#00e5ff',
        border: '2px solid #005b6e',
        zIndex: 2147483647,
        pointerEvents: 'none',
        transition: 'transform 40ms linear, opacity 200ms ease',
        opacity: '0',
        transform: 'translate(-9999px, -9999px)'
    });
    document.body.appendChild(dragDot);
    return dragDot;
}

function moveDragDot(x, y) {
    const d = ensureDragDot();
    d.style.opacity = '1';
    d.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
}

function hideDragDot() {
    if (dragDot) dragDot.style.opacity = '0';
}

function pulseDot(x, y, color = '#ff0') {
    const dot = document.createElement('div');
    Object.assign(dot.style, {
        position: 'fixed',
        left: `${Math.round(x)}px`,
        top: `${Math.round(y)}px`,
        width: '10px',
        height: '10px',
        marginLeft: '-5px',
        marginTop: '-5px',
        borderRadius: '50%',
        background: color,
        boxShadow: '0 0 10px ' + color,
        zIndex: 2147483647,
        pointerEvents: 'none',
        opacity: '1',
        transition: 'opacity 600ms ease'
    });
    document.body.appendChild(dot);
    setTimeout(() => { dot.style.opacity = '0'; }, 50);
    setTimeout(() => { try { dot.remove(); } catch {} }, 700);
}
// ===== End overlays =====

// ===== Bottom-left combo log overlay =====
let comboLogBox = null;
let comboLogEntries = [];

function ensureComboLogBox() {
    if (comboLogBox) return comboLogBox;
    comboLogBox = document.createElement('div');
    Object.assign(comboLogBox.style, {
        position: 'fixed',
        left: '10px',
        bottom: '10px',
        width: '320px',
        maxHeight: '40vh',
        overflow: 'hidden',
        background: 'rgba(0,0,0,0.75)',
        color: '#fff',
        font: '12px/1.4 system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
        borderRadius: '6px',
        zIndex: 2147483647,
        pointerEvents: 'none',
        boxShadow: '0 2px 8px rgba(0,0,0,0.35)',
        padding: '6px 8px'
    });
    document.body.appendChild(comboLogBox);
    renderComboLog();
    return comboLogBox;
}

function renderComboLog() {
    ensureComboLogBox();
    const html = comboLogEntries.map(e => `<div style="margin:4px 0;">${e}</div>`).join('');
    comboLogBox.innerHTML = html || '<div style="opacity:.7">No combinations yet</div>';
}

function addComboLogEntry(text) {
    const ts = new Date();
    const t = ts.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    comboLogEntries.push(`[${t}] ${text}`);
    if (comboLogEntries.length > 5) comboLogEntries = comboLogEntries.slice(-5);
    renderComboLog();
}
// ===== End combo log overlay =====

// Find a scrollable ancestor element that can be scrolled
function findScrollableAncestor(el) {
    let node = el;
    while (node && node !== document.body && node !== document.documentElement) {
        try {
            const style = getComputedStyle(node);
            const overflowY = style.overflowY;
            const canScroll = (overflowY === 'auto' || overflowY === 'scroll') && node.scrollHeight > node.clientHeight + 1;
            if (canScroll) return node;
        } catch {}
        node = node.parentElement;
    }
    // Fallback to document.scrollingElement if it's scrollable
    const se = document.scrollingElement || document.documentElement;
    if (se && se.scrollHeight > se.clientHeight + 1) return se;
    return null;
}

// Try to locate the real sidebar scroll container reliably
function findSidebarContainer() {
    // Strategy 1: from any sample item, climb up to a scrollable ancestor
    let sample = document.querySelector('[data-item-text]');
    if (sample) {
        let node = sample;
        while (node && node !== document.body && node !== document.documentElement) {
            try {
                const r = node.getBoundingClientRect();
                const style = getComputedStyle(node);
                const hasScroll = node.scrollHeight > node.clientHeight + 1 || node.scrollWidth > node.clientWidth + 1;
                const overflowY = style.overflowY;
                const scrollable = hasScroll || overflowY === 'auto' || overflowY === 'scroll';
                const visible = r.width > 20 && r.height > 60 && style.visibility !== 'hidden' && style.display !== 'none';
                if (scrollable && visible) return node;
            } catch {}
            node = node.parentElement;
        }
    }
    // Strategy 2: any element that contains many [data-item-text] and is scrollable
    const all = Array.from(document.querySelectorAll('*'));
    let best = null, bestScore = -1;
    for (const el of all) {
        try {
            const style = getComputedStyle(el);
            if (style.display === 'none' || style.visibility === 'hidden') continue;
            const rect = el.getBoundingClientRect();
            if (rect.width < 120 || rect.height < 120) continue; // sidebar-sized or larger
            const hasScroll = el.scrollHeight > el.clientHeight + 1;
            const overflowY = style.overflowY;
            const scrollable = hasScroll || overflowY === 'auto' || overflowY === 'scroll';
            if (!scrollable) continue;
            const count = el.querySelectorAll('[data-item-text]').length;
            // Prefer left-half containers and higher counts
            const leftBias = rect.left < (window.innerWidth / 2) ? 1 : 0;
            const score = count + leftBias * 25 + Math.min(25, Math.floor(rect.height / 20));
            if (score > bestScore) { bestScore = score; best = el; }
        } catch {}
    }
    if (best) return best;
    // Strategy 3: fallback to document.scrollingElement
    return document.scrollingElement || document.documentElement;
}

function dispatchWheel(el, deltaY, x, y) {
    try {
        const evt = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY, clientX: Math.round(x), clientY: Math.round(y) });
        el.dispatchEvent(evt);
    } catch {}
}

async function scrollScanTopToBottom(container, maxSteps, delta, settleMs, force) {
    const rect = container.getBoundingClientRect();
    container.scrollTop = 0;
    await sleep(settleMs);
    let steps = 0;
    let lastTop = -1;
    while ((force || running) && steps < maxSteps) {
        try { scanNodeForItems(container); } catch {}
        const atBottom = container.scrollTop >= container.scrollHeight - container.clientHeight - 2;
        if (atBottom) break;
        const before = container.scrollTop;
        container.scrollTop = Math.min(container.scrollTop + delta, container.scrollHeight);
        if (container.scrollTop === before) {
            // fallback: wheel event to nudge virtual scrollers
            dispatchWheel(container, +160, rect.left + 10, rect.top + 10);
        }
        steps++;
        await sleep(settleMs);
    }
    try { scanNodeForItems(container); } catch {}
}

async function scrollScanBottomToTop(container, maxSteps, delta, settleMs, force) {
    const rect = container.getBoundingClientRect();
    container.scrollTop = Math.max(0, container.scrollHeight - container.clientHeight);
    await sleep(settleMs);
    let steps = 0;
    while ((force || running) && steps < maxSteps && container.scrollTop > 0) {
        try { scanNodeForItems(container); } catch {}
        const before = container.scrollTop;
        container.scrollTop = Math.max(0, container.scrollTop - delta);
        if (container.scrollTop === before) {
            dispatchWheel(container, -160, rect.left + 10, rect.top + 10);
        }
        steps++;
        await sleep(settleMs);
    }
    try { scanNodeForItems(container); } catch {}
}

// Harvest all sidebar items by scrolling and scanning (disabled: no searching/typing)
async function harvestAllSidebarItems(maxSteps = 200, stepRatio = 0.85, settleMs = 40, force = false) {
    try { scanNodeForItems(document.documentElement); } catch {}
    await sleep(settleMs);
}

// Force the app to render different slices by typing queries and harvesting each slice (disabled)
async function harvestBySearchQueries(queries = [], settleMs = 100) {
    // Disabled per user request: do not type into the search bar.
    return;
}

// Perform multi-pass harvesting until the item count stabilizes (simplified: no search/scroll)
async function harvestAllSidebarItemsExact(options = {}) {
    try { scanNodeForItems(document.documentElement); } catch {}
    return Array.from(itemSet).sort((a,b)=>a.localeCompare(b));
}

async function pointerDragElementToElement(source, target) {
    if (!source || !target) return false;
    const { x, y } = elCenter(target);
    return pointerDragElementToPoint(source, x, y);
}

async function clearSearchToAll() {
    const input = findSearchInput();
    if (!input) return false;
    // Cycle empty -> space -> empty to trigger apps that ignore no-op input
    focusAndType(input, '');
    await sleep(80);
    focusAndType(input, ' ');
    await sleep(80);
    focusAndType(input, '');
    await sleep(120);
    return true;
}

function findSidebarItemByText(name) {
    const container = findSidebarContainer();
    const escaped = cssEscapeSafe(name);
    if (container) {
        let node = container.querySelector(`[data-item-text="${escaped}"]`);
        if (node) return node;
        const candidates = container.querySelectorAll('[data-item-text]');
        for (const c of candidates) {
            const val = (c.getAttribute('data-item-text') || c.textContent || '').trim();
            if (val.toLowerCase() === String(name).trim().toLowerCase()) return c;
        }
    }
    // Global fallback
    return findItemElementByText(name);
}

function stopBot() {
    if (!running) return;
    setAction('Stopping bot...');
    running = false;
}

// Parse data-item-text values directly from the page HTML (no typing/searching)
function decodeHtmlEntities(str) {
    try {
        const txt = document.createElement('textarea');
        txt.innerHTML = str;
        return txt.value;
    } catch { return str; }
}
function extractItemsFromHTML(html) {
    const set = new Set();
    if (!html) return [];
    const re = /data-item-text\s*=\s*(?:"([^"]+)"|'([^']+)')/g;
    let m;
    while ((m = re.exec(html)) !== null) {
        const raw = m[1] !== undefined ? m[1] : m[2];
        const val = decodeHtmlEntities(raw || '');
        const t = (val || '').trim();
        if (t) set.add(t);
    }
    return Array.from(set).sort((a,b)=>a.localeCompare(b));
}
function getItemsViaHTMLSnapshot() {
    try { return extractItemsFromHTML(getPageHTML()); } catch { return []; }
}
// ===== Recipes DB (API-backed) =====
let recipesDB = { items: [], failedRecipes: [] };

function loadRecipesDB() {
    return new Promise(resolve => {
        chrome.storage.local.get(['recipesDB'], (res) => {
            if (res && res.recipesDB) recipesDB = res.recipesDB;
            if (!Array.isArray(recipesDB.items)) recipesDB.items = [];
            if (!Array.isArray(recipesDB.failedRecipes)) recipesDB.failedRecipes = [];
            // Ensure new field timesNothing present
            recipesDB.items.forEach(it => { if (typeof it.timesNothing !== 'number') it.timesNothing = 0; });
            resolve();
        });
    });
}
function saveRecipesDB() {
    return new Promise(resolve => {
        chrome.storage.local.set({ recipesDB }, () => resolve());
    });
}
function getItemRecord(product) {
    return (recipesDB.items || []).find(i => String(i.product) === String(product)) || null;
}
function ensureItemRecord(product, emoji) {
    let it = getItemRecord(product);
    if (!it) {
        it = { product, emoji: emoji || '', timesIngredient: 0, timesFail: 0, timesDupe: 0, timesNothing: 0, recipes: [] };
        recipesDB.items.push(it);
    } else {
        if (typeof it.timesNothing !== 'number') it.timesNothing = 0; // backfill
    }
    return it;
}
function recipeExistsFor(item, a, b) {
    return Array.isArray(item.recipes) && item.recipes.some(r => (r[0] === a && r[1] === b) || (r[0] === b && r[1] === a));
}
function addFailedRecipe(a, b) {
    const exists = (recipesDB.failedRecipes || []).some(r => (r[0] === a && r[1] === b) || (r[0] === b && r[1] === a));
    if (!exists) recipesDB.failedRecipes.push([a, b]);
}
async function apiSearchPair(s1, s2, attempt = 0) {
    const url = `https://neal.fun/api/infinite-craft/pair?first=${encodeURIComponent(s1)}&second=${encodeURIComponent(s2)}`;
    const resp = await fetch(url, { cache: 'no-store' });
    if (!resp.ok) {
        if (resp.status === 429) {
            const ra = Number(resp.headers.get('Retry-After')) || 5;
            console.warn(`[Bot] 429 retry after ${ra + 5}s for pair ${s1} + ${s2}`);
            await sleep((ra + 5) * 1000);
            if (attempt < 5) return apiSearchPair(s1, s2, attempt + 1);
        }
        throw new Error(`API status ${resp.status}`);
    }
    return resp.json();
}
async function recordPairResult(s1, s2) {
    try {
        const out = await apiSearchPair(s1, s2);
        const product = out && out.result ? String(out.result) : '';
        const emoji = out && out.emoji ? String(out.emoji) : '';
        const i1 = ensureItemRecord(s1, '');
        const i2 = ensureItemRecord(s2, '');
        if (!product || product === 'Nothing') {
            i1.timesFail = (i1.timesFail || 0) + 1;
            i2.timesFail = (i2.timesFail || 0) + 1;
            i1.timesNothing = (i1.timesNothing || 0) + 1;
            i2.timesNothing = (i2.timesNothing || 0) + 1;
            addFailedRecipe(s1, s2);
        } else {
            const existing = getItemRecord(product);
            if (existing) {
                i1.timesDupe = (i1.timesDupe || 0) + 1;
                i2.timesDupe = (i2.timesDupe || 0) + 1;
                if (!recipeExistsFor(existing, s1, s2)) existing.recipes.push([s1, s2]);
                if (!existing.emoji && emoji) existing.emoji = emoji;
            } else {
                // Do NOT add the new product yet. It will be added only once it appears in the real page HTML.
                i1.timesIngredient = (i1.timesIngredient || 0) + 1;
                i2.timesIngredient = (i2.timesIngredient || 0) + 1;
            }
        }
        await saveRecipesDB();
        return { ok: true, product, emoji };
    } catch (e) {
        console.warn('[Bot] recordPairResult error', e);
        return { ok: false, error: String(e) };
    }
}
function mergeHtmlItemsIntoDB() {
    const htmlItems = getItemsViaHTMLSnapshot();
    for (const name of htmlItems) ensureItemRecord(name, '');
}
function getAllKnownProducts() {
    // Return ONLY what is actually present in the live HTML (no DB-only items)
    try { return getItemsViaHTMLSnapshot().filter(v => !isNumberItem(v)); } catch { return []; }
}
// ===== End Recipes DB =====