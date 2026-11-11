/**
 * app.js — ไฟล์หลักของ FolderMind
 * เชื่อม fs-access.js (ข้อมูล) กับ render-tree.js (การแสดงผล) และจัดการ UI ทั้งหมด
 */
import {
    isLiveSyncSupported, pickLiveDirectory, readDirectoryHandle, readDroppedItems, readFileList,
    buildDemoTree, createEntry, deleteEntry, validateEntryName, captureCollapsed, restoreCollapsed,
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
const LARGE_TREE_THRESHOLD = 800; // ถ้าเกินนี้ จะยุบโฟลเดอร์ชั้นลึกไว้ก่อน กัน Mind Map ค้าง
const SVG_NS = 'http://www.w3.org/2000/svg';

const state = {
    treeData: null,
    rootHandle: null,
    isLiveSync: false,
    activeView: 'mindmap',   // 'mindmap' | 'tree'
    searchQuery: '',
    zoom: 1,
    panX: 80,
    panY: 300,
    bounds: null,            // ขอบเขตของ Mind Map ที่วาดล่าสุด
    needsFit: false,         // true = ครั้งถัดไปที่วาด Mind Map ให้ปรับพอดีหน้าจอ
    busy: false,
    createContext: { targetNode: null, type: 'file' },
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
    'createModal', 'createModalTargetPath', 'createTypeFileBtn', 'createTypeFolderBtn', 'createModalInputName',
    'createModalNameLabel', 'submitCreateBtn', 'cancelCreateBtn', 'closeCreateModal',
    'deleteModal', 'deleteModalTargetName', 'deleteModalWarnSync', 'confirmDeleteBtn', 'cancelDeleteBtn',
    'asciiModal', 'asciiText', 'copyAsciiBtn', 'closeAsciiModal',
    'statsSidebar', 'toggleSidebarBtn', 'expandSidebarBtn',
    'toast', 'toastMsg', 'toastIcon',
    'statRootName', 'statSummary', 'statFilesCount', 'statFoldersCount', 'statTotalSize', 'extBreakdownList',
    'badgeFolderCount', 'badgeCodeCount', 'badgeMediaCount', 'badgeDocCount', 'badgeDataCount', 'badgeArchiveCount'
];

const ui = {};
for (const id of IDS) {
    ui[id] = document.getElementById(id);
    if (!ui[id]) console.error(`[FolderMind] ไม่พบ element #${id} ใน index.html`);
}

const show = (el) => el.classList.remove('hidden');
const hide = (el) => el.classList.add('hidden');
const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

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

    clearTimeout(toastTimer); // กัน toast เก่าที่ค้างอยู่มาซ่อน toast ใหม่ก่อนเวลา
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
   ข้อมูล: สถิติ / ตั้งต้นต้นไม้
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

/**
 * ตั้งต้นไม้ใหม่แล้ววาด
 * fresh = true  → โหลดโฟลเดอร์ใหม่ (ปรับพอดีหน้าจอ, ยุบชั้นลึกถ้าใหญ่มาก)
 * fresh = false → แค่รีเฟรชข้อมูล (คงตำแหน่ง/ซูมเดิม)
 * คืน true ถ้ามีการยุบโฟลเดอร์ชั้นลึกอัตโนมัติ
 */
function setTree(root, { fresh = true } = {}) {
    state.stats = analyze(root);
    state.treeData = root;

    let autoCollapsed = false;
    if (fresh) {
        const total = state.stats.totalFiles + state.stats.totalFolders;
        if (total > LARGE_TREE_THRESHOLD) { collapseDeep(root); autoCollapsed = true; }
        state.needsFit = true;
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
        name.append(dot, `.${ext}`); // ข้อความจากชื่อไฟล์ → append แบบ text เสมอ
        const badge = document.createElement('span');
        badge.className = 'font-mono text-[10px] text-slate-400 bg-slate-800 px-1.5 py-0.5 rounded';
        badge.textContent = String(count);
        row.append(name, badge);
        return row;
    }));
}

/* ==========================================================================
   มุมมอง & การวาด
   ========================================================================== */

const TAB_ON = 'flex items-center gap-2 px-3 py-1.5 rounded-lg transition-all text-white bg-indigo-600 shadow-md';
const TAB_OFF = 'flex items-center gap-2 px-3 py-1.5 rounded-lg text-slate-400 hover:text-slate-200 transition-all';

function switchView(view) {
    state.activeView = view;
    const isMap = view === 'mindmap';
    ui.viewMindmapBtn.className = isMap ? TAB_ON : TAB_OFF;
    ui.viewTreeBtn.className = isMap ? TAB_OFF : TAB_ON;
    ui.mindmapContainer.classList.toggle('hidden', !isMap);
    ui.treeContainer.classList.toggle('hidden', isMap);
    ui.mindmapControls.classList.toggle('hidden', !isMap);
    renderActiveView();
}

const viewHandlers = {
    onToggle: (node) => { node.collapsed = !node.collapsed; renderActiveView(); },
    onCreate: (node, type) => openCreateModal(node, type),
    onDelete: (node, parent) => openDeleteModal(node, parent),
    onFileClick: (node) => {
        if (state.activeView === 'tree') {
            copyText(node.path).then((ok) => showToast(ok ? `คัดลอกพาธแล้ว: ${node.path}` : 'คัดลอกไม่สำเร็จ', ok ? 'success' : 'error'));
        } else {
            showToast(`ไฟล์: ${node.path} (${formatBytes(node.size)})`, 'info');
        }
    }
};

const mindmapArgs = () => ({
    root: state.treeData, query: state.searchQuery,
    linesLayer: ui.linesLayer, nodesLayer: ui.nodesLayer, ...viewHandlers
});

function renderActiveView() {
    if (!state.treeData) return;
    if (state.activeView === 'mindmap') {
        state.bounds = renderMindmap(mindmapArgs());
        if (state.needsFit && state.bounds) { fitToScreen(); state.needsFit = false; }
        else applyTransform();
    } else {
        renderTree({
            root: state.treeData, query: state.searchQuery,
            container: ui.treeContent, pathLabel: ui.treePathNotice, ...viewHandlers
        });
    }
}

/** ขยายทั้งหมด / ยุบทั้งหมด (โฟลเดอร์รากเปิดไว้เสมอ) — วาดครั้งเดียว ไม่วาดซ้ำทุกโหนดเหมือนเดิม */
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
    state.panX = px - (px - state.panX) * k; // ซูมเข้าหาตำแหน่งเมาส์
    state.panY = py - (py - state.panY) * k;
    state.zoom = zoom;
    applyTransform();
}

function fitToScreen() {
    const { bounds } = state;
    const w = ui.mindmapContainer.clientWidth;
    const h = ui.mindmapContainer.clientHeight;
    if (!bounds || !w || !h) return;
    const pad = 40;
    const zoom = clamp(Math.min((w - pad * 2) / bounds.width, (h - pad * 2) / bounds.height, 1), MIN_ZOOM, MAX_ZOOM);
    state.zoom = zoom;
    state.panX = (w - bounds.width * zoom) / 2 - bounds.x * zoom;
    state.panY = (h - bounds.height * zoom) / 2 - bounds.y * zoom;
    applyTransform();
}

function setupPanZoom() {
    const container = ui.mindmapContainer;
    let drag = null;
    let suppressClick = false;

    container.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        drag = { offX: e.clientX - state.panX, offY: e.clientY - state.panY, x0: e.clientX, y0: e.clientY, moved: false };
    });
    window.addEventListener('pointermove', (e) => {
        if (!drag) return;
        if (!drag.moved && Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < 4) return;
        drag.moved = true;
        state.panX = e.clientX - drag.offX;
        state.panY = e.clientY - drag.offY;
        applyTransform();
    });
    const endDrag = () => {
        if (drag?.moved) {
            suppressClick = true; // กันไม่ให้การลากไปจบบนโหนดถูกนับเป็นคลิก (เดิมจะยุบ/ขยายโดยไม่ตั้งใจ)
            setTimeout(() => { suppressClick = false; }, 0);
        }
        drag = null;
    };
    window.addEventListener('pointerup', endDrag);
    window.addEventListener('pointercancel', endDrag);
    container.addEventListener('click', (e) => {
        if (suppressClick) { e.stopPropagation(); e.preventDefault(); }
    }, true);

    container.addEventListener('wheel', (e) => {
        e.preventDefault();
        const rect = container.getBoundingClientRect();
        zoomAt(e.clientX - rect.left, e.clientY - rect.top, e.deltaY < 0 ? 1.1 : 1 / 1.1);
    }, { passive: false });

    const zoomCenter = (factor) =>
        zoomAt(container.clientWidth / 2, container.clientHeight / 2, factor);
    ui.zoomInBtn.addEventListener('click', () => zoomCenter(1.2));
    ui.zoomOutBtn.addEventListener('click', () => zoomCenter(1 / 1.2));
    ui.zoomFitBtn.addEventListener('click', fitToScreen);
}

/* ==========================================================================
   โหลดโฟลเดอร์ (Live Sync / ลากวาง / เลือกไฟล์ / ตัวอย่าง)
   ========================================================================== */

/** state.busy กันกดซ้ำระหว่างที่งานเดิมยังทำไม่เสร็จ */
async function loadSource({ message, mode, handle = null, read }) {
    if (state.busy) return;
    state.busy = true;
    showToast(message, 'info');
    try {
        const tree = await read();
        if (!tree) { showToast('ไม่พบโฟลเดอร์ให้อ่าน (ลองลากโฟลเดอร์มาวาง)', 'error'); return; }
        // เปลี่ยนโหมดหลังอ่านสำเร็จเท่านั้น (เดิมเปลี่ยนก่อน ถ้าอ่านพลาดสถานะจะเพี้ยน)
        state.isLiveSync = mode === 'live';
        state.rootHandle = handle;
        const collapsed = setTree(tree, { fresh: true });
        setMode(mode);
        showToast(
            `โหลด "${tree.name}" แล้ว: ${state.stats.totalFiles.toLocaleString()} ไฟล์, ${state.stats.totalFolders.toLocaleString()} โฟลเดอร์`
            + (collapsed ? ' • ยุบโฟลเดอร์ชั้นลึกไว้เพราะมีรายการมาก' : ''),
            'success'
        );
    } catch (err) {
        console.error(err);
        showToast(`เกิดข้อผิดพลาด: ${err.message}`, 'error');
    } finally {
        state.busy = false;
    }
}

async function handleOpenLiveSync() {
    if (!isLiveSyncSupported()) {
        showToast('เบราว์เซอร์นี้ไม่รองรับ File System Sync โปรดใช้ Chrome, Edge หรือ Brave', 'error');
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

async function refreshFromDisk() {
    const collapsed = captureCollapsed(state.treeData);
    const tree = await readDirectoryHandle(state.rootHandle);
    restoreCollapsed(tree, collapsed); // เดิมการรีเฟรชทำให้โฟลเดอร์ที่ยุบไว้ถูกขยายหมด
    setTree(tree, { fresh: false });
}

/** หลังสร้าง/ลบสำเร็จ: อัปเดตหน้าจอ แล้วแจ้งผล */
async function applyChange(successMessage) {
    try {
        if (state.isLiveSync && state.rootHandle) await refreshFromDisk();
        else setTree(state.treeData, { fresh: false });
        showToast(successMessage, 'success');
    } catch (err) {
        console.error(err);
        showToast(`ทำรายการแล้ว แต่โหลดโฟลเดอร์ใหม่ไม่สำเร็จ: ${err.message}`, 'error');
    }
}

const hasFiles = (e) => Array.from(e.dataTransfer?.types ?? []).includes('Files');

function setupDragAndDrop() {
    window.addEventListener('dragover', (e) => {
        if (!hasFiles(e)) return; // ไม่แสดง overlay ตอนลากข้อความธรรมดา
        e.preventDefault();
        show(ui.dragHoverOverlay);
    });
    window.addEventListener('dragleave', (e) => {
        if (!e.relatedTarget) hide(ui.dragHoverOverlay); // ออกนอกหน้าต่าง
    });
    window.addEventListener('drop', (e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        hide(ui.dragHoverOverlay);
        // read() ต้องถูกเรียกแบบ synchronous ในนี้ (readDroppedItems ดึง entry ก่อน await)
        loadSource({
            message: 'กำลังอ่านโครงสร้างโฟลเดอร์ (ดูอย่างเดียว)...', mode: 'readonly',
            read: () => readDroppedItems(e.dataTransfer.items)
        });
    });
}

function handleFolderInput(e) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = ''; // ให้เลือกโฟลเดอร์เดิมซ้ำได้ (เดิม change จะไม่ยิงอีก)
    if (files.length === 0) return;
    loadSource({
        message: 'กำลังอ่านโฟลเดอร์ที่เลือก (ดูอย่างเดียว)...', mode: 'readonly',
        read: async () => readFileList(files)
    });
}

/* ==========================================================================
   Modal: สร้าง / ลบ / ASCII
   ========================================================================== */

const MODALS = () => [ui.createModal, ui.deleteModal, ui.asciiModal];
const closeAllModals = () => MODALS().forEach(hide);

const TYPE_BTN = 'flex items-center justify-center gap-2 py-2 px-3 rounded-xl border font-medium transition-all';
const TYPE_FILE_ON = `${TYPE_BTN} border-indigo-500 bg-indigo-600/20 text-indigo-200 shadow-sm`;
const TYPE_FOLDER_ON = `${TYPE_BTN} border-amber-500 bg-amber-500/20 text-amber-200 shadow-sm`;
const TYPE_OFF = `${TYPE_BTN} border-slate-800 bg-slate-900 text-slate-400`;

function setCreateType(type) {
    state.createContext.type = type;
    const isFile = type === 'file';
    ui.createTypeFileBtn.className = isFile ? TYPE_FILE_ON : TYPE_OFF;
    ui.createTypeFolderBtn.className = isFile ? TYPE_OFF : TYPE_FOLDER_ON;
    ui.createModalNameLabel.textContent = isFile
        ? 'ชื่อไฟล์ (ระบุนามสกุล เช่น script.js, index.html, notes.txt):'
        : 'ชื่อโฟลเดอร์ใหม่ (เช่น components, utils, assets):';
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
    if (invalid) { showToast(invalid, 'error'); return; } // เปิด modal ค้างไว้ให้แก้ชื่อ

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
    const label = type === 'file' ? 'ไฟล์' : 'โฟลเดอร์';
    await applyChange(state.isLiveSync
        ? `สร้าง${label} "${name}" ลงในเครื่องจริงแล้ว`
        : `สร้าง${label} "${name}" แล้ว (ในระบบจำลอง)`);
    state.busy = false;
}

function openDeleteModal(targetNode, parentNode) {
    state.deleteContext = { targetNode, parentNode };
    ui.deleteModalTargetName.textContent = targetNode.name;
    ui.deleteModalWarnSync.classList.toggle('hidden', !state.isLiveSync);
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
    await applyChange(state.isLiveSync
        ? `ลบ "${targetNode.name}" ออกจากดิสก์เครื่องจริงแล้ว`
        : `ลบ "${targetNode.name}" แล้ว (ในระบบจำลอง)`);
    state.busy = false;
}

/* ==========================================================================
   Export
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
    a.href = url;
    a.download = filename;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function copyText(text) {
    try {
        await navigator.clipboard.writeText(text);
        return true;
    } catch { // เช่น ไม่ใช่ secure context หรือไม่ได้รับอนุญาต → ลองวิธีสำรอง
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.cssText = 'position:fixed;opacity:0';
        document.body.append(ta);
        ta.select();
        let ok = false;
        try { ok = document.execCommand('copy'); } catch { /* ignore */ }
        ta.remove();
        return ok;
    }
}

/**
 * สร้าง SVG สำหรับส่งออกจากต้นไม้ทั้งหมด (ไม่ขึ้นกับตำแหน่งแพน/ซูมหรือมุมมองที่เปิดอยู่)
 * เดิม: ส่งออกตามหน้าจอที่เห็น จึงอาจตัดขอบ/ว่างเปล่า และไฟล์ SVG ไม่มี xmlns เปิดนอกเบราว์เซอร์ไม่ได้
 */
function buildExportSvg() {
    const bounds = renderMindmap(mindmapArgs());
    if (!bounds) return null;

    const pad = 40;
    const x = bounds.x - pad, y = bounds.y - pad;
    const w = Math.ceil(bounds.width + pad * 2), h = Math.ceil(bounds.height + pad * 2);

    const clone = ui.mindmapSvg.cloneNode(true);
    clone.removeAttribute('class');
    clone.removeAttribute('id');
    clone.querySelectorAll('.node-actions, .node-toggle').forEach((el) => el.remove());
    const group = clone.querySelector('#viewportGroup');
    group.removeAttribute('transform');
    group.removeAttribute('id');

    const bg = document.createElementNS(SVG_NS, 'rect');
    for (const [k, v] of Object.entries({ x, y, width: w, height: h, fill: '#090d16' })) bg.setAttribute(k, v);
    clone.insertBefore(bg, group);

    clone.setAttribute('xmlns', SVG_NS);
    clone.setAttribute('viewBox', `${x} ${y} ${w} ${h}`);
    clone.setAttribute('width', w);
    clone.setAttribute('height', h);
    clone.setAttribute('font-family', "system-ui, -apple-system, 'Segoe UI', Roboto, 'Noto Sans Thai', sans-serif");

    return { markup: new XMLSerializer().serializeToString(clone), width: w, height: h };
}

function exportAsSVG() {
    const svg = buildExportSvg();
    if (!svg) { showToast('ไม่มีข้อมูลให้ส่งออก (ลองล้างคำค้นหา)', 'error'); return; }
    downloadBlob(new Blob([svg.markup], { type: 'image/svg+xml;charset=utf-8' }), `${safeName(state.treeData.name)}-mindmap.svg`);
    showToast('ดาวน์โหลดไฟล์ SVG แล้ว', 'success');
}

function exportAsPNG() {
    const svg = buildExportSvg();
    if (!svg) { showToast('ไม่มีข้อมูลให้ส่งออก (ลองล้างคำค้นหา)', 'error'); return; }
    showToast('กำลังสร้างไฟล์ PNG...', 'info');

    // ขนาด canvas ต้องไม่เกินขีดจำกัดของเบราว์เซอร์
    const scale = Math.min(2, 8192 / svg.width, 8192 / svg.height, Math.sqrt(64e6 / (svg.width * svg.height)));
    const url = URL.createObjectURL(new Blob([svg.markup], { type: 'image/svg+xml;charset=utf-8' }));
    const img = new Image();
    img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.floor(svg.width * scale));
        canvas.height = Math.max(1, Math.floor(svg.height * scale));
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((blob) => {
            URL.revokeObjectURL(url);
            if (!blob) { showToast('สร้างไฟล์ PNG ไม่สำเร็จ (ภาพใหญ่เกินไป)', 'error'); return; }
            downloadBlob(blob, `${safeName(state.treeData.name)}-mindmap.png`);
            showToast('ดาวน์โหลดไฟล์ PNG แล้ว', 'success');
        }, 'image/png');
    };
    img.onerror = () => {
        URL.revokeObjectURL(url);
        showToast('สร้างไฟล์ PNG ไม่สำเร็จ', 'error');
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
    showToast(ok ? 'คัดลอกโครงสร้าง ASCII แล้ว' : 'คัดลอกไม่สำเร็จ ลองเลือกข้อความแล้วกด Ctrl+C', ok ? 'success' : 'error');
    if (ok) hide(ui.asciiModal);
}

function exportAsJSON() {
    if (!state.treeData) return;
    const json = JSON.stringify(state.treeData, (key, val) => (key === 'handle' ? undefined : val), 2);
    downloadBlob(new Blob([json], { type: 'application/json' }), `${safeName(state.treeData.name)}-structure.json`);
    showToast('ดาวน์โหลดไฟล์ JSON แล้ว', 'success');
}

/* ==========================================================================
   ผูก Event & เริ่มต้น
   ========================================================================== */

function bindEvents() {
    // เปิดโฟลเดอร์
    ui.openLiveSyncBtn.addEventListener('click', handleOpenLiveSync);
    ui.heroLiveSyncBtn.addEventListener('click', handleOpenLiveSync);
    ui.selectFolderBtn.addEventListener('click', () => ui.folderInput.click());
    ui.heroUploadBtn.addEventListener('click', () => ui.folderInput.click());
    ui.folderInput.addEventListener('change', handleFolderInput);
    ui.demoDataBtn.addEventListener('click', () => loadSource({
        message: 'กำลังโหลดข้อมูลตัวอย่าง...', mode: 'demo', read: async () => buildDemoTree()
    }));
    setupDragAndDrop();

    // มุมมอง
    ui.viewMindmapBtn.addEventListener('click', () => switchView('mindmap'));
    ui.viewTreeBtn.addEventListener('click', () => switchView('tree'));

    // ค้นหา (หน่วงเล็กน้อยเพื่อไม่ให้วาดใหม่ทุกตัวอักษรในโฟลเดอร์ใหญ่)
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
        ui.searchInput.value = '';
        state.searchQuery = '';
        hide(ui.clearSearchBtn);
        renderActiveView();
    });

    ui.expandAllBtn.addEventListener('click', () => setAllCollapsed(false));
    ui.collapseAllBtn.addEventListener('click', () => setAllCollapsed(true));

    // เมนู Export
    ui.exportMenuBtn.addEventListener('click', (e) => { e.stopPropagation(); ui.exportDropdown.classList.toggle('hidden'); });
    document.addEventListener('click', () => hide(ui.exportDropdown));
    ui.exportPngBtn.addEventListener('click', exportAsPNG);
    ui.exportSvgBtn.addEventListener('click', exportAsSVG);
    ui.exportAsciiBtn.addEventListener('click', openAsciiModal);
    ui.exportJsonBtn.addEventListener('click', exportAsJSON);
    ui.copyAsciiBtn.addEventListener('click', copyAscii);
    ui.closeAsciiModal.addEventListener('click', () => hide(ui.asciiModal));

    // Modal สร้าง / ลบ
    ui.createTypeFileBtn.addEventListener('click', () => setCreateType('file'));
    ui.createTypeFolderBtn.addEventListener('click', () => setCreateType('folder'));
    ui.submitCreateBtn.addEventListener('click', submitCreate);
    ui.cancelCreateBtn.addEventListener('click', () => hide(ui.createModal));
    ui.closeCreateModal.addEventListener('click', () => hide(ui.createModal));
    ui.confirmDeleteBtn.addEventListener('click', confirmDelete);
    ui.cancelDeleteBtn.addEventListener('click', () => hide(ui.deleteModal));

    // คลิกพื้นหลังเพื่อปิด / Esc ปิด / Enter ยืนยันการสร้าง
    for (const modal of MODALS()) {
        modal.addEventListener('click', (e) => { if (e.target === modal) hide(modal); });
    }
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { closeAllModals(); hide(ui.exportDropdown); }
        if (e.key === 'Enter' && e.target === ui.createModalInputName) { e.preventDefault(); submitCreate(); }
    });

    // แถบด้านข้าง
    ui.toggleSidebarBtn.addEventListener('click', () => {
        ui.statsSidebar.classList.add('-ml-64');
        show(ui.expandSidebarBtn);
    });
    ui.expandSidebarBtn.addEventListener('click', () => {
        ui.statsSidebar.classList.remove('-ml-64');
        hide(ui.expandSidebarBtn);
    });

    // ดักข้อผิดพลาดที่หลุดมา แทนที่จะเงียบหาย
    window.addEventListener('unhandledrejection', (e) => {
        console.error(e.reason);
        showToast(`เกิดข้อผิดพลาด: ${e.reason?.message ?? e.reason}`, 'error');
    });
}

function init() {
    if (!isLiveSyncSupported()) show(ui.fsApiNotSupportedNotice);
    bindEvents();
    setupPanZoom();
    updateExportState();
}

init();