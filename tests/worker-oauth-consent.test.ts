import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { test } from 'node:test';

// See worker-public-files.test.ts: tsx loads `worker/src` as CommonJS, so the
// module object is default-imported and destructured.
import handlerMod from '../worker/src/auth0-handler.ts';
const { Auth0Handler } = handlerMod as any;

/**
 * MCP clients register themselves (RFC 7591), so a client's name and redirect
 * URI are whatever the registrant typed, and Auth0 skips its own consent for
 * the single upstream application. The Worker's consent screen is therefore the
 * only place a person agrees to a particular client. These tests pin the rules
 * that keep that agreement real:
 *
 *  - the request being approved is held server-side, never read back from the form;
 *  - an approval only counts from the browser that was shown the screen;
 *  - the Auth0 round-trip only completes in the browser that started it;
 *  - PKCE S256 is required before anything is shown.
 */

const BASE = 'https://mcp.example';
const CLIENT = {
  clientId: 'client-1',
  clientName: 'Example Client',
  redirectUris: ['https://client.example/cb'],
};
const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

interface Harness {
  env: any;
  kv: Map<string, string>;
  completed: any[];
}

function harness(client: Record<string, unknown> = CLIENT): Harness {
  const kv = new Map<string, string>();
  const completed: any[] = [];
  const env = {
    OAUTH_KV: {
      get: async (key: string) => kv.get(key) ?? null,
      put: async (key: string, value: string) => void kv.set(key, value),
      delete: async (key: string) => void kv.delete(key),
    },
    COOKIE_ENCRYPTION_KEY: 'test-cookie-key',
    AUTH0_DOMAIN: 'tenant.example',
    AUTH0_CLIENT_ID: 'upstream-client',
    AUTH0_CLIENT_SECRET: 'upstream-secret',
    AUTH0_AUDIENCE: 'https://api.tribeunal.com',
    AUTH0_SCOPE: 'openid profile',
    OAUTH_PROVIDER: {
      // Mirrors the library: unknown clients and unregistered redirect URIs throw.
      parseAuthRequest: async (request: Request) => {
        const url = new URL(request.url);
        const clientId = url.searchParams.get('client_id') || '';
        const redirectUri = url.searchParams.get('redirect_uri') || '';
        if (clientId && clientId !== client.clientId) throw new Error('Invalid client.');
        if (redirectUri && !(client.redirectUris as string[]).includes(redirectUri)) {
          throw new Error('Invalid redirect URI.');
        }
        return {
          responseType: url.searchParams.get('response_type') || '',
          clientId,
          redirectUri,
          scope: (url.searchParams.get('scope') || '').split(' ').filter(Boolean),
          state: url.searchParams.get('state') || '',
          codeChallenge: url.searchParams.get('code_challenge') || undefined,
          codeChallengeMethod: url.searchParams.get('code_challenge_method') || 'plain',
        };
      },
      lookupClient: async (clientId: string) => (clientId === client.clientId ? client : null),
      completeAuthorization: async (options: any) => {
        completed.push(options);
        return { redirectTo: `${options.request.redirectUri}?code=issued&state=${options.request.state}` };
      },
    },
  };
  return { env, kv, completed };
}

function authorizeUrl(params: Record<string, string> = {}, base = BASE): string {
  const url = new URL('/authorize', base);
  const merged = {
    response_type: 'code',
    client_id: CLIENT.clientId,
    redirect_uri: CLIENT.redirectUris[0],
    state: 'client-state',
    code_challenge: CHALLENGE,
    code_challenge_method: 'S256',
    ...params,
  };
  for (const [key, value] of Object.entries(merged)) {
    if (value !== '') url.searchParams.set(key, value);
  }
  return url.href;
}

/** `name=value` pairs a browser would send back, from a response's Set-Cookie headers. */
function cookiesFrom(response: Response, jar: Record<string, string> = {}): Record<string, string> {
  for (const header of response.headers.getSetCookie()) {
    const [pair] = header.split(';');
    const eq = pair.indexOf('=');
    const name = pair.slice(0, eq);
    const value = pair.slice(eq + 1);
    if (/Max-Age=0\b/.test(header)) delete jar[name];
    else jar[name] = value;
  }
  return jar;
}

function cookieHeader(jar: Record<string, string>): string {
  return Object.entries(jar)
    .map(([name, value]) => `${name}=${value}`)
    .join('; ');
}

/** The cookie names the Worker derives from a consent token or an Auth0 state. */
const consentCookie = (token: string, prefix = '__Host-') => `${prefix}mcp-consent-${token.slice(0, 16)}`;
const loginCookie = (state: string, prefix = '__Host-') => `${prefix}mcp-login-${state.slice(0, 16)}`;

function consentToken(html: string): string {
  const match = html.match(/name="consent" value="([^"]+)"/);
  assert.ok(match, 'the consent form carries a consent token');
  return match[1];
}

function postConsent(env: any, token: string, jar: Record<string, string>): Promise<Response> {
  const headers: Record<string, string> = { 'content-type': 'application/x-www-form-urlencoded' };
  if (Object.keys(jar).length > 0) headers.cookie = cookieHeader(jar);
  return Auth0Handler.request(
    `${BASE}/authorize`,
    { method: 'POST', headers, body: new URLSearchParams({ consent: token }).toString() },
    env,
  );
}

/** GET the consent screen and approve it in the same browser. */
async function approve(h: Harness): Promise<{ response: Response; jar: Record<string, string> }> {
  const page = await Auth0Handler.request(authorizeUrl(), {}, h.env);
  const jar = cookiesFrom(page);
  const response = await postConsent(h.env, consentToken(await page.text()), jar);
  return { response, jar: cookiesFrom(response, jar) };
}

async function withFetch(stub: typeof globalThis.fetch, body: () => Promise<void>): Promise<void> {
  const real = globalThis.fetch;
  globalThis.fetch = stub;
  try {
    await body();
  } finally {
    globalThis.fetch = real;
  }
}

function auth0Tokens(): Response {
  const claims = Buffer.from(JSON.stringify({ sub: 'auth0|user-1', email: 'user@example.com' })).toString('base64url');
  return new Response(
    JSON.stringify({ access_token: 'upstream-access', id_token: `h.${claims}.s`, token_type: 'Bearer', expires_in: 3600 }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

// --- PKCE and request validation --------------------------------------------

test('authorize refuses a request with no PKCE challenge', async () => {
  const h = harness();
  const response = await Auth0Handler.request(authorizeUrl({ code_challenge: '', code_challenge_method: '' }), {}, h.env);
  assert.equal(response.status, 400);
  assert.match(await response.text(), /PKCE/);
  assert.equal(h.kv.size, 0);
});

test('authorize refuses S256 named without a code_challenge', async () => {
  // The library lets this through: it only objects to the plain method.
  const h = harness();
  const response = await Auth0Handler.request(authorizeUrl({ code_challenge: '' }), {}, h.env);
  assert.equal(response.status, 400);
  assert.match(await response.text(), /PKCE/);
  assert.equal(h.kv.size, 0);
});

test('authorize refuses the plain PKCE method', async () => {
  const h = harness();
  const response = await Auth0Handler.request(authorizeUrl({ code_challenge_method: 'plain' }), {}, h.env);
  assert.equal(response.status, 400);
  assert.match(await response.text(), /S256/);
});

test('an unknown client or unregistered redirect URI is a 400, not a 500', async () => {
  const h = harness();
  const unknown = await Auth0Handler.request(authorizeUrl({ client_id: 'nobody' }), {}, h.env);
  assert.equal(unknown.status, 400);
  const elsewhere = await Auth0Handler.request(authorizeUrl({ redirect_uri: 'https://elsewhere.example/cb' }), {}, h.env);
  assert.equal(elsewhere.status, 400);
});

test('authorize refuses a request that names no redirect URI', async () => {
  const h = harness();
  const response = await Auth0Handler.request(authorizeUrl({ redirect_uri: '' }), {}, h.env);
  assert.equal(response.status, 400);
});

// --- The consent screen -----------------------------------------------------

test('the consent screen names the destination and cannot be framed or cached', async () => {
  const h = harness();
  const response = await Auth0Handler.request(authorizeUrl(), {}, h.env);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('x-frame-options'), 'DENY');
  assert.match(response.headers.get('content-security-policy') ?? '', /frame-ancestors 'none'/);
  assert.equal(response.headers.get('cache-control'), 'no-store');

  const html = await response.text();
  assert.match(html, /Example Client/);
  assert.match(html, /https:\/\/client\.example\/cb/, 'the page shows where access is sent');
  assert.match(html, /not verified/i, 'the page says the client name is self-declared');
  assert.match(html, /onsubmit="[^"]*disabled=true"/, 'Approve cannot be submitted twice');
});

test('the consent form carries a token only, and the request is held server-side', async () => {
  const h = harness();
  const response = await Auth0Handler.request(authorizeUrl(), {}, h.env);
  const html = await response.text();
  const token = consentToken(html);

  assert.doesNotMatch(html, /name="state"/, 'the auth request is not round-tripped through the form');
  const stored = JSON.parse(h.kv.get(`consent:${token}`) ?? 'null');
  assert.equal(stored.clientId, CLIENT.clientId);
  assert.equal(stored.redirectUri, CLIENT.redirectUris[0]);

  const [cookie] = response.headers.getSetCookie();
  assert.match(cookie, new RegExp(`^${consentCookie(token)}=${token};`));
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /SameSite=Lax/);
  assert.match(cookie, /Path=\//);
});

test('client-supplied text is escaped on the consent screen', async () => {
  const h = harness({ ...CLIENT, clientName: '<img src=x onerror=alert(1)>' });
  const html = await (await Auth0Handler.request(authorizeUrl(), {}, h.env)).text();
  assert.doesNotMatch(html, /<img src=x/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
});

// --- Approving --------------------------------------------------------------

test('an approval posted without the consent cookie is refused', async () => {
  const h = harness();
  const page = await Auth0Handler.request(authorizeUrl(), {}, h.env);
  const token = consentToken(await page.text());

  const response = await postConsent(h.env, token, {});
  assert.equal(response.status, 400);
  assert.equal(response.headers.get('location'), null);
  assert.deepEqual(response.headers.getSetCookie(), []);
  assert.ok(h.kv.has(`consent:${token}`), 'a refused post does not burn the pending consent');
});

test('an approval whose token does not match the cookie is refused', async () => {
  const h = harness();
  const first = await Auth0Handler.request(authorizeUrl(), {}, h.env);
  const firstToken = consentToken(await first.text());
  const second = await Auth0Handler.request(authorizeUrl(), {}, h.env);
  const secondJar = cookiesFrom(second);

  const response = await postConsent(h.env, firstToken, secondJar);
  assert.equal(response.status, 400);
  assert.equal(response.headers.get('location'), null);

  const wrongValue = await postConsent(h.env, firstToken, { [consentCookie(firstToken)]: '0'.repeat(64) });
  assert.equal(wrongValue.status, 400);
});

test('a post that is not a form is a 400, not a 500', async () => {
  const h = harness();
  const response = await Auth0Handler.request(
    `${BASE}/authorize`,
    { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"consent":"x"}' },
    h.env,
  );
  assert.equal(response.status, 400);
});

test('a request described in the form body is never honoured', async () => {
  const h = harness();
  const forged = Buffer.from(
    JSON.stringify({ oauthReqInfo: { clientId: CLIENT.clientId, redirectUri: CLIENT.redirectUris[0], scope: [], state: 'x' } }),
  ).toString('base64');
  const response = await Auth0Handler.request(
    `${BASE}/authorize`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', origin: 'https://other.example' },
      body: new URLSearchParams({ state: forged }).toString(),
    },
    h.env,
  );
  assert.equal(response.status, 400);
  assert.equal(response.headers.get('location'), null);
  assert.deepEqual(response.headers.getSetCookie(), []);
  assert.equal(h.kv.size, 0, 'no login transaction is opened');
});

test('approving in the same browser goes to Auth0 and binds the login to that browser', async () => {
  const h = harness();
  const { response, jar } = await approve(h);

  assert.equal(response.status, 302);
  const location = new URL(response.headers.get('location')!);
  assert.equal(location.host, 'tenant.example');
  assert.equal(location.searchParams.get('code_challenge_method'), 'S256');
  const state = location.searchParams.get('state')!;

  assert.equal(jar[loginCookie(state)], state, 'the login cookie is the Auth0 state');
  assert.ok(jar['__Host-mcp-consented-clients'], 'the client is remembered');
  assert.deepEqual(Object.keys(jar).filter((name) => name.includes('mcp-consent-')), [], 'the consent cookie is cleared');

  const tx = JSON.parse(h.kv.get(`pkce:${state}`)!);
  assert.equal(tx.oauthReqInfo.clientId, CLIENT.clientId);
  assert.equal(tx.oauthReqInfo.codeChallenge, CHALLENGE);
});

test('a consent can be approved once', async () => {
  const h = harness();
  const page = await Auth0Handler.request(authorizeUrl(), {}, h.env);
  const jar = cookiesFrom(page);
  const token = consentToken(await page.text());

  assert.equal((await postConsent(h.env, token, jar)).status, 302);
  assert.equal((await postConsent(h.env, token, jar)).status, 400);
});

test('two sign-ins open in one browser do not break each other', async () => {
  const h = harness();
  const jar: Record<string, string> = {};
  const first = await Auth0Handler.request(authorizeUrl({ state: 'first' }), {}, h.env);
  const firstToken = consentToken(await first.text());
  cookiesFrom(first, jar);
  const second = await Auth0Handler.request(authorizeUrl({ state: 'second' }), {}, h.env);
  const secondToken = consentToken(await second.text());
  cookiesFrom(second, jar);

  // Approve the older screen first, then the newer one.
  const firstApproved = await postConsent(h.env, firstToken, jar);
  assert.equal(firstApproved.status, 302);
  cookiesFrom(firstApproved, jar);
  const secondApproved = await postConsent(h.env, secondToken, jar);
  assert.equal(secondApproved.status, 302);
  cookiesFrom(secondApproved, jar);

  // Both logins are now in flight; each callback finds its own cookie.
  const states = [firstApproved, secondApproved].map(
    (response) => new URL(response.headers.get('location')!).searchParams.get('state')!,
  );
  await withFetch((async () => auth0Tokens()) as any, async () => {
    for (const state of states) {
      const done = await Auth0Handler.request(
        `${BASE}/callback?code=auth0-code&state=${state}`,
        { headers: { cookie: cookieHeader(jar) } },
        h.env,
      );
      assert.equal(done.status, 302);
    }
  });
  assert.deepEqual(h.completed.map((options) => options.request.state), ['first', 'second']);
});

test('a remembered client skips the screen but still needs PKCE', async () => {
  const h = harness();
  const { jar } = await approve(h);
  const remembered = { '__Host-mcp-consented-clients': jar['__Host-mcp-consented-clients'] };

  const again = await Auth0Handler.request(authorizeUrl(), { headers: { cookie: cookieHeader(remembered) } }, h.env);
  assert.equal(again.status, 302);
  const state = new URL(again.headers.get('location')!).searchParams.get('state')!;
  assert.equal(cookiesFrom(again)[loginCookie(state)], state);

  const noPkce = await Auth0Handler.request(
    authorizeUrl({ code_challenge: '', code_challenge_method: '' }),
    { headers: { cookie: cookieHeader(remembered) } },
    h.env,
  );
  assert.equal(noPkce.status, 400);
});

test('an approval cookie from before the hardening is not honoured', async () => {
  const h = harness();
  // A correctly signed approval under the old cookie name: it used to skip the
  // screen, and could have been recorded without the person ever seeing it.
  const payload = JSON.stringify([CLIENT.clientId]);
  const signature = createHmac('sha256', h.env.COOKIE_ENCRYPTION_KEY).update(payload).digest('hex');
  const response = await Auth0Handler.request(
    authorizeUrl(),
    { headers: { cookie: `mcp-approved-clients=${signature}.${btoa(payload)}` } },
    h.env,
  );
  assert.equal(response.status, 200);
});

test('over plain HTTP, which is wrangler dev, the cookies drop the __Host- prefix', async () => {
  // Browsers refuse `__Host-` over plain HTTP, so the prefix would break local sign-in.
  const h = harness();
  const local = 'http://localhost:8788';
  const page = await Auth0Handler.request(authorizeUrl({}, local), {}, h.env);
  const jar = cookiesFrom(page);
  const token = consentToken(await page.text());
  assert.equal(jar[consentCookie(token, '')], token);

  const approved = await Auth0Handler.request(
    `${local}/authorize`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: cookieHeader(jar) },
      body: new URLSearchParams({ consent: token }).toString(),
    },
    h.env,
  );
  assert.equal(approved.status, 302);
  const state = new URL(approved.headers.get('location')!).searchParams.get('state')!;
  assert.equal(cookiesFrom(approved)[loginCookie(state, '')], state);
});

test('over HTTPS a bare-named cookie is ignored', async () => {
  // A cookie without the prefix is one a sibling subdomain could have planted.
  const h = harness();
  const page = await Auth0Handler.request(authorizeUrl(), {}, h.env);
  const token = consentToken(await page.text());
  const response = await postConsent(h.env, token, { [consentCookie(token, '')]: token });
  assert.equal(response.status, 400);
});

// --- The Auth0 callback -----------------------------------------------------

test('the callback is refused in a browser that did not start the login', async () => {
  const h = harness();
  const { response } = await approve(h);
  const state = new URL(response.headers.get('location')!).searchParams.get('state')!;

  let fetched = 0;
  await withFetch((async () => (fetched++, auth0Tokens())) as any, async () => {
    const noCookie = await Auth0Handler.request(`${BASE}/callback?code=auth0-code&state=${state}`, {}, h.env);
    assert.equal(noCookie.status, 400);
    const wrongCookie = await Auth0Handler.request(
      `${BASE}/callback?code=auth0-code&state=${state}`,
      { headers: { cookie: `${loginCookie(state)}=${'0'.repeat(64)}` } },
      h.env,
    );
    assert.equal(wrongCookie.status, 400);
  });

  assert.equal(fetched, 0, 'the Auth0 code is not exchanged');
  assert.equal(h.completed.length, 0, 'no grant is issued');
  assert.ok(h.kv.has(`pkce:${state}`), 'the transaction is left for the browser that owns it');
});

test('the callback completes in the browser that started the login', async () => {
  const h = harness();
  const { response, jar } = await approve(h);
  const state = new URL(response.headers.get('location')!).searchParams.get('state')!;

  await withFetch((async () => auth0Tokens()) as any, async () => {
    const done = await Auth0Handler.request(
      `${BASE}/callback?code=auth0-code&state=${state}`,
      { headers: { cookie: cookieHeader(jar) } },
      h.env,
    );
    assert.equal(done.status, 302);
    assert.equal(done.headers.get('location'), `${CLIENT.redirectUris[0]}?code=issued&state=client-state`);
    assert.equal(cookiesFrom(done, { ...jar })[loginCookie(state)], undefined, 'the login cookie is cleared');
  });

  assert.equal(h.completed.length, 1);
  assert.equal(h.completed[0].userId, 'auth0|user-1');
  assert.equal(h.completed[0].request.clientId, CLIENT.clientId);
  assert.equal(h.kv.has(`pkce:${state}`), false, 'the transaction is consumed');
});
