/* ZIP extractor test: build a real zip (deflate + stored + dirs + __MACOSX junk
   + an image + a text file), then run Ace's extractZip against it in Node. */
const fs = require("fs");
const { execSync } = require("child_process");

// ---- DOM/window shims (files.js touches a few globals at load) ----
global.window = global;
global.document = {
  createElement: () => ({ classList: { add() {}, remove() {}, toggle() {} }, style: {}, dataset: {}, append() {}, querySelector: () => null, querySelectorAll: () => [] }),
  querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, getElementById: () => null
};
eval(fs.readFileSync("/home/z/my-project/public/ace/js/config.js", "utf8"));
global.Ace.UI = { toast() {} };
global.Ace.Images = { pending: [], renderChips() {}, attach: async () => {} };
eval(fs.readFileSync("/home/z/my-project/public/ace/js/files.js", "utf8"));

// ---- build the test zip with Python zipfile ----
const tmp = "/home/z/my-project/scripts/ztest";
execSync(`rm -rf ${tmp} && mkdir -p ${tmp}/__MACOSX ${tmp}/src ${tmp}/assets`);
fs.writeFileSync(`${tmp}/README.md`, "# Test project\n\nA tiny site to verify the zip extractor.\n");
fs.writeFileSync(`${tmp}/src/index.html`, "<!DOCTYPE html>\n<html><head><title>Z</title></head><body><h1>Hi</h1></body></html>\n");
fs.writeFileSync(`${tmp}/src/app.js`, "console.log('hello from app.js');\n".repeat(40));
fs.writeFileSync(`${tmp}/notes.txt`, "line\n".repeat(500));
// tiny valid PNG (1x1)
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
fs.writeFileSync(`${tmp}/assets/logo.png`, png);
fs.writeFileSync(`${tmp}/__MACOSX/._README.md`, "junk");
execSync(`cd ${tmp} && python3 -c "
import zipfile, os
z = zipfile.ZipFile('proj.zip', 'w', zipfile.ZIP_DEFLATED)
z.write('README.md')
z.write('src/index.html')
z.write('src/app.js')
z.write('notes.txt')
z.write('assets/logo.png')
# stored (method 0) entry
zi = zipfile.ZipInfo('stored.txt')
z.writestr(zi, 'stored content here', zipfile.ZIP_STORED)
# junk that must be filtered
z.writestr('__MACOSX/._x', 'junk')
z.close()
print('zip written')
"`);
// also a big stored+deflate mix
const buf = fs.readFileSync(`${tmp}/proj.zip`);
console.log("zip size:", buf.length, "bytes");

// ---- run the extractor ----
(async () => {
  const file = { name: "proj.zip", arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) };
  const out = await Ace.Files.extractZip(file, () => {});
  console.log("extracted entries:", out.files.length, "of", out.total);
  const names = out.files.map(f => f.name);
  console.log("names:", names);
  const get = (n) => out.files.find(f => f.name === n);

  const md = get("README.md");
  const html = get("src/index.html");
  const js = get("src/app.js");
  const stored = get("stored.txt");
  const img = get("assets/logo.png");
  const pngOut = img ? Buffer.from(img.bytes).toString("base64") : "";

  let pass = 0, fail = 0;
  const ok = (c, n) => { c ? (pass++, console.log("  PASS", n)) : (fail++, console.log("  FAIL", n)); };
  ok(names.includes("README.md"), "README.md extracted");
  ok(names.includes("src/index.html"), "nested path extracted");
  ok(names.includes("stored.txt"), "STORED (method 0) entry extracted");
  ok(names.includes("assets/logo.png"), "binary png extracted");
  ok(!names.some(n => n.includes("__MACOSX")), "__MACOSX junk filtered");
  ok(!names.some(n => n.startsWith("._")), "dot-underscore junk filtered");
  ok(md && md.bytes && new TextDecoder().decode(md.bytes).includes("tiny site"), "deflated text content correct");
  ok(stored && new TextDecoder().decode(stored.bytes) === "stored content here", "stored content correct");
  ok(pngOut === png.toString("base64"), "png bytes identical after inflate");
  ok(js && new TextDecoder().decode(js.bytes).includes("hello from app.js"), "app.js content correct");
  console.log(`==== zip extractor: ${pass} passed, ${fail} failed ====`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error("EXTRACT THREW:", e); process.exit(1); });
