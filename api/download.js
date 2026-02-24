import axios from 'axios';
import * as cheerio from 'cheerio';

// ==========================================
// FORMATTERS
// ==========================================

function formatNumber(num) {
  if (!num || isNaN(num)) return '0';
  num = parseInt(num);
  if (num >= 1000000) {
    return (num / 1000000).toFixed(1).replace(/\.0$/, '') + 'm';
  }
  if (num >= 1000) {
    return (num / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
  }
  return num.toString();
}

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 MB';
  const mb = bytes / (1024 * 1024);
  return mb.toFixed(2) + ' MB';
}

function parseRegion(locationCreated) {
  const regionMap = {
    'US': 'United States', 'GB': 'United Kingdom', 'CA': 'Canada', 'AU': 'Australia',
    'DE': 'Germany', 'FR': 'France', 'JP': 'Japan', 'KR': 'South Korea', 'IN': 'India',
    'BR': 'Brazil', 'MX': 'Mexico', 'ID': 'Indonesia', 'RU': 'Russia', 'TR': 'Turkey',
    'SA': 'Saudi Arabia', 'TH': 'Thailand', 'VN': 'Vietnam', 'PH': 'Philippines',
    'MY': 'Malaysia', 'SG': 'Singapore', 'TW': 'Taiwan', 'HK': 'Hong Kong', 'CN': 'China',
    'NG': 'Nigeria', 'ZA': 'South Africa', 'EG': 'Egypt', 'AE': 'UAE', 'PK': 'Pakistan',
    'BD': 'Bangladesh', 'IT': 'Italy', 'ES': 'Spain', 'NL': 'Netherlands', 'PL': 'Poland'
  };
  return regionMap[locationCreated] || locationCreated || 'Unknown';
}

// ==========================================
// VIDEO ID EXTRACTOR
// ==========================================

function extractVideoId(url) {
  const patterns = [
    /tiktok\.com\/@[\w.]+\/video\/(\d+)/,
    /tiktok\.com\/t\/(\w+)/,
    /vm\.tiktok\.com\/(\w+)/,
    /vt\.tiktok\.com\/(\w+)/,
    /tiktok\.com\/video\/(\d+)/,
    /\/v\/(\d+)/,
    /m\.tiktok\.com\/v\/(\d+)/,
    /tiktok\.com\/.*\/video\/(\d+)/,
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return null;
}

// ==========================================
// TIKTOK SCRAPER CORE
// ==========================================

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36'
];

async function scrapeTikTok(url) {
  try {
    const videoId = extractVideoId(url);
    if (!videoId) {
      return { status: 'error', message: 'Invalid TikTok URL format' };
    }

    // Try multiple extraction strategies
    const strategies = [
      () => fetchFromWebPage(url),
      () => fetchFromApi(videoId),
      () => fetchFromEmbed(videoId)
    ];

    for (const strategy of strategies) {
      try {
        const result = await strategy();
        if (result && result.status === 'success') return result;
      } catch (e) {
        console.log('Strategy failed:', e.message);
        continue;
      }
    }

    return { status: 'error', message: 'All extraction methods failed. Video may be private, deleted, or region-blocked.' };

  } catch (error) {
    console.error('Scraping error:', error);
    return { 
      status: 'error', 
      message: error.message || 'Unknown error occurred' 
    };
  }
}

async function fetchFromWebPage(url) {
  const config = {
    headers: {
      'User-Agent': USER_AGENTS[0],
      'Referer': 'https://www.tiktok.com/',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
      'Connection': 'keep-alive',
      'Upgrade-Insecure-Requests': '1',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Cache-Control': 'max-age=0',
    },
    timeout: 15000,
    maxRedirects: 5,
  };

  const response = await axios.get(url, config);
  const html = response.data;
  const $ = cheerio.load(html);

  // Strategy 1: __UNIVERSAL_DATA_FOR_REHYDRATION__ (Most reliable)
  const scriptContent = $('#__UNIVERSAL_DATA_FOR_REHYDRATION__').html();
  if (scriptContent) {
    try {
      const data = JSON.parse(scriptContent);
      const itemStruct = data?.itemInfo?.itemStruct;
      if (itemStruct) return formatResponse(itemStruct);
    } catch (e) {
      console.log('Failed to parse __UNIVERSAL_DATA_FOR_REHYDRATION__');
    }
  }

  // Strategy 2: __SIGI_STATE__ (SSR data)
  const sigiData = $('#__SIGI_STATE__').html();
  if (sigiData) {
    try {
      const data = JSON.parse(sigiData);
      const itemModule = data?.ItemModule;
      if (itemModule) {
        const itemKey = Object.keys(itemModule)[0];
        const itemStruct = itemModule[itemKey];
        if (itemStruct) return formatResponse(itemStruct);
      }
    } catch (e) {
      console.log('Failed to parse __SIGI_STATE__');
    }
  }

  // Strategy 3: Next.js data
  const nextData = $('#__NEXT_DATA__').html();
  if (nextData) {
    try {
      const data = JSON.parse(nextData);
      const itemStruct = data?.props?.pageProps?.itemInfo?.itemStruct;
      if (itemStruct) return formatResponse(itemStruct);
    } catch (e) {
      console.log('Failed to parse __NEXT_DATA__');
    }
  }

  return null;
}

async function fetchFromApi(videoId) {
  // TikTok mobile API endpoint
  const apiUrls = [
    `https://api16-normal-c-useast1a.tiktokv.com/aweme/v1/feed/?aweme_id=${videoId}`,
    `https://api16-normal-c-useast2a.tiktokv.com/aweme/v1/feed/?aweme_id=${videoId}`,
    `https://api16-core-c-useast1a.tiktokv.com/aweme/v1/feed/?aweme_id=${videoId}`,
  ];

  for (const apiUrl of apiUrls) {
    try {
      const config = {
        headers: {
          'User-Agent': USER_AGENTS[1],
          'Accept': 'application/json',
          'Referer': 'https://www.tiktok.com/',
        },
        timeout: 10000,
      };

      const response = await axios.get(apiUrl, config);
      const videoData = response.data?.aweme_list?.[0];
      if (videoData) return formatResponse(videoData);
    } catch (e) {
      continue;
    }
  }
  return null;
}

async function fetchFromEmbed(videoId) {
  try {
    const embedUrl = `https://www.tiktok.com/embed/${videoId}`;
    const config = {
      headers: {
        'User-Agent': USER_AGENTS[2],
        'Accept': 'text/html',
      },
      timeout: 10000,
    };

    const response = await axios.get(embedUrl, config);
    const html = response.data;
    
    // Extract data from embed page
    const match = html.match(/<script[^>]*>window\._SSR_HYDRATED_DATA\s*=\s*({.*?})<\/script>/);
    if (match) {
      const data = JSON.parse(match[1]);
      const itemStruct = data?.itemInfo?.itemStruct;
      if (itemStruct) return formatResponse(itemStruct);
    }
  } catch (e) {
    console.log('Embed fetch failed:', e.message);
  }
  return null;
}

function formatResponse(itemStruct) {
  const isImagePost = itemStruct.imagePost?.images?.length > 0 || 
                      itemStruct.image_post_info?.images?.length > 0 ||
                      itemStruct.aweme_type === 150; // 150 = image post type

  const videoInfo = itemStruct.video || {};
  const authorInfo = itemStruct.author || {};
  const musicInfo = itemStruct.music || {};
  const stats = itemStruct.statistics || itemStruct.stats || {};

  // Handle different API response structures
  const desc = itemStruct.desc || itemStruct.description || '';
  const createTime = itemStruct.create_time || itemStruct.createTime;
  const region = itemStruct.region || itemStruct.location_created || 'Unknown';

  const data = {
    type: isImagePost ? 'images' : 'video',
    id: itemStruct.aweme_id || itemStruct.id || itemStruct.video_id,
    desc: desc,
    thumbnail: videoInfo.cover?.url_list?.[0] || 
               videoInfo.origin_cover?.url_list?.[0] || 
               videoInfo.dynamic_cover?.url_list?.[0] ||
               videoInfo.cover ||
               '',
    author: {
      name: authorInfo.nickname || '',
      username: authorInfo.unique_id || authorInfo.uid || authorInfo.sec_uid || '',
      avatar: authorInfo.avatar_larger?.url_list?.[0] || 
              authorInfo.avatar_thumb?.url_list?.[0] ||
              authorInfo.avatar_medium?.url_list?.[0] ||
              '',
      verified: authorInfo.verification_type === 1 || authorInfo.is_verified || false,
    },
    statistics: {
      likes: formatNumber(stats.digg_count || stats.diggCount || 0),
      comments: formatNumber(stats.comment_count || stats.commentCount || 0),
      shares: formatNumber(stats.share_count || stats.shareCount || 0),
      views: formatNumber(stats.play_count || stats.playCount || 0),
      likesRaw: parseInt(stats.digg_count || stats.diggCount || 0),
      commentsRaw: parseInt(stats.comment_count || stats.commentCount || 0),
      sharesRaw: parseInt(stats.share_count || stats.shareCount || 0),
      viewsRaw: parseInt(stats.play_count || stats.playCount || 0),
    },
    duration: Math.floor((videoInfo.duration || videoInfo.video_length || 0) / 1000) || 
              Math.floor(videoInfo.duration || 0),
    region: parseRegion(region),
    createdAt: createTime ? new Date(createTime * 1000).toISOString() : new Date().toISOString(),
    music: {
      title: musicInfo.title || '',
      author: musicInfo.author || musicInfo.owner_nickname || musicInfo.author_name || '',
      cover: musicInfo.cover_large?.url_list?.[0] || 
             musicInfo.cover_thumb?.url_list?.[0] ||
             musicInfo.cover_hd?.url_list?.[0] ||
             '',
      url: musicInfo.play_url?.url_list?.[0] || 
           musicInfo.play_url?.uri ||
           '',
      duration: Math.floor((musicInfo.duration || 0) / 1000),
    },
  };

  // Process video qualities (NO WATERMARK)
  if (!isImagePost && videoInfo) {
    const qualities = [];
    
    // Primary: play_addr (no watermark) - HIGHEST QUALITY
    if (videoInfo.play_addr?.url_list?.length > 0) {
      videoInfo.play_addr.url_list.forEach((url, index) => {
        if (url) {
          qualities.push({
            url: url,
            quality: videoInfo.ratio || videoInfo.quality || '540p',
            size: 'Unknown',
            sizeBytes: 0,
            width: videoInfo.width || 576,
            height: videoInfo.height || 1024,
            bitrate: videoInfo.bitrate || 0,
            type: index === 0 ? 'primary' : 'fallback'
          });
        }
      });
    }

    // Secondary: bit_rate array (multiple qualities)
    if (videoInfo.bit_rate?.length > 0) {
      videoInfo.bit_rate.forEach((info) => {
        if (info.play_addr?.url_list?.[0]) {
          qualities.push({
            url: info.play_addr.url_list[0],
            quality: `${info.width}x${info.height}` || info.quality || '540p',
            size: formatBytes(info.data_size || 0),
            sizeBytes: info.data_size || 0,
            width: info.width || 576,
            height: info.height || 1024,
            bitrate: info.bit_rate || 0,
            type: 'bitrate'
          });
        }
      });
    }

    // Tertiary: download_addr (usually has watermark, but we check)
    const withWatermark = [];
    if (videoInfo.download_addr?.url_list?.length > 0) {
      videoInfo.download_addr.url_list.forEach((url) => {
        if (url) {
          withWatermark.push({
            url: url,
            quality: videoInfo.ratio || '540p',
            size: 'Unknown',
            sizeBytes: 0,
            width: videoInfo.width || 576,
            height: videoInfo.height || 1024,
            bitrate: videoInfo.bitrate || 0,
          });
        }
      });
    }

    // Deduplicate URLs
    const seenUrls = new Set();
    const uniqueQualities = qualities.filter(q => {
      if (seenUrls.has(q.url)) return false;
      seenUrls.add(q.url);
      return true;
    });

    // Sort by quality (highest first)
    uniqueQualities.sort((a, b) => {
      const qualityOrder = { '1080p': 4, '720p': 3, '540p': 2, '480p': 1 };
      const aScore = qualityOrder[a.quality] || 0;
      const bScore = qualityOrder[b.quality] || 0;
      return bScore - aScore;
    });

    data.video = {
      noWatermark: uniqueQualities,
      withWatermark: withWatermark,
      hd: uniqueQualities.find(q => q.quality.includes('720') || q.quality.includes('1080'))?.url || 
          uniqueQualities[0]?.url || 
          null,
    };
  }

  // Process images (Carousel/Slideshow)
  if (isImagePost) {
    const images = itemStruct.imagePost?.images || 
                   itemStruct.image_post_info?.images || 
                   [];
    
    data.images = images.map((img) => ({
      url: img.url_list?.[0] || 
           img.display_image?.url_list?.[0] || 
           img.origin_image?.url_list?.[0] ||
           '',
      width: img.width || 1080,
      height: img.height || 1920,
    })).filter(img => img.url); // Remove empty URLs
  }

  return { status: 'success', data };
}

// ==========================================
// VERCEL SERVERLESS HANDLER
// ==========================================

export default async function handler(req, res) {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    return res.status(200).end();
  }

  // Only allow GET and POST
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ 
      status: 'error', 
      message: 'Method not allowed. Use GET or POST.' 
    });
  }

  try {
    // Get URL from query or body
    let url;
    if (req.method === 'POST') {
      url = req.body?.url;
    } else {
      url = req.query?.url;
    }

    // Validate URL
    if (!url) {
      return res.status(400).json({ 
        status: 'error', 
        message: 'URL parameter is required. Usage: /api/download?url=https://tiktok.com/...' 
      });
    }

    if (typeof url !== 'string') {
      return res.status(400).json({ 
        status: 'error', 
        message: 'URL must be a string' 
      });
    }

    // Basic TikTok domain check
    if (!url.includes('tiktok.com')) {
      return res.status(400).json({ 
        status: 'error', 
        message: 'Invalid TikTok URL. Must contain tiktok.com' 
      });
    }

    // Scrape the video
    const result = await scrapeTikTok(url);

    // Set response headers
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');
    
    // Return appropriate status code
    if (result.status === 'error') {
      return res.status(400).json(result);
    }

    return res.status(200).json(result);

  } catch (error) {
    console.error('API Error:', error);
    return res.status(500).json({ 
      status: 'error', 
      message: 'Internal server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
}
