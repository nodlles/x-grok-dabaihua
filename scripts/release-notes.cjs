const fs = require('node:fs');
const path = require('node:path');

function releaseNotes(tag, version, changelog) {
  if (!/^v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/.test(tag)) {
    throw new Error('Expected a stable version tag such as v0.4.1');
  }
  if (tag !== `v${version}`) throw new Error(`Tag ${tag} does not match manifest version ${version}`);
  const lines = changelog.replace(/\r\n/g, '\n').split('\n');
  const matches = lines.flatMap((line, index) =>
    line.startsWith('## ') && line.slice(3).trim().split(/\s/)[0] === tag ? [index] : []);
  if (matches.length !== 1) throw new Error(`Expected exactly one CHANGELOG section for ${tag}`);
  const start = matches[0] + 1;
  const next = lines.findIndex((line, index) => index >= start && line.startsWith('## '));
  const notes = lines.slice(start, next < 0 ? undefined : next).join('\n').trim();
  if (!notes) throw new Error(`CHANGELOG section for ${tag} is empty`);
  return `${notes}\n`;
}

if (require.main === module) {
  const root = path.resolve(__dirname, '..');
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  process.stdout.write(releaseNotes(process.argv[2], manifest.version,
    fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8')));
}

module.exports = { releaseNotes };
