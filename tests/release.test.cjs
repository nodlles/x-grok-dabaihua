const { test } = require('node:test');
const assert = require('node:assert/strict');
const { releaseNotes } = require('../scripts/release-notes.cjs');

test('release notes include only the exact version, preserving subsections and CRLF content', () => {
  const changelog = '# Changes\r\n\r\n## v0.4.10 date\r\nOther\r\n## v0.4.1 date\r\n\r\n### Added\r\n- API support\r\n\r\n## v0.4.0 date\r\nOld\r\n';
  assert.equal(releaseNotes('v0.4.1', '0.4.1', changelog), '### Added\n- API support\n');
  assert.equal(releaseNotes('v0.4.0', '0.4.0', changelog), 'Old\n');
});

test('release validation rejects mismatched versions and non-release tags', () => {
  assert.throws(() => releaseNotes('v0.4.1', '0.4.0', ''), /does not match/);
  for (const tag of ['main', '0.4.1', 'v0.4.1-beta.1', 'v00.4.1', 'v0.4.1\n', 'v0.4.1;echo bad']) {
    assert.throws(() => releaseNotes(tag, '0.4.1', ''), /stable version tag/);
  }
});

test('release validation rejects missing, empty or duplicate changelog sections', () => {
  for (const changelog of ['## v0.4.10\nWrong version', '## v0.4.1\n\n## v0.4.0\nOld', '## v0.4.1\nOne\n## v0.4.1\nTwo']) {
    assert.throws(() => releaseNotes('v0.4.1', '0.4.1', changelog), /CHANGELOG/);
  }
});
