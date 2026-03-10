import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { registerChannel, type ChannelOpts } from './registry.js';
import type { Channel, NewMessage } from '../types.js';
import pino from 'pino';

const logger = pino({ name: 'http-channel' });

interface TaskPayload {
  task: string;
  task_id: string;
  session_id: string;
  callback_url: string;
  context?: Record<string, unknown>;
}

interface CallbackPayload {
  task_id: string;
  status: 'done' | 'failed';
  summary: string;
  error?: string;
}

/**
 * HTTP Channel for NanoClaw
 * 
 * Ingress: POST /api/webhooks/fastapi - Receives task delegation from FastAPI
 * Egress: Sends results to callback_url embedded in JID
 * 
 * JID Format: http:{base64(callback_url)}
 * This enables stateless URL decoding without process-specific state.
 */
export function createHttpChannel(opts: ChannelOpts): Channel | null {
  const port = process.env.HTTP_PORT;
  if (!port) {
    logger.warn('HTTP_PORT not set, HTTP channel disabled');
    return null;
  }

  let server: Server | null = null;
  let connected = false;
  
  // Map JID -> task_id for callback correlation
  const jidToTaskId = new Map<string, string>();

  /**
   * Create JID from callback URL using base64 encoding
   */
  function createJid(callbackUrl: string): string {
    return `http:${Buffer.from(callbackUrl).toString('base64')}`;
  }

  /**
   * Extract callback URL from JID
   */
  function extractCallbackUrl(jid: string): string | null {
    if (!jid.startsWith('http:')) {
      return null;
    }
    
    const base64Part = jid.slice(5); // Remove "http:" prefix
    try {
      return Buffer.from(base64Part, 'base64').toString('utf-8');
    } catch (err) {
      logger.error({ jid, err }, 'Failed to decode JID');
      return null;
    }
  }

  /**
   * Parse and validate incoming webhook payload
   */
  function parsePayload(body: string): TaskPayload | null {
    try {
      const data = JSON.parse(body);
      
      if (!data.task || !data.task_id || !data.session_id || !data.callback_url) {
        logger.warn({ data }, 'Invalid payload: missing required fields');
        return null;
      }
      
      return data as TaskPayload;
    } catch (err) {
      logger.error({ err }, 'Failed to parse payload');
      return null;
    }
  }

  /**
   * Read full request body
   */
  function readBody(req: IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk.toString();
      });
      req.on('end', () => resolve(body));
      req.on('error', reject);
    });
  }

  /**
   * Handle incoming webhook request
   */
  async function handleWebhook(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method !== 'POST') {
      res.writeHead(405, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Method not allowed' }));
      return;
    }

    try {
      const body = await readBody(req);
      const payload = parsePayload(body);

      if (!payload) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid payload' }));
        return;
      }

      // Create JID from callback URL
      const jid = createJid(payload.callback_url);
      
      // Store task_id for later callback
      jidToTaskId.set(jid, payload.task_id);

      // Create synthetic message
      const timestamp = new Date().toISOString();
      const message: NewMessage = {
        id: `http-${payload.task_id}-${Date.now()}`,
        chat_jid: jid,
        sender: 'fastapi',
        sender_name: 'FastAPI Director',
        content: formatTaskMessage(payload),
        timestamp,
        is_from_me: false,
        is_bot_message: false,
      };

      // Notify chat metadata
      opts.onChatMetadata(jid, timestamp, 'FastAPI Delegation', 'http', false);

      // Deliver message to group queue
      opts.onMessage(jid, message);

      logger.info({ task_id: payload.task_id, jid }, 'Task received');

      // Respond immediately with 202 Accepted (fire-and-forget)
      res.writeHead(202, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'accepted', task_id: payload.task_id }));
    } catch (err) {
      logger.error({ err }, 'Error handling webhook');
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Internal server error' }));
    }
  }

  /**
   * Format task payload into message content
   */
  function formatTaskMessage(payload: TaskPayload): string {
    let content = `Task: ${payload.task}\n`;
    content += `Task ID: ${payload.task_id}\n`;
    content += `Session ID: ${payload.session_id}\n`;
    
    if (payload.context && Object.keys(payload.context).length > 0) {
      content += `\nContext:\n${JSON.stringify(payload.context, null, 2)}`;
    }
    
    return content;
  }

  /**
   * HTTP request router
   */
  function handleRequest(req: IncomingMessage, res: ServerResponse): void {
    const url = req.url || '/';

    if (url === '/api/webhooks/fastapi') {
      handleWebhook(req, res).catch((err) => {
        logger.error({ err }, 'Unhandled error in webhook handler');
        res.writeHead(500);
        res.end('Internal Server Error');
      });
      return;
    }

    // 404 for unknown routes
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  }

  /**
   * Send result to callback URL
   */
  async function sendCallback(callbackUrl: string, payload: CallbackPayload): Promise<void> {
    try {
      const response = await fetch(callbackUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        logger.warn(
          { callbackUrl, status: response.status, task_id: payload.task_id },
          'Callback request failed',
        );
      } else {
        logger.info({ task_id: payload.task_id }, 'Callback sent successfully');
      }
    } catch (err) {
      // Log error but don't retry - FastAPI's background sweep handles TTL
      logger.error(
        { callbackUrl, task_id: payload.task_id, err },
        'Failed to send callback (not retrying)',
      );
    }
  }

  const channel: Channel = {
    name: 'http',

    async connect(): Promise<void> {
      if (connected) {
        logger.warn('HTTP channel already connected');
        return;
      }

      return new Promise((resolve, reject) => {
        server = createServer(handleRequest);
        
        server.on('error', (err) => {
          logger.error({ err, port }, 'HTTP server error');
          reject(err);
        });

        server.listen(parseInt(port, 10), () => {
          connected = true;
          logger.info({ port }, 'HTTP channel connected');
          resolve();
        });
      });
    },

    async disconnect(): Promise<void> {
      if (!server || !connected) {
        return;
      }

      return new Promise((resolve, reject) => {
        server!.close((err) => {
          if (err) {
            logger.error({ err }, 'Error closing HTTP server');
            reject(err);
          } else {
            connected = false;
            server = null;
            logger.info('HTTP channel disconnected');
            resolve();
          }
        });
      });
    },

    async sendMessage(jid: string, text: string): Promise<void> {
      const callbackUrl = extractCallbackUrl(jid);
      if (!callbackUrl) {
        logger.error({ jid }, 'Invalid JID format, cannot extract callback URL');
        return;
      }

      const taskId = jidToTaskId.get(jid) || `unknown-${Date.now()}`;
      
      const payload: CallbackPayload = {
        task_id: taskId,
        status: 'done',
        summary: text,
      };

      await sendCallback(callbackUrl, payload);
      
      // Cleanup task_id mapping after sending
      jidToTaskId.delete(jid);
    },

    isConnected(): boolean {
      return connected;
    },

    ownsJid(jid: string): boolean {
      return jid.startsWith('http:');
    },
  };

  return channel;
}

// Self-register the channel
registerChannel('http', createHttpChannel);
