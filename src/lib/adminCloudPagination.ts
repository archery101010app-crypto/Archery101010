import {
  collection,
  doc,
  getDoc,
  getDocs,
  getCountFromServer,
  query,
  where,
  orderBy,
  limit,
  startAfter,
  QueryDocumentSnapshot,
  DocumentData
} from "firebase/firestore";
import { db, auth } from "@/lib/firebase";
import { UserProfile } from "@/lib/authService";

export const ADMIN_PAGE_SIZE = 50;

export interface AdminGlobalCounts {
  totalUsers: number;
  proUsers: number;
  coachUsers: number;
  totalSessions: number;
}

export interface PaginatedUsersResult {
  users: UserProfile[];
  lastCursor: QueryDocumentSnapshot<DocumentData> | null;
  hasMore: boolean;
}

/**
 * Uses Firestore server-side index aggregation (getCountFromServer: ~1 read per 1,000 docs)
 * so SuperAdmin KPIs stay 100% accurate even at 50,000+ registered accounts without downloading docs.
 */
export async function fetchAdminGlobalCounts(): Promise<AdminGlobalCounts | null> {
  if (!auth.currentUser) return null;
  try {
    const usersCol = collection(db, "users");
    const sessionsCol = collection(db, "sessions");
    const [totalSnap, proSnap, coachSnap, sessSnap] = await Promise.all([
      getCountFromServer(usersCol).catch(() => null),
      getCountFromServer(query(usersCol, where("plan", "==", "PRO"))).catch(() => null),
      getCountFromServer(
        query(usersCol, where("role", "in", ["coach", "team_admin", "team_admin_coach"]))
      ).catch(() => null),
      getCountFromServer(sessionsCol).catch(() => null)
    ]);

    if (!totalSnap) return null;
    return {
      totalUsers: totalSnap.data().count,
      proUsers: proSnap ? proSnap.data().count : 0,
      coachUsers: coachSnap ? coachSnap.data().count : 0,
      totalSessions: sessSnap ? sessSnap.data().count : 0
    };
  } catch (err) {
    console.warn("[AdminPagination] Could not fetch global counts:", err);
    return null;
  }
}

/**
 * Fetches a 50-user cursor page ordered by createdAt DESC (with safe unordered fallback for legacy docs).
 */
export async function fetchAdminUsersPage(
  cursor: QueryDocumentSnapshot<DocumentData> | null = null,
  pageSize: number = ADMIN_PAGE_SIZE
): Promise<PaginatedUsersResult> {
  if (!auth.currentUser) {
    return { users: [], lastCursor: null, hasMore: false };
  }

  const usersCol = collection(db, "users");
  let snap;
  try {
    const q = cursor
      ? query(usersCol, orderBy("createdAt", "desc"), startAfter(cursor), limit(pageSize))
      : query(usersCol, orderBy("createdAt", "desc"), limit(pageSize));
    snap = await getDocs(q);
  } catch {
    const fallbackQ = cursor
      ? query(usersCol, startAfter(cursor), limit(pageSize))
      : query(usersCol, limit(pageSize));
    snap = await getDocs(fallbackQ);
  }

  const users: UserProfile[] = [];
  snap.docs.forEach((docSnap) => {
    const data = docSnap.data() as UserProfile;
    const uid = data?.uid || docSnap.id;
    if (uid && uid !== "USR-GUEST-OFFLINE") {
      users.push({ ...data, uid });
    }
  });

  // On the very first page, if legacy accounts without `createdAt` exist, ensure we also capture up to pageSize unordered if empty
  if (!cursor && users.length === 0) {
    const unorderedSnap = await getDocs(query(usersCol, limit(pageSize)));
    unorderedSnap.docs.forEach((docSnap) => {
      const data = docSnap.data() as UserProfile;
      const uid = data?.uid || docSnap.id;
      if (uid && uid !== "USR-GUEST-OFFLINE") {
        users.push({ ...data, uid });
      }
    });
    const lastUnordered =
      unorderedSnap.docs.length > 0 ? unorderedSnap.docs[unorderedSnap.docs.length - 1] : null;
    return {
      users,
      lastCursor: lastUnordered,
      hasMore: unorderedSnap.docs.length === pageSize
    };
  }

  const lastCursor = snap.docs.length > 0 ? snap.docs[snap.docs.length - 1] : null;
  return {
    users,
    lastCursor,
    hasMore: snap.docs.length === pageSize
  };
}

function toTitleCase(input: string): string {
  return input
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

/**
 * Searches directly against Firestore indexes by email prefix, @nickname prefix, fullName prefix,
 * 6-digit Coach invite code, or exact UID so any user out of 100,000+ is found immediately.
 */
export async function searchAdminUsersInCloud(rawTerm: string): Promise<UserProfile[]> {
  const term = (rawTerm || "").trim();
  if (!term || term.length < 2 || !auth.currentUser) return [];

  const lower = term.toLowerCase();
  const cleanNick = lower.replace(/^@/, "");
  const titleCased = toTitleCase(term);
  const usersCol = collection(db, "users");

  const promises: Promise<UserProfile[]>[] = [];

  // 1. Exact UID lookup if plausible
  if (term.length >= 6 && !term.includes(" ") && !term.includes("@")) {
    promises.push(
      getDoc(doc(db, "users", term))
        .then((d) => (d.exists() ? [{ ...(d.data() as UserProfile), uid: d.id }] : []))
        .catch(() => [])
    );
  }

  // 2. Email prefix lookup (stored lowercase)
  promises.push(
    getDocs(
      query(
        usersCol,
        where("email", ">=", lower),
        where("email", "<=", lower + "\uf8ff"),
        limit(30)
      )
    )
      .then((s) => s.docs.map((d) => ({ ...(d.data() as UserProfile), uid: (d.data() as any)?.uid || d.id })))
      .catch(() => [])
  );

  // 3. Nickname prefix lookup (stored lowercase)
  if (cleanNick.length >= 2) {
    promises.push(
      getDocs(
        query(
          usersCol,
          where("nickname", ">=", cleanNick),
          where("nickname", "<=", cleanNick + "\uf8ff"),
          limit(30)
        )
      )
        .then((s) => s.docs.map((d) => ({ ...(d.data() as UserProfile), uid: (d.data() as any)?.uid || d.id })))
        .catch(() => [])
    );
  }

  // 4. FullName prefix lookup (Title Case + raw input case)
  const nameCandidates = Array.from(new Set([titleCased, term])).filter((s) => s.length >= 2);
  for (const namePrefix of nameCandidates) {
    promises.push(
      getDocs(
        query(
          usersCol,
          where("fullName", ">=", namePrefix),
          where("fullName", "<=", namePrefix + "\uf8ff"),
          limit(30)
        )
      )
        .then((s) => s.docs.map((d) => ({ ...(d.data() as UserProfile), uid: (d.data() as any)?.uid || d.id })))
        .catch(() => [])
    );
  }

  // 5. Exact 6-digit Coach Invite Code lookup
  if (/^\d{6}$/.test(term)) {
    promises.push(
      getDocs(query(usersCol, where("clubInviteCode", "==", term), limit(10)))
        .then((s) => s.docs.map((d) => ({ ...(d.data() as UserProfile), uid: (d.data() as any)?.uid || d.id })))
        .catch(() => [])
    );
  }

  const resultsNested = await Promise.all(promises);
  const deduped = new Map<string, UserProfile>();
  for (const group of resultsNested) {
    for (const u of group) {
      if (u?.uid && u.uid !== "USR-GUEST-OFFLINE") {
        deduped.set(u.uid, u);
      }
    }
  }
  return Array.from(deduped.values());
}
