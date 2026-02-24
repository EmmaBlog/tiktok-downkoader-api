import type { VercelRequest, VercelResponse } from '@vercel/node';
import { scrapeTikTok } from '../lib/tiktok-scraper.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS is now handled by vercel.json headers, but keep for safety
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ status: 'error', message: 'Method not allowed' });
  }

  try {
    const url = req.method === 'POST' ? req.body?.url : req.query?.url;

    if (!url || typeof url !== 'string') {
      return res.status(400).json({ 
        status: 'error', 
        message: 'URL parameter is required. Usage: /api/download?url=https://tiktok.com/...' 
      });
    }

    if (!url.includes('tiktok.com')) {
      return res.status(400).json({ 
        status: 'error', 
        message: 'Invalid TikTok URL' 
      });
    }

    const result = await scrapeTikTok(url);

    if (result.status === 'error') {
      return res.status(400).json(result);
    }

    return res.status(200).json(result);

  } catch (error) {
    console.error('API Error:', error);
    return res.status(500).json({ 
      status: 'error', 
      message: 'Internal server error' 
    });
  }
}
