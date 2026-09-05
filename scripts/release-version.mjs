#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { execFileSync } from 'node:child_process';

const root = process.cwd();
const appPackagePath = path.join(root, 'apps/mobile/package.json');
const compatibilityPath = path.join(root, 'packages/core/src/compatibility.ts');
const androidGradlePath = path.join(root, 'apps/mobile/android/app/build.gradle');

function usage() {
  console.log(`Usage:
  node scripts/release-version.mjs preflight
  node scripts/release-version.mjs next
  node scripts/release-version.mjs check <version>
  node scripts/release-version.mjs bump <version> [--code <versionCode>]
  node scripts/release-version.mjs bump-next [--code <versionCode>]`);
  process.exitCode = 1;
}

function git(args) {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  } catch (error) {
    const detail = error?.stderr?.toString().trim();
    throw new Error(detail ? `Git command failed: ${detail}` : `Git command failed: git ${args.join(' ')}`);
  }
}

function assertReleaseState() {
  let branch = '';
  try {
    branch = git(['symbolic-ref', '--quiet', '--short', 'HEAD']);
  } catch {
    branch = '';
  }
  if (branch !== 'master') {
    throw new Error(`Release must start from the master branch (current: ${branch || 'detached HEAD'}).`);
  }
  if (git(['status', '--porcelain']) !== '') {
    throw new Error('Release requires a clean working tree. Commit or discard all local changes first.');
  }
}

function incrementReleaseVersion(version) {
  const parsed = parseSemanticVersion(version);
  let { major, minor, patch } = parsed;
  patch += 1;
  if (patch >= 100) {
    patch = 0;
    minor += 1;
  }
  if (minor >= 1000) {
    minor = 0;
    major += 1;
  }
  return `${major}.${minor}.${patch}`;
}

function latestTaggedVersion() {
  const tags = git(['tag', '--list', 'v*', '--sort=-v:refname'])
    .split(/\r?\n/)
    .map(value => value.trim())
    .filter(Boolean);
  if (tags.length === 0) {
    throw new Error('No previous v* release tag found; provide an explicit version to bump.');
  }
  return parseSemanticVersion(tags[0]).version;
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

function parseSemanticVersion(value) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(value);
  if (!match) {
    throw new Error(`Version must be semantic MAJOR.MINOR.PATCH, got: ${value}`);
  }
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    version: `${Number(match[1])}.${Number(match[2])}.${Number(match[3])}`,
  };
}

function defaultVersionCode(version) {
  const { major, minor, patch } = parseSemanticVersion(version);
  if (major > 999 || minor > 999 || patch > 99) {
    throw new Error('Version is too large for the default versionCode mapping');
  }
  return major * 1_000_000 + minor * 10_000 + patch * 100;
}

function replaceFirst(content, pattern, replacement, label) {
  if (!pattern.test(content)) {
    throw new Error(`Cannot update ${label}`);
  }
  return content.replace(pattern, replacement);
}

async function check(expectedVersion) {
  const normalized = parseSemanticVersion(expectedVersion).version ?? expectedVersion;
  const appPackage = await readJson(appPackagePath);
  const compatibility = await fs.readFile(compatibilityPath, 'utf8');
  const gradle = await fs.readFile(androidGradlePath, 'utf8');

  const packageVersion = appPackage.version;
  const appVersion = /export const APP_VERSION = '([^']+)'/.exec(compatibility)?.[1];
  const versionName = /^\s*versionName "([^"]+)"$/m.exec(gradle)?.[1];
  const versionCode = /^\s*versionCode (\d+)$/m.exec(gradle)?.[1];

  const mismatches = [];
  if (packageVersion !== normalized) mismatches.push(`apps/mobile/package.json: ${packageVersion}`);
  if (appVersion !== normalized) mismatches.push(`APP_VERSION: ${appVersion}`);
  if (versionName !== normalized) mismatches.push(`versionName: ${versionName}`);
  if (!/^\d+$/.test(versionCode ?? '') || Number(versionCode) <= 0) {
    mismatches.push(`versionCode: ${versionCode}`);
  }

  if (mismatches.length > 0) {
    throw new Error(`Release version ${normalized} is inconsistent:\n${mismatches.join('\n')}`);
  }
  console.log(`Release version ${normalized} is consistent (versionCode ${versionCode}).`);
}

async function bump(expectedVersion, versionCode) {
  assertReleaseState();
  const version = parseSemanticVersion(expectedVersion);
  const normalized = `${version.major}.${version.minor}.${version.patch}`;
  const appPackage = await readJson(appPackagePath);
  const gradleBefore = await fs.readFile(androidGradlePath, 'utf8');
  const currentCode = Number(/^\s*versionCode (\d+)$/m.exec(gradleBefore)?.[1] ?? 0);
  const safeDefaultCode = Math.max(defaultVersionCode(normalized), currentCode + 1);
  const code = versionCode ?? safeDefaultCode;
  if (!Number.isInteger(code) || code <= 0) {
    throw new Error(`versionCode must be a positive integer, got: ${code}`);
  }
  appPackage.version = normalized;
  await fs.writeFile(appPackagePath, `${JSON.stringify(appPackage, null, 2)}\n`);

  let compatibility = await fs.readFile(compatibilityPath, 'utf8');
  compatibility = replaceFirst(
    compatibility,
    /export const APP_VERSION = '[^']+'/,
    `export const APP_VERSION = '${normalized}'`,
    'APP_VERSION',
  );
  await fs.writeFile(compatibilityPath, compatibility);

  let gradle = gradleBefore;
  gradle = gradle
    .replace(/^(\s*versionCode )\d+$/m, `$1${code}`)
    .replace(/^(\s*versionName ")[^"]+(")$/m, `$1${normalized}$2`);
  if (!gradle.includes(`versionCode ${code}`) || !gradle.includes(`versionName "${normalized}"`)) {
    throw new Error('Failed to update Android version metadata');
  }
  await fs.writeFile(androidGradlePath, gradle);

  console.log(`Bumped release version to ${normalized} (versionCode ${code}).`);
}

const cliArgs = process.argv.slice(2);
const command = cliArgs[0];
const version = command === 'bump-next' ? undefined : cliArgs[1];
const optionIndex = command === 'bump-next' ? 1 : 2;
const codeFlag = cliArgs[optionIndex];
const codeValue = cliArgs[optionIndex + 1];
try {
  if (command === 'preflight') {
    assertReleaseState();
    console.log('Release preflight passed: on master with a clean working tree.');
  } else if (command === 'next') {
    assertReleaseState();
    const previous = latestTaggedVersion();
    console.log(incrementReleaseVersion(previous));
  } else if (command === 'check' && version) {
    await check(version);
  } else if (command === 'bump' && version) {
    const explicitCode = codeFlag === '--code' ? Number(codeValue) : undefined;
    if (codeFlag === '--code' && (!Number.isInteger(explicitCode) || explicitCode <= 0)) {
      throw new Error(`--code expects a positive integer, got: ${codeValue}`);
    }
    await bump(version, explicitCode);
  } else if (command === 'bump-next') {
    assertReleaseState();
    const explicitCode = codeFlag === '--code' ? Number(codeValue) : undefined;
    if (codeFlag === '--code' && (!Number.isInteger(explicitCode) || explicitCode <= 0)) {
      throw new Error(`--code expects a positive integer, got: ${codeValue}`);
    }
    const previous = latestTaggedVersion();
    const next = incrementReleaseVersion(previous);
    await bump(next, explicitCode);
  } else {
    usage();
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
