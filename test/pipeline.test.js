'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const yaml = require('js-yaml');

const ROOT = path.resolve(__dirname, '..');
const CLI = path.join(ROOT, 'bin', 'pipeline');
const FIXTURE = path.join(__dirname, 'fixtures', 'sample-app');

function temporaryApp() {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pipeline-kit-test-'));
  const app = path.join(temporaryRoot, 'sample-app');
  fs.cpSync(FIXTURE, app, { recursive: true });
  return { temporaryRoot, app };
}

function run(args, options = {}) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, ...options.env },
  });
}

function configureModels(app, update = () => {}) {
  const file = path.join(app, 'pipeline.yml');
  const config = yaml.load(fs.readFileSync(file, 'utf8'));
  config.models = {
    tiers: { light: 'gpt-light', standard: 'gpt-standard', hard: 'gpt-hard' },
    reviewer: {
      'gpt-light': 'gpt-hard',
      'gpt-standard': 'gpt-hard',
      'gpt-hard': 'claude-reviewer',
    },
    review_location: { openai: 'mac', anthropic: 'ci' },
    escalations_per_ticket: 1,
  };
  update(config.models);
  fs.writeFileSync(file, yaml.dump(config));
}

function updateConfig(app, update) {
  const file = path.join(app, 'pipeline.yml');
  const config = yaml.load(fs.readFileSync(file, 'utf8'));
  update(config);
  fs.writeFileSync(file, yaml.dump(config));
}

function initConfigured(app) {
  const result = run(['init', app]);
  assert.equal(result.status, 0, result.stderr);
  configureModels(app);
  updateConfig(app, (config) => {
    config.runner = { git_name: 'sample-bot', git_email: '1+sample-bot@users.noreply.github.com' };
  });
  return result;
}

function failureLines(stdout) {
  return stdout.split('\n').filter((line) => /\| FAIL\s+\|/.test(line));
}

function fakeGh(temporaryRoot) {
  const executable = path.join(temporaryRoot, 'gh');
  fs.writeFileSync(executable, `#!/bin/sh
if [ "$1" = "api" ]; then
  printf '%s\\n' '{"contexts":["ci","review"],"checks":[]}'
  exit 0
fi
exit 2
`);
  fs.chmodSync(executable, 0o755);
  return executable;
}

test('init copies the kit, infers package values, and removes stale owned content', (t) => {
  const { temporaryRoot, app } = temporaryApp();
  t.after(() => fs.rmSync(temporaryRoot, { recursive: true, force: true }));
  fs.mkdirSync(path.join(app, 'scripts', 'lane'), { recursive: true });
  fs.writeFileSync(path.join(app, 'scripts', 'lane', 'old-runner.js'), 'old\n');
  fs.mkdirSync(path.join(app, '.github', 'workflows'), { recursive: true });
  fs.writeFileSync(path.join(app, '.github', 'workflows', 'ci.yml'), 'old ci\n');

  const result = run(['init', app]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Plan: initialize pipeline kit/);
  assert.match(result.stdout, /DELETE .*ci\.yml/);
  assert.match(result.stdout, /Deleted scripts\/lane\//);
  assert.equal(fs.existsSync(path.join(app, 'scripts', 'lane', 'old-runner.js')), false);
  assert.equal(fs.existsSync(path.join(app, '.github', 'workflows', 'ci.yml')), false);
  assert.equal(fs.readFileSync(path.join(app, 'CLAUDE.md'), 'utf8').trim(), '@AGENTS.md');

  const config = yaml.load(fs.readFileSync(path.join(app, 'pipeline.yml'), 'utf8'));
  assert.equal(config.project, 'sample-app');
  assert.equal(config.commands.install, 'npm ci');
  assert.equal(config.commands.test, 'npm test');
  assert.equal(config.deploy.provider, 'vercel');
  assert.equal(config.database.provider, 'supabase');
  assert.equal(config.ui_library, '@example/ui');
  assert.deepEqual(config.models.reviewer, {});
  assert.deepEqual(config.models.review_location, { openai: 'mac', anthropic: 'ci' });
  assert.match(result.stdout, /Set models\.reviewer for every builder model ID/);
  assert.deepEqual(config.runner, { git_name: 'none', git_email: 'none' });
  assert.match(result.stdout, /Set runner\.git_name and runner\.git_email/);
  assert.equal(Object.prototype.hasOwnProperty.call(config, 'verify'), false);
  assert.deepEqual(config.owned_paths, [
    '.github/workflows/ci.yml',
    '.github/workflows/review.yml',
    '.github/workflows/migrate.yml',
    '.github/ISSUE_TEMPLATE/ticket.yml',
    'AGENTS.md',
    'CLAUDE.md',
    '.claude/settings.json',
    'scripts/lane/',
    'scripts/agent/',
  ]);
});

test('init preserves an existing AGENTS.md and pipeline.yml', (t) => {
  const { temporaryRoot, app } = temporaryApp();
  t.after(() => fs.rmSync(temporaryRoot, { recursive: true, force: true }));
  const agents = '# Existing project rules\n';
  const pipeline = 'project: existing\n';
  fs.writeFileSync(path.join(app, 'AGENTS.md'), agents);
  fs.writeFileSync(path.join(app, 'pipeline.yml'), pipeline);

  const result = run(['init', app]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.readFileSync(path.join(app, 'AGENTS.md'), 'utf8'), agents);
  assert.equal(fs.readFileSync(path.join(app, 'pipeline.yml'), 'utf8'), pipeline);
  assert.match(result.stdout, /KEEP   AGENTS\.md/);
  assert.match(result.stdout, /--- kit\/AGENTS\.md/);
  assert.match(result.stdout, /KEEP   pipeline\.yml/);
});

test('check accepts valid reviewer mappings without running project commands', (t) => {
  const { temporaryRoot, app } = temporaryApp();
  t.after(() => fs.rmSync(temporaryRoot, { recursive: true, force: true }));
  const initialized = initConfigured(app);
  assert.equal(initialized.status, 0, initialized.stderr);
  const gh = fakeGh(temporaryRoot);

  const result = run(['check', app], {
    env: { PIPELINE_GH: gh, GITHUB_REPOSITORY: 'example-org/sample-app' },
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /pipeline\.yml schema\s+\| PASS/);
  assert.match(result.stdout, /commands\.test\s+\| PASS\s+\| found npm; command not executed/);
  assert.match(result.stdout, /branch protection\s+\| PASS/);
  assert.match(result.stdout, /models\.reviewer\s+\| PASS/);
  assert.match(result.stdout, /owned: \.github\/workflows\/ci\.yml\s+\| SKIP/);
});

test('check reports per-file drift and exits non-zero', (t) => {
  const { temporaryRoot, app } = temporaryApp();
  t.after(() => fs.rmSync(temporaryRoot, { recursive: true, force: true }));
  initConfigured(app);
  fs.writeFileSync(path.join(app, 'CLAUDE.md'), 'drift\n');
  const gh = fakeGh(temporaryRoot);

  const result = run(['check', app], {
    env: { PIPELINE_GH: gh, GITHUB_REPOSITORY: 'example-org/sample-app' },
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /owned: CLAUDE\.md\s+\| FAIL\s+\| content drift/);
});

test('check accepts a project-specific AGENTS.md with Review protocol and rejects one without it', (t) => {
  const { temporaryRoot, app } = temporaryApp();
  t.after(() => fs.rmSync(temporaryRoot, { recursive: true, force: true }));
  initConfigured(app);
  const gh = fakeGh(temporaryRoot);
  const env = { PIPELINE_GH: gh, GITHUB_REPOSITORY: 'example-org/sample-app' };
  const agentsFile = path.join(app, 'AGENTS.md');

  fs.writeFileSync(agentsFile, '# Project-specific instructions\n\n## Review protocol\n');
  const accepted = run(['check', app], { env });
  assert.equal(accepted.status, 0, `${accepted.stdout}\n${accepted.stderr}`);
  assert.match(accepted.stdout, /owned: AGENTS\.md\s+\| PASS\s+\| contains Review protocol/);
  assert.doesNotMatch(accepted.stdout, /owned: AGENTS\.md.*content drift/);

  fs.writeFileSync(agentsFile, '# Project-specific instructions\n');
  const rejected = run(['check', app], { env });
  assert.notEqual(rejected.status, 0);
  assert.match(rejected.stdout, /owned: AGENTS\.md\s+\| FAIL\s+\| missing required line: Review protocol/);
});

test('inventory proposes legacy files without deleting them', (t) => {
  const { temporaryRoot, app } = temporaryApp();
  t.after(() => fs.rmSync(temporaryRoot, { recursive: true, force: true }));
  initConfigured(app);
  fs.mkdirSync(path.join(app, 'scripts', 'night'), { recursive: true });
  fs.writeFileSync(path.join(app, 'scripts', 'night', 'legacy.js'), 'legacy\n');
  fs.mkdirSync(path.join(app, '.claude', 'commands'), { recursive: true });
  fs.writeFileSync(path.join(app, '.claude', 'commands', 'unused.md'), 'unused\n');
  const gh = fakeGh(temporaryRoot);

  const result = run(['check', app, '--inventory'], {
    env: { PIPELINE_GH: gh, GITHUB_REPOSITORY: 'example-org/sample-app' },
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /proposed delete: scripts\/night\/legacy\.js/);
  assert.match(result.stdout, /proposed delete: \.claude\/commands\/unused\.md/);
  assert.equal(fs.existsSync(path.join(app, 'scripts', 'night', 'legacy.js')), true);
  assert.equal(fs.existsSync(path.join(app, '.claude', 'commands', 'unused.md')), true);
});

test('inventory never proposes files covered by keep_paths', (t) => {
  const { temporaryRoot, app } = temporaryApp();
  t.after(() => fs.rmSync(temporaryRoot, { recursive: true, force: true }));
  initConfigured(app);
  fs.mkdirSync(path.join(app, 'scripts', 'night'), { recursive: true });
  fs.writeFileSync(path.join(app, 'scripts', 'night', 'keep.js'), 'keep\n');
  fs.writeFileSync(path.join(app, 'scripts', 'night', 'remove.js'), 'remove\n');
  const configFile = path.join(app, 'pipeline.yml');
  const config = yaml.load(fs.readFileSync(configFile, 'utf8'));
  config.keep_paths = ['scripts/night/keep.js'];
  fs.writeFileSync(configFile, yaml.dump(config));
  const gh = fakeGh(temporaryRoot);

  const result = run(['check', app, '--inventory'], {
    env: { PIPELINE_GH: gh, GITHUB_REPOSITORY: 'example-org/sample-app' },
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.doesNotMatch(result.stdout, /proposed delete: scripts\/night\/keep\.js/);
  assert.match(result.stdout, /proposed delete: scripts\/night\/remove\.js/);
});

test('check rejects schema errors', (t) => {
  const { temporaryRoot, app } = temporaryApp();
  t.after(() => fs.rmSync(temporaryRoot, { recursive: true, force: true }));
  initConfigured(app);
  const config = yaml.load(fs.readFileSync(path.join(app, 'pipeline.yml'), 'utf8'));
  config.deploy.provider = 'somewhere';
  fs.writeFileSync(path.join(app, 'pipeline.yml'), yaml.dump(config));

  const result = run(['check', app], { env: { GITHUB_REPOSITORY: 'example-org/sample-app' } });
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /pipeline\.yml schema\s+\| FAIL/);
  assert.match(result.stdout, /must be one of vercel, none/);
});

const reviewerFailures = [
  {
    name: 'missing reviewer for a tier',
    update: (models) => { delete models.reviewer['gpt-standard']; },
    expected: ['missing reviewer for builder gpt-standard'],
  },
  {
    name: 'reviewer equal to builder',
    update: (models) => { models.reviewer['gpt-light'] = 'gpt-light'; },
    expected: ['reviewer gpt-light equals its builder gpt-light'],
  },
  {
    name: 'missing review_location',
    update: (models) => { delete models.review_location; },
    expected: ['$.models.review_location: is required'],
  },
  {
    name: 'missing provider location',
    update: (models) => { delete models.review_location.anthropic; },
    expected: ['$.models.review_location.anthropic: is required'],
  },
  {
    name: 'multiple reviewer problems on separate lines',
    update: (models) => {
      delete models.reviewer['gpt-standard'];
      models.reviewer['gpt-light'] = 'gpt-light';
    },
    expected: [
      'missing reviewer for builder gpt-standard',
      'reviewer gpt-light equals its builder gpt-light',
    ],
  },
  {
    name: 'self-review in an extra mapping',
    update: (models) => { models.reviewer['claude-extra'] = 'claude-extra'; },
    expected: ['reviewer claude-extra equals its builder claude-extra'],
  },
  {
    name: 'unknown reviewer provider',
    update: (models) => { models.reviewer['gpt-light'] = 'unknown-reviewer'; },
    expected: ['cannot infer provider for reviewer unknown-reviewer'],
  },
  {
    name: 'old reviewer string shape',
    update: (models) => { models.reviewer = 'claude-reviewer'; },
    expected: ['$.models.reviewer: expected object, got string'],
  },
  {
    name: 'non-string reviewer mapping value',
    update: (models) => { models.reviewer['gpt-light'] = 123; },
    expected: ['$.models.reviewer.gpt-light: expected string, got integer'],
  },
  {
    name: 'empty reviewer model ID',
    update: (models) => { models.reviewer['gpt-light'] = ''; },
    expected: ['$.models.reviewer.gpt-light: must contain at least 1 character(s)'],
  },
  {
    name: 'invalid review locations on separate lines',
    update: (models) => { models.review_location = { openai: 'local', anthropic: 'cloud' }; },
    expected: [
      '$.models.review_location.openai: must be one of mac, ci',
      '$.models.review_location.anthropic: must be one of mac, ci',
    ],
  },
];

for (const { name, update, expected } of reviewerFailures) {
  test(`check rejects ${name}`, (t) => {
    const { temporaryRoot, app } = temporaryApp();
    t.after(() => fs.rmSync(temporaryRoot, { recursive: true, force: true }));
    initConfigured(app);
    configureModels(app, update);
    const gh = fakeGh(temporaryRoot);
    const result = run(['check', app], {
      env: { PIPELINE_GH: gh, GITHUB_REPOSITORY: 'example-org/sample-app' },
    });
    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
    const failures = result.stdout.split('\n').filter((line) => /\| FAIL\s+\|/.test(line));
    assert.equal(failures.length, expected.length, result.stdout);
    for (const problem of expected) {
      assert.equal(failures.filter((line) => line.includes(problem)).length, 1, result.stdout);
    }
  });
}

test('check accepts a full pipeline.yml with runner, verify, supabase, snapshots, and wall-clock budgets', (t) => {
  const { temporaryRoot, app } = temporaryApp();
  t.after(() => fs.rmSync(temporaryRoot, { recursive: true, force: true }));
  initConfigured(app);
  const fullConfig = yaml.load(fs.readFileSync(path.join(__dirname, 'fixtures', 'full-pipeline.yml'), 'utf8'));
  assert.ok(fullConfig.verify.real_data_diff.command);
  assert.ok(fullConfig.runner.git_email);
  // Keep the sample app's owned paths and commands so only the schema is under test.
  updateConfig(app, (config) => {
    for (const key of ['verify', 'supabase', 'snapshots', 'runner', 'models', 'keep_paths']) config[key] = fullConfig[key];
    config.budget = fullConfig.budget;
  });
  const gh = fakeGh(temporaryRoot);

  const result = run(['check', app], {
    env: { PIPELINE_GH: gh, GITHUB_REPOSITORY: 'example-org/sample-app' },
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /pipeline\.yml schema\s+\| PASS\s+\| valid/);
});

test('check validates the full example pipeline.yml fixture against the schema', (t) => {
  const { temporaryRoot, app } = temporaryApp();
  t.after(() => fs.rmSync(temporaryRoot, { recursive: true, force: true }));
  fs.copyFileSync(path.join(__dirname, 'fixtures', 'full-pipeline.yml'), path.join(app, 'pipeline.yml'));

  // Owned paths are not initialized here, so only the schema row is asserted.
  const result = run(['check', app], { env: { PIPELINE_GH: fakeGh(temporaryRoot), GITHUB_REPOSITORY: 'example-org/sample-app' } });
  assert.match(result.stdout, /pipeline\.yml schema\s+\| PASS\s+\| valid/);
  assert.doesNotMatch(result.stdout, /pipeline\.yml schema\s+\| FAIL/);
});

const configFailures = [
  {
    name: 'a real_data_diff with paths but no command',
    update: (config) => { config.verify = { real_data_diff: { paths: ['lib/ingest/*.ts'] } }; },
    expected: ['$.verify.real_data_diff.command: is required when paths are set; give the command the runner runs once on base and once on head'],
  },
  {
    name: 'a real_data_diff with a command but no paths',
    update: (config) => { config.verify = { real_data_diff: { command: 'node diff.mjs' } }; },
    expected: ['$.verify.real_data_diff.paths: is required; list the repository-relative globs whose changes trigger the diff'],
  },
  {
    name: 'a real_data_diff with an empty paths list',
    update: (config) => { config.verify = { real_data_diff: { paths: [], command: 'node diff.mjs' } }; },
    expected: ['$.verify.real_data_diff.paths: must contain at least 1 item(s)'],
  },
  {
    name: 'a real_data_diff with a blank command',
    update: (config) => { config.verify = { real_data_diff: { paths: ['lib/**'], command: '   ' } }; },
    expected: ['$.verify.real_data_diff.command: must be a non-empty command'],
  },
  {
    name: 'real_data_diff globs that are absolute, climb out, or are blank',
    update: (config) => { config.verify = { real_data_diff: { paths: ['/etc/*', 'lib/../secrets/*', ' '], command: 'node diff.mjs' } }; },
    expected: [
      '$.verify.real_data_diff.paths[0]: must be a repository-relative glob',
      '$.verify.real_data_diff.paths[1]: must be a repository-relative glob',
      '$.verify.real_data_diff.paths[2]: must be a repository-relative glob',
    ],
  },
  {
    name: 'an unknown real_data_diff field',
    update: (config) => { config.verify = { real_data_diff: { paths: ['lib/**'], command: 'node diff.mjs', gate: true } }; },
    expected: ['$.verify.real_data_diff.gate: unknown field'],
  },
  {
    name: 'a missing runner',
    update: (config) => { delete config.runner; },
    expected: ['$.runner: is required'],
  },
  {
    name: 'a runner without git_name',
    update: (config) => { delete config.runner.git_name; },
    expected: ['$.runner.git_name: is required'],
  },
  {
    name: 'the starter runner placeholder email',
    update: (config) => { config.runner.git_email = 'none'; },
    expected: ['$.runner.git_email: must be an email address; use the GitHub account noreply address'],
  },
  {
    name: 'snapshot parts over the storage limit',
    update: (config) => { config.snapshots = { keep: 3, part_mb: 46 }; },
    expected: ['$.snapshots.part_mb: must be at most 45'],
  },
  {
    name: 'a zero wall-clock budget',
    update: (config) => { config.budget.wall_clock_minutes = { light: 0, standard: 45, hard: 90 }; },
    expected: ['$.budget.wall_clock_minutes.light: must be at least 1'],
  },
  {
    name: 'an invalid Supabase project ref',
    update: (config) => { config.supabase = { project_ref: 'Not A Ref' }; },
    expected: ['$.supabase.project_ref: must be a Supabase project ref'],
  },
];

for (const { name, update, expected } of configFailures) {
  test(`check rejects ${name}`, (t) => {
    const { temporaryRoot, app } = temporaryApp();
    t.after(() => fs.rmSync(temporaryRoot, { recursive: true, force: true }));
    initConfigured(app);
    updateConfig(app, update);
    const gh = fakeGh(temporaryRoot);
    const result = run(['check', app], {
      env: { PIPELINE_GH: gh, GITHUB_REPOSITORY: 'example-org/sample-app' },
    });
    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
    const failures = failureLines(result.stdout);
    assert.equal(failures.length, expected.length, result.stdout);
    for (const problem of expected) {
      assert.equal(failures.filter((line) => line.includes(problem)).length, 1, result.stdout);
    }
  });
}
