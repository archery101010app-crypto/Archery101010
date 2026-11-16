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
  isFictitiousUser,
  isFictitiousSession,
  sanitizeForFirestore
} from "./indexedDB";
import {
  UserProfile,
  hasRecentLocalUserWrite,
  getCanonicalCoachClubId,
  getExternalCoachUid,
  isLinkedToExternalCoach
} from "@/lib/authService";

const SESSION_QUERY_LIMIT = 200;

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
    console.log("Mock Firebase configuration detected. Real-time sync disabled.");
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

  console.log("Initializing Scoped Real-Time Turbo Sync Firestore listeners...");

  // =========================================================================
  // 1. Scoped & Bounded Users Listeners (replaces full-collection O(N^2) scan)
  // =========================================================================
  const liveUsersBySource = new Map<string, Map<string, UserProfile>>();
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

      const usersList = Array.from(unionRemote.values());
      const rawLocalUsers = (await settingsStore.getItem<UserProfile[]>("simulated_users")) || [];
      const localUsers = rawLocalUsers.filter((u) => !isFictitiousUser(u));
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

      const localByUid = new Map(localUsers.map((u) => [u.uid, u]));
      const mergedList: UserProfile[] = [];

      for (const remoteU of usersList) {
        const localU = localByUid.get(remoteU.uid);
        const localIsNewer =
          localU &&
          typeof localU.updatedAt === "number" &&
          typeof remoteU.updatedAt === "number" &&
          localU.updatedAt > remoteU.updatedAt;
        if (!pendingUserUids.has(remoteU.uid) && !localIsNewer) {
          mergedList.push(remoteU);
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

          if (localIsNewer) {
            // Skip overwriting a newer local profile with an older snapshot
          } else if (isLocalValid && !isRemoteValid) {
            console.warn(
              "[Sync] Local profile is complete, but remote is missing mandatory fields. Skip overwrite to avoid reset loop."
            );
          } else {
            const hasFunctionalDifference = isProfileFunctionallyDifferent(
              localCurrent,
              updatedCurrentUser
            );
            const hasAnyDifference =
              JSON.stringify(localCurrent) !== JSON.stringify(updatedCurrentUser);

            if (hasFunctionalDifference) {
              await settingsStore.setItem("current_user", updatedCurrentUser);
              window.dispatchEvent(
                new CustomEvent("current-user-updated", { detail: { user: updatedCurrentUser } })
              );
            } else if (hasAnyDifference) {
              await settingsStore.setItem("current_user", updatedCurrentUser);
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

  function attachUserDocListener(sourceKey: string, targetUid: string) {
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
      (err) => reportListenerError(`users:${sourceKey}`, err)
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

  // Always listen to current user's own document
  attachUserDocListener("self", currentUserUid);

  if (isSuperAdmin) {
    attachUsersQueryListener("superadmin", query(collection(db, "users"), limit(250)));
  } else if (isCoachRole) {
    attachUsersQueryListener(
      "coach_club",
      query(collection(db, "users"), where("clubId", "==", canonicalClubId), limit(200))
    );
    if (effectiveClubId && effectiveClubId !== canonicalClubId) {
      attachUsersQueryListener(
        "coach_alt_club",
        query(collection(db, "users"), where("clubId", "==", effectiveClubId), limit(200))
      );
    }
    attachUsersQueryListener(
      "coach_direct",
      query(collection(db, "users"), where("coachId", "==", currentUserUid), limit(200))
    );
  } else {
    if (effectiveClubId) {
      attachUsersQueryListener(
        "archer_club",
        query(collection(db, "users"), where("clubId", "==", effectiveClubId), limit(150))
      );
    }
    if (initialCoachUid && initialCoachUid !== currentUserUid) {
      attachUserDocListener(`coach:${initialCoachUid}`, initialCoachUid);
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
        attachUserDocListener(`coach:${storedUser.coachId}`, storedUser.coachId);
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
    belongsToCurrentScope?: (localVal: any, key: string) => boolean
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
                targetSet.add(docId);
                if (!pendingIds.has(docId)) {
                  await store.setItem(docId, docSnap.data());
                }
              } else {
                targetSet.delete(docId);
                if (!pendingIds.has(docId) && !isStillLiveAnywhere(docId)) {
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
        let isFirstSnapshot = true;
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
              if (hitCap) {
                truncatedTargets.add(target.label);
              } else {
                truncatedTargets.delete(target.label);
              }

              if (isFirstSnapshot) {
                isFirstSnapshot = false;
                targetSet.clear();
                snapshot.docs.forEach((d) => targetSet.add(d.id));

                await Promise.all(
                  snapshot.docs
                    .filter((d) => !pendingIds.has(d.id))
                    .map((d) => store.setItem(d.id, d.data()))
                );

                initializedTargets.add(target.label);

                // Reconcile offline server-side deletions ONLY once all sibling scopes loaded without truncation
                if (
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
                }
              } else {
                const changes = snapshot.docChanges();
                if (changes.length === 0) return;

                await Promise.all(
                  changes.map(async (change) => {
                    const docId = change.doc.id;
                    if (change.type === "removed") {
                      targetSet.delete(docId);
                      // Only remove locally if not pending, not in a sibling scope, and not merely evicted by query limit
                      if (!pendingIds.has(docId) && !isStillLiveAnywhere(docId) && !hitCap) {
                        await store.removeItem(docId);
                      }
                    } else {
                      targetSet.add(docId);
                      if (!pendingIds.has(docId)) {
                        await store.setItem(docId, change.doc.data());
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
      (Array.isArray(val?.assignedAthleteIds) && val.assignedAthleteIds.includes(currentUserUid))
  );

  // =========================================================================
  // 5. Sync Sessions (Scoped & Bounded to limit(200), preserving older local sessions)
  // =========================================================================
  async function applySessionsSnapshot(snapshot: any, isFirst: boolean, isOwnScope: boolean) {
    const queue = await getSyncQueue();
    const pendingSessionIds = new Set(
      queue.filter((item) => item.collection === "sessions").map((item) => item.payloadId)
    );
    const isWindowFull = snapshot.size >= SESSION_QUERY_LIMIT;

    if (isFirst) {
      const remoteIds = new Set(snapshot.docs.map((d: any) => d.id));
      let oldestRemoteTimestamp = Infinity;
      snapshot.docs.forEach((d: any) => {
        const ts = Number(d.data()?.timestamp) || 0;
        if (ts > 0 && ts < oldestRemoteTimestamp) {
          oldestRemoteTimestamp = ts;
        }
      });

      const keysToRemove: string[] = [];
      const localSessionsToRescue: Array<{ key: string; value: any }> = [];

      await sessionsStore.iterate((value: any, key: string) => {
        if (isFictitiousSession(value, key)) {
          keysToRemove.push(key);
          return;
        }
        if (!isOwnScope || !currentUserUid) return;
        const isOwnSession = value && (value.userId === currentUserUid || value.userUid === currentUserUid);
        if (!isOwnSession || value.isDraft) return;

        // Only rescue unsynced local sessions that fall within the active window (never re-upload archived history past limit(200))
        if (!remoteIds.has(key) && !pendingSessionIds.has(key)) {
          const localTs = Number(value.timestamp) || 0;
          if (!isWindowFull || (oldestRemoteTimestamp < Infinity && localTs > oldestRemoteTimestamp)) {
            localSessionsToRescue.push({ key, value });
          }
        }
      });

      for (const { key, value } of localSessionsToRescue) {
        const payload = sanitizeForFirestore({
          ...value,
          id: value.id || value.uid || key,
          userId: currentUserUid,
          clubId: value.clubId || effectiveClubId || null,
          updatedAt: Date.now()
        });
        setDoc(doc(db, "sessions", key), payload, { merge: true }).catch((e) =>
          console.warn("Could not rescue local session to cloud:", e?.message || e)
        );
      }

      // Merge incoming remote sessions incrementally into IndexedDB without wiping older local sessions
      await Promise.all([
        ...keysToRemove.map((k) => sessionsStore.removeItem(k)),
        ...snapshot.docs
          .filter((d: any) => !pendingSessionIds.has(d.id) && !isFictitiousSession(d.data(), d.id))
          .map(async (d: any) => {
            const data = d.data();
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
            await sessionsStore.setItem(d.id, { ...data, id: d.id });
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
            // When the 200-session window is full, a "removed" change simply means an older session slid out of the top-200 window.
            // Preserve local IndexedDB sessions so years of archer history stay intact!
            if (isWindowFull) return;

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
            await sessionsStore.removeItem(docId);
          } else {
            const data = change.doc.data();
            if (isFictitiousSession(data, docId)) {
              await sessionsStore.removeItem(docId);
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
            await sessionsStore.setItem(docId, { ...data, id: docId });
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
    let isFirst = true;
    let didFallback = false;

    const subscribeTo = (qRef: Query<DocumentData>, allowIndexFallback: boolean) => {
      const unsub = onSnapshot(
        qRef,
        async (snapshot: any) => {
          if (generation !== syncGeneration) return;
          const first = isFirst;
          isFirst = false;
          try {
            await applySessionsSnapshot(snapshot, first, isOwnScope);
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
            isFirst = true;
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
    console.log("Detaching real-time Firestore sync listeners...");
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
