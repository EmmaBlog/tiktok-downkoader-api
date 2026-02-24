import axios, { AxiosRequestConfig } from 'axios';
import * as cheerio from 'cheerio';
import { TikTokResponse, VideoData, VideoQuality } from './types.js';
import { formatNumber, formatBytes, parseRegion } from './formatter.js';

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36'
];

export async function scrapeTikTok(url: string): Promise<TikTokResponse> {
  try {
    const videoId = extractVideoId(url);
    if (!videoId) {
      return { status: 'error', message: 'Invalid TikTok URL format' };
    }

    // Try multiple strategies
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
        console.log('Strategy failed, trying next...');
        continue;
      }
    }

    return { status: 'error', message: 'All extraction methods failed. Video may be private or region-blocked.' };

  } catch (error) {
    console.error('Scraping error:', error);
    return { 
      status: 'error', 
      message: error instanceof Error ? error.message : 'Unknown error occurred' 
    };
  }
}

async function fetchFromWebPage(url: string): Promise<TikTokResponse | null> {
  const config: AxiosRequestConfig = {
    headers: {
      'User-Agent': USER_AGENTS[0],
      'Referer': 'https://www.tiktok.com/',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5',
      'Accept-Encoding': 'gzip, deflate, br',
      'Connection': 'keep-alive',
    },
    timeout: 15000,
    maxRedirects: 5,
  };

  const response = await axios.get(url, config);
  const html = response.data;
  const $ = cheerio.load(html);

  // Strategy 1: __UNIVERSAL_DATA_FOR_REHYDRATION__
  const scriptContent = $('#__UNIVERSAL_DATA_FOR_REHYDRATION__').html();
  if (scriptContent) {
    const data = JSON.parse(scriptContent);
    const itemStruct = data?.itemInfo?.itemStruct;
    if (itemStruct) return formatResponse(itemStruct);
  }

  // Strategy 2: SSR Hydration Data
  const sigiData = $('#__SIGI_STATE__').html();
  if (sigiData) {
    const data = JSON.parse(sigiData);
    const itemStruct = data?.ItemModule?.[Object.keys(data.ItemModule)[0]];
    if (itemStruct) return formatResponse(itemStruct);
  }

  return null;
}

async function fetchFromApi(videoId: string): Promise<TikTokResponse | null> {
  // Mobile API endpoint (less restricted)
  const apiUrl = `https://api16-normal-c-useast1a.tiktokv.com/aweme/v1/feed/?aweme_id=${videoId}`;
  
  const config: AxiosRequestConfig = {
    headers: {
      'User-Agent': USER_AGENTS[1],
      'Accept': 'application/json',
    },
    timeout: 10000,
  };

  try {
    const response = await axios.get(apiUrl, config);
    const videoData = response.data?.aweme_list?.[0];
    if (videoData) return formatResponse(videoData);
  } catch (e) {
    return null;
  }
  return null;
}

async function fetchFromEmbed(videoId: string): Promise<TikTokResponse | null> {
  const embedUrl = `https://www.tiktok.com/embed/${videoId}`;
  
  const config: AxiosRequestConfig = {
    headers: {
      'User-Agent': USER_AGENTS[2],
    },
    timeout: 10000,
  };

  try {
    const response = await axios.get(embedUrl, config);
    // Parse embed page for data
    return null; // Implement if needed
  } catch (e) {
    return null;
  }
}

function formatResponse(itemStruct: any): TikTokResponse {
  const isImagePost = itemStruct.imagePost?.images?.length > 0;
  
  const data: VideoData = {
    type: isImagePost ? 'images' : 'video',
    id: itemStruct.aweme_id || itemStruct.id,
    desc: itemStruct.desc || '',
    thumbnail: itemStruct.video?.cover?.url_list?.[0] || 
               itemStruct.video?.origin_cover?.url_list?.[0] || 
               itemStruct.video?.dynamic_cover?.url_list?.[0] || '',
    author: {
      name: itemStruct.author?.nickname || '',
      username: itemStruct.author?.unique_id || itemStruct.author?.uid || '',
      avatar: itemStruct.author?.avatar_larger?.url_list?.[0] || 
              itemStruct.author?.avatar_thumb?.url_list?.[0] || '',
      verified: itemStruct.author?.verified || false,
    },
    statistics: {
      likes: formatNumber(itemStruct.statistics?.digg_count || itemStruct.stats?.diggCount || 0),
      comments: formatNumber(itemStruct.statistics?.comment_count || itemStruct.stats?.commentCount || 0),
      shares: formatNumber(itemStruct.statistics?.share_count || itemStruct.stats?.shareCount || 0),
      views: formatNumber(itemStruct.statistics?.play_count || itemStruct.stats?.playCount || 0),
      likesRaw: itemStruct.statistics?.digg_count || itemStruct.stats?.diggCount || 0,
      commentsRaw: itemStruct.statistics?.comment_count || itemStruct.stats?.commentCount || 0,
      sharesRaw: itemStruct.statistics?.share_count || itemStruct.stats?.shareCount || 0,
      viewsRaw: itemStruct.statistics?.play_count || itemStruct.stats?.playCount || 0,
    },
    duration: Math.floor((itemStruct.video?.duration || 0) / 1000),
    region: parseRegion(itemStruct.region || itemStruct.location_created),
    createdAt: itemStruct.create_time ? new Date(itemStruct.create_time * 1000).toISOString() : '',
    music: {
      title: itemStruct.music?.title || '',
      author: itemStruct.music?.author || itemStruct.music?.owner_nickname || '',
      cover: itemStruct.music?.cover_large?.url_list?.[0] || 
             itemStruct.music?.cover_thumb?.url_list?.[0] || '',
      url: itemStruct.music?.play_url?.url_list?.[0] || '',
      duration: Math.floor((itemStruct.music?.duration || 0) / 1000),
    },
  };

  // Process video qualities (No Watermark)
  if (!isImagePost && itemStruct.video) {
    const qualities: VideoQuality[] = [];
    const video = itemStruct.video;

    // Primary: playAddr (no watermark)
    if (video.play_addr?.url_list?.[0]) {
      qualities.push({
        url: video.play_addr.url_list[0],
        quality: video.ratio || '540p',
        size: 'Unknown',
        sizeBytes: 0,
        width: video.width || 576,
        height: video.height || 1024,
        bitrate: video.bitrate || 0,
      });
    }

    // Fallback: bitRate array
    if (video.bit_rate?.length > 0) {
      video.bit_rate.forEach((info: any) => {
        if (info.play_addr?.url_list?.[0]) {
          qualities.push({
            url: info.play_addr.url_list[0],
            quality: `${info.width}x${info.height}`,
            size: formatBytes(info.data_size || 0),
            sizeBytes: info.data_size || 0,
            width: info.width || 576,
            height: info.height || 1024,
            bitrate: info.bit_rate || 0,
          });
        }
      });
    }

    // With Watermark
    const withWatermark: VideoQuality[] = [];
    if (video.download_addr?.url_list?.[0]) {
      withWatermark.push({
        url: video.download_addr.url_list[0],
        quality: video.ratio || '540p',
        size: 'Unknown',
        sizeBytes: 0,
        width: video.width || 576,
        height: video.height || 1024,
        bitrate: video.bitrate || 0,
      });
    }

    data.video = {
      noWatermark: qualities,
      withWatermark: withWatermark,
      hd: qualities.find(q => q.quality.includes('720') || q.quality.includes('1080'))?.url || qualities[0]?.url,
    };
  }

  // Process images
  if (isImagePost && itemStruct.imagePost?.images) {
    data.images = itemStruct.imagePost.images.map((img: any) => ({
      url: img.url_list?.[0] || img.display_image?.url_list?.[0] || '',
      width: img.width || 1080,
      height: img.height || 1920,
    }));
  }

  return { status: 'success', data };
}

function extractVideoId(url: string): string | null {
  const patterns = [
    /tiktok\.com\/@[\w.]+\/video\/(\d+)/,
    /tiktok\.com\/t\/(\w+)/,
    /vm\.tiktok\.com\/(\w+)/,
    /vt\.tiktok\.com\/(\w+)/,
    /tiktok\.com\/video\/(\d+)/,
    /\/v\/(\d+)/,
    /m\.tiktok\.com\/v\/(\d+)/,
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }

  return null;
}
