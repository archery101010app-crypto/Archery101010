export interface AdSlide {
  id: string;
  imageUrl: string;
  title?: string;
  subtitle?: string;
  linkUrl: string;
  backgroundColor?: string;
}

export interface AdCampaign {
  id: string;
  name: string;
  type: "popup" | "banner_widget" | "notification_bar";
  status: "active" | "paused" | "scheduled" | "expired";
  slides: AdSlide[];
  startDate: string;
  endDate: string;
  showOnAppOpen: boolean;
  frequencyMinutes: number;
  maxImpressionsPerDay: number;
  slideIntervalSeconds: number;
  targetScreens: string[];
  targetRoles: ("archer" | "coach")[];
  totalImpressions: number;
  totalClicks: number;
  createdAt: string;
  updatedAt: string;
}

export interface AdImpression {
  campaignId: string;
  visitorId: string;
  date: string;
  count: number;
  lastShownAt: number;
}
