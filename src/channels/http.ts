/**
 * HTTP Channel — receives task delegations from FastAPI Director via webhook
 * and sends results back via callback URL.
 *
 * JID format: `http:{base64(callback_url)}`
 * The callback URL is embedded in the JID for stateless routing across restarts.
 */
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';

import { GROUPS_DIR } from '../config.js';
import { logger } from '../logger.js';
import { Channel, NewMessage, RegisteredGroup } from '../types.js';
import { registerChannel } from './registry.js';
import type { ChannelOpts } from './registry.js';

const JID_PREFIX = 'http:';
const HTTP_GROUP_FOLDER = 'http';

// --- JID helpers ---

export function encodeJid(callbackUrl: string): string {
  return `${JID_PREFIX}${Buffer.from(callbackUrl).toString('base64')}`;
}

export function decodeJid(jid: string): string | null {
  if (!jid.startsWith(JID_PREFIX)) return null;
  try {
    const decoded = Buffer.from(
      jid.slice(JID_PREFIX.length),
      'base64',
    ).toString('utf8');
    // Basic URL validation to prevent SSRF with non-URL values
    const url = new URL(decoded);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return decoded;
  } catch {
    return null;
  }
}

// --- Payload validation ---

interface FastApiPayload {
  task: string;
  task_id: string;
  session_id: string;
  callback_url: string;
  context: Record<string, unknown>;
}

function isValidPayload(v: unknown): v is FastApiPayload {
  if (typeof v !== 'object' || v === null) return false;
  const p = v as Record<string, unknown>;
  return (
    typeof p.task === 'string' &&
    p.task.length > 0 &&
    typeof p.task_id === 'string' &&
    p.task_id.length > 0 &&
    typeof p.session_id === 'string' &&
    typeof p.callback_url === 'string' &&
    p.callback_url.length > 0
  );
}

// --- Body reader ---

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

// --- Callback POST ---

async function postCallback(callbackUrl: string, body: string): Promise<void> {
  const parsed = new URL(callbackUrl);
  const transport = parsed.protocol === 'https:' ? https : http;

  return new Promise((resolve, reject) => {
    const options: http.RequestOptions = {
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    };

    const req = transport.request(options, (res) => {
      res.resume();
      res.on('end', resolve);
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// --- HTTP Channel ---

class HttpChannel implements Channel {
  name = 'http';

  private server: http.Server | null = null;
  private connected = false;
  private readonly opts: ChannelOpts;
  private readonly port: number;

  /** Maps httpJid → task_id for building egress payloads */
  private readonly pendingTasks = new Map<string, string>();

  constructor(opts: ChannelOpts, port: number) {
    this.opts = opts;
    this.port = port;
  }

  async connect(): Promise<void> {
    this.server = http.createServer((req, res) => {
      this.handleRequest(req, res).catch((err) => {
        logger.error(
          { err },
          'HTTP channel: unhandled error in request handler',
        );
        if (!res.headersSent) {
          res.writeHead(500);
          res.end();
        }
      });
    });

    await new Promise<void>((resolve, reject) => {
      this.server!.listen(this.port, resolve);
      this.server!.once('error', reject);
    });

    this.connected = true;
    logger.info({ port: this.port }, 'HTTP channel listening');
  }

  private async handleRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    if (req.method !== 'POST' || req.url !== '/api/webhooks/fastapi') {
      res.writeHead(404);
      res.end();
      return;
    }

    const raw = await readBody(req);
    let payload: unknown;
    try {
      payload = JSON.parse(raw);
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid JSON' }));
      return;
    }

    if (!isValidPayload(payload)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error:
            'Missing required fields: task, task_id, session_id, callback_url',
        }),
      );
      return;
    }

    const { task, task_id, callback_url, context } = payload;

    // Validate callback URL to prevent SSRF
    const httpJid = encodeJid(callback_url);
    if (decodeJid(httpJid) === null) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: 'Invalid callback_url: must be http or https',
        }),
      );
      return;
    }

    // Ensure groups/http/ folder exists for the container agent
    const groupDir = path.resolve(GROUPS_DIR, HTTP_GROUP_FOLDER);
    fs.mkdirSync(path.join(groupDir, 'logs'), { recursive: true });
    if (!fs.existsSync(path.join(groupDir, 'CLAUDE.md'))) {
      fs.writeFileSync(
        path.join(groupDir, 'CLAUDE.md'),
        '# HTTP Task Agent\n\nHandles tasks delegated from the FastAPI Director.\n',
      );
    }

    // Register this JID as a transient group (in-memory only — not persisted to DB).
    // The `registeredGroups()` getter returns a reference to the live object in
    // src/index.ts, so mutating it here affects the message loop immediately.
    const groups = this.opts.registeredGroups() as Record<
      string,
      RegisteredGroup
    >;
    if (!groups[httpJid]) {
      groups[httpJid] = {
        name: `http-${task_id}`,
        folder: HTTP_GROUP_FOLDER,
        trigger: '',
        added_at: new Date().toISOString(),
        requiresTrigger: false,
        isMain: false,
      };
      this.opts.onChatMetadata(
        httpJid,
        new Date().toISOString(),
        'HTTP Channel',
        'http',
        false,
      );
      logger.debug(
        { httpJid, task_id },
        'HTTP channel: registered transient group',
      );
    }

    // Track task_id so sendMessage can include it in the egress payload
    this.pendingTasks.set(httpJid, task_id);

    // Build message content
    const contextStr =
      context && Object.keys(context).length > 0
        ? `\nContext: ${JSON.stringify(context)}`
        : '';
    const content = `Task ID: ${task_id}\n${task}${contextStr}`;

    const msg: NewMessage = {
      id: task_id,
      chat_jid: httpJid,
      sender: 'fastapi',
      sender_name: 'FastAPI Director',
      content,
      timestamp: new Date().toISOString(),
      is_from_me: false,
      is_bot_message: false,
    };

    this.opts.onMessage(httpJid, msg);

    logger.info({ task_id, httpJid }, 'HTTP channel: task accepted');

    res.writeHead(202, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'accepted', task_id }));
  }

  async sendMessage(jid: string, text: string): Promise<void> {
    const callbackUrl = decodeJid(jid);
    if (!callbackUrl) {
      logger.error(
        { jid },
        'HTTP channel: cannot decode callback URL from JID',
      );
      return;
    }

    const task_id = this.pendingTasks.get(jid) ?? 'unknown';
    this.pendingTasks.delete(jid);

    // Clean up the transient group registration
    const groups = this.opts.registeredGroups() as Record<
      string,
      RegisteredGroup
    >;
    delete groups[jid];

    const body = JSON.stringify({ task_id, status: 'done', summary: text });

    try {
      await postCallback(callbackUrl, body);
      logger.info({ task_id, callbackUrl }, 'HTTP channel: callback delivered');
    } catch (err) {
      // Log only — no retries to prevent loops (per PRD requirement)
      logger.error(
        { task_id, callbackUrl, err },
        'HTTP channel: callback delivery failed',
      );
    }
  }

  isConnected(): boolean {
    return this.connected;
  }

  ownsJid(jid: string): boolean {
    return jid.startsWith(JID_PREFIX);
  }

  async disconnect(): Promise<void> {
    if (this.server) {
      await new Promise<void>((resolve) => this.server!.close(() => resolve()));
      this.connected = false;
      logger.info('HTTP channel disconnected');
    }
  }
}

// Self-register when this module is imported
registerChannel('http', (opts) => {
  const port = parseInt(process.env.HTTP_PORT ?? '', 10);
  if (!port || isNaN(port)) {
    logger.debug('HTTP channel disabled (HTTP_PORT not set)');
    return null;
  }
  return new HttpChannel(opts, port);
});
