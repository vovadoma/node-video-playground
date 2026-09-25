import type { IncomingMessage, ServerResponse } from 'node:http';

export interface EventStream {
  send(event: string, data: unknown): void;
  close(): void;
  /** Called once when the client disconnects or close() is called. */
  onClose(fn: () => void): void;
}

/** Server-Sent Events: a long-lived text/event-stream response the browser reads with EventSource. */
export function openEventStream(req: IncomingMessage, res: ServerResponse): EventStream {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.write(': connected\n\n');

  const listeners: Array<() => void> = [];
  let closed = false;
  const heartbeat = setInterval(() => res.write(': ping\n\n'), 15_000);
  const done = () => {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    listeners.forEach((fn) => fn());
  };
  req.on('close', done);

  return {
    send(event, data) {
      if (!closed) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    },
    close() {
      done();
      res.end();
    },
    onClose(fn) {
      listeners.push(fn);
    },
  };
}
