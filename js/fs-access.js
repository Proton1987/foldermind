/**
 * fs-access.js (Pro v3.1)
 * รองรับการอ่าน/เขียน, คำนวณขนาดโฟลเดอร์, เปลี่ยนชื่อ (Rename) และย้ายไฟล์ (Move)
 */

const EXTENSION_CATEGORIES = {
    js: 'code', mjs: 'code', ts: 'code', jsx: 'code', tsx: 'code', py: 'code', html: 'code', css: 'code',
    scss: 'code', cpp: 'code', c: 'code', h: 'code', cs: 'code', java: 'code', rb: 'code',
    php: 'code', go: 'code', rs: 'code', vue: 'code', svelte: 'code', sh: 'code', sql: 'code',
    png: 'media', jpg: 'media', jpeg: 'media', gif: 'media', svg: 'media', webp: 'media',
    ico: 'media', mp4: 'media', mp3: 'media', wav: 'media', mov: 'media', avi: 'media',
    pdf: 'docs', md: 'docs', txt: 'docs', doc: 'docs', docx: 'docs', xls: 'docs', xlsx: 'docs',
    ppt: 'docs', pptx: 'docs', epub: 'docs',
    json: 'data', xml: 'data', yaml: 'data', yml: 'data', csv: 'data', env: 'data',
    toml: 'data', lock: 'data', config: 'data',
    zip: 'archives', tar: 'archives', gz: 'archives', '7z': 'archives', rar: 'archives', bz2: 'archives'
};

export const IGNORED_DIRS = new Set(['node_modules', '.git']);

export function getExtension(filename) {
    const parts = filename.split('.');
    if (parts.length < 2 || (parts.length === 2 && parts[0] === '')) return '';
    return parts.pop().toLowerCase();
}

export function getCategory(ext) {
    return ext && Object.hasOwn(EXTENSION_CATEGORIES, ext) ? EXTENSION_CATEGORIES[ext] : 'other';
}

export const isLiveSyncSupported = () =>
    typeof window !== 'undefined' && 'showDirectoryPicker' in window;

function makeFile(name, path, size = 0, handle) {
    const extension = getExtension(name);
    const node = { name, type: 'file', path, size, extension, category: getCategory(extension), collapsed: false };
    if (handle) node.handle = handle;
    return node;
}

function makeDir(name, path, children = [], handle) {
    const node = { name, type: 'directory', path, children, category: 'folder', collapsed: false, size: 0 };
    if (handle) node.handle = handle;
    return node;
}

const joinPath = (parent, name) => (parent ? `${parent}/${name}` : name);
const shouldSkip = (name, parentPath) => Boolean(parentPath) && IGNORED_DIRS.has(name);

function createLimiter(max) {
    let active = 0;
    const queue = [];
    const next = () => {
        if (active >= max || queue.length === 0) return;
        active++;
        const { fn, resolve, reject } = queue.shift();
        fn().then(resolve, reject).finally(() => { active--; next(); });
    };
    return (fn) => new Promise((resolve, reject) => { queue.push({ fn, resolve, reject }); next(); });
}

export async function pickLiveDirectory() {
    return window.showDirectoryPicker({ mode: 'readwrite' });
}

/** คำนวณขนาดรวมของโฟลเดอร์ และจัดเรียงรายการ (ข้อ 6) */
export function calculateFolderSizes(node) {
    if (node.type === 'file') return node.size || 0;
    let totalSize = 0;
    if (node.children) {
        for (const child of node.children) {
            totalSize += calculateFolderSizes(child);
        }
    }
    node.size = totalSize;
    return totalSize;
}

export async function readDirectoryHandle(rootHandle, { onProgress } = {}) {
    const limit = createLimiter(32);
    let count = 0;

    async function walk(handle, parentPath) {
        const path = joinPath(parentPath, handle.name);

        if (handle.kind === 'file') {
            let size = 0;
            try {
                size = (await limit(() => handle.getFile())).size;
            } catch { /* ignore */ }
            onProgress?.(++count);
            return makeFile(handle.name, path, size, handle);
        }

        let children = [];
        const skipped = shouldSkip(handle.name, parentPath);
        if (!skipped) {
            try {
                const entries = [];
                for await (const entry of handle.values()) entries.push(entry);
                children = await Promise.all(entries.map((e) => walk(e, path)));
            } catch (err) {
                console.warn(`อ่านโฟลเดอร์ไม่ได้: ${path}`, err);
            }
        }
        const dir = makeDir(handle.name, path, children, handle);
        if (skipped) dir.skipped = true;
        return dir;
    }

    const rootNode = await walk(rootHandle, '');
    calculateFolderSizes(rootNode); // คำนวณขนาดรวม
    return rootNode;
}

const INVALID_NAME = /[\\/:*?"<>|\u0000-\u001f]/;

export function validateEntryName(name) {
    if (!name) return 'โปรดระบุชื่อไฟล์หรือโฟลเดอร์';
    if (name === '.' || name === '..') return 'ชื่อ "." และ ".." ใช้ไม่ได้';
    if (INVALID_NAME.test(name)) return 'ชื่อห้ามมีอักขระ \\ / : * ? " < > |';
    if (name.endsWith('.')) return 'ชื่อห้ามลงท้ายด้วยจุด';
    if (name.length > 255) return 'ชื่อยาวเกิน 255 ตัวอักษร';
    return null;
}

async function nameExistsOnDisk(dirHandle, name) {
    try { await dirHandle.getFileHandle(name); return true; } catch (e) {
        if (e.name === 'TypeMismatchError') return true;
        if (e.name !== 'NotFoundError') throw e;
    }
    try { await dirHandle.getDirectoryHandle(name); return true; } catch (e) {
        if (e.name === 'TypeMismatchError') return true;
        if (e.name !== 'NotFoundError') throw e;
    }
    return false;
}

export async function createEntry(parentNode, name, type, { live }) {
    const exists = 'มีรายการชื่อนี้อยู่แล้วในโฟลเดอร์นี้';
    if (live && parentNode.handle) {
        if (await nameExistsOnDisk(parentNode.handle, name)) throw new Error(exists);
        if (type === 'file') await parentNode.handle.getFileHandle(name, { create: true });
        else await parentNode.handle.getDirectoryHandle(name, { create: true });
        return null;
    }
    const lower = name.toLowerCase();
    if (parentNode.children?.some((c) => c.name.toLowerCase() === lower)) throw new Error(exists);
    const path = joinPath(parentNode.path, name);
    const node = type === 'file' ? makeFile(name, path) : makeDir(name, path);
    (parentNode.children ??= []).push(node);
    return node;
}

/** ฟังก์ชันเปลี่ยนชื่อ (Rename) รองรับดิสก์จริงและระบบจำลอง (ข้อ 4) */
export async function renameEntry(parentNode, node, newName, { live }) {
    const invalid = validateEntryName(newName);
    if (invalid) throw new Error(invalid);
    if (node.name === newName) return;

    if (live && parentNode.handle) {
        if (await nameExistsOnDisk(parentNode.handle, newName)) throw new Error('มีชื่อนี้อยู่แล้ว');
        // File System Access API ไม่มีคำสั่ง rename โดยตรง ต้องใช้วิธีคัดลอกเนื้อหาเดิมไปสร้างใหม่แล้วลบของเก่า
        if (node.type === 'file') {
            const oldFileHandle = await parentNode.handle.getFileHandle(node.name);
            const file = await oldFileHandle.getFile();
            const newFileHandle = await parentNode.handle.getFileHandle(newName, { create: true });
            const writable = await newFileHandle.createWritable();
            await writable.write(file);
            await writable.close();
            await parentNode.handle.removeEntry(node.name);
        } else {
            // สำหรับโฟลเดอร์ในดิสก์จริง
            const oldDirHandle = await parentNode.handle.getDirectoryHandle(node.name);
            const newDirHandle = await parentNode.handle.getDirectoryHandle(newName, { create: true });
            // คัดลอกแบบ recursive อย่างง่าย
            async function copyDir(src, dest) {
                for await (const [name, handle] of src.entries()) {
                    if (handle.kind === 'file') {
                        const f = await handle.getFile();
                        const nf = await dest.getFileHandle(name, { create: true });
                        const w = await nf.createWritable();
                        await w.write(f);
                        await w.close();
                    } else if (handle.kind === 'directory') {
                        const nd = await dest.getDirectoryHandle(name, { create: true });
                        await copyDir(handle, nd);
                    }
                }
            }
            await copyDir(oldDirHandle, newDirHandle);
            await parentNode.handle.removeEntry(node.name, { recursive: true });
        }
        return;
    }

    // โหมดจำลอง
    if (parentNode.children?.some((c) => c.name.toLowerCase() === newName.toLowerCase())) {
        throw new Error('มีชื่อนี้อยู่แล้ว');
    }
    node.name = newName;
    node.path = joinPath(parentNode.path, newName);
}

export async function deleteEntry(parentNode, node, { live }) {
    if (live && parentNode.handle) {
        await parentNode.handle.removeEntry(node.name, { recursive: node.type === 'directory' });
        return;
    }
    parentNode.children = (parentNode.children ?? []).filter((c) => c !== node);
}

export function captureCollapsed(root) {
    const paths = new Set();
    (function walk(n) {
        if (n.type !== 'directory') return;
        if (n.collapsed) paths.add(n.path);
        n.children?.forEach(walk);
    })(root);
    return paths;
}

export function restoreCollapsed(root, paths) {
    (function walk(n) {
        if (n.type !== 'directory') return;
        if (paths.has(n.path)) n.collapsed = true;
        n.children?.forEach(walk);
    })(root);
}

const entryToFile = (entry) => new Promise((resolve, reject) => entry.file(resolve, reject));

async function readAllEntries(reader) {
    const all = [];
    for (;;) {
        const batch = await new Promise((resolve, reject) => reader.readEntries(resolve, reject));
        if (batch.length === 0) return all;
        all.push(...batch);
    }
}

async function walkEntry(entry, parentPath) {
    const path = joinPath(parentPath, entry.name);
    if (entry.isFile) {
        try {
            return makeFile(entry.name, path, (await entryToFile(entry)).size);
        } catch { return null; }
    }
    if (entry.isDirectory) {
        let children = [];
        const skipped = shouldSkip(entry.name, parentPath);
        if (!skipped) {
            try {
                const entries = await readAllEntries(entry.createReader());
                children = (await Promise.all(entries.map((e) => walkEntry(e, path)))).filter(Boolean);
            } catch (err) {
                console.warn(`อ่านโฟลเดอร์ไม่ได้: ${path}`, err);
            }
        }
        const dir = makeDir(entry.name, path, children);
        if (skipped) dir.skipped = true;
        return dir;
    }
    return null;
}

export const DROP_ROOT_NAME = 'รายการที่วางลงมา';

export async function readDroppedItems(items) {
    const entries = [...items]
        .filter((item) => item.kind === 'file')
        .map((item) => item.webkitGetAsEntry?.())
        .filter(Boolean);

    if (entries.length === 0) return null;
    if (entries.length === 1 && entries[0].isDirectory) {
        const root = await walkEntry(entries[0], '');
        calculateFolderSizes(root);
        return root;
    }
    const children = (await Promise.all(entries.map((e) => walkEntry(e, DROP_ROOT_NAME)))).filter(Boolean);
    const root = makeDir(DROP_ROOT_NAME, DROP_ROOT_NAME, children);
    calculateFolderSizes(root);
    return root;
}

export function buildTreeFromPaths(files, fallbackRoot = 'Root') {
    const rootName = files[0]?.path.split('/')[0] || fallbackRoot;
    const root = makeDir(rootName, rootName);
    const dirs = new Map([[rootName, root]]);

    for (const { path, size = 0 } of files) {
        const parts = path.split('/').filter(Boolean);
        let parent = root;
        let ignored = false;

        for (let i = 1; i < parts.length && !ignored; i++) {
            const childPath = parts.slice(0, i + 1).join('/');
            if (i === parts.length - 1) {
                parent.children.push(makeFile(parts[i], childPath, size));
                break;
            }
            let dir = dirs.get(childPath);
            if (!dir) {
                dir = makeDir(parts[i], childPath);
                if (IGNORED_DIRS.has(parts[i])) dir.skipped = true;
                dirs.set(childPath, dir);
                parent.children.push(dir);
            }
            ignored = Boolean(dir.skipped);
            parent = dir;
        }
    }
    calculateFolderSizes(root);
    return root;
}

export function readFileList(fileList) {
    return buildTreeFromPaths(
        Array.from(fileList, (f) => ({ path: f.webkitRelativePath || f.name, size: f.size }))
    );
}

const DEMO_FILES = [
    ['src/components/Navbar.tsx', 4520],
    ['src/components/MindMapCanvas.tsx', 12400],
    ['src/App.tsx', 2800],
    ['src/index.css', 3500],
    ['assets/logo.svg', 2400],
    ['assets/banner.png', 245000],
    ['package.json', 1850],
    ['README.md', 4200]
];

export function buildDemoTree() {
    return buildTreeFromPaths(DEMO_FILES.map(([p, size]) => ({ path: `my-web-project/${p}`, size })));
}