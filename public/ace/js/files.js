/* ============================================================
   Ace — files.js · file attachments + ZIP extractor
   The composer's + button offers: Upload images / Attach files /
   Upload zip. Plain text & code files are read as text and their
   contents are injected into the message so the AI can view them.
   ZIPs are extracted 100% client-side with a tiny zero-dependency
   reader built on the browser's native DecompressionStream
   (Chrome 103+, Edge 103+, Firefox 113+, Safari 16.4+ — every
   school Chromebook). Images found inside a zip become image
   attachments; text/code files become file attachments.
   ============================================================ */
"use strict";
window.Ace = window.Ace || {};
(function () {
  const $ = (id) => document.getElementById(id);
  const F = { pending: [] }; // [{name, size, text|dataUrl, kind:"text"|"image", lang}]

  const MAX_FILES = 12;
  const MAX_FILE_TEXT = 60 * 1024;     // per-file cap sent to the model
  const MAX_TOTAL_TEXT = 240 * 1024;   // total cap
  const MAX_ZIP_ENTRIES = 80;
  const MAX_ZIP_FILE = 2.5 * 1024 * 1024;

  const TEXT_EXT = {
    txt: "text", md: "markdown", markdown: "markdown", json: "json", csv: "csv",
    js: "javascript", mjs: "javascript", cjs: "javascript", ts: "typescript", tsx: "typescript",
    jsx: "jsx", html: "html", htm: "html", css: "css", scss: "scss", less: "less",
    py: "python", java: "java", c: "c", h: "c", cpp: "cpp", hpp: "cpp", cs: "csharp",
    rb: "ruby", go: "go", rs: "rust", php: "php", swift: "swift", kt: "kotlin",
    sql: "sql", sh: "bash", bash: "bash", zsh: "bash", yml: "yaml", yaml: "yaml",
    toml: "toml", ini: "ini", cfg: "ini", xml: "xml", svg: "xml", log: "text",
    env: "text", gitignore: "text", lock: "text", r: "r", ipynb: "json"
  };
  const IMG_EXT = { png: 1, jpg: 1, jpeg: 1, gif: 1, webp: 1, bmp: 1, avif: 1 };

  const ext = (name) => {
    const m = String(name || "").toLowerCase().match(/\.([a-z0-9]+)$/);
    return m ? m[1] : "";
  };
  const fmtKB = (n) => n < 1024 ? n + " B" : (n / 1024).toFixed(1) + " KB";

  /* ---------- plain file attach (text/code) ---------- */
  async function attachFiles(fileList) {
    const files = Array.from(fileList || []).filter(f => f && f.size <= 4 * 1024 * 1024);
    if (!files.length) return;
    let added = 0;
    for (const f of files.slice(0, MAX_FILES - F.pending.length)) {
      if (IMG_EXT[ext(f.name)]) { // an image selected through "files" → treat as image
        await Ace.Images.attach([f]).catch(() => {});
        continue;
      }
      if (/^image\//.test(f.type)) { await Ace.Images.attach([f]).catch(() => {}); continue; }
      try {
        const text = await f.text();
        if (F.pending.length >= MAX_FILES) break;
        F.pending.push({
          name: f.name || "file.txt", size: f.size, kind: "text",
          lang: TEXT_EXT[ext(f.name)] || "text", text: text.slice(0, MAX_FILE_TEXT),
          truncated: f.size > MAX_FILE_TEXT
        });
        added++;
      } catch (e) { console.warn("file read failed", f.name, e); }
    }
    if (files.length > MAX_FILES - F.pending.length + added)
      Ace.UI.toast(`Max ${MAX_FILES} files per message`, "warn");
    if (added) Ace.UI.toast(added === 1 ? "Attached 1 file — Ace will read it" : `Attached ${added} files — Ace will read them all`, "ok");
    renderChips();
  }

  /* ============================================================
     ZIP EXTRACTOR — zero dependencies
     1. find End-Of-Central-Directory (EOCD) record from the tail
     2. walk the central directory → entry metadata
     3. per entry, read its local header to find the data start
     4. method 0 (stored) = raw bytes; method 8 (deflate) →
        native DecompressionStream("deflate-raw")
     ============================================================ */
  async function extractZip(file, onProgress) {
    if (typeof DecompressionStream === "undefined")
      throw new Error("This browser can't unzip (needs Chrome 103+/Edge/Firefox/Safari 16.4+). Attach the files individually instead.");
    const buf = new Uint8Array(await file.arrayBuffer());
    const dv = new DataView(buf.buffer);

    /* locate EOCD: scan backward for PK\x05\x06 */
    let eocd = -1;
    const minEocd = Math.max(0, buf.length - 66000);
    for (let i = buf.length - 22; i >= minEocd; i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error("Not a valid zip file (no end record found).");
    const cdCount = dv.getUint16(eocd + 10, true);
    let cdOff = dv.getUint32(eocd + 16, true);
    // zip64? (offset 0xFFFFFFFF) — the tail-scan fallback below usually still works
    if (cdOff === 0xFFFFFFFF || cdOff + 4 > buf.length) {
      // try finding the central directory by signature scan
      cdOff = -1;
      for (let i = 0; i < buf.length - 4; i++) {
        if (dv.getUint32(i, true) === 0x02014b50) { cdOff = i; break; }
      }
      if (cdOff < 0) throw new Error("This zip uses an unsupported format (zip64).");
    }

    /* walk central directory */
    const entries = [];
    let p = cdOff;
    for (let n = 0; n < cdCount && p + 46 <= buf.length; n++) {
      if (dv.getUint32(p, true) !== 0x02014b50) break;
      const flags = dv.getUint16(p + 8, true);
      const method = dv.getUint16(p + 10, true);
      const compSize = dv.getUint32(p + 20, true);
      const uncompSize = dv.getUint32(p + 24, true);
      const nameLen = dv.getUint16(p + 28, true);
      const extraLen = dv.getUint16(p + 30, true);
      const commentLen = dv.getUint16(p + 32, true);
      const localOff = dv.getUint32(p + 42, true);
      const name = new TextDecoder("utf-8").decode(buf.slice(p + 46, p + 46 + nameLen));
      entries.push({ name, method, compSize, uncompSize, localOff, utf8: !!(flags & 0x800) });
      p += 46 + nameLen + extraLen + commentLen;
    }
    if (!entries.length) throw new Error("The zip archive looks empty.");

    /* filter: drop dirs, macOS junk, huge files */
    const usable = entries.filter(e =>
      !e.name.endsWith("/") &&
      !/^__MACOSX\//i.test(e.name) &&
      !/(^|\/)\._/.test(e.name) &&
      !/(^|\/)\.DS_Store$/i.test(e.name) &&
      e.uncompSize <= MAX_ZIP_FILE);
    const out = [];
    for (let i = 0; i < Math.min(usable.length, MAX_ZIP_ENTRIES); i++) {
      const e = usable[i];
      try {
        const data = await readEntry(buf, dv, e);
        if (!data || !data.length) continue;
        out.push({ name: e.name.replace(/^\/+/, ""), bytes: data });
        onProgress && onProgress(out.length, Math.min(usable.length, MAX_ZIP_ENTRIES), e.name);
      } catch (err) { console.warn("zip entry failed", e.name, err); }
    }
    if (!out.length) throw new Error("Nothing extractable found inside (files may be too big or unsupported).");
    return { files: out, total: usable.length };
  }

  function readEntry(buf, dv, e) {
    const lo = e.localOff;
    if (lo + 30 > buf.length || dv.getUint32(lo, true) !== 0x04034b50) return null;
    const nameLen = dv.getUint16(lo + 26, true);
    const extraLen = dv.getUint16(lo + 28, true);
    const dataStart = lo + 30 + nameLen + extraLen;
    const raw = buf.slice(dataStart, dataStart + e.compSize);
    if (e.method === 0) return raw;                       // stored
    if (e.method !== 8) return null;                      // unsupported compression
    return inflateRaw(raw);                               // deflate → promise
  }
  async function inflateRaw(raw) {
    const ds = new DecompressionStream("deflate-raw");
    const stream = new Blob([raw]).stream().pipeThrough(ds);
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  /* ---------- zip intake: extract → route entries ---------- */
  async function attachZip(file) {
    const t0 = Date.now();
    Ace.UI.toast(`Extracting ${file.name}…`, "info");
    let extracted;
    try {
      extracted = await extractZip(file, (n, total, name) => {
        // light progress via toast swap (no spinner infra needed)
        if (n % 10 === 0) Ace.UI.toast(`Extracting… ${n}/${total}`, "info");
      });
    } catch (err) {
      Ace.UI.toast(err.message || "Couldn't extract that zip", "warn");
      return;
    }
    let images = 0, texts = 0, skipped = 0;
    for (const f of extracted.files) {
      if (F.pending.length >= MAX_FILES) { skipped++; continue; }
      const e = ext(f.name);
      if (IMG_EXT[e] || /^(image\/)/.test(mimeOf(f.name))) {
        const blob = new Blob([f.bytes], { type: mimeOf(f.name) });
        const im = await blobToImageAttachment(blob, f.name);
        if (im) { Ace.Images.pending.push(im); images++; }
      } else if (TEXT_EXT[e] || isProbablyText(f.bytes)) {
        const text = new TextDecoder("utf-8", { fatal: false }).decode(f.bytes.slice(0, MAX_FILE_TEXT));
        if (text.replace(/\s/g, "").length) {
          F.pending.push({
            name: f.name, size: f.bytes.length, kind: "text",
            lang: TEXT_EXT[e] || "text", text,
            truncated: f.bytes.length > MAX_FILE_TEXT
          });
          texts++;
        }
      } else skipped++;
    }
    Ace.Images.renderChips();
    renderChips();
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    const parts = [];
    if (texts) parts.push(`${texts} file${texts > 1 ? "s" : ""} for the AI to read`);
    if (images) parts.push(`${images} image${images > 1 ? "s" : ""}`);
    if (skipped) parts.push(`${skipped} skipped`);
    Ace.UI.toast(`Extracted ${extracted.files.length} files from ${file.name} in ${secs}s — ${parts.join(", ")}`, "ok");
  }
  const mimeOf = (name) => ({
    png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
    webp: "image/webp", bmp: "image/bmp", avif: "image/avif"
  }[ext(name)] || "application/octet-stream");

  function isProbablyText(bytes) {
    const n = Math.min(bytes.length, 2048);
    let weird = 0;
    for (let i = 0; i < n; i++) {
      const b = bytes[i];
      if (b === 0) return false;                 // null byte → binary
      if (b < 9 || (b > 13 && b < 32)) weird++;  // control chars
    }
    return weird / n < 0.08;
  }
  function blobToImageAttachment(blob, name) {
    return new Promise(res => {
      const fr = new FileReader();
      fr.onload = () => {
        const im = new Image();
        im.onload = () => {
          const MAX = Ace.IMG_MAX_DIM;
          const scale = Math.min(1, MAX / Math.max(im.width, im.height));
          const w = Math.max(1, Math.round(im.width * scale)), h = Math.max(1, Math.round(im.height * scale));
          const c = document.createElement("canvas");
          c.width = w; c.height = h;
          const ctx = c.getContext("2d");
          ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, w, h);
          ctx.drawImage(im, 0, 0, w, h);
          res({ dataUrl: c.toDataURL("image/jpeg", 0.85), name, w, h });
        };
        im.onerror = () => res(null);
        im.src = fr.result;
      };
      fr.onerror = () => res(null);
      fr.readAsDataURL(blob);
    });
  }

  /* ---------- chips UI (shares attachRow with images) ---------- */
  function renderChips() {
    const row = $("attachRow");
    if (!row) return;
    // remove existing file chips, keep image chips (images.js renders those)
    row.querySelectorAll(".filechip").forEach(x => x.remove());
    row.classList.toggle("hidden", F.pending.length === 0 && !(Ace.Images.pending && Ace.Images.pending.length));
    F.pending.forEach((f, i) => {
      const chip = Ace.el("div", "filechip",
        `<span class="fc-ic">${Ace.ICON(fileIcon(f.name), 13)}</span>
         <span class="fc-name" title="${Ace.esc(f.name)}">${Ace.esc(f.name)}</span>
         <span class="fc-size">${fmtKB(f.size)}</span>
         <button class="imgchip-x" title="Remove">${Ace.ICON("close", 11)}</button>`);
      chip.querySelector(".imgchip-x").onclick = () => { F.pending.splice(i, 1); renderChips(); };
      row.append(chip);
    });
  }
  function fileIcon(name) {
    const e = ext(name);
    if (["html", "htm"].includes(e)) return "code";
    if (["js", "ts", "jsx", "tsx", "py", "java", "c", "cpp", "cs", "rb", "go", "rs", "php", "swift", "kt", "sh"].includes(e)) return "code";
    if (["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "avif"].includes(e)) return "img";
    return "file";
  }

  /* ---------- compose the file section injected into the API message ---------- */
  F.buildContextFrom = (files) => {
    files = files || [];
    if (!files.length) return "";
    let total = 0, out = "\n\n[The user attached " + files.length + " file" + (files.length > 1 ? "s" : "") + " — full contents below]";
    files.forEach((f, i) => {
      if (total >= MAX_TOTAL_TEXT) { out += `\n[file ${i + 1}: ${f.name} — omitted, attachment size limit reached]`; return; }
      const body = String(f.text || "").slice(0, Math.min(MAX_FILE_TEXT, MAX_TOTAL_TEXT - total));
      total += body.length;
      out += `\n----- ATTACHED FILE ${i + 1}: ${f.name} (${fmtKB(f.size)}${f.truncated ? ", first part shown" : ""}) -----\n`;
      out += "```" + (f.lang && f.lang !== "text" ? f.lang : "") + "\n" + body + "\n```\n";
    });
    return out;
  };
  F.buildContext = () => F.buildContextFrom(F.pending);
  F.take = () => { const files = F.pending.slice(); F.pending.length = 0; renderChips(); return files; };
  F.count = () => F.pending.length;

  /* ---------- plus menu ---------- */
  function init() {
    const menu = $("plusMenu");
    const btn = $("btnAttach");
    const docInput = $("docInput"), zipInput = $("zipInput"), imgInput = $("fileInput");

    // labels + icons
    const pmI = $("pmImages"), pmF = $("pmFiles"), pmZ = $("pmZip");
    if (pmI) pmI.innerHTML = `${Ace.ICON("img", 16)}<span><b>Upload images</b><small>Photos, screenshots, diagrams — or paste / drag them</small></span>`;
    if (pmF) pmF.innerHTML = `${Ace.ICON("file", 16)}<span><b>Attach files</b><small>Text &amp; code — .txt .md .js .py .html .csv … sent for me to view</small></span>`;
    if (pmZ) pmZ.innerHTML = `${Ace.ICON("zip", 16)}<span><b>Upload zip</b><small>Auto-extracts every file inside and sends them all for me to view</small></span>`;

    function openMenu() { menu.classList.remove("hidden"); btn.classList.add("active"); }
    function closeMenu() { menu.classList.add("hidden"); btn.classList.remove("active"); }
    let menuOpen = false;
    btn.onclick = (e) => {
      e.stopPropagation();
      menuOpen = !menuOpen;
      menuOpen ? openMenu() : closeMenu();
    };
    document.addEventListener("click", (e) => {
      if (menuOpen && !menu.contains(e.target) && e.target !== btn) { menuOpen = false; closeMenu(); }
    });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && menuOpen) { menuOpen = false; closeMenu(); } });

    pmI.onclick = () => { menuOpen = false; closeMenu(); imgInput && imgInput.click(); };
    pmF.onclick = () => { menuOpen = false; closeMenu(); docInput && docInput.click(); };
    pmZ.onclick = () => { menuOpen = false; closeMenu(); zipInput && zipInput.click(); };

    if (docInput) docInput.onchange = async () => {
      const files = Array.from(docInput.files || []);
      if (files.length) await attachFiles(files);
      docInput.value = ""; // clear only AFTER reads — clearing early can invalidate File refs
    };
    if (zipInput) zipInput.onchange = async () => {
      const f = zipInput.files && zipInput.files[0];
      if (f) await attachZip(f);
      zipInput.value = "";
    };
  }
  F.init = init;
  F.attachFiles = attachFiles;
  F.attachZip = attachZip;
  F.renderChips = renderChips;
  F.extractZip = extractZip; // exposed for testing
  Ace.Files = F;
})();
