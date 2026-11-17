/**
 * app.js — โค้ดหลัก FolderMind Pro v3.1
 * รวมทุกฟีเจอร์: PWA, Light/Dark Theme, LocalStorage, Disk Focus Refresh, Legend Filter, Rename & Keyboard Navigation
 */
import {
    isLiveSyncSupported, pickLiveDirectory, readDirectoryHandle, readDroppedItems, readFileList,
    buildDemoTree, createEntry, deleteEntry, renameEntry, validateEntryName, captureCollapsed, restoreCollapsed,
    getExtension, getCategory
} from './fs-access.js';
import {
    CATEGORY_COLORS, formatBytes, renderMindmap, renderTree, generateAsciiTree
} from './render-tree.js';

/* ==========================================================================
   State & DOM
   ========================================================================== */

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 3;
const LARGE_TREE_THRESHOLD = 800;

const state = {
    treeData: null,
    rootHandle: null,
    isLiveSync: false,
    activeView: localStorage.getItem('foldermind_view') || 'mindmap',   // 'mindmap' | 'tree'
    searchQuery: '',
    filterCategory: null,    // หมวดหมู่ที่เลือกกรองจาก Legend (ข้อ 5)
    zoom: 1,
    panX: 80,
    panY: 300,
    bounds: null,
    needsFit: false,
    autoFit: false,
    activePath: null,
    busy: false,
    createContext: { targetNode: null, type: 'file' },
    renameContext: { targetNode: null, parentNode: null },
    deleteContext: { targetNode: null, parentNode: null },
    stats: null
};

const IDS = [
    'dropzoneArea', 'dragHoverOverlay', 'emptyState', 'openLiveSyncBtn', 'heroLiveSyncBtn',
    'fsApiNotSupportedNotice', 'folderInput', 'selectFolderBtn', 'heroUploadBtn', 'demoDataBtn', 'modeBadge',
    'viewMindmapBtn', 'viewTreeBtn', 'mindmapContainer', 'treeContainer', 'mindmapControls',
    'mindmapSvg', 'viewportGroup', 'linesLayer', 'nodesLayer', 'treeContent', 'treePathNotice',
    'searchInput', 'clearSearchBtn', 'expandAllBtn', 'collapseAllBtn',
    'zoomInBtn', 'zoomOutBtn', 'zoomFitBtn', 'zoomLabel',
    'exportMenuBtn', 'exportDropdown', 'exportPngBtn', 'exportSvgBtn', 'exportAsciiBtn', 'exportJsonBtn',
    'themeToggleBtn', 'themeIconLight', 'themeIconDark',
    'createModal', 'createModalTargetPath', 'createTypeFileBtn', 'createTypeFolderBtn', 'createModalInputName',
    'createModalNameLabel', 'submitCreateBtn', 'cancelCreateBtn', 'closeCreateModal',
    'renameModal', 'renameModalInput', 'submitRenameBtn', 'cancelRenameBtn', 'closeRenameModal',
    'deleteModal', 'deleteModalTargetName', 'deleteModalWarnSync', 'deleteConfirmInputContainer', 'deleteConfirmInput', 'confirmDeleteBtn', 'cancelDeleteBtn',
    'asciiModal', 'asciiText', 'copyAsciiBtn', 'closeAsciiModal',
    'statsSidebar', 'toggleSidebarBtn', 'expandSidebarBtn', 'legendContainer',
    'toast', 'toastMsg', 'toastIcon', 'nodeActionBar', 'sidebarBackdrop',
    'statRootName', 'statSummary', 'statFilesCount', 'statFoldersCount', 'statTotalSize', 'extBreakdownList',
    'badgeFolderCount', 'badgeCodeCount', 'badgeMediaCount', 'badgeDocCount', 'badgeDataCount', 'badgeArchiveCount'
];

const ui = {};
for (const id of IDS) {
    ui[id] = document.getElementById(id);
    if (!ui[id]) console.error(`[FolderMind] ไม่พบ element #${id}`);
}

const show = (el) => el.classList.remove('hidden');
const hide = (el) => el.classList.add('hidden');
const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

/* ==========================================================================
   Theme Management (ข้อ 8) & LocalStorage (ข้อ 7)
   ========================================================================== */

function initTheme() {
    const savedTheme = localStorage.getItem('foldermind_theme') || 'dark';
    if (savedTheme === 'light') {
        document.documentElement.classList.remove('dark');
        show(ui.themeIconDark);
        hide(ui.themeIconLight);
    } else {
        document.documentElement.classList.add('dark');
        hide(ui.themeIconDark);
        show(ui.themeIconLight);
    }
}

function toggleTheme() {
    const isDark = document.documentElement.classList.toggle('dark');
    localStorage.setItem('foldermind_theme', isDark ? 'dark' : 'light');
    if (isDark) {
        hide(ui.themeIconDark);
        show(ui.themeIconLight);
    } else {
        show(ui.themeIconDark);
        hide(ui.themeIconLight);
    }
    showToast(`เปลี่ยนเป็นธีม ${isDark ? 'มืด' : 'สว่าง'} แล้ว`, 'info');
}

/* ==========================================================================
   Toast / Mode badge
   ========================================================================== */

const TOAST_ICONS = {
    success: ['text-emerald-400', 'M5 13l4 4L19 7'],
    error: ['text-rose-400', 'M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z'],
    info: ['text-cyan-400', 'M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z']
};
let toastTimer = 0;

function showToast(message, type = 'info') {
    const [color, d] = TOAST_ICONS[type] ?? TOAST_ICONS.info;
    ui.toastMsg.textContent = message;
    ui.toastIcon.innerHTML = `<svg class="w-5 h-5 ${color}" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="${d}"></path></svg>`;
    ui.toast.classList.remove('translate-y-20', 'opacity-0');
    ui.toast.classList.add('translate-y-0', 'opacity-100');

    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
        ui.toast.classList.remove('translate-y-0', 'opacity-100');
        ui.toast.classList.add('translate-y-20', 'opacity-0');
    }, type === 'error' ? 5000 : 3200);
}

const MODES = {
    live: ['bg-emerald-500/10 text-emerald-300 border-emerald-500/30', 'bg-emerald-400 animate-pulse', 'Sync ดิสก์จริง (อ่าน/เขียน)'],
    readonly: ['bg-amber-500/10 text-amber-300 border-amber-500/30', 'bg-amber-400', 'ดูอย่างเดียว'],
    demo: ['bg-indigo-500/10 text-indigo-300 border-indigo-500/30', 'bg-indigo-400', 'โหมดตัวอย่าง']
};

function setMode(mode) {
    const [cls, dot, text] = MODES[mode];
    ui.modeBadge.className = `flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-medium border ${cls}`;
    const dotEl = document.createElement('span');
    dotEl.className = `w-2 h-2 rounded-full ${dot}`;
    const label = document.createElement('span');
    label.textContent = text;
    ui.modeBadge.replaceChildren(dotEl, label);
}

/* ==========================================================================
   Analysis & SetTree
   ========================================================================== */

const compareNodes = (a, b) => (a.type === b.type
    ? a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
    : a.type === 'directory' ? -1 : 1);

function analyze(root) {
    const stats = {
        totalFiles: 0, totalFolders: 0, totalSize: 0,
        categories: { code: 0, media: 0, docs: 0, data: 0, archives: 0, folder: 0, other: 0 },
        extensions: new Map()
    };
    (function walk(node) {
        if (node.type === 'directory') {
            stats.totalFolders++;
            stats.categories.folder++;
            node.category = 'folder';
            node.children?.sort(compareNodes);
            node.children?.forEach(walk);
        } else {
            stats.totalFiles++;
            stats.totalSize += node.size || 0;
            node.extension = getExtension(node.name);
            node.category = getCategory(node.extension);
            stats.categories[node.category]++;
            if (node.extension) stats.extensions.set(node.extension, (stats.extensions.get(node.extension) ?? 0) + 1);
        }
    })(root);
    return stats;
}

function collapseDeep(node, depth = 0) {
    if (node.type !== 'directory') return;
    if (depth >= 2) node.collapsed = true;
    node.children?.forEach((c) => collapseDeep(c, depth + 1));
}

function setTree(root, { fresh = true } = {}) {
    state.stats = analyze(root);
    state.treeData = root;
    document.body.classList.add('has-tree');

    let autoCollapsed = false;
    if (fresh) {
        const total = state.stats.totalFiles + state.stats.totalFolders;
        if (total > LARGE_TREE_THRESHOLD) { collapseDeep(root); autoCollapsed = true; }
        state.needsFit = true;
        state.activePath = null;
    }

    renderStats();
    hide(ui.emptyState);
    updateExportState();
    renderActiveView();
    return autoCollapsed;
}

const BADGES = {
    folder: 'badgeFolderCount', code: 'badgeCodeCount', media: 'badgeMediaCount',
    docs: 'badgeDocCount', data: 'badgeDataCount', archives: 'badgeArchiveCount'
};

function renderStats() {
    const { stats, treeData } = state;
    ui.statRootName.textContent = treeData.name;
    ui.statSummary.textContent = `${stats.totalFiles.toLocaleString()} ไฟล์, ${stats.totalFolders.toLocaleString()} โฟลเดอร์`;
    ui.statFilesCount.textContent = stats.totalFiles.toLocaleString();
    ui.statFoldersCount.textContent = stats.totalFolders.toLocaleString();
    ui.statTotalSize.textContent = formatBytes(stats.totalSize);
    for (const [cat, id] of Object.entries(BADGES)) ui[id].textContent = stats.categories[cat].toLocaleString();

    const top = [...stats.extensions].sort((a, b) => b[1] - a[1]).slice(0, 7);
    if (top.length === 0) {
        const p = document.createElement('p');
        p.className = 'text-slate-500 text-xs italic';
        p.textContent = 'ไม่พบนามสกุลไฟล์';
        ui.extBreakdownList.replaceChildren(p);
        return;
    }
    ui.extBreakdownList.replaceChildren(...top.map(([ext, count]) => {
        const row = document.createElement('div');
        row.className = 'flex items-center justify-between text-xs py-1 px-2 rounded-lg bg-slate-900/40 border border-slate-800/80';
        const name = document.createElement('span');
        name.className = 'font-mono text-slate-300 flex items-center gap-1.5';
        const dot = document.createElement('span');
        dot.className = 'w-2 h-2 rounded-full';
        dot.style.background = CATEGORY_COLORS[getCategory(ext)].stroke;
        name.append(dot, `.${ext}`);
        const badge = document.createElement('span');
        badge.className = 'font-mono text-[10px] text-slate-400 bg-slate-800 px-1.5 py-0.5 rounded';
        badge.textContent = String(count);
        row.append(name, badge);
        return row;
    }));
}

/* ==========================================================================
   Views & Rendering
   ========================================================================== */

const TAB_ON = 'flex items-center gap-2 px-3 py-1.5 rounded-lg transition-all text-white bg-indigo-600 shadow-md';
const TAB_OFF = 'flex items-center gap-2 px-3 py-1.5 rounded-lg text-slate-400 hover:text-slate-200 transition-all';

function switchView(view) {
    state.activeView = view;
    localStorage.setItem('foldermind_view', view);
    const isMap = view === 'mindmap';
    ui.viewMindmapBtn.className = isMap ? TAB_ON : TAB_OFF;
    ui.viewTreeBtn.className = isMap ? TAB_OFF : TAB_ON;
    ui.mindmapContainer.classList.toggle('hidden', !isMap);
    ui.treeContainer.classList.toggle('hidden', isMap);
    ui.mindmapControls.classList.toggle('hidden', !isMap);
    renderActiveView();
}

const viewHandlers = {
    onToggle: (node) => { node.collapsed = !node.collapsed; state.activePath = node.path; renderActiveView(); },
    onCreate: (node, type) => openCreateModal(node, type),
    onRename: (node, parent) => openRenameModal(node, parent),
    onDelete: (node, parent) => openDeleteModal(node, parent),
    onFileClick: (node) => {
        if (state.activeView === 'mindmap') { state.activePath = node.path; renderActiveView(); }
        showToast(`ไฟล์: ${node.path} (${formatBytes(node.size)})`, 'info');
    }
};

const mindmapArgs = () => ({
    root: state.treeData, query: state.searchQuery, filterCategory: state.filterCategory,
    activeNode: resolveActive(), linesLayer: ui.linesLayer, nodesLayer: ui.nodesLayer, ...viewHandlers
});

function renderActiveView() {
    if (!state.treeData) return;
    if (state.activeView === 'mindmap') {
        state.bounds = renderMindmap(mindmapArgs());
        if (state.needsFit && state.bounds) { fitToScreen('readable'); state.needsFit = false; }
        else applyTransform();
    } else {
        renderTree({
            root: state.treeData, query: state.searchQuery, filterCategory: state.filterCategory,
            container: ui.treeContent, pathLabel: ui.treePathNotice, ...viewHandlers
        });
    }
    updateActionBar();
}

function setAllCollapsed(collapsed) {
    if (!state.treeData) return;
    (function walk(node, isRoot) {
        if (node.type !== 'directory') return;
        node.collapsed = isRoot ? false : collapsed;
        node.children?.forEach((c) => walk(c, false));
    })(state.treeData, true);
    state.needsFit = true;
    renderActiveView();
}

/* ==========================================================================
   Pan & Zoom
   ========================================================================== */

function applyTransform() {
    ui.viewportGroup.setAttribute('transform', `translate(${state.panX}, ${state.panY}) scale(${state.zoom})`);
    ui.zoomLabel.textContent = `${Math.round(state.zoom * 100)}%`;
}

function zoomAt(px, py, factor) {
    const zoom = clamp(state.zoom * factor, MIN_ZOOM, MAX_ZOOM);
    const k = zoom / state.zoom;
    state.panX = px - (px - state.panX) * k;
    state.panY = py - (py - state.panY) * k;
    state.zoom = zoom;
    state.autoFit = false;
    applyTransform();
}

function fitToScreen(mode = 'full') {
    const { bounds } = state;
    const w = ui.mindmapContainer.clientWidth;
    const h = ui.mindmapContainer.clientHeight;
    if (!bounds || !w || !h) return;

    const pad = w < 600 ? 16 : 40;
    let zoom = Math.min((w - pad * 2) / bounds.width, (h - pad * 2) / bounds.height, 1);
    if (mode === 'readable') zoom = Math.max(zoom, Math.min(w, h) < 500 ? 0.7 : 0.5);
    zoom = clamp(zoom, MIN_ZOOM, MAX_ZOOM);

    const contentW = bounds.width * zoom;
    const contentH = bounds.height * zoom;
    state.zoom = zoom;
    state.panX = contentW <= w - pad * 2 + 0.5 ? (w - contentW) / 2 - bounds.x * zoom : pad - bounds.x * zoom;
    state.panY = (h - contentH) / 2 - bounds.y * zoom;
    state.autoFit = mode;
    applyTransform();
}

function setupPanZoom() {
    const container = ui.mindmapContainer;
    const pointers = new Map();
    let drag = null;
    let pinch = null;
    let suppressClick = false;

    const localPoint = (x, y) => {
        const r = container.getBoundingClientRect();
        return { x: x - r.left, y: y - r.top };
    };
    const twoFingers = () => {
        const [a, b] = [...pointers.values()];
        return { dist: Math.hypot(a.x - b.x, a.y - b.y), mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
    };
    const suppressNextClick = () => { suppressClick = true; setTimeout(() => { suppressClick = false; }, 0); };

    container.addEventListener('pointerdown', (e) => {
        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (pointers.size === 2) { pinch = twoFingers(); drag = null; }
        else if (pointers.size === 1 && e.button === 0) {
            drag = { offX: e.clientX - state.panX, offY: e.clientY - state.panY, x0: e.clientX, y0: e.clientY, moved: false };
        }
    });

    window.addEventListener('pointermove', (e) => {
        if (!pointers.has(e.pointerId)) return;
        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

        if (pinch && pointers.size === 2) {
            const now = twoFingers();
            if (pinch.dist > 0 && now.dist > 0) {
                const m = localPoint(now.mid.x, now.mid.y);
                zoomAt(m.x, m.y, now.dist / pinch.dist);
            }
            state.panX += now.mid.x - pinch.mid.x;
            state.panY += now.mid.y - pinch.mid.y;
            pinch = now;
            state.autoFit = false;
            applyTransform();
            return;
        }
        if (!drag) return;
        if (!drag.moved && Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < 4) return;
        drag.moved = true;
        state.autoFit = false;
        state.panX = e.clientX - drag.offX;
        state.panY = e.clientY - drag.offY;
        applyTransform();
    });

    const endPointer = (e) => {
        if (!pointers.has(e.pointerId)) return;
        const wasPinching = Boolean(pinch);
        pointers.delete(e.pointerId);
        if (pointers.size < 2) pinch = null;
        if (wasPinching) { suppressNextClick(); drag = null; return; }
        if (drag?.moved) suppressNextClick();
        drag = null;
    };
    window.addEventListener('pointerup', endPointer);
    window.addEventListener('pointercancel', endPointer);

    container.addEventListener('click', (e) => {
        if (suppressClick) { e.stopPropagation(); e.preventDefault(); }
    }, true);
    container.addEventListener('click', (e) => {
        if (state.activePath && !e.target.closest('.mindmap-node')) { state.activePath = null; renderActiveView(); }
    });

    container.addEventListener('wheel', (e) => {
        e.preventDefault();
        const p = localPoint(e.clientX, e.clientY);
        zoomAt(p.x, p.y, e.deltaY < 0 ? 1.1 : 1 / 1.1);
    }, { passive: false });

    ui.zoomInBtn.addEventListener('click', () => zoomAt(container.clientWidth / 2, container.clientHeight / 2, 1.2));
    ui.zoomOutBtn.addEventListener('click', () => zoomAt(container.clientWidth / 2, container.clientHeight / 2, 1 / 1.2));
    ui.zoomFitBtn.addEventListener('click', () => fitToScreen('full'));
}

function setupResizeHandling() {
    let lastW = 0, lastH = 0;
    new ResizeObserver(([entry]) => {
        const { width: w, height: h } = entry.contentRect;
        if (!w || !h) return;
        if (state.treeData && state.activeView === 'mindmap') {
            if (state.autoFit && state.bounds) fitToScreen(state.autoFit);
            else if (lastW && lastH) {
                state.panX += (w - lastW) / 2;
                state.panY += (h - lastH) / 2;
                applyTransform();
            }
        }
        lastW = w; lastH = h;
    }).observe(ui.mindmapContainer);
}

/* ==========================================================================
   Node Action Bar
   ========================================================================== */

function findByPath(node, path) {
    if (node.path === path) return node;
    for (const c of node.children ?? []) { const hit = findByPath(c, path); if (hit) return hit; }
    return null;
}

function findParent(root, target) {
    for (const c of root.children ?? []) {
        if (c === target) return root;
        const hit = findParent(c, target);
        if (hit) return hit;
    }
    return null;
}

const resolveActive = () => (state.activePath && state.treeData ? findByPath(state.treeData, state.activePath) : null);

function updateActionBar() {
    const bar = ui.nodeActionBar;
    const node = state.activeView === 'mindmap' ? resolveActive() : null;
    if (!node) { hide(bar); bar.replaceChildren(); return; }

    const parent = findParent(state.treeData, node);
    const makeBtn = (label, cls, onClick) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = cls;
        b.textContent = label;
        b.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
        return b;
    };
    const name = document.createElement('span');
    name.className = 'node-action-bar__name';
    name.textContent = node.name;

    const items = [name];
    if (node.type === 'directory') {
        items.push(
            makeBtn('＋ ไฟล์', 'border-cyan-500/40 bg-cyan-500/10 text-cyan-300', () => openCreateModal(node, 'file')),
            makeBtn('📁 โฟลเดอร์', 'border-amber-500/40 bg-amber-500/10 text-amber-300', () => openCreateModal(node, 'folder'))
        );
    }
    if (parent) {
        items.push(
            makeBtn('✏️', 'border-sky-500/40 bg-sky-500/10 text-sky-300', () => openRenameModal(node, parent)),
            makeBtn('🗑', 'border-rose-500/40 bg-rose-500/10 text-rose-300', () => openDeleteModal(node, parent))
        );
    }
    items.push(makeBtn('✕', 'border-slate-700 bg-slate-900 text-slate-400', () => { state.activePath = null; renderActiveView(); }));
    bar.replaceChildren(...items);
    show(bar);
}

/* ==========================================================================
   Sidebar Drawer Handling
   ========================================================================== */

const desktopQuery = window.matchMedia('(min-width: 1024px)');
const isDrawerOpen = () => !desktopQuery.matches && document.body.classList.contains('sidebar-open');

function setSidebar(open) {
    if (desktopQuery.matches) {
        document.body.classList.toggle('sidebar-collapsed', !open);
        localStorage.setItem('foldermind_sidebar', open ? 'open' : 'collapsed');
    } else {
        document.body.classList.toggle('sidebar-open', open);
    }
    syncSidebarA11y();
}

function syncSidebarA11y() {
    ui.statsSidebar.inert = !desktopQuery.matches && !document.body.classList.contains('sidebar-open');
}

/* ==========================================================================
   Disk Loading & Auto Refresh on Focus (ข้อ 3)
   ========================================================================== */

async function handleOpenLiveSync() {
    if (!isLiveSyncSupported()) {
        showToast('เบราว์เซอร์ของคุณไม่รองรับ File System Sync โปรดใช้ Chrome, Edge หรือ Brave', 'error');
        return;
    }
    let handle;
    try {
        handle = await pickLiveDirectory();
    } catch (err) {
        if (err.name !== 'AbortError') showToast(`เปิดโฟลเดอร์ไม่สำเร็จ: ${err.message}`, 'error');
        return;
    }
    await loadSource({
        message: `กำลังอ่านโฟลเดอร์ "${handle.name}"...`, mode: 'live', handle,
        read: () => readDirectoryHandle(handle)
    });
}

async function loadSource({ message, mode, handle = null, read }) {
    if (state.busy) return;
    state.busy = true;
    showToast(message, 'info');
    try {
        const tree = await read();
        if (!tree) { showToast('ไม่พบโฟลเดอร์ให้อ่าน', 'error'); return; }
        state.isLiveSync = mode === 'live';
        state.rootHandle = handle;
        const collapsed = setTree(tree, { fresh: true });
        setMode(mode);
        showToast(`โหลด "${tree.name}" สำเร็จ`, 'success');
    } catch (err) {
        console.error(err);
        showToast(`เกิดข้อผิดพลาด: ${err.message}`, 'error');
    } finally {
        state.busy = false;
    }
}

async function refreshFromDisk() {
    if (!state.isLiveSync || !state.rootHandle) return;
    try {
        const collapsed = captureCollapsed(state.treeData);
        const tree = await readDirectoryHandle(state.rootHandle);
        restoreCollapsed(tree, collapsed);
        setTree(tree, { fresh: false });
    } catch (err) {
        console.warn('รีเฟรชดิสก์อัตโนมัติไม่สำเร็จ:', err);
    }
}

window.addEventListener('focus', () => {
    if (state.isLiveSync && state.rootHandle) {
        refreshFromDisk();
    }
});

async function applyChange(successMessage) {
    try {
        if (state.isLiveSync && state.rootHandle) await refreshFromDisk();
        else setTree(state.treeData, { fresh: false });
        showToast(successMessage, 'success');
    } catch (err) {
        console.error(err);
        showToast(`เกิดข้อผิดพลาด: ${err.message}`, 'error');
    }
}

function setupDragAndDrop() {
    window.addEventListener('dragover', (e) => { e.preventDefault(); show(ui.dragHoverOverlay); });
    window.addEventListener('dragleave', (e) => { if (!e.relatedTarget) hide(ui.dragHoverOverlay); });
    window.addEventListener('drop', (e) => {
        e.preventDefault();
        hide(ui.dragHoverOverlay);
        loadSource({
            message: 'กำลังอ่านโครงสร้างโฟลเดอร์...', mode: 'readonly',
            read: () => readDroppedItems(e.dataTransfer.items)
        });
    });
}

function handleFolderInput(e) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (files.length === 0) return;
    loadSource({
        message: 'กำลังอ่านโฟลเดอร์ที่เลือก...', mode: 'readonly',
        read: async () => readFileList(files)
    });
}

/* ==========================================================================
   Modals: Create, Rename, Delete (ข้อ 2, ข้อ 4)
   ========================================================================== */

const MODALS = () => [ui.createModal, ui.renameModal, ui.deleteModal, ui.asciiModal];
const closeAllModals = () => MODALS().forEach(hide);

function setCreateType(type) {
    state.createContext.type = type;
    const isFile = type === 'file';
    ui.createTypeFileBtn.className = isFile 
        ? 'flex items-center justify-center gap-2 py-2 px-3 rounded-xl border border-indigo-500 bg-indigo-600/20 text-indigo-200 font-medium transition-all'
        : 'flex items-center justify-center gap-2 py-2 px-3 rounded-xl border border-slate-800 bg-slate-900 text-slate-400 font-medium transition-all';
    ui.createTypeFolderBtn.className = isFile 
        ? 'flex items-center justify-center gap-2 py-2 px-3 rounded-xl border border-slate-800 bg-slate-900 text-slate-400 font-medium transition-all'
        : 'flex items-center justify-center gap-2 py-2 px-3 rounded-xl border border-amber-500 bg-amber-600/20 text-amber-200 font-medium transition-all';
    ui.createModalNameLabel.textContent = isFile ? 'ชื่อไฟล์ใหม่ (เช่น script.js):' : 'ชื่อโฟลเดอร์ใหม่:';
    ui.createModalInputName.placeholder = isFile ? 'script.js' : 'components';
}

function openCreateModal(targetNode, type = 'file') {
    state.createContext.targetNode = targetNode;
    ui.createModalTargetPath.textContent = targetNode.path;
    ui.createModalInputName.value = '';
    setCreateType(type);
    show(ui.createModal);
    ui.createModalInputName.focus();
}

async function submitCreate() {
    if (state.busy) return;
    const name = ui.createModalInputName.value.trim();
    const { targetNode, type } = state.createContext;
    const invalid = validateEntryName(name);
    if (invalid) { showToast(invalid, 'error'); return; }

    state.busy = true;
    try {
        await createEntry(targetNode, name, type, { live: state.isLiveSync });
    } catch (err) {
        showToast(`สร้างไม่สำเร็จ: ${err.message}`, 'error');
        state.busy = false;
        return;
    }
    hide(ui.createModal);
    targetNode.collapsed = false;
    await applyChange(`สร้าง "${name}" สำเร็จ`);
    state.busy = false;
}

function openRenameModal(targetNode, parentNode) {
    state.renameContext = { targetNode, parentNode };
    ui.renameModalInput.value = targetNode.name;
    show(ui.renameModal);
    ui.renameModalInput.focus();
    ui.renameModalInput.select();
}

async function submitRename() {
    if (state.busy) return;
    const newName = ui.renameModalInput.value.trim();
    const { targetNode, parentNode } = state.renameContext;
    const invalid = validateEntryName(newName);
    if (invalid) { showToast(invalid, 'error'); return; }

    state.busy = true;
    try {
        await renameEntry(parentNode, targetNode, newName, { live: state.isLiveSync });
    } catch (err) {
        showToast(`เปลี่ยนชื่อไม่สำเร็จ: ${err.message}`, 'error');
        state.busy = false;
        return;
    }
    hide(ui.renameModal);
    await applyChange(`เปลี่ยนชื่อเป็น "${newName}" สำเร็จ`);
    state.busy = false;
}

function openDeleteModal(targetNode, parentNode) {
    state.deleteContext = { targetNode, parentNode };
    ui.deleteModalTargetName.textContent = targetNode.name;
    ui.deleteModalWarnSync.classList.toggle('hidden', !state.isLiveSync);

    const hasChildren = targetNode.type === 'directory' && (targetNode.children?.length ?? 0) > 0;
    if (hasChildren || state.isLiveSync) {
        show(ui.deleteConfirmInputContainer);
        ui.deleteConfirmInput.value = '';
        ui.confirmDeleteBtn.disabled = true;
        ui.confirmDeleteBtn.className = 'px-4 py-2 rounded-xl bg-rose-600/50 cursor-not-allowed text-white text-xs font-semibold shadow-lg transition-all';
    } else {
        hide(ui.deleteConfirmInputContainer);
        ui.confirmDeleteBtn.disabled = false;
        ui.confirmDeleteBtn.className = 'px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold shadow-lg transition-all';
    }
    show(ui.deleteModal);
}

async function confirmDelete() {
    const { targetNode, parentNode } = state.deleteContext;
    if (state.busy || !targetNode || !parentNode) return;

    state.busy = true;
    try {
        await deleteEntry(parentNode, targetNode, { live: state.isLiveSync });
    } catch (err) {
        showToast(`ลบไม่สำเร็จ: ${err.message}`, 'error');
        state.busy = false;
        return;
    }
    hide(ui.deleteModal);
    state.deleteContext = { targetNode: null, parentNode: null };
    state.activePath = null;
    await applyChange(`ลบ "${targetNode.name}" สำเร็จ`);
    state.busy = false;
}

/* ==========================================================================
   Keyboard Navigation (ข้อ 9)
   ========================================================================== */

function setupKeyboardNavigation() {
    document.addEventListener('keydown', (e) => {
        if (['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;

        const modalOpen = MODALS().some((m) => !m.classList.contains('hidden'));
        if (e.key === 'Escape') {
            closeAllModals(); hide(ui.exportDropdown);
            if (!modalOpen && isDrawerOpen()) setSidebar(false);
            return;
        }

        if (modalOpen || !state.treeData) return;

        if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
            e.preventDefault();
            const list = [];
            (function flatten(node) {
                list.push(node);
                if (node.type === 'directory' && !node.collapsed && node.children) {
                    node.children.forEach(flatten);
                }
            })(state.treeData);

            if (list.length === 0) return;
            let idx = list.findIndex(n => n.path === state.activePath);
            if (idx === -1) idx = 0;
            else if (e.key === 'ArrowDown' || e.key === 'ArrowRight') idx = (idx + 1) % list.length;
            else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') idx = (idx - 1 + list.length) % list.length;

            state.activePath = list[idx].path;
            renderActiveView();
        }

        if (e.key === 'Delete' && state.activePath) {
            const node = resolveActive();
            const parent = findParent(state.treeData, node);
            if (node && parent) {
                openDeleteModal(node, parent);
            }
        }
    });
}

/* ==========================================================================
   Export Functions
   ========================================================================== */

function updateExportState() {
    const hasData = Boolean(state.treeData);
    ui.exportMenuBtn.disabled = !hasData;
    ui.exportMenuBtn.classList.toggle('opacity-50', !hasData);
    ui.exportMenuBtn.classList.toggle('cursor-not-allowed', !hasData);
}

const safeName = (s) => s.replace(/[\\/:*?"<>|]+/g, '_');

function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function copyText(text) {
    try {
        await navigator.clipboard.writeText(text);
        return true;
    } catch {
        const ta = document.createElement('textarea');
        ta.value = text; ta.style.cssText = 'position:fixed;opacity:0';
        document.body.append(ta); ta.select();
        let ok = false;
        try { ok = document.execCommand('copy'); } catch { }
        ta.remove();
        return ok;
    }
}

function buildExportSvg() {
    const bounds = renderMindmap(mindmapArgs());
    if (!bounds) return null;
    const pad = 40;
    const x = bounds.x - pad, y = bounds.y - pad;
    const w = Math.ceil(bounds.width + pad * 2), h = Math.ceil(bounds.height + pad * 2);

    const clone = ui.mindmapSvg.cloneNode(true);
    clone.removeAttribute('class'); clone.removeAttribute('id');
    clone.querySelectorAll('.node-actions, .node-toggle').forEach((el) => el.remove());
    const group = clone.querySelector('#viewportGroup');
    group.removeAttribute('transform'); group.removeAttribute('id');

    const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    for (const [k, v] of Object.entries({ x, y, width: w, height: h, fill: document.documentElement.classList.contains('dark') ? '#090d16' : '#f8fafc' })) {
        bg.setAttribute(k, v);
    }
    clone.insertBefore(bg, group);
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    clone.setAttribute('viewBox', `${x} ${y} ${w} ${h}`);
    clone.setAttribute('width', w); clone.setAttribute('height', h);
    return { markup: new XMLSerializer().serializeToString(clone), width: w, height: h };
}

function exportAsSVG() {
    const svg = buildExportSvg();
    if (!svg) { showToast('ไม่มีข้อมูลให้ส่งออก', 'error'); return; }
    downloadBlob(new Blob([svg.markup], { type: 'image/svg+xml;charset=utf-8' }), `${safeName(state.treeData.name)}-mindmap.svg`);
    showToast('ดาวน์โหลด SVG สำเร็จ', 'success');
}

function exportAsPNG() {
    const svg = buildExportSvg();
    if (!svg) { showToast('ไม่มีข้อมูลให้ส่งออก', 'error'); return; }
    showToast('กำลังสร้างภาพ PNG...', 'info');
    const scale = Math.min(2, 8192 / svg.width, 8192 / svg.height);
    const url = URL.createObjectURL(new Blob([svg.markup], { type: 'image/svg+xml;charset=utf-8' }));
    const img = new Image();
    img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = Math.floor(svg.width * scale);
        canvas.height = Math.floor(svg.height * scale);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((blob) => {
            URL.revokeObjectURL(url);
            if (!blob) { showToast('สร้าง PNG ไม่สำเร็จ', 'error'); return; }
            downloadBlob(blob, `${safeName(state.treeData.name)}-mindmap.png`);
            showToast('ดาวน์โหลด PNG สำเร็จ', 'success');
        }, 'image/png');
    };
    img.src = url;
}

function openAsciiModal() {
    if (!state.treeData) return;
    ui.asciiText.textContent = generateAsciiTree(state.treeData);
    show(ui.asciiModal);
}

async function copyAscii() {
    const ok = await copyText(ui.asciiText.textContent);
    showToast(ok ? 'คัดลอกโครงสร้าง ASCII สำเร็จ' : 'คัดลอกไม่สำเร็จ', ok ? 'success' : 'error');
    if (ok) hide(ui.asciiModal);
}

function exportAsJSON() {
    if (!state.treeData) return;
    const json = JSON.stringify(state.treeData, (key, val) => (key === 'handle' ? undefined : val), 2);
    downloadBlob(new Blob([json], { type: 'application/json' }), `${safeName(state.treeData.name)}-structure.json`);
    showToast('ดาวน์โหลด JSON สำเร็จ', 'success');
}

/* ==========================================================================
   Event Binding & Initialization
   ========================================================================== */

function bindEvents() {
    ui.themeToggleBtn.addEventListener('click', toggleTheme);

    ui.openLiveSyncBtn.addEventListener('click', handleOpenLiveSync);
    ui.heroLiveSyncBtn.addEventListener('click', handleOpenLiveSync);
    ui.selectFolderBtn.addEventListener('click', () => ui.folderInput.click());
    ui.heroUploadBtn.addEventListener('click', () => ui.folderInput.click());
    ui.folderInput.addEventListener('change', handleFolderInput);
    ui.demoDataBtn.addEventListener('click', () => loadSource({
        message: 'กำลังโหลดข้อมูลตัวอย่าง...', mode: 'demo', read: async () => buildDemoTree()
    }));
    setupDragAndDrop();

    ui.viewMindmapBtn.addEventListener('click', () => switchView('mindmap'));
    ui.viewTreeBtn.addEventListener('click', () => switchView('tree'));

    let searchTimer = 0;
    ui.searchInput.addEventListener('input', (e) => {
        ui.clearSearchBtn.classList.toggle('hidden', !e.target.value.trim());
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => {
            state.searchQuery = e.target.value.toLowerCase().trim();
            renderActiveView();
        }, 120);
    });
    ui.clearSearchBtn.addEventListener('click', () => {
        clearTimeout(searchTimer);
        ui.searchInput.value = ''; state.searchQuery = '';
        hide(ui.clearSearchBtn); renderActiveView();
    });

    ui.legendContainer.addEventListener('click', (e) => {
        const item = e.target.closest('.legend-filter-item');
        if (!item) return;
        const cat = item.getAttribute('data-category');
        if (state.filterCategory === cat) {
            state.filterCategory = null;
            item.classList.remove('ring-2', 'ring-white');
        } else {
            state.filterCategory = cat;
            ui.legendContainer.querySelectorAll('.legend-filter-item').forEach(el => el.classList.remove('ring-2', 'ring-white'));
            item.classList.add('ring-2', 'ring-white');
        }
        renderActiveView();
    });

    ui.expandAllBtn.addEventListener('click', () => setAllCollapsed(false));
    ui.collapseAllBtn.addEventListener('click', () => setAllCollapsed(true));

    ui.exportMenuBtn.addEventListener('click', (e) => { e.stopPropagation(); ui.exportDropdown.classList.toggle('hidden'); });
    document.addEventListener('click', () => hide(ui.exportDropdown));
    ui.exportPngBtn.addEventListener('click', exportAsPNG);
    ui.exportSvgBtn.addEventListener('click', exportAsSVG);
    ui.exportAsciiBtn.addEventListener('click', openAsciiModal);
    ui.exportJsonBtn.addEventListener('click', exportAsJSON);
    ui.copyAsciiBtn.addEventListener('click', copyAscii);
    ui.closeAsciiModal.addEventListener('click', () => hide(ui.asciiModal));

    ui.createTypeFileBtn.addEventListener('click', () => setCreateType('file'));
    ui.createTypeFolderBtn.addEventListener('click', () => setCreateType('folder'));
    ui.submitCreateBtn.addEventListener('click', submitCreate);
    ui.cancelCreateBtn.addEventListener('click', () => hide(ui.createModal));
    ui.closeCreateModal.addEventListener('click', () => hide(ui.createModal));

    ui.submitRenameBtn.addEventListener('click', submitRename);
    ui.cancelRenameBtn.addEventListener('click', () => hide(ui.renameModal));
    ui.closeRenameModal.addEventListener('click', () => hide(ui.renameModal));

    ui.deleteConfirmInput.addEventListener('input', (e) => {
        const targetName = state.deleteContext.targetNode?.name || '';
        const match = e.target.value.trim() === targetName;
        ui.confirmDeleteBtn.disabled = !match;
        ui.confirmDeleteBtn.className = match
            ? 'px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold shadow-lg transition-all'
            : 'px-4 py-2 rounded-xl bg-rose-600/50 cursor-not-allowed text-white text-xs font-semibold shadow-lg transition-all';
    });
    ui.confirmDeleteBtn.addEventListener('click', confirmDelete);
    ui.cancelDeleteBtn.addEventListener('click', () => hide(ui.deleteModal));

    for (const modal of MODALS()) {
        modal.addEventListener('click', (e) => { if (e.target === modal) hide(modal); });
    }

    ui.toggleSidebarBtn.addEventListener('click', () => setSidebar(false));
    ui.expandSidebarBtn.addEventListener('click', () => setSidebar(true));
    ui.sidebarBackdrop.addEventListener('click', () => setSidebar(false));
    desktopQuery.addEventListener('change', () => { document.body.classList.remove('sidebar-open'); syncSidebarA11y(); });

    setupKeyboardNavigation();
}

function init() {
    initTheme();
    if (localStorage.getItem('foldermind_sidebar') === 'collapsed' && desktopQuery.matches) {
        document.body.classList.add('sidebar-collapsed');
    }
    if (!isLiveSyncSupported()) show(ui.fsApiNotSupportedNotice);
    bindEvents();
    setupPanZoom();
    setupResizeHandling();
    syncSidebarA11y();
    updateExportState();
}

init();