import { auth, db } from "@/lib/firebase";
import {
  collection,
  onSnapshot,
  query,
  where,
  orderBy,
  limit,
  doc,
  setDoc,
  Query,
  DocumentReference,
  DocumentData
} from "firebase/firestore";
import {
  adCampaignsStore,
  calendarStore,
  macrocyclesStore,
  sessionsStore,
  settingsStore,
  athleteStarsStore,
  starHistoryStore,
  getSyncQueue,
  getSessionTombstones,
  markSessionTombstone,
  isFictitiousUser,
  isFictitiousSession,
  sanitizeForFirestore
} from "./indexedDB";
import {
  UserProfile,
  hasRecentLocalUserWrite,
  markLocalUserWrite,
  getCanonicalCoachClubId,
  getExternalCoachUid,
  isLinkedToExternalCoach,
  mergeUserProfilesNonDestructive,
  cloudWriteUser,
  syncCoachInviteCodeDoc
} from "@/lib/authService";
import { logger } from "@/lib/logger";

const SESSION_QUERY_LIMIT = 200;
const SESSION_BACKFILL_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * Syncs only the safe public presence & club directory fields to `users_public/{uid}`.
 * Never writes non-empty `clubInviteCode` to `users_public` (6-digit codes live exclusively in `coach_invite_codes/{code}`).
 */
export async function syncPublicUserPresence(
  profile: Partial<UserProfile> & { uid: string },
  lastActiveOverride?: number
): Promise<void> {
  if (!profile?.uid || profile.uid === "USR-GUEST-OFFLINE") return;
  if (typeof navigator !== "undefined" && !navigator.onLine) return;
  if (!auth.currentUser || auth.currentUser.uid !== profile.uid) return;

  const isCoachOwner =
    !isLinkedToExternalCoach(profile) &&
    (profile.role === "coach" ||
      profile.role === "team_admin" ||
      profile.role === "team_admin_coach" ||
      profile.role === "superadmin" ||
      Boolean(profile.isClubCreator));
  if (isCoachOwner && /^\d{6}$/.test((profile.clubInviteCode || "").trim())) {
    syncCoachInviteCodeDoc(profile).catch(() => {});
  }

  const now = Date.now();
  const publicPayload = {
    uid: profile.uid,
    fullName: (profile.fullName || "").slice(0, 100),
    nickname: (profile.nickname || "").slice(0, 50),
    country: (profile.country || "CR").slice(0, 100),
    bowType: profile.bowConfig?.type || "Recurve",
    clubId: (profile.clubId || "").slice(0, 100),
    clubName: (profile.clubName || "").slice(0, 100),
    role: profile.role || "archer",
    lastActiveAt: typeof lastActiveOverride === "number" ? lastActiveOverride : now,
    updatedAt: now
  };

  try {
    await setDoc(doc(db, "users_public", profile.uid), publicPayload, { merge: true });
  } catch (err: any) {
    // If a legacy users_public doc still held a non-empty clubInviteCode, clear it once so rules pass
    if (String(err?.code || "").includes("permission-denied")) {
      try {
        await setDoc(
          doc(db, "users_public", profile.uid),
          { ...publicPayload, clubInviteCode: "" },
          { merge: true }
        );
        return;
      } catch {}
    }
    logger.debug("Public presence sync skipped:", err?.message || err);
  }
}

/**
 * Helper to check if two user profiles are functionally different, ignoring transient synchronization timestamps.
 */
function isProfileFunctionallyDifferent(p1: UserProfile | null, p2: UserProfile | null): boolean {
  if (!p1 || !p2) return p1 !== p2;

  const keysToCompare: (keyof UserProfile)[] = [
    "email",
    "fullName",
    "nickname",
    "birthDate",
    "country",
    "city",
    "gender",
    "role",
    "plan",
    "proExpiresAt",
    "clubId",
    "coachId",
    "coachName",
    "coachEmail",
    "clubName",
    "clubInviteCode",
    "clubLogo",
    "clubCountry",
    "isClubCreator",
    "profileSetupCompleted",
    "whatsappNumber"
  ];

  for (const key of keysToCompare) {
    if (JSON.stringify(p1[key]) !== JSON.stringify(p2[key])) {
      return true;
    }
  }

  if (JSON.stringify(p1.bowConfig) !== JSON.stringify(p2.bowConfig)) return true;
  if (JSON.stringify(p1.bows) !== JSON.stringify(p2.bows)) return true;
  if (JSON.stringify(p1.physicalData) !== JSON.stringify(p2.physicalData)) return true;

  return false;
}

let activeUnsubscribes: (() => void)[] = [];
let activeSyncKey: string | null = null;
let syncGeneration = 0;

function reportListenerError(name: string, err: any) {
  console.warn(`Firestore ${name} real-time listener error:`, err?.message || err);
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent("firestore-sync-error", { detail: { error: err?.message || String(err) } })
    );
  }
}

export interface RealtimeSyncScope {
  role?: string | null;
  clubId?: string | null;
  coachId?: string | null;
  isClubCreator?: boolean | null;
}

/**
 * Initializes Firebase real-time listeners for all core collections
 * using scoped, bounded queries (`limit <= 250`) and incremental delta merging.
 *
 * Idempotent: calling it again with the same uid/role/club does NOT tear down and re-create
 * listeners (rapid listener churn triggers Firestore "INTERNAL ASSERTION FAILED (ca9/b815)").
 */
export function startRealtimeSync(
  currentUserUid: string | null,
  scope?: RealtimeSyncScope
) {
  if (typeof window === "undefined") return;

  // Offline Guest Guard: never attach Firestore listeners without an authenticated Firebase user
  if (!currentUserUid || currentUserUid === "USR-GUEST-OFFLINE" || !auth.currentUser) {
    stopRealtimeSync();
    return;
  }

  const role = scope?.role || "archer";
  const rawClubId = scope?.clubId?.trim() || null;
  const syncKey = `${currentUserUid}|${role}|${rawClubId || ""}|${scope?.coachId || ""}|${
    scope?.isClubCreator ? "1" : ""
  }`;
  if (activeSyncKey === syncKey && activeUnsubscribes.length > 0) {
    return; // Already listening with identical scope
  }

  // Clear any existing active listeners to prevent multiple streams
  stopRealtimeSync();
  activeSyncKey = syncKey;
  const generation = ++syncGeneration;

  // Check if the api key is the mock placeholder to prevent console warnings on mock environments
  const isLocalhost =
    typeof window !== "undefined" &&
    (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1");
  const isMockFirebase =
    (!process.env.NEXT_PUBLIC_FIREBASE_API_KEY ||
      process.env.NEXT_PUBLIC_FIREBASE_API_KEY.includes("mock-api-key")) &&
    isLocalhost;

  if (isMockFirebase) {
    logger.debug("Mock Firebase configuration detected. Real-time sync disabled.");
    return;
  }

  const isSuperAdmin = role === "superadmin";
  const linkedExternal = isLinkedToExternalCoach({
    uid: currentUserUid,
    clubId: rawClubId,
    coachId: scope?.coachId || null,
    isClubCreator: Boolean(scope?.isClubCreator)
  });
  const isCoachRole =
    !isSuperAdmin &&
    (role === "coach" ||
      role === "team_admin" ||
      role === "team_admin_coach" ||
      (Boolean(scope?.isClubCreator) && !linkedExternal));

  const canonicalClubId = getCanonicalCoachClubId({ uid: currentUserUid });
  const effectiveClubId = isCoachRole ? rawClubId || canonicalClubId : rawClubId;
  const initialCoachUid = !isCoachRole && !isSuperAdmin
    ? scope?.coachId || getExternalCoachUid({ uid: currentUserUid, clubId: rawClubId }) || null
    : null;

  logger.debug("Initializing Scoped Real-Time Turbo Sync Firestore listeners...");

  // =========================================================================
  // 1. Scoped & Bounded Users + users_public Presence Listeners
  // =========================================================================
  const liveUsersBySource = new Map<string, Map<string, UserProfile>>();
  const livePublicUsersBySource = new Map<string, Map<string, Record<string, any>>>();
  const attachedCoachDocUids = new Set<string>();

  async function reconcileUsersSnapshot(removedUids: string[] = []) {
    if (generation !== syncGeneration) return;
    try {
      const unionRemote = new Map<string, UserProfile>();
      liveUsersBySource.forEach((sourceMap) => {
        sourceMap.forEach((profile, uid) => {
          if (!isFictitiousUser(profile)) {
            unionRemote.set(uid, profile);
          }
        });
      });

      const rawLocalUsers = (await settingsStore.getItem<UserProfile[]>("simulated_users")) || [];
      const localUsers = rawLocalUsers.filter((u) => !isFictitiousUser(u));
      const localByUid = new Map(localUsers.map((u) => [u.uid, u]));

      // Overlay live public presence / club roster entries from `users_public` without overwriting private profile fields
      livePublicUsersBySource.forEach((pubMap) => {
        pubMap.forEach((pub, uid) => {
          if (!uid || isFictitiousUser(pub)) return;
          const existingFull = unionRemote.get(uid);
          if (existingFull) {
            // Only refresh presence timestamp on peer profiles (never overwrite `current_user` full profile fields)
            if (
              uid !== currentUserUid &&
              typeof pub.lastActiveAt === "number" &&
              (Number(pub.updatedAt) || 0) >= (Number(existingFull.updatedAt) || 0)
            ) {
              unionRemote.set(uid, {
                ...existingFull,
                lastActiveAt: pub.lastActiveAt,
                updatedAt: Math.max(Number(existingFull.updatedAt) || 0, Number(pub.updatedAt) || 0)
              });
            }
          } else if (uid !== currentUserUid) {
            const cachedLocal = localByUid.get(uid);
            const bowType =
              pub.bowType === "Compound" || pub.bowType === "Barebow" ? pub.bowType : "Recurve";
            const publicProfile: UserProfile = {
              uid,
              email: cachedLocal?.email || "",
              fullName: pub.fullName || cachedLocal?.fullName || "Arquero",
              nickname: pub.nickname || cachedLocal?.nickname || "",
              birthDate: cachedLocal?.birthDate || "",
              country: pub.country || cachedLocal?.country || "CR",
              city: cachedLocal?.city || "",
              gender: cachedLocal?.gender || "",
              bowConfig: cachedLocal?.bowConfig || {
                type: bowType,
                brand: "",
                model: "",
                poundage: 36
              },
              clubId: pub.clubId || null,
              clubName: pub.clubName || null,
              clubInviteCode: pub.clubInviteCode || "",
              role: pub.role || "archer",
              plan: cachedLocal?.plan || "FREE",
              isClubCreator:
                pub.role === "coach" ||
                pub.role === "team_admin" ||
                pub.role === "team_admin_coach",
              lastActiveAt: typeof pub.lastActiveAt === "number" ? pub.lastActiveAt : 0,
              updatedAt: typeof pub.updatedAt === "number" ? pub.updatedAt : 0
            };
            unionRemote.set(uid, publicProfile);
          }
        });
      });

      const usersList = Array.from(unionRemote.values());
      const queue = await getSyncQueue();
      const nowQueueMs = Date.now();
      const pendingUserUids = new Set(
        queue
          .filter(
            (q) =>
              q.collection === "users" &&
              nowQueueMs - (q.timestamp || 0) < 60000
          )
          .map((q) => q.payloadId)
      );
      for (const localU of localUsers) {
        if (hasRecentLocalUserWrite(localU.uid)) {
          pendingUserUids.add(localU.uid);
        }
      }
      if (currentUserUid && hasRecentLocalUserWrite(currentUserUid)) {
        pendingUserUids.add(currentUserUid);
      }

      const removedSet = new Set(
        removedUids.filter(
          (uid) =>
            uid !== currentUserUid &&
            !unionRemote.has(uid) &&
            !pendingUserUids.has(uid)
        )
      );

      const mergedList: UserProfile[] = [];

      for (const remoteU of usersList) {
        const localU = localByUid.get(remoteU.uid);
        const localIsNewer =
          localU &&
          typeof localU.updatedAt === "number" &&
          typeof remoteU.updatedAt === "number" &&
          localU.updatedAt > remoteU.updatedAt;
        if (!pendingUserUids.has(remoteU.uid) && !localIsNewer) {
          mergedList.push(
            localU ? mergeUserProfilesNonDestructive(localU, remoteU).merged : remoteU
          );
        }
      }

      // Preserve local users unless they were explicitly removed from all active user scopes
      for (const localU of localUsers) {
        if (removedSet.has(localU.uid)) continue;
        if (!mergedList.some((u) => u.uid === localU.uid)) {
          mergedList.push(localU);
        }
      }

      const nowMs = Date.now();
      const isOnline = (u?: UserProfile | null) =>
        !!u?.lastActiveAt && nowMs - u.lastActiveAt < 120000;
      let rosterMeaningfullyChanged = mergedList.length !== localUsers.length;
      if (!rosterMeaningfullyChanged) {
        for (const u of mergedList) {
          const prev = localByUid.get(u.uid) || null;
          if (
            !prev ||
            isProfileFunctionallyDifferent(prev, u) ||
            isOnline(prev) !== isOnline(u)
          ) {
            rosterMeaningfullyChanged = true;
            break;
          }
        }
      }

      await settingsStore.setItem("simulated_users", mergedList);

      // Update current_user if changed remotely and not protected by a recent local write
      if (currentUserUid && !pendingUserUids.has(currentUserUid)) {
        const updatedCurrentUser = unionRemote.get(currentUserUid);
        if (updatedCurrentUser) {
          // If an archer discovers a coachId on their remote profile not yet attached, attach coach doc listener
          if (
            !isCoachRole &&
            !isSuperAdmin &&
            updatedCurrentUser.coachId &&
            updatedCurrentUser.coachId !== currentUserUid &&
            !attachedCoachDocUids.has(updatedCurrentUser.coachId)
          ) {
            attachUserDocListener(`coach:${updatedCurrentUser.coachId}`, updatedCurrentUser.coachId);
          }

          const localCurrent = await settingsStore.getItem<UserProfile>("current_user");

          const localIsNewer =
            localCurrent &&
            typeof localCurrent.updatedAt === "number" &&
            typeof updatedCurrentUser.updatedAt === "number" &&
            localCurrent.updatedAt > updatedCurrentUser.updatedAt;

          const isProfileValid = (u: UserProfile | null | undefined): boolean => {
            if (!u) return false;
            return !!(
              u.fullName?.trim() &&
              u.birthDate &&
              u.country &&
              u.gender
            );
          };

          const isLocalValid = isProfileValid(localCurrent);
          const isRemoteValid = isProfileValid(updatedCurrentUser);

          const { merged: safeCurrentUser, localHadMissingCloudFields } =
            mergeUserProfilesNonDestructive(localCurrent, updatedCurrentUser);

          if (localIsNewer) {
            if (typeof navigator !== "undefined" && navigator.onLine) {
              markLocalUserWrite(safeCurrentUser.uid, Number(localCurrent?.updatedAt || Date.now()));
              cloudWriteUser(safeCurrentUser).catch(() => {});
            }
          } else if (isLocalValid && !isRemoteValid) {
            console.warn(
              "[Sync] Local profile is complete, but remote is missing mandatory fields. Skip overwrite to avoid reset loop."
            );
            if (typeof navigator !== "undefined" && navigator.onLine) {
              markLocalUserWrite(safeCurrentUser.uid, Date.now());
              cloudWriteUser(safeCurrentUser).catch(() => {});
            }
          } else {
            const hasFunctionalDifference = isProfileFunctionallyDifferent(
              localCurrent,
              safeCurrentUser
            );
            const hasAnyDifference =
              JSON.stringify(localCurrent) !== JSON.stringify(safeCurrentUser);

            if (hasFunctionalDifference) {
              await settingsStore.setItem("current_user", safeCurrentUser);
              window.dispatchEvent(
                new CustomEvent("current-user-updated", { detail: { user: safeCurrentUser } })
              );
            } else if (hasAnyDifference) {
              await settingsStore.setItem("current_user", safeCurrentUser);
            }

            if (localHadMissingCloudFields && typeof navigator !== "undefined" && navigator.onLine) {
              markLocalUserWrite(safeCurrentUser.uid, Date.now());
              cloudWriteUser(safeCurrentUser).catch(() => {});
            }
          }
        }
      }

      if (rosterMeaningfullyChanged) {
        window.dispatchEvent(
          new CustomEvent("local-db-change", { detail: { store: "simulated_users" } })
        );
        window.dispatchEvent(new CustomEvent("users-roster-updated"));
      }
    } catch (err) {
      console.error("Error in real-time users sync:", err);
    }
  }

  function attachUserDocListener(sourceKey: string, targetUid: string, silentPermDenied = false) {
    if (!targetUid) return;
    if (sourceKey.startsWith("coach:")) {
      attachedCoachDocUids.add(targetUid);
    }
    const sourceMap = new Map<string, UserProfile>();
    liveUsersBySource.set(sourceKey, sourceMap);

    const unsub = onSnapshot(
      doc(db, "users", targetUid),
      async (docSnap) => {
        if (generation !== syncGeneration) return;
        const removed: string[] = [];
        if (docSnap.exists()) {
          const data = { ...(docSnap.data() as UserProfile), uid: (docSnap.data() as any)?.uid || docSnap.id };
          sourceMap.set(data.uid, data);
        } else {
          if (sourceMap.has(targetUid)) removed.push(targetUid);
          sourceMap.delete(targetUid);
        }
        await reconcileUsersSnapshot(removed);
      },
      (err) => {
        if (silentPermDenied && String(err?.code || "").includes("permission-denied")) {
          logger.debug(`Firestore users:${sourceKey} restricted; using users_public fallback.`);
          return;
        }
        reportListenerError(`users:${sourceKey}`, err);
      }
    );
    activeUnsubscribes.push(unsub);
  }

  function attachPublicUserDocListener(sourceKey: string, targetUid: string) {
    if (!targetUid) return;
    const sourceMap = new Map<string, Record<string, any>>();
    livePublicUsersBySource.set(sourceKey, sourceMap);

    const unsub = onSnapshot(
      doc(db, "users_public", targetUid),
      async (docSnap) => {
        if (generation !== syncGeneration) return;
        const removed: string[] = [];
        if (docSnap.exists()) {
          const data = { ...(docSnap.data() as Record<string, any>), uid: (docSnap.data() as any)?.uid || docSnap.id };
          sourceMap.set(data.uid, data);
        } else {
          if (sourceMap.has(targetUid)) removed.push(targetUid);
          sourceMap.delete(targetUid);
        }
        await reconcileUsersSnapshot(removed);
      },
      (err) => logger.debug(`Firestore users_public:${sourceKey} listener notice:`, err?.message || err)
    );
    activeUnsubscribes.push(unsub);
  }

  function attachUsersQueryListener(sourceKey: string, q: Query<DocumentData>) {
    const sourceMap = new Map<string, UserProfile>();
    liveUsersBySource.set(sourceKey, sourceMap);

    const unsub = onSnapshot(
      q,
      async (snapshot) => {
        if (generation !== syncGeneration) return;
        const removed: string[] = [];
        snapshot.docChanges().forEach((change) => {
          const data = change.doc.data() as UserProfile;
          const uid = data?.uid || change.doc.id;
          if (change.type === "removed") {
            sourceMap.delete(uid);
            removed.push(uid);
          } else if (data) {
            sourceMap.set(uid, { ...data, uid });
          }
        });
        await reconcileUsersSnapshot(removed);
      },
      (err) => reportListenerError(`users:${sourceKey}`, err)
    );
    activeUnsubscribes.push(unsub);
  }

  function attachPublicUsersQueryListener(sourceKey: string, q: Query<DocumentData>) {
    const sourceMap = new Map<string, Record<string, any>>();
    livePublicUsersBySource.set(sourceKey, sourceMap);

    const unsub = onSnapshot(
      q,
      async (snapshot) => {
        if (generation !== syncGeneration) return;
        const removed: string[] = [];
        snapshot.docChanges().forEach((change) => {
          const data = change.doc.data() as Record<string, any>;
          const uid = data?.uid || change.doc.id;
          if (change.type === "removed") {
            sourceMap.delete(uid);
            removed.push(uid);
          } else if (data) {
            sourceMap.set(uid, { ...data, uid });
          }
        });
        await reconcileUsersSnapshot(removed);
      },
      (err) => logger.debug(`Firestore users_public:${sourceKey} listener notice:`, err?.message || err)
    );
    activeUnsubscribes.push(unsub);
  }

  // Always listen to current user's own document
  attachUserDocListener("self", currentUserUid);

  if (isSuperAdmin) {
    attachUsersQueryListener(
      "superadmin",
      query(collection(db, "users"), orderBy("createdAt", "desc"), limit(50))
    );
    attachPublicUsersQueryListener(
      "superadmin_public",
      query(collection(db, "users_public"), limit(100))
    );
  } else if (isCoachRole) {
    attachUsersQueryListener(
      "coach_club",
      query(collection(db, "users"), where("clubId", "==", canonicalClubId), limit(200))
    );
    attachPublicUsersQueryListener(
      "coach_club_public",
      query(collection(db, "users_public"), where("clubId", "==", canonicalClubId), limit(150))
    );
    if (effectiveClubId && effectiveClubId !== canonicalClubId) {
      attachUsersQueryListener(
        "coach_alt_club",
        query(collection(db, "users"), where("clubId", "==", effectiveClubId), limit(200))
      );
      attachPublicUsersQueryListener(
        "coach_alt_club_public",
        query(collection(db, "users_public"), where("clubId", "==", effectiveClubId), limit(150))
      );
    }
    attachUsersQueryListener(
      "coach_direct",
      query(collection(db, "users"), where("coachId", "==", currentUserUid), limit(200))
    );
  } else {
    if (effectiveClubId) {
      attachPublicUsersQueryListener(
        "archer_club_public",
        query(collection(db, "users_public"), where("clubId", "==", effectiveClubId), limit(150))
      );
    }
    if (initialCoachUid && initialCoachUid !== currentUserUid) {
      attachPublicUserDocListener(`coach_pub:${initialCoachUid}`, initialCoachUid);
      attachUserDocListener(`coach:${initialCoachUid}`, initialCoachUid, true);
    }
  }

  // Also check stored local current_user in case coachId or isClubCreator wasn't passed in scope
  settingsStore
    .getItem<UserProfile>("current_user")
    .then((storedUser) => {
      if (generation !== syncGeneration || !storedUser || storedUser.uid !== currentUserUid) return;
      if (
        !isSuperAdmin &&
        !isCoachRole &&
        storedUser.isClubCreator &&
        !isLinkedToExternalCoach(storedUser)
      ) {
        if (!liveUsersBySource.has("coach_direct")) {
          attachUsersQueryListener(
            "coach_direct",
            query(collection(db, "users"), where("coachId", "==", currentUserUid), limit(200))
          );
        }
        if (!liveUsersBySource.has("coach_club") && effectiveClubId !== canonicalClubId) {
          attachUsersQueryListener(
            "coach_club",
            query(collection(db, "users"), where("clubId", "==", canonicalClubId), limit(200))
          );
          attachPublicUsersQueryListener(
            "coach_club_public",
            query(collection(db, "users_public"), where("clubId", "==", canonicalClubId), limit(150))
          );
        }
        return;
      }
      if (
        !isSuperAdmin &&
        !isCoachRole &&
        storedUser.coachId &&
        storedUser.coachId !== currentUserUid &&
        !attachedCoachDocUids.has(storedUser.coachId)
      ) {
        attachPublicUserDocListener(`coach_pub:${storedUser.coachId}`, storedUser.coachId);
        attachUserDocListener(`coach:${storedUser.coachId}`, storedUser.coachId, true);
      }
    })
    .catch(() => {});

  // =========================================================================
  // Helper: Multi-Scope Incremental Store Coordinator (preserves sibling query items)
  // =========================================================================
  type ScopedTarget =
    | { label: string; kind: "query"; ref: Query<DocumentData>; capLimit: number }
    | { label: string; kind: "doc"; ref: DocumentReference<DocumentData> };

  function attachScopedStoreListeners(
    collectionName: string,
    store: LocalForage,
    storeEventName: string,
    targets: ScopedTarget[],
    belongsToCurrentScope?: (localVal: any, key: string) => boolean,
    shouldAcceptRemoteDoc?: (remoteVal: any, docId: string) => boolean
  ) {
    if (targets.length === 0) return;
    const liveIdsByTarget = new Map<string, Set<string>>();
    const initializedTargets = new Set<string>();
    const truncatedTargets = new Set<string>();

    for (const target of targets) {
      liveIdsByTarget.set(target.label, new Set<string>());
    }

    const isStillLiveAnywhere = (docId: string): boolean => {
      for (const idSet of liveIdsByTarget.values()) {
        if (idSet.has(docId)) return true;
      }
      return false;
    };

    for (const target of targets) {
      if (target.kind === "doc") {
        const unsub = onSnapshot(
          target.ref,
          async (docSnap) => {
            if (generation !== syncGeneration) return;
            try {
              const queue = await getSyncQueue();
              const pendingIds = new Set(
                queue.filter((item) => item.collection === collectionName).map((item) => item.payloadId)
              );
              const targetSet = liveIdsByTarget.get(target.label)!;
              const docId = docSnap.id;

              if (docSnap.exists()) {
                const remoteData = docSnap.data();
                if (shouldAcceptRemoteDoc && !shouldAcceptRemoteDoc(remoteData, docId)) {
                  targetSet.delete(docId);
                  if (!pendingIds.has(docId) && !isStillLiveAnywhere(docId)) {
                    await store.removeItem(docId);
                  }
                } else {
                  targetSet.add(docId);
                  if (!pendingIds.has(docId)) {
                    await store.setItem(docId, remoteData);
                  }
                }
              } else {
                targetSet.delete(docId);
                if (!pendingIds.has(docId) && !isStillLiveAnywhere(docId) && !docSnap.metadata?.fromCache) {
                  await store.removeItem(docId);
                }
              }

              initializedTargets.add(target.label);
              window.dispatchEvent(
                new CustomEvent("local-db-change", { detail: { store: storeEventName } })
              );
            } catch (err) {
              console.error(`Error in real-time ${collectionName}:${target.label} doc sync:`, err);
            }
          },
          (err) => reportListenerError(`${collectionName}:${target.label}`, err)
        );
        activeUnsubscribes.push(unsub);
      } else {
        let needsServerReconcile = true;
        const unsub = onSnapshot(
          target.ref,
          async (snapshot) => {
            if (generation !== syncGeneration) return;
            try {
              const queue = await getSyncQueue();
              const pendingIds = new Set(
                queue.filter((item) => item.collection === collectionName).map((item) => item.payloadId)
              );
              const targetSet = liveIdsByTarget.get(target.label)!;
              const hitCap = snapshot.size >= target.capLimit;
              const fromCache = Boolean(snapshot.metadata?.fromCache);
              if (hitCap) {
                truncatedTargets.add(target.label);
              } else {
                truncatedTargets.delete(target.label);
              }

              if (needsServerReconcile) {
                if (!fromCache) {
                  needsServerReconcile = false;
                }
                const acceptedDocs = snapshot.docs.filter(
                  (d) => !shouldAcceptRemoteDoc || shouldAcceptRemoteDoc(d.data(), d.id)
                );
                targetSet.clear();
                acceptedDocs.forEach((d) => targetSet.add(d.id));

                await Promise.all(
                  acceptedDocs
                    .filter((d) => !pendingIds.has(d.id))
                    .map((d) => store.setItem(d.id, d.data()))
                );

                if (!fromCache) {
                  initializedTargets.add(target.label);
                }

                // Reconcile offline server-side deletions ONLY once all sibling scopes loaded from server without truncation
                if (
                  !fromCache &&
                  belongsToCurrentScope &&
                  initializedTargets.size === targets.length &&
                  truncatedTargets.size === 0
                ) {
                  const keysToRemove: string[] = [];
                  await store.iterate((val: any, key: string) => {
                    if (
                      !pendingIds.has(key) &&
                      !isStillLiveAnywhere(key) &&
                      belongsToCurrentScope(val, key)
                    ) {
                      keysToRemove.push(key);
                    }
                  });
                  if (keysToRemove.length > 0) {
                    await Promise.all(keysToRemove.map((k) => store.removeItem(k)));
                  }
                } else if (shouldAcceptRemoteDoc) {
                  // Immediately evict any locally stored docs explicitly rejected by shouldAcceptRemoteDoc
                  const rejectedLocalKeys: string[] = [];
                  await store.iterate((val: any, key: string) => {
                    if (!pendingIds.has(key) && !shouldAcceptRemoteDoc(val, key)) {
                      rejectedLocalKeys.push(key);
                    }
                  });
                  if (rejectedLocalKeys.length > 0) {
                    await Promise.all(rejectedLocalKeys.map((k) => store.removeItem(k)));
                  }
                }
              } else {
                const changes = snapshot.docChanges();
                if (changes.length === 0) return;

                await Promise.all(
                  changes.map(async (change) => {
                    const docId = change.doc.id;
                    if (change.type === "removed") {
                      targetSet.delete(docId);
                      // Only remove locally if not pending, not in a sibling scope, not from cache, and not merely evicted by query limit
                      if (!pendingIds.has(docId) && !isStillLiveAnywhere(docId) && !hitCap && !fromCache) {
                        await store.removeItem(docId);
                      }
                    } else {
                      const remoteData = change.doc.data();
                      if (shouldAcceptRemoteDoc && !shouldAcceptRemoteDoc(remoteData, docId)) {
                        targetSet.delete(docId);
                        if (!pendingIds.has(docId) && !isStillLiveAnywhere(docId)) {
                          await store.removeItem(docId);
                        }
                      } else {
                        targetSet.add(docId);
                        if (!pendingIds.has(docId)) {
                          await store.setItem(docId, remoteData);
                        }
                      }
                    }
                  })
                );
              }

              window.dispatchEvent(
                new CustomEvent("local-db-change", { detail: { store: storeEventName } })
              );
            } catch (err) {
              console.error(`Error in real-time ${collectionName}:${target.label} sync:`, err);
            }
          },
          (err) => reportListenerError(`${collectionName}:${target.label}`, err)
        );
        activeUnsubscribes.push(unsub);
      }
    }
  }

  // 2. Sync Ad Campaigns Collection (Bounded <= 100)
  attachScopedStoreListeners(
    "ad_campaigns",
    adCampaignsStore,
    "ad_campaigns",
    [{ label: "bounded", kind: "query", ref: query(collection(db, "ad_campaigns"), limit(100)), capLimit: 100 }],
    () => true
  );

  // 3. Sync Calendar Events Collection (Scoped & Bounded <= 250)
  const calendarTargets: ScopedTarget[] = isSuperAdmin
    ? [{ label: "all", kind: "query", ref: query(collection(db, "calendar_events"), limit(250)), capLimit: 250 }]
    : isCoachRole
    ? [
        {
          label: "club",
          kind: "query",
          ref: query(collection(db, "calendar_events"), where("clubId", "==", canonicalClubId), limit(250)),
          capLimit: 250
        },
        {
          label: "own",
          kind: "query",
          ref: query(collection(db, "calendar_events"), where("createdByUid", "==", currentUserUid), limit(250)),
          capLimit: 250
        }
      ]
    : [
        {
          label: "own",
          kind: "query",
          ref: query(collection(db, "calendar_events"), where("createdByUid", "==", currentUserUid), limit(250)),
          capLimit: 250
        },
        ...(effectiveClubId
          ? [
              {
                label: "club",
                kind: "query" as const,
                ref: query(collection(db, "calendar_events"), where("clubId", "==", effectiveClubId), limit(250)),
                capLimit: 250
              }
            ]
          : [])
      ];

  attachScopedStoreListeners(
    "calendar_events",
    calendarStore,
    "calendar_events",
    calendarTargets,
    (val) =>
      isSuperAdmin ||
      val?.createdByUid === currentUserUid ||
      Boolean(effectiveClubId && val?.clubId === effectiveClubId) ||
      (isCoachRole && val?.clubId === canonicalClubId)
  );

  // 4. Sync Macrocycles Collection (Scoped & Bounded <= 250)
  const macrocycleTargets: ScopedTarget[] = isSuperAdmin
    ? [{ label: "all", kind: "query", ref: query(collection(db, "macrocycles"), limit(250)), capLimit: 250 }]
    : isCoachRole
    ? [
        {
          label: "club",
          kind: "query",
          ref: query(collection(db, "macrocycles"), where("clubId", "==", canonicalClubId), limit(250)),
          capLimit: 250
        },
        {
          label: "coach",
          kind: "query",
          ref: query(collection(db, "macrocycles"), where("coachId", "==", currentUserUid), limit(250)),
          capLimit: 250
        }
      ]
    : [
        {
          label: "assigned",
          kind: "query",
          ref: query(
            collection(db, "macrocycles"),
            where("assignedAthleteIds", "array-contains", currentUserUid),
            limit(250)
          ),
          capLimit: 250
        },
        ...(effectiveClubId
          ? [
              {
                label: "club",
                kind: "query" as const,
                ref: query(collection(db, "macrocycles"), where("clubId", "==", effectiveClubId), limit(250)),
                capLimit: 250
              }
            ]
          : [])
      ];

  attachScopedStoreListeners(
    "macrocycles",
    macrocyclesStore,
    "macrocycles_local",
    macrocycleTargets,
    (val) =>
      isSuperAdmin ||
      val?.coachId === currentUserUid ||
      Boolean(effectiveClubId && val?.clubId === effectiveClubId) ||
      (isCoachRole && val?.clubId === canonicalClubId) ||
      (Array.isArray(val?.assignedAthleteIds) && val.assignedAthleteIds.includes(currentUserUid)),
    (remoteVal) => {
      if (!isCoachRole && !isSuperAdmin && !effectiveClubId) {
        return (
          remoteVal?.coachId === currentUserUid ||
          (Array.isArray(remoteVal?.assignedAthleteIds) &&
            remoteVal.assignedAthleteIds.includes(currentUserUid))
        );
      }
      return true;
    }
  );

  // =========================================================================
  // 5. Sync Sessions (Scoped & Bounded to limit(200), preserving older local sessions)
  // =========================================================================
  async function applySessionsSnapshot(snapshot: any, isFirst: boolean, isOwnScope: boolean) {
    const [queue, tombstones] = await Promise.all([getSyncQueue(), getSessionTombstones()]);
    const pendingSessionIds = new Set(
      queue.filter((item) => item.collection === "sessions").map((item) => item.payloadId)
    );
    const isWindowFull = snapshot.size >= SESSION_QUERY_LIMIT;
    const fromCache = Boolean(snapshot?.metadata?.fromCache);

    if (isFirst) {
      const seenRemoteIds = new Set(snapshot.docs.map((d: any) => d.id));
      let oldestRemoteTimestamp = Infinity;
      snapshot.docs.forEach((d: any) => {
        const ts = Number(d.data()?.timestamp) || 0;
        if (ts > 0 && ts < oldestRemoteTimestamp) {
          oldestRemoteTimestamp = ts;
        }
      });

      const nowMs = Date.now();
      const keysToRemove: string[] = [];
      const localSessionsToRescue: Array<{ key: string; value: any }> = [];

      await sessionsStore.iterate((localSess: any, key: string) => {
        if (isFictitiousSession(localSess, key) || tombstones.has(key)) {
          keysToRemove.push(key);
          return;
        }
        if (!isOwnScope || !currentUserUid) return;
        const isOwnSession =
          localSess && (localSess.userId === currentUserUid || localSess.userUid === currentUserUid);
        if (!isOwnSession || localSess.isDraft) return;

        const sessId = localSess.id || key;
        if (!seenRemoteIds.has(sessId) && !seenRemoteIds.has(key) && !pendingSessionIds.has(key)) {
          // Guard remote-deletion pruning & rescue against incomplete initial cached snapshots (Fixes M13)
          if (fromCache) return;

          const localTs = Number(localSess.timestamp || localSess.createdAt) || 0;
          const inActiveWindow =
            !isWindowFull || (oldestRemoteTimestamp < Infinity && localTs > oldestRemoteTimestamp);

          // Previously synced session missing from authoritative server active window => deleted on another device
          if (localSess.syncedAt && inActiveWindow && !snapshot.metadata.fromCache) {
            keysToRemove.push(key);
            return;
          }

          // Only auto-backfill never-synced local sessions from the last 14 days that were never deleted
          const isNeverSynced = !localSess.syncedAt;
          const isWithin14Days = localTs > 0 && nowMs - localTs <= SESSION_BACKFILL_MAX_AGE_MS;
          const isNotDeleted =
            !localSess.deletedAt && !localSess.deletedByArcher && !tombstones.has(key);

          if (inActiveWindow && isNeverSynced && isWithin14Days && isNotDeleted) {
            localSessionsToRescue.push({ key, value: localSess });
          }
        }
      });

      for (const { key, value } of localSessionsToRescue) {
        const { syncedAt: _omitLocalSyncedAt, ...cloudSessionFields } = value || {};
        const syncTs = Date.now();
        const payload = sanitizeForFirestore({
          ...cloudSessionFields,
          id: value.id || value.uid || key,
          userId: currentUserUid,
          clubId: value.clubId || effectiveClubId || null,
          updatedAt: syncTs
        });
        setDoc(doc(db, "sessions", key), payload, { merge: true })
          .then(async () => {
            const currentLocal = await sessionsStore.getItem<any>(key);
            if (currentLocal) {
              await sessionsStore.setItem(key, { ...currentLocal, syncedAt: syncTs });
            }
          })
          .catch((e) =>
            logger.warn("Could not rescue local session to cloud:", e?.message || e)
          );
      }

      // Merge incoming remote sessions incrementally into IndexedDB without wiping older local sessions
      await Promise.all([
        ...keysToRemove.map(async (k) => {
          await markSessionTombstone(k);
          await sessionsStore.removeItem(k);
        }),
        ...snapshot.docs
          .filter((d: any) => !pendingSessionIds.has(d.id) && !isFictitiousSession(d.data(), d.id))
          .map(async (d: any) => {
            const data = d.data();
            if (tombstones.has(d.id) && !data?.restoredByCoach) {
              return;
            }
            if (data?.isDraft && currentUserUid && data.userId === currentUserUid) {
              const existingLocal = await sessionsStore.getItem<any>(d.id);
              if (
                existingLocal &&
                (existingLocal.updatedAt || existingLocal.timestamp || 0) >=
                  (data.updatedAt || data.timestamp || 0)
              ) {
                return;
              }
            }
            await sessionsStore.setItem(d.id, {
              ...data,
              id: d.id,
              syncedAt: data?.syncedAt || Date.now()
            });
          })
      ]);
    } else {
      const changes = snapshot.docChanges();
      if (changes.length === 0) return;

      await Promise.all(
        changes.map(async (change: any) => {
          const docId = change.doc.id;
          if (pendingSessionIds.has(docId)) return;

          if (change.type === "removed") {
            // When the 200-session window is full or snapshot is from local cache, preserve local IndexedDB sessions!
            if (isWindowFull || fromCache) return;

            const existingLocal = await sessionsStore.getItem<any>(docId);
            if (
              existingLocal &&
              currentUserUid &&
              (existingLocal.userId === currentUserUid || existingLocal.userUid === currentUserUid) &&
              !isOwnScope
            ) {
              return;
            }
            if (existingLocal?.isDraft && currentUserUid && existingLocal.userId === currentUserUid) {
              return;
            }
            await markSessionTombstone(docId);
            await sessionsStore.removeItem(docId);
          } else {
            const data = change.doc.data();
            if (isFictitiousSession(data, docId)) {
              await sessionsStore.removeItem(docId);
              return;
            }
            if (tombstones.has(docId) && !data?.restoredByCoach) {
              return;
            }
            if (data?.isDraft && currentUserUid && data.userId === currentUserUid) {
              const existingLocal = await sessionsStore.getItem<any>(docId);
              if (
                existingLocal &&
                (existingLocal.updatedAt || existingLocal.timestamp || 0) >=
                  (data.updatedAt || data.timestamp || 0)
              ) {
                return;
              }
            }
            await sessionsStore.setItem(docId, {
              ...data,
              id: docId,
              syncedAt: data?.syncedAt || Date.now()
            });
          }
        })
      );
    }

    window.dispatchEvent(new CustomEvent("local-db-change", { detail: { store: "sessions_local" } }));
  }

  function attachSessionsListener(
    orderedQuery: Query<DocumentData>,
    fallbackQuery: Query<DocumentData>,
    isOwnScope: boolean,
    label: string
  ) {
    let needsServerReconcile = true;
    let didFallback = false;

    const subscribeTo = (qRef: Query<DocumentData>, allowIndexFallback: boolean) => {
      const unsub = onSnapshot(
        qRef,
        async (snapshot: any) => {
          if (generation !== syncGeneration) return;
          const runFullReconcile = needsServerReconcile;
          if (!snapshot?.metadata?.fromCache) {
            needsServerReconcile = false;
          }
          try {
            await applySessionsSnapshot(snapshot, runFullReconcile, isOwnScope);
          } catch (err) {
            console.error(`Error in real-time sessions sync (${label}):`, err);
          }
        },
        (err: any) => {
          if (
            allowIndexFallback &&
            !didFallback &&
            generation === syncGeneration &&
            (err?.code === "failed-precondition" || String(err?.message || "").includes("index"))
          ) {
            didFallback = true;
            needsServerReconcile = true;
            subscribeTo(fallbackQuery, false);
            return;
          }
          reportListenerError(`sessions:${label}`, err);
        }
      );
      activeUnsubscribes.push(unsub);
    };

    subscribeTo(orderedQuery, true);
  }

  if (isSuperAdmin) {
    attachSessionsListener(
      query(collection(db, "sessions"), orderBy("timestamp", "desc"), limit(SESSION_QUERY_LIMIT)),
      query(collection(db, "sessions"), limit(SESSION_QUERY_LIMIT)),
      true,
      "all"
    );
  } else if (currentUserUid) {
    attachSessionsListener(
      query(
        collection(db, "sessions"),
        where("userId", "==", currentUserUid),
        orderBy("timestamp", "desc"),
        limit(SESSION_QUERY_LIMIT)
      ),
      query(collection(db, "sessions"), where("userId", "==", currentUserUid), limit(SESSION_QUERY_LIMIT)),
      true,
      "own"
    );
    if (isCoachRole) {
      attachSessionsListener(
        query(
          collection(db, "sessions"),
          where("clubId", "==", canonicalClubId),
          orderBy("timestamp", "desc"),
          limit(SESSION_QUERY_LIMIT)
        ),
        query(collection(db, "sessions"), where("clubId", "==", canonicalClubId), limit(SESSION_QUERY_LIMIT)),
        false,
        "club"
      );
      if (effectiveClubId && effectiveClubId !== canonicalClubId) {
        attachSessionsListener(
          query(
            collection(db, "sessions"),
            where("clubId", "==", effectiveClubId),
            orderBy("timestamp", "desc"),
            limit(SESSION_QUERY_LIMIT)
          ),
          query(collection(db, "sessions"), where("clubId", "==", effectiveClubId), limit(SESSION_QUERY_LIMIT)),
          false,
          "alt_club"
        );
      }
    }
  }

  // 6. Sync Athlete Stars Collection (Scoped & Bounded <= 250)
  const athleteStarsTargets: ScopedTarget[] = isSuperAdmin
    ? [{ label: "all", kind: "query", ref: query(collection(db, "athlete_stars"), limit(250)), capLimit: 250 }]
    : isCoachRole
    ? [
        { label: "self", kind: "doc", ref: doc(db, "athlete_stars", currentUserUid) },
        {
          label: "club",
          kind: "query",
          ref: query(collection(db, "athlete_stars"), where("clubId", "==", canonicalClubId), limit(250)),
          capLimit: 250
        }
      ]
    : [
        { label: "self", kind: "doc", ref: doc(db, "athlete_stars", currentUserUid) },
        ...(effectiveClubId
          ? [
              {
                label: "club",
                kind: "query" as const,
                ref: query(collection(db, "athlete_stars"), where("clubId", "==", effectiveClubId), limit(250)),
                capLimit: 250
              }
            ]
          : [])
      ];

  attachScopedStoreListeners("athlete_stars", athleteStarsStore, "athlete_stars", athleteStarsTargets);

  // 7. Sync Star History Collection (Scoped & Bounded <= 250)
  const starHistoryTargets: ScopedTarget[] = isSuperAdmin
    ? [{ label: "all", kind: "query", ref: query(collection(db, "star_history"), limit(250)), capLimit: 250 }]
    : isCoachRole
    ? [
        {
          label: "club",
          kind: "query",
          ref: query(collection(db, "star_history"), where("clubId", "==", canonicalClubId), limit(250)),
          capLimit: 250
        },
        {
          label: "own",
          kind: "query",
          ref: query(collection(db, "star_history"), where("userId", "==", currentUserUid), limit(250)),
          capLimit: 250
        }
      ]
    : [
        {
          label: "own",
          kind: "query",
          ref: query(collection(db, "star_history"), where("userId", "==", currentUserUid), limit(250)),
          capLimit: 250
        },
        ...(effectiveClubId
          ? [
              {
                label: "club",
                kind: "query" as const,
                ref: query(collection(db, "star_history"), where("clubId", "==", effectiveClubId), limit(250)),
                capLimit: 250
              }
            ]
          : [])
      ];

  attachScopedStoreListeners(
    "star_history",
    starHistoryStore,
    "star_history",
    starHistoryTargets,
    (val) =>
      isSuperAdmin ||
      val?.userId === currentUserUid ||
      Boolean(effectiveClubId && val?.clubId === effectiveClubId) ||
      (isCoachRole && val?.clubId === canonicalClubId)
  );
}

/**
 * Detaches all active Firestore real-time listeners
 */
export function stopRealtimeSync() {
  syncGeneration++;
  activeSyncKey = null;
  if (activeUnsubscribes.length > 0) {
    logger.debug("Detaching real-time Firestore sync listeners...");
    activeUnsubscribes.forEach((unsub) => {
      try {
        unsub();
      } catch {
        // ignore
      }
    });
    activeUnsubscribes = [];
  }
}
