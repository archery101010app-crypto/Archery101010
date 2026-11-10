import { adCampaignsStore, adImpressionsStore, generateResilientId } from "@/lib/db/indexedDB";
import { AdCampaign, AdImpression } from "@/lib/db/adTypes";

function parseCampaignBoundMs(dateStr: string | undefined, isEnd: boolean): number | null {
  if (!dateStr || typeof dateStr !== "string" || !dateStr.trim()) return null;
  const trimmed = dateStr.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const [y, m, d] = trimmed.split("-").map(Number);
    if (!y || !m || !d) return null;
    return isEnd
      ? new Date(y, m - 1, d, 23, 59, 59, 999).getTime()
      : new Date(y, m - 1, d, 0, 0, 0, 0).getTime();
  }
  const parsed = Date.parse(trimmed);
  return isNaN(parsed) ? null : parsed;
}

function isWithinCampaignSchedule(campaign: AdCampaign, nowMs: number = Date.now()): boolean {
  const startMs = parseCampaignBoundMs(campaign.startDate, false);
  const endMs = parseCampaignBoundMs(campaign.endDate, true);
  if (startMs !== null && nowMs < startMs) return false;
  if (endMs !== null && nowMs > endMs) return false;
  return true;
}

// Decides what ad popup to show next
export async function getNextPopup(
  currentScreen: string,
  userRole: string,
  userPlan: string
): Promise<AdCampaign | null> {
  try {
    const campaigns: AdCampaign[] = [];
    await adCampaignsStore.iterate((value: AdCampaign) => {
      campaigns.push(value);
    });

    const now = Date.now();
    const activePopups = campaigns.filter((c) => {
      const isPopup = c.type === "popup";
      const isActive = c.status === "active";
      const inSchedule = isWithinCampaignSchedule(c, now);
      const isTargetScreen = Array.isArray(c.targetScreens) && c.targetScreens.includes(currentScreen);
      const isTargetRole = Array.isArray(c.targetRoles) && c.targetRoles.includes(userRole as any);
      const plans = c.targetPlans && c.targetPlans.length > 0 ? c.targetPlans : ["FREE"];
      const isTargetPlan = userRole === "superadmin" || plans.includes(userPlan as any);

      return isPopup && isActive && inSchedule && isTargetScreen && isTargetRole && isTargetPlan;
    });

    if (activePopups.length === 0) return null;

    // Check impressions and frequency
    const today = new Date(now).toISOString().split("T")[0];

    for (const campaign of activePopups) {
      const impKey = `${campaign.id}_${today}`;
      const impression = await adImpressionsStore.getItem<AdImpression>(impKey);

      if (impression) {
        if (impression.count >= campaign.maxImpressionsPerDay) {
          continue;
        }
        const elapsedMinutes = (now - impression.lastShownAt) / 60000;
        if (campaign.frequencyMinutes > 0 && elapsedMinutes < campaign.frequencyMinutes) {
          continue;
        }
      }

      return campaign;
    }
  } catch (error) {
    console.error("[AdManager] Error determining next popup ad:", error);
  }

  return null;
}

// Gets the active banner campaign
export async function getActiveBannerCampaign(
  currentScreen: string,
  userRole: string,
  userPlan: string
): Promise<AdCampaign | null> {
  try {
    const campaigns: AdCampaign[] = [];
    await adCampaignsStore.iterate((value: AdCampaign) => {
      campaigns.push(value);
    });

    const now = Date.now();
    const activeBanner = campaigns.find((c) => {
      const isBanner = c.type === "banner_widget";
      const isActive = c.status === "active";
      const inSchedule = isWithinCampaignSchedule(c, now);
      const isTargetScreen = Array.isArray(c.targetScreens) && c.targetScreens.includes(currentScreen);
      const isTargetRole = Array.isArray(c.targetRoles) && c.targetRoles.includes(userRole as any);
      const plans = c.targetPlans && c.targetPlans.length > 0 ? c.targetPlans : ["FREE"];
      const isTargetPlan = userRole === "superadmin" || plans.includes(userPlan as any);

      return isBanner && isActive && inSchedule && isTargetScreen && isTargetRole && isTargetPlan;
    });

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
  try {
    const campaigns: AdCampaign[] = [];
    await adCampaignsStore.iterate((value: AdCampaign) => {
      campaigns.push(value);
    });

    const now = Date.now();
    const activeBar = campaigns.find((c) => {
      const isBar = c.type === "notification_bar";
      const isActive = c.status === "active";
      const inSchedule = isWithinCampaignSchedule(c, now);
      const isTargetScreen = Array.isArray(c.targetScreens) && c.targetScreens.includes(currentScreen);
      const isTargetRole = Array.isArray(c.targetRoles) && c.targetRoles.includes(userRole as any);
      const plans = c.targetPlans && c.targetPlans.length > 0 ? c.targetPlans : ["FREE"];
      const isTargetPlan = userRole === "superadmin" || plans.includes(userPlan as any);

      return isBar && isActive && inSchedule && isTargetScreen && isTargetRole && isTargetPlan;
    });

    return activeBar || null;
  } catch (error) {
    console.error("Error getting active notification bar ad:", error);
    return null;
  }
}

async function syncAdMetricsToCloud(
  campaignId: string,
  nextImpressions: number,
  nextClicks: number,
  nowMs: number
): Promise<void> {
  if (campaignId.startsWith("AD-DEMO-")) {
    // Local-only demo campaigns may not exist in Firestore; attempt silent updateDoc only if online
    try {
      const { doc, updateDoc } = await import("firebase/firestore");
      const { db, auth } = await import("@/lib/firebase");
      if (typeof navigator !== "undefined" && navigator.onLine && auth.currentUser) {
        await updateDoc(doc(db, "ad_campaigns", campaignId), {
          impressions: nextImpressions,
          clicks: nextClicks,
          updatedAt: nowMs
        }).catch(() => {});
      }
    } catch {
      // ignore
    }
    return;
  }

  try {
    const { doc, updateDoc } = await import("firebase/firestore");
    const { db, auth } = await import("@/lib/firebase");
    if (typeof navigator !== "undefined" && navigator.onLine && auth.currentUser) {
      await updateDoc(doc(db, "ad_campaigns", campaignId), {
        impressions: nextImpressions,
        clicks: nextClicks,
        updatedAt: nowMs
      });
      return;
    }
  } catch (err: any) {
    const code = String(err?.code || "");
    const msg = String(err?.message || "");
    if (code.includes("not-found") || msg.includes("No document to update")) {
      return;
    }
  }

  const { addToSyncQueue } = await import("@/lib/db/indexedDB");
  await addToSyncQueue({
    id: generateResilientId("TX-AD"),
    collection: "ad_campaigns",
    operation: "UPDATE",
    payloadId: campaignId,
    payload: {
      id: campaignId,
      impressions: nextImpressions,
      clicks: nextClicks,
      updatedAt: nowMs
    },
    timestamp: nowMs
  });
}

// Records an ad impression
export async function recordImpression(campaignId: string, visitorId: string): Promise<void> {
  try {
    const now = Date.now();
    const today = new Date(now).toISOString().split("T")[0];
    const impKey = `${campaignId}_${today}`;

    const currentImp = await adImpressionsStore.getItem<AdImpression>(impKey);
    if (currentImp) {
      await adImpressionsStore.setItem(impKey, {
        ...currentImp,
        count: currentImp.count + 1,
        lastShownAt: now
      });
    } else {
      await adImpressionsStore.setItem(impKey, {
        campaignId,
        visitorId,
        date: today,
        count: 1,
        lastShownAt: now
      });
    }

    const campaign = await adCampaignsStore.getItem<AdCampaign & { impressions?: number; clicks?: number }>(
      campaignId
    );
    if (campaign) {
      const nextImpressions =
        Math.max(Number(campaign.impressions) || 0, Number(campaign.totalImpressions) || 0) + 1;
      const nextClicks = Math.max(Number(campaign.clicks) || 0, Number(campaign.totalClicks) || 0);

      const updatedCampaign = {
        ...campaign,
        impressions: nextImpressions,
        clicks: nextClicks,
        totalImpressions: nextImpressions,
        totalClicks: nextClicks,
        updatedAt: new Date(now).toISOString()
      };
      await adCampaignsStore.setItem(campaignId, updatedCampaign);
      await syncAdMetricsToCloud(campaignId, nextImpressions, nextClicks, now);
    }
  } catch (error) {
    console.error("Error recording ad impression:", error);
  }
}

// Records an ad click
export async function recordClick(campaignId: string, _slideId: string): Promise<void> {
  try {
    const now = Date.now();
    const campaign = await adCampaignsStore.getItem<AdCampaign & { impressions?: number; clicks?: number }>(
      campaignId
    );
    if (campaign) {
      const nextImpressions = Math.max(
        Number(campaign.impressions) || 0,
        Number(campaign.totalImpressions) || 0
      );
      const nextClicks =
        Math.max(Number(campaign.clicks) || 0, Number(campaign.totalClicks) || 0) + 1;

      const updatedCampaign = {
        ...campaign,
        impressions: nextImpressions,
        clicks: nextClicks,
        totalImpressions: nextImpressions,
        totalClicks: nextClicks,
        updatedAt: new Date(now).toISOString()
      };
      await adCampaignsStore.setItem(campaignId, updatedCampaign);
      await syncAdMetricsToCloud(campaignId, nextImpressions, nextClicks, now);
    }
  } catch (error) {
    console.error("Error recording ad click:", error);
  }
}

function getDefaultDemoCampaigns(): AdCampaign[] {
  const nowIso = new Date().toISOString();
  return [
    {
      id: "AD-DEMO-POPUP",
      name: "Bienvenida ARCHERY 101010",
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
      createdAt: nowIso,
      updatedAt: nowIso,
      slides: [
        {
          id: "SLIDE-POPUP-1",
          imageUrl: "https://images.unsplash.com/photo-1511379938547-c1f69419868d?q=80&w=600&auto=format&fit=crop",
          title: "Equipamiento de Alto Rendimiento 101010",
          subtitle: "Registra cada flecha, analiza tu agrupación y sincroniza con tu Smartwatch Deportivo.",
          linkUrl: "https://archery101010-c0bb4.web.app",
          backgroundColor: "#0F0F11"
        }
      ]
    },
    {
      id: "AD-DEMO-BANNER",
      name: "Destacados ARCHERY 101010 THE APP",
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
      createdAt: nowIso,
      updatedAt: nowIso,
      slides: [
        {
          id: "SLIDE-BANNER-1",
          imageUrl: "https://images.unsplash.com/photo-1541534741688-6078c6bfb5c5?q=80&w=800&auto=format&fit=crop",
          title: "Flechas de Carbono de Competición",
          subtitle: "Precisión milimétrica para sesiones de control y eliminatorias 1 vs 1.",
          linkUrl: "https://archery101010-c0bb4.web.app"
        },
        {
          id: "SLIDE-BANNER-2",
          imageUrl: "https://images.unsplash.com/photo-1608248597481-496100c8c836?q=80&w=800&auto=format&fit=crop",
          title: "ARCHERY 101010 · Plataforma Oficial de Entrenamiento",
          subtitle: "Monitoreo en vivo para arqueros y entrenadores en todo momento.",
          linkUrl: "https://archery101010-c0bb4.web.app"
        },
        {
          id: "SLIDE-BANNER-3",
          imageUrl: "https://images.unsplash.com/photo-1506126613408-eca07ce68773?q=80&w=800&auto=format&fit=crop",
          title: "Diana Digital 101010 Pro",
          subtitle: "Mejora tu agrupación y ajuste de mira en cada tanda.",
          linkUrl: "https://archery101010-c0bb4.web.app"
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
      createdAt: nowIso,
      updatedAt: nowIso,
      slides: [
        {
          id: "SLIDE-BAR-1",
          imageUrl: "",
          title: "Seminario de Técnica Olímpica con Coach Invitado · Reserva tu lugar en ARCHERY 101010",
          linkUrl: "https://archery101010-c0bb4.web.app",
          backgroundColor: "#00BFFF"
        }
      ]
    }
  ];
}

// Seeds default demo campaigns if none exist and scrubs any legacy third-party brand names on local demo ads
export async function seedDemoAdCampaigns(): Promise<void> {
  try {
    const keys = await adCampaignsStore.keys();
    const defaultsById = new Map(getDefaultDemoCampaigns().map((d) => [d.id, d]));
    const thirdPartyRegex = /\b(win\s*&\s*win|wuw|easton|hoyt)\b/i;

    if (keys.length > 0) {
      for (const k of keys) {
        const existing = await adCampaignsStore.getItem<AdCampaign>(k);
        if (!existing) continue;

        const hasLegacyDemoBrand =
          k.startsWith("AD-DEMO-") &&
          (thirdPartyRegex.test(existing.name || "") ||
            (existing.slides || []).some(
              (s) =>
                thirdPartyRegex.test(s.title || "") ||
                thirdPartyRegex.test(s.subtitle || "") ||
                thirdPartyRegex.test(s.linkUrl || "")
            ));

        if (hasLegacyDemoBrand && defaultsById.has(k)) {
          const replacement = defaultsById.get(k)!;
          await adCampaignsStore.setItem(k, {
            ...replacement,
            status: existing.status,
            totalImpressions: existing.totalImpressions || 0,
            totalClicks: existing.totalClicks || 0
          });
          continue;
        }

        if (existing.slides?.length) {
          let modified = false;
          const cleanedSlides = existing.slides.map((s) => {
            const cleanedTitle = (s.title || "")
              .replace(/[\p{Extended_Pictographic}\u2600-\u27BF]/gu, "")
              .trim();
            if (cleanedTitle !== s.title) {
              modified = true;
              return { ...s, title: cleanedTitle };
            }
            return s;
          });
          if (modified) {
            await adCampaignsStore.setItem(k, { ...existing, slides: cleanedSlides });
          }
        }
      }
      return;
    }

    for (const campaign of getDefaultDemoCampaigns()) {
      await adCampaignsStore.setItem(campaign.id, campaign);
    }
  } catch (error) {
    console.error("Error seeding default ad campaigns:", error);
  }
}
