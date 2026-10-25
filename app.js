/*
 * コマ割り一覧とコマ下絵 ZIP。layouts.json（コマ割りの一覧）を読んで、ブラウザの中だけで動く。
 * コマ下絵の大きさの計算は、もとのエディタの「コマ下絵を書き出し」と同じ:
 * ページ幅 W・高さ round(W / ページの縦横比) の上で、コマの頂点（斜めの切り抜き・回転も考える）をすべて含む
 * 軸に平行な矩形を取り、各辺に余白を足して丸める（丸めは JavaScript の Math.round）。
 * 置いた画像はこのページの中で見せるだけで、どこにも送らない。
 */
"use strict";

const GROUPS = [["all", "すべて"], ["1", "全面"], ["2", "二分割"], ["3", "三分割"], ["4", "四分割"], ["5", "五分割"],
  ["6", "六分割"], ["7", "七分割"], ["8", "八分割"], ["other", "その他"]];
const SHAPES = [["all", "すべて"], ["rect", "長方形"], ["slant", "斜め"]];
const RATIO_LABEL = { portrait: "3x4", tall: "9x16", square: "1x1", wide: "16x9", cinematic: "21x9" };

const state = {
  data: null, ratio: "portrait", group: "all", shape: "all", q: "", current: null,
  pageWidth: 2000, margin: 48, guide: false,
  images: new Map(), // "layoutId:コマ番号" → { url, name }
};
const $ = (id) => document.getElementById(id);
const el = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "on") for (const [ev, fn] of Object.entries(v)) e.addEventListener(ev, fn);
    else if (v !== false && v != null) e.setAttribute(k, v === true ? "" : String(v));
  }
  for (const k of kids) e.append(k);
  return e;
};
const SVG = "http://www.w3.org/2000/svg";
const svg = (tag, attrs = {}) => {
  const e = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) {
    // CSS の変数は属性では効かないので style で入れる（明るい・暗い画面で色を変えるため）
    if (typeof v === "string" && v.startsWith("var(")) e.style.setProperty(k, v);
    else e.setAttribute(k, String(v));
  }
  return e;
};

// ── 計算（エディタと同じ） ─────────────────────────────────────────────────
const groupOf = (n) => (n <= 1 ? "1" : n >= 9 ? "other" : String(n));
const aspectOf = (ratio) => state.data.ratios[ratio] ?? 1;

function panelVerts(p, W, H) {
  let verts;
  if (p.clip && p.clip.length >= 3) {
    verts = p.clip.map(([cx, cy]) => [((p.x + (cx / 100) * p.width) / 100) * W, ((p.y + (cy / 100) * p.height) / 100) * H]);
  } else {
    const x0 = (p.x / 100) * W, y0 = (p.y / 100) * H, x1 = ((p.x + p.width) / 100) * W, y1 = ((p.y + p.height) / 100) * H;
    verts = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  }
  if (p.rotation) {
    const rad = (p.rotation * Math.PI) / 180;
    const cx = ((p.x + p.width / 2) / 100) * W, cy = ((p.y + p.height / 2) / 100) * H;
    const cos = Math.cos(rad), sin = Math.sin(rad);
    verts = verts.map(([x, y]) => [cx + (x - cx) * cos - (y - cy) * sin, cy + (x - cx) * sin + (y - cy) * cos]);
  }
  return verts;
}

function pageSize() {
  const W = Math.max(200, Math.round(state.pageWidth));
  return { W, H: Math.round(W / aspectOf(state.ratio)) };
}

/** 各コマの白紙: 外接矩形＋余白（ページ座標）と、PNG の大きさ。 */
function komaRects(layout) {
  const { W, H } = pageSize();
  const m = Math.max(0, Math.round(state.margin));
  return layout.panels.map((p) => {
    const verts = panelVerts(p, W, H);
    const xs = verts.map((v) => v[0]), ys = verts.map((v) => v[1]);
    const minX = Math.min(...xs), minY = Math.min(...ys);
    const w = Math.max(1, Math.round(Math.max(...xs) - minX + 2 * m));
    const h = Math.max(1, Math.round(Math.max(...ys) - minY + 2 * m));
    return { verts, x: minX - m, y: minY - m, w, h, m, minX, minY };
  });
}

// ── 一覧 ─────────────────────────────────────────────────────────────────
function thumb(layout) {
  const H = 100 / aspectOf(state.ratio);
  const s = svg("svg", { viewBox: `-2 -2 104 ${H + 4}`, "aria-hidden": "true" });
  s.append(svg("rect", { x: 0, y: 0, width: 100, height: H, fill: "var(--page)", stroke: "var(--line)" }));
  for (const p of layout.panels) {
    s.append(svg("polygon", {
      points: panelVerts(p, 100, H).map((v) => v.join(",")).join(" "),
      fill: "#ffffff", stroke: "var(--koma)", "stroke-width": 1.4, "stroke-linejoin": "round",
    }));
  }
  return s;
}

function filtered() {
  const q = state.q.trim().toLowerCase();
  return state.data.layouts.filter((l) =>
    (state.group === "all" || groupOf(l.count) === state.group) &&
    (state.shape === "all" || (state.shape === "slant") === l.slant) &&
    (!q || l.id.toLowerCase().includes(q)));
}

function renderGrid() {
  const list = filtered();
  $("count").textContent = `${list.length} 件`;
  const grid = $("grid");
  grid.replaceChildren(...list.map((l) => el("button", {
    type: "button", class: "tile", "aria-current": state.current?.id === l.id ? "true" : false,
    title: `${l.id}（${l.count} コマ）`, on: { click: () => select(l) },
  }, thumb(l), el("span", {}, l.id))));
  if (!list.length) grid.append(el("p", { class: "empty" }, "当てはまるコマ割りがありません。"));
}

function renderChips(id, items, key) {
  $(id).replaceChildren(...items.map(([v, label]) => el("button", {
    type: "button", class: "chip", "aria-pressed": state[key] === v ? "true" : "false",
    on: { click: () => { state[key] = v; renderChips(id, items, key); renderGrid(); } },
  }, label)));
}

// ── 選んだコマ割り ─────────────────────────────────────────────────────────
function select(layout) {
  state.current = layout;
  history.replaceState(null, "", `#${encodeURIComponent(layout.id)}`);
  renderGrid();
  renderDetail();
  // 狭い画面では選んだコマ割りが一覧の下に出るので、そこまで送る
  if (window.matchMedia("(max-width: 899px)").matches) $("detail").scrollIntoView({ behavior: "smooth", block: "start" });
}

const imgKey = (i) => `${state.current.id}:${i}`;

function setImage(i, file) {
  if (!file || !file.type.startsWith("image/")) return;
  const old = state.images.get(imgKey(i));
  if (old) URL.revokeObjectURL(old.url);
  state.images.set(imgKey(i), { url: URL.createObjectURL(file), name: file.name });
}

/** 何枚か一度に落としたとき: ファイル名の koma-{番号} でコマを決め、無ければ空いたコマに順に置く。 */
function placeFiles(files, startAt = 0) {
  const n = state.current.panels.length;
  const rest = [];
  for (const f of files) {
    const m = /koma-(\d+)/i.exec(f.name);
    const i = m ? Number(m[1]) - 1 : -1;
    if (i >= 0 && i < n) setImage(i, f); else rest.push(f);
  }
  let i = startAt;
  for (const f of rest) {
    while (i < n && state.images.has(imgKey(i))) i++;
    if (i >= n) break;
    setImage(i++, f);
  }
  renderDetail();
}

function pickFile(i) {
  const input = el("input", { type: "file", accept: "image/*" });
  input.addEventListener("change", () => { if (input.files?.[0]) { setImage(i, input.files[0]); renderDetail(); } });
  input.click();
}

function preview(layout, rects) {
  const { W, H } = pageSize();
  const s = svg("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": `${layout.id} のプレビュー` });
  const defs = svg("defs");
  s.append(defs);
  const sw = Math.max(2, W / 400);
  rects.forEach((r, i) => {
    const points = r.verts.map((v) => v.join(",")).join(" ");
    const clip = svg("clipPath", { id: `clip-${i}` });
    clip.append(svg("polygon", { points }));
    defs.append(clip);
    const g = svg("g", { class: "koma", tabindex: 0, role: "button", "aria-label": `コマ ${i + 1} に絵を置く` });
    g.append(svg("polygon", { points, fill: "#ffffff" }));
    const im = state.images.get(imgKey(i));
    if (im) {
      // 白紙の大きさ（外接矩形＋余白）に合わせて置く。縦横比が違えば中央で切り取る
      const image = svg("image", { x: r.x, y: r.y, width: r.w, height: r.h, preserveAspectRatio: "xMidYMid slice", "clip-path": `url(#clip-${i})` });
      image.setAttributeNS("http://www.w3.org/1999/xlink", "href", im.url);
      image.setAttribute("href", im.url);
      g.append(image);
    } else {
      const cx = r.minX + (r.w - 2 * r.m) / 2, cy = r.minY + (r.h - 2 * r.m) / 2;
      const t = svg("text", { x: cx, y: cy, "text-anchor": "middle", "dominant-baseline": "middle", "font-size": W / 22, fill: "#9a9a9a" });
      t.textContent = String(i + 1);
      g.append(t);
    }
    g.append(svg("polygon", { class: "edge", points, fill: "none", stroke: "var(--koma)", "stroke-width": sw, "stroke-linejoin": "round" }));
    g.addEventListener("click", () => pickFile(i));
    g.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pickFile(i); } });
    g.addEventListener("dragover", (e) => e.preventDefault());
    g.addEventListener("drop", (e) => {
      e.preventDefault(); e.stopPropagation();
      const files = [...(e.dataTransfer?.files ?? [])];
      if (files.length === 1) { setImage(i, files[0]); renderDetail(); } else placeFiles(files, i);
    });
    s.append(g);
  });
  return s;
}

function numberInput(label, key, min, max, step) {
  return el("label", {}, label, el("input", {
    type: "number", min, max, step, value: state[key],
    on: { change: (e) => { const v = Number(e.target.value); state[key] = Math.min(max, Math.max(min, Number.isFinite(v) ? v : state[key])); renderDetail(); } },
  }));
}

function renderDetail() {
  const layout = state.current;
  const box = $("detail");
  if (!layout) return;
  const rects = komaRects(layout);
  const placed = layout.panels.filter((_, i) => state.images.has(imgKey(i))).length;
  const pv = el("div", { class: "preview" }, preview(layout, rects));
  pv.addEventListener("dragover", (e) => { e.preventDefault(); pv.classList.add("drop-on"); });
  pv.addEventListener("dragleave", () => pv.classList.remove("drop-on"));
  pv.addEventListener("drop", (e) => { e.preventDefault(); pv.classList.remove("drop-on"); placeFiles([...(e.dataTransfer?.files ?? [])]); });
  box.replaceChildren(
    el("h2", {}, layout.id),
    el("p", { class: "hint" }, `${layout.panels.length} コマ。コマを押すか画像を落とすと、そのコマに絵を置いて見られます（何枚かまとめて落とすと koma-1… の名前の順に入ります）。`),
    pv,
    el("div", { class: "row" },
      numberInput("ページ幅 px", "pageWidth", 400, 6000, 100),
      numberInput("余白 px", "margin", 0, 400, 4),
      el("label", {}, el("input", { type: "checkbox", checked: state.guide, on: { change: (e) => { state.guide = e.target.checked; } } }), "コマ枠のガイド線"),
    ),
    el("div", { class: "row" },
      el("button", { type: "button", class: "btn", on: { click: (e) => downloadZip(e.currentTarget) } }, `⬇ コマ下絵 ZIP（${layout.panels.length} 枚）`),
      el("button", { type: "button", class: "btn sub", disabled: placed === 0, on: { click: (e) => downloadComposite(e.currentTarget) } }, "⬇ 置いた絵を 1 枚の PNG で保存"),
      el("button", { type: "button", class: "btn sub", disabled: placed === 0, on: { click: clearImages } }, "絵を外す"),
    ),
    el("ul", { class: "sizes" }, ...rects.map((r, i) => el("li", {}, `koma-${i + 1}_${r.w}x${r.h}.png`))),
  );
}

function clearImages() {
  state.current.panels.forEach((_, i) => {
    const im = state.images.get(imgKey(i));
    if (im) { URL.revokeObjectURL(im.url); state.images.delete(imgKey(i)); }
  });
  renderDetail();
}

// ── PNG と ZIP ──────────────────────────────────────────────────────────────
const toBlob = (canvas) => new Promise((ok, ng) => canvas.toBlob((b) => (b ? ok(b) : ng(new Error("PNG を作れませんでした"))), "image/png"));

async function blankPng(r) {
  const c = document.createElement("canvas");
  c.width = r.w; c.height = r.h;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, r.w, r.h);
  if (state.guide) {
    ctx.strokeStyle = "rgba(0,0,0,0.18)";
    ctx.lineWidth = Math.max(1, Math.round(pageSize().W / 1000));
    ctx.setLineDash([8, 6]);
    ctx.beginPath();
    r.verts.forEach(([x, y], k) => (k ? ctx.lineTo(x - r.minX + r.m, y - r.minY + r.m) : ctx.moveTo(x - r.minX + r.m, y - r.minY + r.m)));
    ctx.closePath();
    ctx.stroke();
  }
  return new Uint8Array(await (await toBlob(c)).arrayBuffer());
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
const crc32 = (b) => { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC_TABLE[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };

/** 圧縮しない ZIP（PNG はもう圧縮されている）。ファイル名は UTF-8。 */
function zip(files) {
  const enc = new TextEncoder();
  const parts = [], central = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name), crc = crc32(f.data), size = f.data.length;
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true); local.setUint16(4, 20, true); local.setUint16(6, 0x0800, true);
    local.setUint32(14, crc, true); local.setUint32(18, size, true); local.setUint32(22, size, true); local.setUint16(26, name.length, true);
    parts.push(local.buffer, name, f.data);
    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true); cd.setUint16(4, 20, true); cd.setUint16(6, 20, true); cd.setUint16(8, 0x0800, true);
    cd.setUint32(16, crc, true); cd.setUint32(20, size, true); cd.setUint32(24, size, true); cd.setUint16(28, name.length, true);
    cd.setUint32(42, offset, true);
    central.push(cd.buffer, name);
    offset += 30 + name.length + size;
  }
  const cdSize = central.reduce((n, p) => n + p.byteLength, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
  end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, end.buffer], { type: "application/zip" });
}

function save(blob, name) {
  const a = el("a", { href: URL.createObjectURL(blob), download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

async function busy(btn, fn) {
  const label = btn.textContent;
  btn.disabled = true; btn.textContent = "作っています…";
  try { await fn(); } catch (e) { alert(e instanceof Error ? e.message : String(e)); }
  finally { btn.disabled = false; btn.textContent = label; }
}

function downloadZip(btn) {
  return busy(btn, async () => {
    const layout = state.current, rects = komaRects(layout), { W, H } = pageSize();
    const files = [];
    for (const [i, r] of rects.entries()) files.push({ name: `koma-${i + 1}_${r.w}x${r.h}.png`, data: await blankPng(r) });
    files.push({ name: "README.txt", data: new TextEncoder().encode(
      `コマ割り ${layout.id}（${layout.panels.length} コマ・ページ ${W}x${H}px）のコマ下絵です。\n` +
      `各コマの頂点をすべて含む矩形に、各辺 ${rects[0]?.m ?? 0}px の余白を足した白い画像です。\n` +
      "この大きさのまま描いて、そのコマにアップロードしてください。\n") });
    save(zip(files), `koma-shitae_${layout.id}_${RATIO_LABEL[state.ratio] ?? state.ratio}_${W}px.zip`);
  });
}

const loadImage = (url) => new Promise((ok, ng) => { const im = new Image(); im.onload = () => ok(im); im.onerror = () => ng(new Error("画像を読めませんでした")); im.src = url; });

function downloadComposite(btn) {
  return busy(btn, async () => {
    const layout = state.current, rects = komaRects(layout), { W, H } = pageSize();
    const c = document.createElement("canvas");
    c.width = W; c.height = H;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, W, H);
    const path = (r) => { ctx.beginPath(); r.verts.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); };
    for (const [i, r] of rects.entries()) {
      const im = state.images.get(imgKey(i));
      if (!im) continue;
      const img = await loadImage(im.url);
      const scale = Math.max(r.w / img.width, r.h / img.height); // 中央で切り取る（プレビューと同じ）
      const dw = img.width * scale, dh = img.height * scale;
      ctx.save(); path(r); ctx.clip();
      ctx.drawImage(img, r.x + (r.w - dw) / 2, r.y + (r.h - dh) / 2, dw, dh);
      ctx.restore();
    }
    ctx.strokeStyle = "#1b1b1b";
    ctx.lineWidth = Math.max(2, W / 400);
    ctx.lineJoin = "round";
    for (const r of rects) { path(r); ctx.stroke(); }
    save(await toBlob(c), `preview_${layout.id}_${W}x${H}.png`);
  });
}

// ── はじめ ─────────────────────────────────────────────────────────────────
async function main() {
  const res = await fetch("layouts.json");
  state.data = await res.json();
  renderChips("groups", GROUPS, "group");
  renderChips("shapes", SHAPES, "shape");
  $("ratio").addEventListener("change", (e) => { state.ratio = e.target.value; renderGrid(); renderDetail(); });
  $("q").addEventListener("input", (e) => { state.q = e.target.value; renderGrid(); });
  $("footer").textContent = `コマ割り ${state.data.layouts.length} 件（${state.data.generatedAt.slice(0, 10)} 時点）`;
  const fromHash = decodeURIComponent(location.hash.slice(1));
  const first = state.data.layouts.find((l) => l.id === fromHash);
  if (first) { state.current = first; renderDetail(); }
  renderGrid();
}
main().catch(() => { $("grid").textContent = "コマ割りの一覧を読み込めませんでした。"; });
