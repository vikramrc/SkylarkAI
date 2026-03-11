import type { Response } from 'express';

export function sseInit(res: Response) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();
}

export function sseSend(res: Response, event: string, data: unknown) {
    const payload = typeof data === 'string' ? data : JSON.stringify(data);
    res.write(`event: ${event}\n`);
    res.write(`data: ${payload}\n\n`);
}

export function sseClose(res: Response) {
    try {
        res.write('event: end\ndata: {}\n\n');
    } catch {}

    try {
        res.end();
    } catch {}
}