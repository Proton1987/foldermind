/**
 * render-tree.js (Pro v3.1)
 * วาด Mind Map และ Tree View พร้อมแสดงขนาดโฟลเดอร์และรองรับการกรองหมวดหมู่
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

export const CATEGORY_COLORS = {
    folder: { stroke: '#f59e0b', fill: 'rgba(245, 158, 11, 0.15)', text: '#fbbf24', border: '#b45309' },
    code: { stroke: '#06b6d4', fill: 'rgba(6, 182, 212, 0.15)', text: '#22d3ee', border: '#0e7490' },
    media: { stroke: '#a855f7', fill: 'rgba(168, 85, 247, 0.15)', text: '#c084fc', border: '#7e22ce' },
    docs: { stroke: '#10b981', fill: 'rgba(16, 185, 129, 0.15)', text: '#34d399', border: '#047857' },
    data: { stroke: '#f97316', fill: 'rgba(249, 115, 22, 0.15)', text: '#fb923c', border: '#c2410c' },
    archives: { stroke: '#f43f5e', fill: 'rgba(244, 63, 94, 0.15)', text: '#fb7185', border: '#be123c' },
    other: { stroke: '#94a3b8', fill: 'rgba(148, 163, 184, 0.15)', text: '#cbd5e1', border: '#475569' }
};

const colorsFor = (node) =>
    CATEGORY_COLORS[node.category || (node.type === 'directory' ? 'folder' : 'other')] ?? CATEGORY_COLORS.other;

export function formatBytes(bytes) {
    if (!bytes || bytes < 1) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    return `${parseFloat((bytes / 1024 ** i).toFixed(1))} ${units[i]}`;
}

function svg(tag, attrs = {}, text) {
    const el = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    if (text !== undefined) el.textContent = text;
    return el;
}

function html(tag, className = '', text) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text !== undefined) el.textContent = text;
    return el;
}

/** ตัวกรองค้นหาและกรองตามประเภทหมวดหมู่ (ข้อ 5) */
function createMatcher(query, filterCategory) {
    return (node) => {
        // กรองตามหมวดหมู่ถ้ามีการเลือกไว้
        const matchCategory = !filterCategory || node.category === filterCategory || (filterCategory === 'folder' && node.type === 'directory');
        if (!matchCategory && node.type === 'file') return false;

        if (!query) return true;
        const hit = node.name.toLowerCase().includes(query)
            || (node.extension ?? '').includes(query)
            || (node.children?.some(c => createMatcher(query, filterCategory)(c)) ?? false);
        return hit;
    };
}

const isNameMatch = (node, query) => Boolean(query) && node.name.toLowerCase().includes(query);
const isOpen = (node, query) => node.type === 'directory' && (!node.collapsed || Boolean(query));

/* ==========================================================================
   Mind Map (SVG)
   ========================================================================== */

const NODE_W = 175;
const NODE_H = 38;
const H_GAP = 240;
const V_GAP = 50;
const MAX_LABEL = 13;

function actionButton({ x, stroke, color, glyph, size, title, onClick }) {
    const outer = svg('g', { transform: `translate(${x}, 0)` });
    const inner = svg('g', { class: 'node-action-btn' });
    inner.append(
        svg('title', {}, title),
        svg('circle', { cx: 9, cy: 10, r: 7.5, fill: '#1e293b', stroke, 'stroke-width': 1 }),
        svg('text', { x: 9, y: 13.5, 'text-anchor': 'middle', fill: color, 'font-size': size, 'font-weight': 'bold', 'pointer-events': 'none' }, glyph)
    );
    outer.append(inner);
    outer.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
    return outer;
}

export function renderMindmap({ root, query, filterCategory, activeNode, linesLayer, nodesLayer, onToggle, onCreate, onDelete, onRename, onFileClick }) {
    linesLayer.replaceChildren();
    nodesLayer.replaceChildren();
    if (!root) return null;

    const matches = createMatcher(query, filterCategory);
    let leafY = 0;

    function layout(node, depth, parent) {
        if (!matches(node)) return null;
        const kids = isOpen(node, query) && node.children
            ? node.children.map((c) => layout(c, depth + 1, node)).filter(Boolean)
            : [];
        let y;
        if (kids.length === 0) { y = leafY; leafY += V_GAP; }
        else y = (kids[0].y + kids[kids.length - 1].y) / 2;
        return { data: node, parent, x: depth * H_GAP, y, kids };
    }

    const top = layout(root, 0, null);
    if (!top) return null;

    const flat = [];
    (function collect(n) { flat.push(n); n.kids.forEach(collect); })(top);

    let minY = Infinity, maxY = -Infinity, maxX = 0;
    for (const n of flat) {
        if (n.y < minY) minY = n.y;
        if (n.y > maxY) maxY = n.y;
        if (n.x > maxX) maxX = n.x;
    }
    const centerY = (minY + maxY) / 2;
    for (const n of flat) n.y -= centerY;

    for (const n of flat) {
        const { data } = n;
        const colors = colorsFor(data);

        for (const kid of n.kids) {
            const sx = n.x + NODE_W;
            const dx = (kid.x - sx) * 0.5;
            linesLayer.append(svg('path', {
                d: `M ${sx} ${n.y} C ${sx + dx} ${n.y}, ${kid.x - dx} ${kid.y}, ${kid.x} ${kid.y}`,
                fill: 'none', stroke: colors.stroke, 'stroke-width': 2, 'stroke-opacity': 0.6,
                class: 'connection-line'
            }));
        }

        const g = svg('g', { class: data === activeNode ? 'mindmap-node is-active' : 'mindmap-node', transform: `translate(${n.x}, ${n.y - NODE_H / 2})` });
        const hit = isNameMatch(data, query);

        const rect = svg('rect', {
            width: NODE_W, height: NODE_H, rx: 10, fill: '#111726',
            stroke: hit ? '#38bdf8' : colors.stroke,
            'stroke-width': hit ? 2.5 : 1.5, 'stroke-opacity': 0.85
        });
        if (hit) rect.setAttribute('filter', 'url(#glow)');

        const label = data.name.length > MAX_LABEL ? `${data.name.slice(0, MAX_LABEL - 2)}..` : data.name;
        // แสดงขนาดไฟล์หรือโฟลเดอร์ต่อท้าย (ข้อ 6)
        const sizeStr = formatBytes(data.size);

        g.append(
            svg('title', {}, `${data.path} (${sizeStr})`),
            rect,
            svg('circle', { cx: 14, cy: 19, r: 4.5, fill: colors.stroke }),
            svg('text', { x: 25, y: 17, fill: '#e2e8f0', 'font-size': 11, 'font-weight': data.type === 'directory' ? 600 : 400 }, label),
            svg('text', { x: 25, y: 30, fill: '#94a3b8', 'font-size': 9, 'font-family': 'monospace' }, sizeStr)
        );

        const actions = svg('g', { class: 'node-actions', transform: 'translate(92, 9)' });
        if (data.type === 'directory') {
            actions.append(
                actionButton({ x: 0, stroke: '#06b6d4', color: '#22d3ee', glyph: '+', size: 10, title: 'สร้างไฟล์ใหม่', onClick: () => onCreate(data, 'file') }),
                actionButton({ x: 18, stroke: '#f59e0b', color: '#fbbf24', glyph: '📁', size: 8, title: 'สร้างโฟลเดอร์', onClick: () => onCreate(data, 'folder') })
            );
        }
        actions.append(
            actionButton({ x: data.type === 'directory' ? 36 : 0, stroke: '#38bdf8', color: '#38bdf8', glyph: '✏️', size: 8, title: 'เปลี่ยนชื่อ', onClick: () => onRename(data, n.parent) })
        );
        if (n.parent) {
            actions.append(
                actionButton({ x: data.type === 'directory' ? 54 : 18, stroke: '#f43f5e', color: '#fb7185', glyph: '✕', size: 8, title: 'ลบ', onClick: () => onDelete(data, n.parent) })
            );
        }
        g.append(actions);

        if (data.type === 'directory' && data.children?.length > 0) {
            const toggle = svg('g', { class: 'node-toggle', transform: 'translate(156, 12)' });
            toggle.append(
                svg('circle', { cx: 7, cy: 7, r: 7, fill: '#1e293b', stroke: colors.stroke, 'stroke-width': 1 }),
                svg('text', { x: 7, y: 10.5, 'text-anchor': 'middle', fill: '#ffffff', 'font-size': 10, 'font-weight': 'bold' }, data.collapsed ? '+' : '−')
            );
            toggle.addEventListener('click', (e) => { e.stopPropagation(); onToggle(data); });
            g.append(toggle);
        }

        g.addEventListener('click', (e) => {
            e.stopPropagation();
            if (data.type === 'directory') onToggle(data);
            else onFileClick(data);
        });

        nodesLayer.append(g);
    }

    return { x: 0, y: minY - centerY - NODE_H / 2, width: maxX + NODE_W + 8, height: maxY - minY + NODE_H };
}

/* ==========================================================================
   Tree View (DOM)
   ========================================================================== */

const ICON_PATHS = {
    code: 'M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4',
    media: 'M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z',
    docs: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z',
    data: 'M4 7v10c0 2 1.5 3 3.5 3h9c2 0 3.5-1 3.5-3V7c0-2-1.5-3-3.5-3h-9C5.5 4 4 5 4 7z',
    archives: 'M5 8h14M5 8a2 2 0 01-2-2V5a2 2 0 012-2h14a2 2 0 012 2v1a2 2 0 01-2 2M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4',
    other: 'M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z'
};
const PLUS_PATH = 'M12 4v16m8-8H4';
const NEW_FOLDER_PATH = 'M9 13h6m-3-3v6m-9 1V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z';
const RENAME_PATH = 'M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z';
const TRASH_PATH = 'M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16';

function strokeIcon(pathD) {
    return `<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="${pathD}"></path></svg>`;
}

function categoryIcon(category) {
    if (category === 'folder') {
        return '<svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z"></path></svg>';
    }
    const d = ICON_PATHS[category] ?? ICON_PATHS.other;
    return `<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="${d}"></path></svg>`;
}

function iconButton(className, title, pathD, onClick) {
    const btn = html('button', `p-1 rounded transition-colors ${className}`);
    btn.type = 'button';
    btn.title = title;
    btn.setAttribute('aria-label', title);
    btn.innerHTML = strokeIcon(pathD);
    btn.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
    return btn;
}

export function renderTree({ root, query, filterCategory, container, pathLabel, onToggle, onCreate, onDelete, onRename, onFileClick }) {
    container.replaceChildren();
    if (!root) return;
    pathLabel.textContent = `ตำแหน่ง: ${root.path}`;

    const matches = createMatcher(query, filterCategory);

    function build(node, depth, parent) {
        if (!matches(node)) return null;

        const isDir = node.type === 'directory';
        const colors = colorsFor(node);
        const wrapper = html('div', 'select-none');

        const row = html('div', `tree-row flex items-center justify-between py-1.5 px-2 rounded-lg cursor-pointer my-0.5 border ${
            isNameMatch(node, query) ? 'border-cyan-500 bg-cyan-950/30' : 'border-transparent hover:border-slate-800'}`);
        row.style.setProperty('--depth', depth);
        row.title = node.path;

        const left = html('div', 'flex items-center gap-2 overflow-hidden mr-2');
        if (isDir) {
            left.append(html('span', `text-slate-400 text-xs transition-transform duration-200 ${isOpen(node, query) ? 'rotate-90' : ''}`, '▶'));
        } else {
            left.append(html('span', 'w-3'));
        }
        const icon = html('span');
        icon.style.color = colors.stroke;
        icon.innerHTML = categoryIcon(node.category || (isDir ? 'folder' : 'other'));
        left.append(icon, html('span', `truncate ${isDir ? 'font-semibold text-slate-200' : 'text-slate-300'}`, node.name));
        row.append(left);

        const right = html('div', 'flex items-center gap-1 shrink-0 font-mono text-xs');
        // แสดงขนาดโฟลเดอร์/ไฟล์ใน Tree View ด้วย (ข้อ 6)
        right.append(html('span', 'text-slate-400 text-[11px] mr-2', formatBytes(node.size)));

        if (isDir) {
            right.append(
                iconButton('hover:bg-cyan-500/20 text-cyan-400', 'สร้างไฟล์', PLUS_PATH, () => onCreate(node, 'file')),
                iconButton('hover:bg-amber-500/20 text-amber-400', 'สร้างโฟลเดอร์', NEW_FOLDER_PATH, () => onCreate(node, 'folder'))
            );
        }
        if (parent) {
            right.append(
                iconButton('hover:bg-sky-500/20 text-sky-400', 'เปลี่ยนชื่อ', RENAME_PATH, () => onRename(node, parent)),
                iconButton('hover:bg-rose-500/20 text-rose-400', 'ลบ', TRASH_PATH, () => onDelete(node, parent))
            );
        }
        row.append(right);

        row.addEventListener('click', (e) => {
            e.stopPropagation();
            if (isDir) onToggle(node);
            else onFileClick(node);
        });
        wrapper.append(row);

        if (isDir && isOpen(node, query) && node.children?.length) {
            const kids = html('div', 'tree-children');
            for (const child of node.children) {
                const el = build(child, depth + 1, node);
                if (el) kids.append(el);
            }
            wrapper.append(kids);
        }
        return wrapper;
    }

    const dom = build(root, 0, null);
    if (dom) container.append(dom);
}

export function generateAsciiTree(node, prefix = '') {
    if (!node) return '';
    let result = `${node.name}${node.type === 'directory' ? '/' : ''} (${formatBytes(node.size)})\n`;
    const kids = node.type === 'directory' ? node.children ?? [] : [];
    kids.forEach((child, index) => {
        const last = index === kids.length - 1;
        result += `${prefix}${last ? '└── ' : '├── '}${generateAsciiTree(child, prefix + (last ? '    ' : '│   '))}`;
    });
    return result;
}