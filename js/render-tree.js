/**
 * render-tree.js
 * วาด Mind Map (SVG) และ Tree View (DOM) จากข้อมูลต้นไม้
 * ไม่เก็บ state ของแอป: รับข้อมูลและ callback เข้ามา แล้วคืนผลลัพธ์
 * ข้อความที่มาจากชื่อไฟล์ใช้ textContent เสมอ (ไม่ใช้ innerHTML) เพื่อกัน XSS
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

/* ---------- ตัวช่วยสร้าง element ---------- */

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

/* ---------- ตัวกรองค้นหา ---------- */

/** คืนฟังก์ชันตรวจว่าโหนด (หรือลูกหลาน) ตรงกับคำค้นหรือไม่ — memoize ต่อการวาด 1 ครั้ง */
function createMatcher(query) {
    if (!query) return () => true;
    const cache = new Map();
    const test = (node) => {
        if (cache.has(node)) return cache.get(node);
        const hit = node.name.toLowerCase().includes(query)
            || (node.extension ?? '').includes(query)
            || (node.children?.some(test) ?? false);
        cache.set(node, hit);
        return hit;
    };
    return test;
}

const isNameMatch = (node, query) => Boolean(query) && node.name.toLowerCase().includes(query);

/** ตอนค้นหาจะเปิดโฟลเดอร์ที่ยุบอยู่ให้เห็นผลลัพธ์ (เดิมผลลัพธ์ในโฟลเดอร์ที่ยุบจะหายไป) */
const isOpen = (node, query) => node.type === 'directory' && (!node.collapsed || Boolean(query));

/* ==========================================================================
   Mind Map (SVG)
   ========================================================================== */

const NODE_W = 160;
const NODE_H = 36;
const H_GAP = 230;
const V_GAP = 48;
const MAX_LABEL = 13;

function actionButton({ x, stroke, color, glyph, size, title, onClick }) {
    // ชั้นนอกถือตำแหน่ง (translate) ชั้นในถือเอฟเฟกต์ hover (scale)
    // ถ้ารวมกัน CSS transform จะทับ attribute ทำให้ปุ่มกระโดดหนีเมาส์ตอน hover
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

/**
 * วาด Mind Map ลงใน linesLayer / nodesLayer
 * คืนค่า bounds { x, y, width, height } ของเนื้อหา (หน่วยเดียวกับพิกัดใน viewportGroup)
 * หรือ null ถ้าไม่มีอะไรให้วาด
 */
export function renderMindmap({ root, query, linesLayer, nodesLayer, onToggle, onCreate, onDelete, onFileClick }) {
    linesLayer.replaceChildren();
    nodesLayer.replaceChildren();
    if (!root) return null;

    const matches = createMatcher(query);
    let leafY = 0;

    // 1) จัดวาง: ใบอยู่เรียงกัน, พ่อแม่อยู่กึ่งกลางลูก
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

    // 2) จัดให้กึ่งกลางแนวตั้งอยู่ที่ y = 0 และคำนวณขอบเขต
    let minY = Infinity, maxY = -Infinity, maxX = 0;
    for (const n of flat) {
        if (n.y < minY) minY = n.y;
        if (n.y > maxY) maxY = n.y;
        if (n.x > maxX) maxX = n.x;
    }
    const centerY = (minY + maxY) / 2;
    for (const n of flat) n.y -= centerY;

    // 3) วาด
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

        const g = svg('g', { class: 'mindmap-node', transform: `translate(${n.x}, ${n.y - NODE_H / 2})` });
        const hit = isNameMatch(data, query);

        const rect = svg('rect', {
            width: NODE_W, height: NODE_H, rx: 10, fill: '#111726',
            stroke: hit ? '#38bdf8' : colors.stroke,
            'stroke-width': hit ? 2.5 : 1.5, 'stroke-opacity': 0.85
        });
        if (hit) rect.setAttribute('filter', 'url(#glow)');

        const label = data.name.length > MAX_LABEL ? `${data.name.slice(0, MAX_LABEL - 2)}..` : data.name;
        g.append(
            svg('title', {}, data.skipped ? `${data.path} (ไม่อ่านเนื้อหาข้างใน)` : data.path),
            rect,
            svg('circle', { cx: 14, cy: 18, r: 4.5, fill: colors.stroke }),
            svg('text', {
                x: 25, y: 22, fill: '#e2e8f0', 'font-size': 11,
                'font-weight': data.type === 'directory' ? 600 : 400
            }, label)
        );

        // ปุ่มจัดการ (CSS ทำให้โผล่ตอน hover)
        const actions = svg('g', { class: 'node-actions', transform: 'translate(100, 8)' });
        if (data.type === 'directory') {
            actions.append(
                actionButton({ x: 0, stroke: '#06b6d4', color: '#22d3ee', glyph: '+', size: 10, title: 'สร้างไฟล์ใหม่', onClick: () => onCreate(data, 'file') }),
                actionButton({ x: 18, stroke: '#f59e0b', color: '#fbbf24', glyph: '📁', size: 8, title: 'สร้างโฟลเดอร์ย่อย', onClick: () => onCreate(data, 'folder') })
            );
        }
        if (n.parent) {
            actions.append(
                actionButton({ x: 36, stroke: '#f43f5e', color: '#fb7185', glyph: '✕', size: 8, title: 'ลบรายการนี้', onClick: () => onDelete(data, n.parent) })
            );
        }
        g.append(actions);

        // ปุ่มยุบ/ขยาย
        if (data.type === 'directory' && data.children?.length > 0) {
            const toggle = svg('g', { class: 'node-toggle', transform: 'translate(154, 11)' });
            toggle.append(
                svg('circle', { cx: 7, cy: 7, r: 7, fill: '#1e293b', stroke: colors.stroke, 'stroke-width': 1 }),
                svg('text', { x: 7, y: 10.5, 'text-anchor': 'middle', fill: '#ffffff', 'font-size': 10, 'font-weight': 'bold' },
                    data.collapsed ? '+' : '−')
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
const TRASH_PATH = 'M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16';

/** ไอคอนทั้งหมดเป็นข้อความคงที่ในโค้ด (ไม่มีข้อมูลจากผู้ใช้) จึงใช้ innerHTML ได้อย่างปลอดภัย */
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

export function renderTree({ root, query, container, pathLabel, onToggle, onCreate, onDelete, onFileClick }) {
    container.replaceChildren();
    if (!root) return;
    pathLabel.textContent = `ตำแหน่ง: ${root.path}`;

    const matches = createMatcher(query);

    function build(node, depth, parent) {
        if (!matches(node)) return null;

        const isDir = node.type === 'directory';
        const colors = colorsFor(node);
        const wrapper = html('div', 'select-none');

        const row = html('div', `tree-row flex items-center justify-between py-1.5 px-2 rounded-lg cursor-pointer my-0.5 border ${
            isNameMatch(node, query) ? 'border-cyan-500 bg-cyan-950/30' : 'border-transparent hover:border-slate-800'}`);
        row.style.paddingLeft = `${depth * 20 + 8}px`;
        row.title = node.path;

        // ซ้าย: ลูกศร + ไอคอน + ชื่อ
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

        // ขวา: จำนวน/ขนาด + ปุ่มลัด
        const right = html('div', 'flex items-center gap-1 shrink-0 font-mono text-xs');
        if (isDir) {
            const label = node.skipped ? 'ไม่อ่านเนื้อหา' : `${node.children?.length ?? 0} รายการ`;
            right.append(html('span', 'bg-slate-800 text-slate-400 px-2 py-0.5 rounded-full text-[10px] mr-1', label));
            right.append(
                iconButton('hover:bg-cyan-500/20 text-cyan-400', 'สร้างไฟล์ใหม่ในโฟลเดอร์นี้', PLUS_PATH, () => onCreate(node, 'file')),
                iconButton('hover:bg-amber-500/20 text-amber-400', 'สร้างโฟลเดอร์ย่อย', NEW_FOLDER_PATH, () => onCreate(node, 'folder'))
            );
        } else {
            right.append(html('span', 'text-slate-500 text-[11px] mr-2', formatBytes(node.size)));
        }
        if (parent) {
            right.append(iconButton('hover:bg-rose-500/20 text-rose-400', 'ลบรายการนี้', TRASH_PATH, () => onDelete(node, parent)));
        }
        row.append(right);

        row.addEventListener('click', (e) => {
            e.stopPropagation();
            if (isDir) onToggle(node);
            else onFileClick(node);
        });
        wrapper.append(row);

        if (isDir && isOpen(node, query) && node.children?.length) {
            const kids = html('div', 'border-l border-slate-800/80 ml-4');
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

/* ==========================================================================
   ASCII Tree
   ========================================================================== */

export function generateAsciiTree(node, prefix = '') {
    if (!node) return '';
    let result = `${node.name}${node.type === 'directory' ? '/' : ''}\n`;
    const kids = node.type === 'directory' ? node.children ?? [] : [];
    kids.forEach((child, index) => {
        const last = index === kids.length - 1;
        result += `${prefix}${last ? '└── ' : '├── '}${generateAsciiTree(child, prefix + (last ? '    ' : '│   '))}`;
    });
    return result;
}