import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createApiClientFromEnv } from '../src/client/from-env.js';

function baseUrlWith(value: string | undefined): string {
  const previous = process.env.TRIBEUNAL_API_BASE_URL;
  if (value === undefined) {
    delete process.env.TRIBEUNAL_API_BASE_URL;
  } else {
    process.env.TRIBEUNAL_API_BASE_URL = value;
  }
  try {
    return (createApiClientFromEnv() as any).client.defaults.baseURL;
  } finally {
    if (previous === undefined) {
      delete process.env.TRIBEUNAL_API_BASE_URL;
    } else {
      process.env.TRIBEUNAL_API_BASE_URL = previous;
    }
  }
}

test('createApiClientFromEnv targets production when TRIBEUNAL_API_BASE_URL is unset', () => {
  assert.equal(baseUrlWith(undefined), 'https://tribeunal.com/api');
});

test('createApiClientFromEnv targets production when TRIBEUNAL_API_BASE_URL is empty', () => {
  assert.equal(baseUrlWith(''), 'https://tribeunal.com/api');
});

test('createApiClientFromEnv honours an explicit TRIBEUNAL_API_BASE_URL', () => {
  assert.equal(baseUrlWith('https://tribeunal.test/api'), 'https://tribeunal.test/api');
});
