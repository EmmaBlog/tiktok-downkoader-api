import axios, { AxiosRequestConfig } from 'axios';
import * as cheerio from 'cheerio';
import { TikTokResponse, VideoData, VideoQuality, TikTokInternalData } from './types.js';
import { formatNumber, formatBytes, parseRegion } from './formatter.js';

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const REFERER = 'https://www.tiktok.com/';

export async function scrapeTikTok(url: string): Promise<TikTokResponse> {
  try {
    // Validate URL
    const videoId = extractVideoId(url);
    if (!videoId) {
      return { status: 'error', message: 'Invalid TikTok URL' };
    }

    // Fetch page with headers to avoid blocks
    const config: AxiosRequestConfig = {
      headers: {
        'User-Agent': USER_AGENT,
        'Referer': REFERER,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1',
        'Cache-Control': 'max-age=0',
      },
      timeout: 10000,
      maxRedirects: 5,
    };

    const response = await axios.get(url, config);
    const html = response.data;
    const $ = cheerio.load(html);

    // Extract JSON data from script tag
    const scriptContent = $('#__UNIVERSAL_DATA_FOR_REHYDRATION__').html();
    if (!scriptContent) {
      return { status: 'error', message: 'Could not extract video data' };
    }

    const parsedData: TikTokInternalData = JSON.parse(scriptContent);
    const itemStruct = parsedData?.itemInfo?.itemStruct;

    if (!itemStruct) {
      return { status: 'error', message: 'Video not found or private' };
    }

    // Process video or images
    const isImagePost = itemStruct.imagePost?.images?.length > 0;
    
    const data: VideoData = {
      type: isImagePost ? 'images' : 'video',
      id: itemStruct.id || videoId,
      desc: itemStruct.desc || '',
      thumbnail: itemStruct.video?.cover || itemStruct.video?.originCover || '',
      author: {
        name: itemStruct.author?.nickname || '',
        username: itemStruct.author?.uniqueId || '',
        avatar: itemStruct.author?.avatarLarger || itemStruct.author?.avatarThumb || '',
        verified: itemStruct.author?.verified || false,
      },
      statistics: {
        likes: formatNumber(itemStruct.stats?.diggCount || 0),
        comments: formatNumber(itemStruct.stats?.commentCount || 0),
        shares: formatNumber(itemStruct.stats?.shareCount || 0),
        views: formatNumber(itemStruct.stats?.playCount || 0),
        likesRaw: itemStruct.stats?.diggCount || 0,
        commentsRaw: itemStruct.stats?.commentCount || 0,
        sharesRaw: itemStruct.stats?.shareCount || 0,
        viewsRaw: itemStruct.stats?.playCount || 0,
      },
      duration: itemStruct.video?.duration || 0,
      region: parseRegion(itemStruct.locationCreated),
      createdAt: itemStruct.createTime ? new Date(itemStruct.createTime * 1000).toISOString() : '',
      music: {
        title: itemStruct.music?.title || '',
        author: itemStruct.music?.authorName || '',
        cover: itemStruct.music?.coverLarge || itemStruct.music?.coverThumb || '',
        url: itemStruct.music?.playUrl || '',
        duration: itemStruct.music?.duration || 0,
      },
    };

    // Process video qualities
    if (!isImagePost && itemStruct.video) {
      const video = itemStruct.video;
      const qualities: VideoQuality[] = [];

      // No watermark sources (playAddr with lr=unwatermarked)
      if (video.playAddr) {
        qualities.push({
          url: video.playAddr,
          quality: video.ratio || '540p',
          size: 'Unknown',
          sizeBytes: 0,
          width: video.width || 576,
          height: video.height || 1024,
          bitrate: video.bitrate || 0,
        });
      }

      // Check bitrateInfo for multiple qualities
      if (video.bitrateInfo && Array.isArray(video.bitrateInfo)) {
        video.bitrateInfo.forEach((info: any) => {
          if (info.PlayAddr?.UrlList?.[0]) {
            qualities.push({
              url: info.PlayAddr.UrlList[0],
              quality: info.Resolution || info.QualityType || '540p',
              size: formatBytes(info.DataSize || 0),
              sizeBytes: info.DataSize || 0,
              width: info.PlayAddr.Width || 576,
              height: info.PlayAddr.Height || 1024,
              bitrate: info.Bitrate || 0,
            });
          }
        });
      }

      // With watermark (downloadAddr)
      const withWatermark: VideoQuality[] = [];
      if (video.downloadAddr) {
        withWatermark.push({
          url: video.downloadAddr,
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
        url: img.imageURL?.urlList?.[0] || img.imageURL?.urlList?.[1] || '',
        width: img.imageWidth || 1080,
        height: img.imageHeight || 1920,
      }));
    }

    return { status: 'success', data };

  } catch (error) {
    console.error('Scraping error:', error);
    return { 
      status: 'error', 
      message: error instanceof Error ? error.message : 'Unknown error occurred' 
    };
  }
}

function extractVideoId(url: string): string | null {
  // Support various TikTok URL formats
  const patterns = [
    /tiktok\.com\/@[\w.]+\/video\/(\d+)/,
    /tiktok\.com\/t\/(\w+)/,
    /vm\.tiktok\.com\/(\w+)/,
    /tiktok\.com\/video\/(\d+)/,
    /\/v\/(\d+)/,
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }

  // Try to extract from shortened URLs
  if (url.includes('vm.tiktok.com') || url.includes('vt.tiktok.com')) {
    // Return a placeholder, actual ID will be resolved after redirect
    return 'pending';
  }

  return null;
}
