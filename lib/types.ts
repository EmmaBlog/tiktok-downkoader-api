export interface TikTokResponse {
  status: 'success' | 'error';
  message?: string;
  data?: VideoData;
}

export interface VideoData {
  type: 'video' | 'images';
  id: string;
  desc: string;
  thumbnail: string;
  author: {
    name: string;
    username: string;
    avatar: string;
    verified: boolean;
  };
  statistics: {
    likes: string;
    comments: string;
    shares: string;
    views: string;
    likesRaw: number;
    commentsRaw: number;
    sharesRaw: number;
    viewsRaw: number;
  };
  duration: number;
  region: string;
  createdAt: string;
  video?: {
    noWatermark: VideoQuality[];
    withWatermark: VideoQuality[];
    hd?: string;
  };
  images?: ImageData[];
  music: {
    title: string;
    author: string;
    cover: string;
    url: string;
    duration: number;
  };
}

export interface VideoQuality {
  url: string;
  quality: string;
  size: string;
  sizeBytes: number;
  width: number;
  height: number;
  bitrate: number;
}

export interface ImageData {
  url: string;
  width: number;
  height: number;
}

export interface TikTokInternalData {
  itemInfo?: {
    itemStruct?: any;
  };
  seoProps?: {
    metaParams?: any;
  };
}

