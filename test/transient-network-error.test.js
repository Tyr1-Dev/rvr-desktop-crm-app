'use strict';

/**
 * test/transient-network-error.test.js - added 2026-09-18.
 *
 * The bug: reported via App Error Tracking, execution 7889 - David's app threw
 * "Error: net::ERR_NETWORK_IO_SUSPENDED" from the auto-updater's half-hourly
 * background check. That is Windows suspending the network stack around
 * sleep/wake, not a broken update feed, and it clears itself on the next
 * timer tick regardless. The 'error' handler in initAutoUpdate() reported
 * every autoUpdater failure unconditionally, so this - and other routine,
 * self-resolving network conditions - reached tech@ as if they were bugs.
 *
 * The fix: isTransientNetworkError() in main.js filters known OS/network
 * transport error codes out of that report. A genuine feed break (bad token,
 * renamed/private repo, a real HTTP error) is not on the list and still
 * reports as before.
 *
 * Pulls the real isTransientNetworkError() out of main.js (which cannot be
 * required outside Electron) the same way test/transfer-timeout.test.js pulls
 * out staffFacingMessage() - read the source, slice out the function by brace
 * counting, and run it in a vm sandbox.
 *
 * Run with:  node test/transient-network-error.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const APP_ROOT = path.join(__dirname, '..');

let passed = 0;
let failed = 0;
function check(name, fn) {
  try { fn(); passed++; console.log(`  ok   ${name}`); }
  catch (e) { failed++; console.log(`  FAIL ${name}\n       ${e.message}`); }
}

function loadIsTransientNetworkError() {
  const mainSrc = fs.readFileSync(path.join(APP_ROOT, 'src', 'main', 'main.js'), 'utf8');

  const arrayMarker = 'const TRANSIENT_NETWORK_ERROR_CODES = [';
  const arrayStart = mainSrc.indexOf(arrayMarker);
  if (arrayStart < 0) throw new Error('TRANSIENT_NETWORK_ERROR_CODES not found in main.js');
  const arrayEnd = mainSrc.indexOf('];', arrayStart) + 2;

  const fnMarker = 'function isTransientNetworkError(err) {';
  const fnStart = mainSrc.indexOf(fnMarker);
  if (fnStart < 0) throw new Error('isTransientNetworkError() not found in main.js');
  let depth = 0;
  let fnEnd = -1;
  for (let j = mainSrc.indexOf('{', fnStart); j < mainSrc.length; j++) {
    if (mainSrc[j] === '{') depth++;
    else if (mainSrc[j] === '}') { depth--; if (depth === 0) { fnEnd = j + 1; break; } }
  }
  if (fnEnd < 0) throw new Error('could not find the end of isTransientNetworkError()');

  const sandbox = { module: { exports: {} } };
  vm.createContext(sandbox);
  const source = `${mainSrc.slice(arrayStart, arrayEnd)}\n${mainSrc.slice(fnStart, fnEnd)}\nmodule.exports.__isTransientNetworkError = isTransientNetworkError;`;
  vm.runInContext(source, sandbox, { filename: 'isTransientNetworkError.js' });
  return sandbox.module.exports.__isTransientNetworkError;
}

const isTransientNetworkError = loadIsTransientNetworkError();

console.log('transient network error filter checks\n');

check('the exact reported error (net::ERR_NETWORK_IO_SUSPENDED) is treated as transient', () => {
  const err = new Error('net::ERR_NETWORK_IO_SUSPENDED');
  assert.strictEqual(isTransientNetworkError(err), true);
});

check('other well-known OS/network-transport codes are also treated as transient', () => {
  ['net::ERR_INTERNET_DISCONNECTED', 'net::ERR_NETWORK_CHANGED', 'net::ERR_NAME_NOT_RESOLVED']
    .forEach((message) => {
      assert.strictEqual(isTransientNetworkError(new Error(message)), true, message);
    });
});

check('a genuine update-feed failure (e.g. a 404 from a renamed/private repo) still reports', () => {
  const err = new Error('HttpError: 404 Not Found');
  assert.strictEqual(isTransientNetworkError(err), false);
});

check('an error with no message at all does not crash the check', () => {
  assert.strictEqual(isTransientNetworkError(new Error()), false);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
