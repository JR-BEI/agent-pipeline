'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const yaml = require('js-yaml');

const ROOT = path.resolve(__dirname, '..');
const FORM = path.join(ROOT, 'kit', '.github', 'ISSUE_TEMPLATE', 'ticket.yml');
const PARSER = path.join(ROOT, 'kit', 'scripts', 'lane', 'ticket-parse.mjs');
const SAMPLE = path.join(__dirname, 'fixtures', 'ticket-sample.md');

function temporaryCheckout(body = fs.readFileSync(SAMPLE, 'utf8')) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ticket-parse-test-'));
  const specDirectory = path.join(root, 'docs', 'specs');
  fs.mkdirSync(specDirectory, { recursive: true });
  fs.writeFileSync(path.join(specDirectory, 'sample-ticket.md'), '# Sample ticket\n');

  const gh = path.join(root, 'gh');
  fs.writeFileSync(gh, `#!/bin/sh
cat "${path.join(root, 'issue-body.md')}"
`);
  fs.writeFileSync(path.join(root, 'issue-body.md'), body);
  fs.chmodSync(gh, 0o755);
  return { root, gh };
}

function runParser(checkout) {
  return spawnSync(process.execPath, [PARSER, '42', 'example-org/example'], {
    cwd: checkout.root,
    encoding: 'utf8',
    env: { ...process.env, PIPELINE_GH: checkout.gh },
  });
}

test('issue form has the requested fields, order, choices, and required state', () => {
  const form = yaml.load(fs.readFileSync(FORM, 'utf8'));
  assert.equal(form.name, 'Pipeline ticket');
  assert.deepEqual(form.labels, ['draft']);
  assert.deepEqual(form.body.map((field) => [field.id, field.type]), [
    ['spec', 'input'],
    ['acceptance_checks', 'textarea'],
    ['allowed_paths', 'textarea'],
    ['components', 'textarea'],
    ['new_components', 'textarea'],
    ['migration', 'dropdown'],
    ['tier', 'dropdown'],
    ['budget_usd', 'input'],
    ['deploy', 'dropdown'],
    ['depends_on', 'input'],
  ]);
  assert.deepEqual(form.body.find((field) => field.id === 'migration').attributes.options, ['none', 'yes']);
  assert.deepEqual(form.body.find((field) => field.id === 'tier').attributes.options, ['light', 'standard', 'hard']);
  assert.deepEqual(form.body.find((field) => field.id === 'deploy').attributes.options, ['preview', 'production']);

  const optional = new Set(['components', 'new_components', 'depends_on']);
  for (const field of form.body) {
    assert.equal(field.validations?.required === true, !optional.has(field.id), field.id);
  }
});

test('ticket parser fetches the issue with gh and prints typed JSON', (t) => {
  const checkout = temporaryCheckout();
  t.after(() => fs.rmSync(checkout.root, { recursive: true, force: true }));

  const result = runParser(checkout);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    spec: 'docs/specs/sample-ticket.md',
    acceptance_checks: ['npm test', 'npm run lint'],
    allowed_paths: ['src/**', 'test/**'],
    components: ['Button', 'Card'],
    new_components: ['PipelineStatus'],
    migration: 'none',
    tier: 'standard',
    budget_usd: 12.5,
    deploy: 'preview',
    depends_on: [12, 34],
  });
});

test('ticket parser lists all requested validation errors and exits non-zero', (t) => {
  const body = `### spec

docs/specs/missing.md

### acceptance_checks

_No response_

### allowed_paths

_No response_

### budget_usd

0
`;
  const checkout = temporaryCheckout(body);
  t.after(() => fs.rmSync(checkout.root, { recursive: true, force: true }));

  const result = runParser(checkout);
  assert.notEqual(result.status, 0);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /spec does not exist: docs\/specs\/missing\.md/);
  assert.match(result.stderr, /acceptance_checks must contain at least one command/);
  assert.match(result.stderr, /allowed_paths must contain at least one glob/);
  assert.match(result.stderr, /budget_usd must be a number greater than 0/);
});
