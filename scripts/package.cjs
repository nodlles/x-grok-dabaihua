// Node.js 20+; zip/unzip must be on PATH. Only declared runtime assets enter the package.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
if (!/^\d+\.\d+\.\d+$/.test(manifest.version)) throw new Error('Expected a three-part release version');
const files = new Set(['manifest.json', 'LICENSE', 'options.js']);
for (const entry of manifest.content_scripts) for (const file of [...(entry.js || []), ...(entry.css || [])]) files.add(file);
for (const file of Object.values(manifest.icons || {})) files.add(file);
for (const file of Object.values(manifest.action?.default_icon || {})) files.add(file);
if (manifest.options_page) files.add(manifest.options_page);
if (manifest.action?.default_popup) files.add(manifest.action.default_popup);
const names = [...files].sort();
for (const file of names) {
  if (path.isAbsolute(file) || file.split('/').includes('..')) throw new Error('Unsafe runtime path: ' + file);
  const full = path.join(root, file);
  if (!fs.lstatSync(full).isFile() || fs.realpathSync(full) !== full) throw new Error('Runtime asset must be a regular file: ' + file);
}
execFileSync(process.execPath, ['--test', 'tests/lifecycle.test.cjs'], { cwd: root, stdio: 'inherit' });
const outputDir = path.join(root, 'dist');
fs.mkdirSync(outputDir, { recursive: true });
const output = path.join(outputDir, `x-grok-dabaihua-v${manifest.version}.zip`);
const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'xdbh-package-'));
try {
  for (const file of names) {
    const target = path.join(staging, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(root, file), target);
    fs.chmodSync(target, 0o644);
    fs.utimesSync(target, new Date('2000-01-01T00:00:00Z'), new Date('2000-01-01T00:00:00Z'));
  }
  // Build a fresh archive; zip update mode could otherwise retain removed files.
  const temporaryZip = path.join(staging, 'release.zip');
  execFileSync('zip', ['-X', '-q', temporaryZip, ...names], { cwd: staging });
  const packed = execFileSync('unzip', ['-Z1', temporaryZip], { encoding: 'utf8' }).trim().split('\n').sort();
  if (JSON.stringify(packed) !== JSON.stringify(names)) throw new Error('Archive contents do not match allowlist');
  for (const file of names) {
    const actual = execFileSync('unzip', ['-p', temporaryZip, file]);
    if (!actual.equals(fs.readFileSync(path.join(root, file)))) throw new Error('Archive mismatch: ' + file);
  }
  fs.copyFileSync(temporaryZip, output);
  const sha256 = crypto.createHash('sha256').update(fs.readFileSync(output)).digest('hex');
  fs.writeFileSync(output + '.sha256', `${sha256}  ${path.basename(output)}\n`);
  console.log(`Verified ${names.length} runtime files\n${output}\nSHA256 ${sha256}`);
} finally {
  fs.rmSync(staging, { recursive: true, force: true });
}
