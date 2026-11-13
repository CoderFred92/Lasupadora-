import type { Request, Response } from 'express';
import app from '../server.ts';

export default function handler(req: Request, res: Response) {
  if (req.url && req.url.startsWith('/api/__uploads/')) {
    req.url = req.url.replace('/api/__uploads/', '/uploads/');
  }
  return app(req, res);
}
