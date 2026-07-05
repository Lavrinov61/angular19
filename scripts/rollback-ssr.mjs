#!/usr/bin/env node
/**
 * Standalone SSR rollback — откат на предыдущую версию билда.
 *
 * Использование:
 *   node scripts/rollback-ssr.mjs              # откат на предыдущую версию
 *   node scripts/rollback-ssr.mjs magnus-photo-v1709312345  # откат на конкретную версию
 */

import { execSync } from 'child_process';
import { existsSync, readdirSync, statSync } from 'fs';
import { resolve, join } from 'path';

const APP_DIR = resolve(import.meta.dirname, '..');
const DIST_DIR = join(APP_DIR, 'dist');
const SYMLINK_PATH = join(DIST_DIR, 'magnus-photo');

function log(msg) {
  console.log(`[rollback-ssr] ${new Date().toISOString()} ${msg}`);
}

function getCurrentSymlinkTarget() {
  try {
    return execSync(`readlink ${SYMLINK_PATH}`, { encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function checkSsrHealth(retries = 5, delayMs = 2000) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch('http://localhost:4000/ssr-health');
      if (res.ok) {
        const data = await res.json();
        if (data.success) return true;
      }
    } catch (_) {}
    if (i < retries - 1) {
      log(`SSR not ready yet, retrying in ${delayMs}ms... (${i + 1}/${retries})`);
      await sleep(delayMs);
    }
  }
  return false;
}

function listVersions() {
  const entries = readdirSync(DIST_DIR)
    .filter(e => e.startsWith('magnus-photo-v') && statSync(join(DIST_DIR, e)).isDirectory())
    .sort((a, b) => statSync(join(DIST_DIR, b)).mtimeMs - statSync(join(DIST_DIR, a)).mtimeMs);
  return entries;
}

async function main() {
  const current = getCurrentSymlinkTarget();
  log(`Current version: ${current || '(unknown)'}`);

  const versions = listVersions();
  if (versions.length === 0) {
    log('ERROR: No build versions found in dist/');
    process.exit(1);
  }

  let target = process.argv[2];

  if (!target) {
    // Найти предыдущую версию (не текущую)
    const prev = versions.find(v => v !== current);
    if (!prev) {
      log('ERROR: No previous version available for rollback.');
      log('Available versions:');
      versions.forEach(v => log(`  ${v === current ? '→' : ' '} ${v}`));
      process.exit(1);
    }
    target = prev;
  }

  if (!existsSync(join(DIST_DIR, target))) {
    log(`ERROR: Version ${target} does not exist.`);
    log('Available versions:');
    versions.forEach(v => log(`  ${v === current ? '→' : ' '} ${v}`));
    process.exit(1);
  }

  if (target === current) {
    log(`Already on ${target}, nothing to do.`);
    process.exit(0);
  }

  log(`Rolling back: ${current} → ${target}`);

  // Atomic symlink swap
  execSync(`ln -sfn ${target} ${SYMLINK_PATH}`, { cwd: APP_DIR });
  log(`Symlink updated: dist/magnus-photo -> ${target}`);

  // PM2 reload
  log('Reloading SSR...');
  execSync('pm2 restart magnus-photo-ssr', { stdio: 'inherit', cwd: APP_DIR });

  // Health check
  log('Checking health...');
  const ok = await checkSsrHealth(8, 3000);
  if (ok) {
    log(`ROLLBACK SUCCESSFUL — now running ${target}`);
  } else {
    log('WARNING: Health check failed after rollback. Check pm2 logs.');
    process.exit(1);
  }
}

main().catch(err => {
  console.error('[rollback-ssr] Fatal error:', err);
  process.exit(1);
});
