import { adCampaignsStore, adImpressionsStore, generateResilientId } from "@/lib/db/indexedDB";
import { AdCampaign, AdImpression } from "@/lib/db/adTypes";

// Decides what ad popup to show next
export async function getNextPopup(
  currentScreen: string,
  userRole: string,
  userPlan: string
): Promise<AdCampaign | null> {
  if (userPlan === "PRO") return null;

  try {
    const campaigns: AdCampaign[] = [];
    await adCampaignsStore.iterate((value: AdCampaign) => {
      campaigns.push(value);
    });

    const activePopups = campaigns.filter(
      (c) =>
        c.type === "popup" &&
        c.status === "active" &&
        c.targetScreens.includes(currentScreen) &&
        c.targetRoles.includes(userRole as any)
    );

    if (activePopups.length === 0) return null;

    // Check impressions and frequency
    const today = new Date().toISOString().split("T")[0];
    const now = Date.now();

    for (const campaign of activePopups) {
      const impKey = `${campaign.id}_${today}`;
      const impression = await adImpressionsStore.getItem<AdImpression>(impKey);

      if (impression) {
        // Check max impressions limit per day
        if (impression.count >= campaign.maxImpressionsPerDay) {
          continue;
        }

        // Check frequency in minutes
        const elapsedMinutes = (now - impression.lastShownAt) / 60000;
        if (campaign.frequencyMinutes > 0 && elapsedMinutes < campaign.frequencyMinutes) {
          continue;
        }
      }

      // If campaign matches and passes limits, return it
      return campaign;
    }
  } catch (error) {
    console.error("Error determining next popup ad:", error);
  }

  return null;
}

// Gets the active banner campaign
export async function getActiveBannerCampaign(
  currentScreen: string,
  userRole: string,
  userPlan: string
): Promise<AdCampaign | null> {
  if (userPlan === "PRO") return null;

  try {
    const campaigns: AdCampaign[] = [];
    await adCampaignsStore.iterate((value: AdCampaign) => {
      campaigns.push(value);
    });

    const activeBanner = campaigns.find(
      (c) =>
        c.type === "banner_widget" &&
        c.status === "active" &&
        c.targetScreens.includes(currentScreen) &&
        c.targetRoles.includes(userRole as any)
    );

    return activeBanner || null;
  } catch (error) {
    console.error("Error getting active banner ad:", error);
    return null;
  }
}

// Gets the active notification bar campaign
export async function getActiveNotificationBar(
  currentScreen: string,
  userRole: string,
  userPlan: string
): Promise<AdCampaign | null> {
  if (userPlan === "PRO") return null;

  try {
    const campaigns: AdCampaign[] = [];
    await adCampaignsStore.iterate((value: AdCampaign) => {
      campaigns.push(value);
    });

    const activeBar = campaigns.find(
      (c) =>
        c.type === "notification_bar" &&
        c.status === "active" &&
        c.targetScreens.includes(currentScreen) &&
        c.targetRoles.includes(userRole as any)
    );

    return activeBar || null;
  } catch (error) {
    console.error("Error getting active notification bar ad:", error);
    return null;
  }
}

// Records an ad impression
export async function recordImpression(campaignId: string, visitorId: string): Promise<void> {
  try {
    const today = new Date().toISOString().split("T")[0];
    const impKey = `${campaignId}_${today}`;
    const now = Date.now();

    const currentImp = await adImpressionsStore.getItem<AdImpression>(impKey);
    if (currentImp) {
      await adImpressionsStore.setItem(impKey, {
        ...currentImp,
        count: currentImp.count + 1,
        lastShownAt: now,
      });
    } else {
      await adImpressionsStore.setItem(impKey, {
        campaignId,
        visitorId,
        date: today,
        count: 1,
        lastShownAt: now,
      });
    }

    // Also update campaign statistics
    const campaign = await adCampaignsStore.getItem<AdCampaign>(campaignId);
    if (campaign) {
      await adCampaignsStore.setItem(campaignId, {
        ...campaign,
        totalImpressions: (campaign.totalImpressions || 0) + 1,
        updatedAt: new Date().toISOString(),
      });
    }
  } catch (error) {
    console.error("Error recording ad impression:", error);
  }
}

// Records an ad click
export async function recordClick(campaignId: string, slideId: string): Promise<void> {
  try {
    const campaign = await adCampaignsStore.getItem<AdCampaign>(campaignId);
    if (campaign) {
      await adCampaignsStore.setItem(campaignId, {
        ...campaign,
        totalClicks: (campaign.totalClicks || 0) + 1,
        updatedAt: new Date().toISOString(),
      });
    }
  } catch (error) {
    console.error("Error recording ad click:", error);
  }
}

// Seeds default demo campaigns if none exist
export async function seedDemoAdCampaigns(): Promise<void> {
  try {
    const count = await adCampaignsStore.keys();
    if (count.length > 0) return;

    const demoCampaigns: AdCampaign[] = [
      {
        id: "AD-DEMO-POPUP",
        name: "Campaña de Bienvenida Win&Win",
        type: "popup",
        status: "active",
        startDate: "2026-01-01",
        endDate: "2027-12-31",
        showOnAppOpen: true,
        frequencyMinutes: 15,
        maxImpressionsPerDay: 5,
        slideIntervalSeconds: 6,
        targetScreens: ["HOME", "TARGET", "HISTORY", "CALENDAR", "PROFILE"],
        targetRoles: ["archer", "coach"],
        totalImpressions: 0,
        totalClicks: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        slides: [
          {
            id: "SLIDE-POPUP-1",
            imageUrl: "https://images.unsplash.com/photo-1511379938547-c1f69419868d?q=80&w=600&auto=format&fit=crop",
            title: "Nuevo Arco Win&Win TFT-G",
            subtitle: "Experimenta la precisión de grafeno con un 15% de descuento especial.",
            linkUrl: "https://www.wuw archery.com",
            backgroundColor: "#0F0F11"
          }
        ]
      },
      {
        id: "AD-DEMO-BANNER",
        name: "Patrocinadores Oficiales de Tiro con Arco",
        type: "banner_widget",
        status: "active",
        startDate: "2026-01-01",
        endDate: "2027-12-31",
        showOnAppOpen: false,
        frequencyMinutes: 0,
        maxImpressionsPerDay: 999,
        slideIntervalSeconds: 5,
        targetScreens: ["HOME", "TARGET", "HISTORY", "CALENDAR", "PROFILE"],
        targetRoles: ["archer", "coach"],
        totalImpressions: 0,
        totalClicks: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        slides: [
          {
            id: "SLIDE-BANNER-1",
            imageUrl: "https://images.unsplash.com/photo-1541534741688-6078c6bfb5c5?q=80&w=800&auto=format&fit=crop",
            title: "Easton Archery: Flechas Premium X10",
            subtitle: "La flecha número 1 en competiciones olímpicas.",
            linkUrl: "https://eastonarchery.com"
          },
          {
            id: "SLIDE-BANNER-2",
            imageUrl: "https://images.unsplash.com/photo-1608248597481-496100c8c836?q=80&w=800&auto=format&fit=crop",
            title: "Hoyt Archery - Redefiniendo el Tiro con Arco",
            subtitle: "Descubre la nueva línea Formula XD 2026.",
            linkUrl: "https://hoyt.com"
          },
          {
            id: "SLIDE-BANNER-3",
            imageUrl: "https://images.unsplash.com/photo-1506126613408-eca07ce68773?q=80&w=800&auto=format&fit=crop",
            title: "Diana Target 101010 Pro",
            subtitle: "Mejora tu agrupación de flechas hoy mismo.",
            linkUrl: "https://archery101010.com"
          }
        ]
      },
      {
        id: "AD-DEMO-BAR",
        name: "Aviso de Seminario de Tiro",
        type: "notification_bar",
        status: "active",
        startDate: "2026-01-01",
        endDate: "2027-12-31",
        showOnAppOpen: false,
        frequencyMinutes: 0,
        maxImpressionsPerDay: 999,
        slideIntervalSeconds: 10,
        targetScreens: ["HOME", "TARGET", "HISTORY", "CALENDAR", "PROFILE"],
        targetRoles: ["archer", "coach"],
        totalImpressions: 0,
        totalClicks: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        slides: [
          {
            id: "SLIDE-BAR-1",
            imageUrl: "",
            title: "🎯 Seminario de Técnica Olímpica con Coach Invitado el 15 de Junio. ¡Reserva tu lugar ahora! 🎯",
            linkUrl: "https://archery101010.com/seminar",
            backgroundColor: "#00BFFF" // Cyan oficial
          }
        ]
      }
    ];

    for (const campaign of demoCampaigns) {
      await adCampaignsStore.setItem(campaign.id, campaign);
    }
  } catch (error) {
    console.error("Error seeding default ad campaigns:", error);
  }
}
