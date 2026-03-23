import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import net from 'node:net';

// Mock config
vi.mock('../config.js', () => ({
  GROUPS_DIR: '/tmp/nanoclaw-test-groups',
}));

// Mock logger
vi.mock('../logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock fs
vi.mock('node:fs', () => ({
  default: {
    mkdirSync: vi.fn(),
    existsSync: vi.fn(() => true),
    writeFileSync: vi.fn(),
  },
}));

import type { RegisteredGroup } from '../types.js';
import { encodeJid, decodeJid } from './http.js';

// ---- JID helpers ----

describe('encodeJid / decodeJid', () => {
  it('round-trips an http callback URL', () => {
    const url = 'http://localhost:8000/callback';
    expect(decodeJid(encodeJid(url))).toBe(url);
  });

  it('round-trips an https callback URL', () => {
    const url = 'https://api.example.com/tasks/done';
    expect(decodeJid(encodeJid(url))).toBe(url);
  });

  it('encodeJid always starts with http:', () => {
    expect(encodeJid('http://x.com').startsWith('http:')).toBe(true);
  });

  it('decodeJid returns null for non-http: prefixed JIDs', () => {
    expect(decodeJid('telegram:12345')).toBeNull();
    expect(decodeJid('whatsapp:123@g.us')).toBeNull();
  });

  it('decodeJid returns null for invalid base64', () => {
    expect(decodeJid('http:!!!notbase64!!!')).toBeNull();
  });

  it('decodeJid returns null for non-http(s) scheme', () => {
    const ftp = encodeJid('ftp://evil.com/');
    // We encoded an ftp URL but it should be rejected on decode
    expect(decodeJid(ftp)).toBeNull();
  });
});

// ---- HTTP server integration ----

/** Get a free TCP port */
function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, () => {
      const addr = srv.address() as net.AddressInfo;
      srv.close(() => resolve(addr.port));
    });
    srv.on('error', reject);
  });
}

/** POST helper */
function post(
  port: number,
  path: string,
  body: unknown,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString('utf8'),
          }),
        );
      },
    );
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

describe('HTTP channel server', () => {
  // We import the channel module and spin up a real HTTP server for tests.
  // Each test uses a fresh port to avoid conflicts.

  let server: http.Server;
  let port: number;
  const receivedMessages: Array<{ jid: string; content: string }> = [];
  const sentMessages: Array<{ jid: string; text: string }> = [];
  const registeredGroups: Record<string, RegisteredGroup> = {};

  beforeEach(async () => {
    port = await getFreePort();
    receivedMessages.length = 0;
    sentMessages.length = 0;

    // Import registry fresh to avoid state leaking from previous test runs
    const { registerChannel } = await import('./registry.js');
    const { default: fs } = await import('node:fs');

    // Mock the channel factory
    const opts = {
      onMessage: (jid: string, msg: { content: string }) => {
        receivedMessages.push({ jid, content: msg.content });
      },
      onChatMetadata: vi.fn(),
      registeredGroups: () => registeredGroups,
    };

    // Build channel via the exported factory stored in registry
    // We do this directly for test isolation
    process.env.HTTP_PORT = String(port);

    // Re-import to trigger self-registration with the new env
    vi.resetModules();
    const mod = await import('./http.js');

    const factory = registerChannel as unknown as ReturnType<typeof vi.fn>;
    void factory; // just ensure module loaded

    // Build a lightweight server ourselves using the public API for integration
    // testing (avoids coupling to internal class).
    const { encodeJid: enc, decodeJid: dec } = mod;
    void enc;
    void dec;

    // Spin up the channel via the registry factory
    const { getChannelFactory } = await import('./registry.js');
    const channelFactory = getChannelFactory('http');
    expect(channelFactory).toBeDefined();

    const channel = channelFactory!(opts);
    expect(channel).not.toBeNull();

    // Intercept sendMessage to record outbound calls
    const origSend = channel!.sendMessage.bind(channel);
    channel!.sendMessage = async (jid: string, text: string) => {
      sentMessages.push({ jid, text });
      await origSend(jid, text);
    };

    await channel!.connect();
    server = (channel as unknown as { server: http.Server }).server;
  });

  afterEach(async () => {
    if (server) {
      await new Promise<void>((r) => server.close(() => r()));
    }
    delete process.env.HTTP_PORT;
    vi.resetModules();
  });

  it('returns 404 for unknown paths', async () => {
    const { status } = await post(port, '/unknown', {});
    expect(status).toBe(404);
  });

  it('returns 400 for missing required fields', async () => {
    const { status, body } = await post(port, '/api/webhooks/fastapi', {
      task: 'do something',
    });
    expect(status).toBe(400);
    expect(JSON.parse(body).error).toMatch(/required fields/);
  });

  it('returns 400 for invalid JSON', async () => {
    const res = await new Promise<{ status: number; body: string }>(
      (resolve, reject) => {
        const payload = 'not json';
        const req = http.request(
          {
            hostname: '127.0.0.1',
            port,
            path: '/api/webhooks/fastapi',
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(payload),
            },
          },
          (r) => {
            const chunks: Buffer[] = [];
            r.on('data', (c: Buffer) => chunks.push(c));
            r.on('end', () =>
              resolve({
                status: r.statusCode ?? 0,
                body: Buffer.concat(chunks).toString('utf8'),
              }),
            );
          },
        );
        req.on('error', reject);
        req.write(payload);
        req.end();
      },
    );
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/Invalid JSON/);
  });

  it('returns 202 and dispatches onMessage for valid payload', async () => {
    const { status, body } = await post(port, '/api/webhooks/fastapi', {
      task: 'Summarise the quarterly report.',
      task_id: 'tid-001',
      session_id: 'sess-abc',
      callback_url: 'http://localhost:9999/done',
      context: { priority: 'high' },
    });

    expect(status).toBe(202);
    expect(JSON.parse(body)).toMatchObject({
      status: 'accepted',
      task_id: 'tid-001',
    });

    expect(receivedMessages).toHaveLength(1);
    const [msg] = receivedMessages;
    expect(msg.content).toContain('tid-001');
    expect(msg.content).toContain('Summarise the quarterly report.');
    expect(msg.content).toContain('"priority":"high"');
    // JID must encode the callback URL
    expect(decodeJid(msg.jid)).toBe('http://localhost:9999/done');
  });

  it('registers a transient group for the request JID', async () => {
    await post(port, '/api/webhooks/fastapi', {
      task: 'Do a thing',
      task_id: 'tid-002',
      session_id: 's',
      callback_url: 'http://localhost:9999/cb2',
      context: {},
    });

    const jid = encodeJid('http://localhost:9999/cb2');
    expect(registeredGroups[jid]).toMatchObject({
      folder: 'http',
      requiresTrigger: false,
    });
  });

  it('ownsJid returns true for http: JIDs', async () => {
    const { getChannelFactory } = await import('./registry.js');
    const factory = getChannelFactory('http')!;
    const ch = factory({
      onMessage: vi.fn(),
      onChatMetadata: vi.fn(),
      registeredGroups: () => ({}),
    });
    expect(ch!.ownsJid('http:abc123')).toBe(true);
    expect(ch!.ownsJid('telegram:123')).toBe(false);
    expect(ch!.ownsJid('whatsapp:123@g.us')).toBe(false);
  });

  it('returns null when HTTP_PORT is not set', async () => {
    const savedPort = process.env.HTTP_PORT;
    delete process.env.HTTP_PORT;
    vi.resetModules();

    const { getChannelFactory } = await import('./registry.js');
    await import('./http.js');

    const factory = getChannelFactory('http');
    const ch = factory?.({
      onMessage: vi.fn(),
      onChatMetadata: vi.fn(),
      registeredGroups: () => ({}),
    });
    expect(ch).toBeNull();

    process.env.HTTP_PORT = savedPort ?? '';
    vi.resetModules();
  });
});
