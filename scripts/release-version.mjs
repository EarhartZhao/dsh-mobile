#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const appPackagePath = path.join(root, 'apps/mobile/package.json');
const compatibilityPath = path.join(root, 'packages/core/src/compatibility.ts');
const androidGradlePath = path.join(root, 'apps/mobile/android/app/build.gradle');

function usage() {
  console.log(`Usage:
  node scripts/release-version.mjs check <version>
  node scripts/release-version.mjs bump <version> [--code <versionCode>]`);
  process.exitCode = 1;
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
  const version = parseSemanticVersion(expectedVersion);
  const normalized = `${version.major}.${version.minor}.${version.patch}`;
  const code = versionCode ?? defaultVersionCode(normalized);
  if (!Number.isInteger(code) || code <= 0) {
    throw new Error(`versionCode must be a positive integer, got: ${code}`);
  }

  const appPackage = await readJson(appPackagePath);
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

  let gradle = await fs.readFile(androidGradlePath, 'utf8');
  gradle = gradle
    .replace(/^(\s*versionCode )\d+$/m, `$1${code}`)
    .replace(/^(\s*versionName ")[^"]+(")$/m, `$1${normalized}$2`);
  if (!gradle.includes(`versionCode ${code}`) || !gradle.includes(`versionName "${normalized}"`)) {
    throw new Error('Failed to update Android version metadata');
  }
  await fs.writeFile(androidGradlePath, gradle);

  console.log(`Bumped release version to ${normalized} (versionCode ${code}).`);
}

const [command, version, codeFlag, codeValue] = process.argv.slice(2);
try {
  if (command === 'check' && version) {
    await check(version);
  } else if (command === 'bump' && version) {
    const explicitCode = codeFlag === '--code' ? Number(codeValue) : undefined;
    if (codeFlag === '--code' && (!Number.isInteger(explicitCode) || explicitCode <= 0)) {
      throw new Error(`--code expects a positive integer, got: ${codeValue}`);
    }
    await bump(version, explicitCode);
  } else {
    usage();
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
