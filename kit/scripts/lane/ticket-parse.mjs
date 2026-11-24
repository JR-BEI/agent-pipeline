#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const FIELD_NAMES = [
  'spec',
  'acceptance_checks',
  'allowed_paths',
  'components',
  'new_components',
  'migration',
  'tier',
  'budget_usd',
  'deploy',
  'depends_on',
];

function usage() {
  console.error('Usage: ticket-parse.mjs <issue-number> <owner/repo>');
}

function fetchIssueBody(issueNumber, repo) {
  const gh = process.env.PIPELINE_GH || 'gh';
  const result = spawnSync(
    gh,
    ['issue', 'view', issueNumber, '--repo', repo, '--json', 'body', '--jq', '.body'],
    { encoding: 'utf8' },
  );

  if (result.error) {
    throw new Error(`could not run gh: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const detail = result.stderr.trim() || `gh exited with status ${result.status}`;
    throw new Error(`could not fetch issue: ${detail}`);
  }
  return result.stdout;
}

function parseSections(body) {
  const sections = Object.fromEntries(FIELD_NAMES.map((name) => [name, '']));
  let current = null;

  for (const line of body.replace(/\r\n?/g, '\n').split('\n')) {
    const heading = line.match(/^###\s+(.+?)\s*$/);
    if (heading) {
      current = FIELD_NAMES.includes(heading[1]) ? heading[1] : null;
      continue;
    }
    if (current) sections[current] += `${line}\n`;
  }

  for (const name of FIELD_NAMES) {
    sections[name] = sections[name].trim();
    if (sections[name] === '_No response_') sections[name] = '';
  }
  return sections;
}

function lines(value) {
  return value.split('\n').map((line) => line.trim()).filter(Boolean);
}

function issueNumbers(value) {
  if (!value) return [];
  return value.split(',').map((item) => item.trim().replace(/^#/, '')).filter(Boolean).map((item) => {
    const number = Number(item);
    return Number.isInteger(number) && number > 0 ? number : item;
  });
}

function buildTicket(sections) {
  return {
    spec: sections.spec,
    acceptance_checks: lines(sections.acceptance_checks),
    allowed_paths: lines(sections.allowed_paths),
    components: lines(sections.components),
    new_components: lines(sections.new_components),
    migration: sections.migration,
    tier: sections.tier,
    budget_usd: Number(sections.budget_usd),
    deploy: sections.deploy,
    depends_on: issueNumbers(sections.depends_on),
  };
}

function validate(ticket) {
  const errors = [];
  const specPath = path.resolve(process.cwd(), ticket.spec);

  if (!ticket.spec || !fs.existsSync(specPath)) {
    errors.push(`spec does not exist: ${ticket.spec || '(empty)'}`);
  }
  if (ticket.acceptance_checks.length === 0) {
    errors.push('acceptance_checks must contain at least one command');
  }
  if (ticket.allowed_paths.length === 0) {
    errors.push('allowed_paths must contain at least one glob');
  }
  if (!Number.isFinite(ticket.budget_usd) || ticket.budget_usd <= 0) {
    errors.push('budget_usd must be a number greater than 0');
  }
  return errors;
}

const [issueNumber, repo, ...extra] = process.argv.slice(2);
if (!issueNumber || !repo || extra.length > 0) {
  usage();
  process.exitCode = 1;
} else {
  try {
    const ticket = buildTicket(parseSections(fetchIssueBody(issueNumber, repo)));
    const errors = validate(ticket);
    if (errors.length > 0) {
      console.error(['Validation errors:', ...errors.map((error) => `- ${error}`)].join('\n'));
      process.exitCode = 1;
    } else {
      console.log(JSON.stringify(ticket, null, 2));
    }
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exitCode = 1;
  }
}
