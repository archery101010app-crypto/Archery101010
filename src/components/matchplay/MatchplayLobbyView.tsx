"use client";

import React, { useState, useEffect } from "react";
import { UserProfile, updateProfile } from "@/lib/authService";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowLeft, Trophy, Search, Plus, Play, ShieldAlert, Users, Trash2, Edit3, Check, Target } from "lucide-react";
import ClubLogoIcon from "../ui/ClubLogoIcon";
import { getLocalSessions, deleteLocalSession, getLocalSetting } from "@/lib/db/indexedDB";
import { db } from "@/lib/firebase";
import { doc, setDoc, getDoc, updateDoc } from "firebase/firestore";

interface MatchplayLobbyViewProps {
  user: UserProfile;
  onBack: () => void;
  onStartDuel: (config: any) => void;
}

import { COUNTRIES } from "@/lib/countries";

const isMockUser = (uid: string, email: string = "", fullName: string = "") => {
  const u = (uid || "").toLowerCase();
  const e = (email || "").toLowerCase();
  const n = (fullName || "").toLowerCase();
  return u.startsWith("riv-") || 
         u.startsWith("usr-d-") || 
         u.includes("demo") || 
         e.includes("demo") || 
         n.includes("demo");
};

// Active mock rivals for elimination duels
const RIVAL_LIST = [
  {
    uid: "RIV-1",
    fullName: "Daniela Solano",
    nickname: "dani_solano",
    country: "CR",
    clubName: "Club Halcones",
    clubLogo: "2",
    clubCountry: "CR",
    bowConfig: { type: "Recurve", brand: "Hoyt", model: "Helix", poundage: 42, defaultDistance: 70 },
    rating: "9.1",
    status: "online"
  },
  {
    uid: "RIV-2",
    fullName: "Carlos Ruiz",
    nickname: "carlos_mx",
    country: "MX",
    clubName: "Nock Archery",
    clubLogo: "3",
    clubCountry: "MX",
    bowConfig: { type: "Compound", brand: "Mathews", model: "TRX", poundage: 58, defaultDistance: 50 },
    rating: "9.4",
    status: "online"
  },
  {
    uid: "RIV-3",
    fullName: "Laura Archer",
    nickname: "laura_spain",
    country: "ES",
    clubName: "Real Arquería",
    clubLogo: "1",
    clubCountry: "ES",
    bowConfig: { type: "Recurve", brand: "Win&Win", model: "Wiawis", poundage: 44, defaultDistance: 70 },
    rating: "9.6",
    status: "online"
  },
  {
    uid: "RIV-4",
    fullName: "Sebastián Castro",
    nickname: "sebas_barebow",
    country: "CR",
    clubName: "Club Halcones",
    clubLogo: "2",
    clubCountry: "CR",
    bowConfig: { type: "Barebow", brand: "Gillo", model: "G1", poundage: 36, defaultDistance: 18 },
    rating: "8.2",
    status: "busy"
  },
  {
    uid: "RIV-5",
    fullName: "Mateo Pérez",
    nickname: "mateo_flechas",
    country: "CO",
    clubName: "Flechas Andinas",
    clubLogo: "4",
    clubCountry: "CO",
    bowConfig: { type: "Compound", brand: "PSE", model: "Supra", poundage: 56, defaultDistance: 50 },
    rating: "8.9",
    status: "online"
  }
];

const formatMatchDate = (timestamp: any) => {
  if (!timestamp) return "Fecha N/A";
  const date = new Date(timestamp);
  return isNaN(date.getTime()) ? "Fecha N/A" : date.toLocaleDateString();
};

export default function MatchplayLobbyView({ user, onBack, onStartDuel }: MatchplayLobbyViewProps) {
  const [activeTab, setActiveTab] = useState<"SEARCH" | "DRAFTS" | "HISTORY">("SEARCH");
  const [drafts, setDrafts] = useState<any[]>([]);
  const [history, setHistory] = useState<any[]>([]);
  const [realUsers, setRealUsers] = useState<UserProfile[]>([]);

  const [bowFilter, setBowFilter] = useState<string>("ALL");
  const [distanceFilter, setDistanceFilter] = useState<string>("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [isCreatingRoom, setIsCreatingRoom] = useState(false);

  // Custom configuration for custom created room
  const [customBow, setCustomBow] = useState<"Recurve" | "Compound" | "Barebow">(user?.bowConfig?.type || "Barebow");
  const [customDistance, setCustomDistance] = useState<number>(user?.bowConfig?.defaultDistance || 70);
  const [botLevel, setBotLevel] = useState<"Rookie" | "Medium" | "High" | "Olympic">("Medium");
  const [duelMode, setDuelMode] = useState<"BOT" | "FRIEND">("FRIEND");
  const [generatedInvite, setGeneratedInvite] = useState<{ code: string; bowType: string; distance: number; text: string } | null>(null);
  const [sentInvite, setSentInvite] = useState<any | null>(null);
  const [inviteStatusMessage, setInviteStatusMessage] = useState("");

  // Competitor Gamertag / Alias State for Duels
  const [isEditingAlias, setIsEditingAlias] = useState(false);
  const [currentAlias, setCurrentAlias] = useState(user.nickname || user.fullName.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 15) || "arquero");

  useEffect(() => {
    if (user.nickname) {
      setCurrentAlias(user.nickname);
    }
  }, [user.nickname]);

  const handleSaveAlias = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const cleanAlias = currentAlias.trim().toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 15) || "arquero";
    setCurrentAlias(cleanAlias);
    setIsEditingAlias(false);
    try {
      const updated = await updateProfile(user.uid, { nickname: cleanAlias });
      window.dispatchEvent(new CustomEvent("current-user-updated", { detail: { user: updated } }));
    } catch (err) {
      console.error("Error updating matchplay alias:", err);
    }
  };
  // Sincronización automática de presencia y cola en el lobby
  useEffect(() => {
    if (!user?.uid) return;
    const uid = user.uid;

    const updateLobbyPresence = async () => {
      try {
        const { doc, setDoc } = await import("firebase/firestore");
        const { db } = await import("@/lib/firebase");
        const docRef = doc(db, "users", uid);
        await setDoc(docRef, {
          lastActiveAt: Date.now()
        }, { merge: true });
        console.log("[Lobby Presence] Updated presence in Firestore.");
      } catch (err) {
        console.error("[Lobby Presence] Error updating presence:", err);
      }
    };

    const triggerBgSync = () => {
      import("@/lib/db/syncManager")
        .then(({ runSync }) => {
          runSync().catch((err) => console.error("[Lobby] Background sync failed:", err));
        })
        .catch((err) => console.error("[Lobby] Failed to import syncManager:", err));
    };

    // Run immediately on mount
    updateLobbyPresence();
    triggerBgSync();

    // Set up intervals
    const presenceInterval = setInterval(updateLobbyPresence, 20000); // presence every 20s
    const syncInterval = setInterval(triggerBgSync, 15000); // bg sync every 15s

    return () => {
      clearInterval(presenceInterval);
      clearInterval(syncInterval);
    };
  }, [user?.uid]);

  const handleDeleteDraft = async (id: string) => {
    if (!window.confirm("¿Seguro que deseas eliminar este duelo activo permanentemente?")) {
      return;
    }
    try {
      await deleteLocalSession(id);
      // Reload list
      const localSess = await getLocalSessions();
      const duelSessions = localSess.filter(
        (s) => s.isDuel === true && s.userUid === user.uid && s.deletedByArcher !== true
      );
      setDrafts(duelSessions.filter((s) => s.isDraft === true));
    } catch (err) {
      console.error("Error deleting draft:", err);
    }
  };

  // Fetch drafts and completed history from IndexedDB
  useEffect(() => {
    async function loadDuels() {
      try {
        const localSess = await getLocalSessions();
        const duelSessions = localSess.filter(
          (s) => s.isDuel === true && s.userUid === user.uid && s.deletedByArcher !== true
        );
        
        const activeDrafts = duelSessions.filter((s) => s.isDraft === true);
        const completedHistory = duelSessions.filter((s) => !s.isDraft);
        
        setDrafts(activeDrafts);
        setHistory(completedHistory);
      } catch (err) {
        console.error("Error loading duels:", err);
      }
    }
    loadDuels();
  }, [user, activeTab]);

  // Load real users and listen to database changes
  useEffect(() => {
    async function loadRealUsers() {
      try {
        const list = await getLocalSetting<UserProfile[]>("simulated_users", []);
        // Exclude the current user
        const others = list.filter((u) => u.uid !== user.uid);
        setRealUsers(others);
      } catch (err) {
        console.error("Error loading real users for duels:", err);
      }
    }
    
    loadRealUsers();
    
    // Listen to changes in the database
    const handleDbChange = (e: Event) => {
      const customEvent = e as CustomEvent;
      if (customEvent.detail?.store === "simulated_users") {
        loadRealUsers();
      }
    };
    
    window.addEventListener("local-db-change", handleDbChange);
    return () => {
      window.removeEventListener("local-db-change", handleDbChange);
    };
  }, [user]);

  // Listen for invitation status updates
  useEffect(() => {
    if (!sentInvite) return;

    let unsubscribe: () => void = () => {};

    async function listenToInvite() {
      try {
        const { doc, onSnapshot, deleteDoc } = await import("firebase/firestore");
        const { db } = await import("@/lib/firebase");

        const inviteRef = doc(db, "duel_invitations", sentInvite.id);
        unsubscribe = onSnapshot(inviteRef, (snap) => {
          if (snap.exists()) {
            const data = snap.data();
            if (data.status === "accepted") {
              // Challenger transitions to Arena
              const matchConfig = {
                id: data.roomCode,
                bowType: data.bowType,
                distance: data.distance,
                system: data.bowType === "Compound" ? "cumulative" : "set",
                isCreator: true,
                rival: {
                  uid: data.receiverUid,
                  fullName: realUsers.find(u => u.uid === data.receiverUid)?.fullName || "Oponente en Línea",
                  country: "CR",
                  clubName: "Oponente",
                  clubLogo: "0",
                  clubCountry: "CR",
                  rating: 9.0
                }
              };
              
              // Clean up invite
              deleteDoc(inviteRef).catch(() => {});
              
              setSentInvite(null);
              onStartDuel(matchConfig);
            } else if (data.status === "rejected") {
              setInviteStatusMessage("El oponente ha rechazado el reto.");
              setTimeout(() => {
                setSentInvite(null);
              }, 3000);
            }
          }
        });
      } catch (err) {
        console.error("Error listening to sent invite:", err);
      }
    }

    listenToInvite();

    return () => unsubscribe();
  }, [sentInvite, realUsers]);

  const handleChallengeRealUser = async (rival: any) => {
    setInviteStatusMessage("Enviando reto...");
    
    // Generate matchplay code
    const code = "MAT-" + Math.random().toString(36).substring(2, 5).toUpperCase() + "-" + Math.random().toString(36).substring(2, 5).toUpperCase();
    
    try {
      const { collection, doc, setDoc } = await import("firebase/firestore");
      const { db } = await import("@/lib/firebase");

      const inviteId = `INV-${Date.now()}`;
      
      const inviteData = {
        senderUid: user.uid,
        senderName: user.fullName,
        receiverUid: rival.uid,
        bowType: rival.bowConfig.type,
        distance: rival.bowConfig.defaultDistance,
        status: "pending",
        roomCode: code,
        createdAt: Date.now()
      };

      // Write invite to Firestore
      await setDoc(doc(db, "duel_invitations", inviteId), inviteData);

      // Write duel room to Firestore
      await setDoc(doc(db, "active_duels", code), {
        id: code,
        bowType: rival.bowConfig.type,
        distance: rival.bowConfig.defaultDistance,
        creatorUid: user.uid,
        creatorName: user.fullName,
        creatorConnected: true,
        creatorConnectedAt: Date.now(),
        playerUid: rival.uid,
        playerName: rival.fullName,
        playerConnected: false,
        playerConnectedAt: 0,
        creatorReady: false,
        playerReady: false,
        status: "waiting",
        updatedAt: Date.now()
      });

      setSentInvite({ id: inviteId, ...inviteData });
      setInviteStatusMessage(`Esperando a que ${rival.fullName} acepte el reto...`);

    } catch (err) {
      console.error("Error creating real-time challenge:", err);
      alert("Error al enviar el reto. Intenta de nuevo.");
    }
  };

  const containerVariants: any = {
    initial: { opacity: 0 },
    animate: { opacity: 1, transition: { staggerChildren: 0.05 } }
  };

  const cardVariants: any = {
    initial: { opacity: 0, y: 15 },
    animate: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.16, 1, 0.3, 1] } }
  };

  // Filter rivals: actual registered users who are currently online
  const filteredRivals = realUsers.map((u) => ({
    uid: u.uid || "",
    fullName: u.fullName || "",
    nickname: u.nickname || (u.fullName ? u.fullName.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 15) : "arquero"),
    email: u.email || "",
    country: u.country || "CR",
    clubName: u.clubName || "Independiente",
    clubLogo: u.clubLogo || "0",
    clubCountry: u.clubCountry || u.country || "CR",
    bowConfig: {
      type: (u.bowConfig?.type || "Barebow") as "Recurve" | "Compound" | "Barebow",
      brand: u.bowConfig?.brand || "Hoyt",
      model: u.bowConfig?.model || "Satori",
      poundage: u.bowConfig?.poundage || 35,
      defaultDistance: u.bowConfig?.defaultDistance || 18
    },
    rating: "9.0",
    status: (u.lastActiveAt && (Math.abs(Date.now() - u.lastActiveAt) < 300000)) ? "online" as const : "offline" as const,
    lastActiveAt: u.lastActiveAt
  })).filter((riv) => {
    // Exclude mock/demo users from the online list
    if (isMockUser(riv.uid, riv.email, riv.fullName)) return false;

    // Exclude the current user themselves
    if (riv.uid === user.uid) return false;

    // Exclude users without a valid name
    if (!riv.fullName || !riv.fullName.trim()) return false;

    const matchesSearch = (riv.fullName || "").toLowerCase().includes((searchQuery || "").toLowerCase()) ||
                          (riv.clubName || "").toLowerCase().includes((searchQuery || "").toLowerCase());
    const matchesBow = bowFilter === "ALL" || riv.bowConfig.type === bowFilter;
    
    let matchesDist = true;
    if (distanceFilter !== "ALL") {
      matchesDist = riv.bowConfig.defaultDistance === Number(distanceFilter);
    }

    return matchesSearch && matchesBow && matchesDist && riv.status === "online";
  });

  // Filter practice bots (simulated opponents)
  const practiceBots = RIVAL_LIST.map((riv) => ({
    uid: riv.uid,
    fullName: riv.fullName,
    nickname: (riv as any).nickname || "",
    country: riv.country,
    clubName: riv.clubName,
    clubLogo: riv.clubLogo,
    clubCountry: riv.clubCountry,
    bowConfig: {
      type: riv.bowConfig.type as "Recurve" | "Compound" | "Barebow",
      brand: riv.bowConfig.brand,
      model: riv.bowConfig.model,
      poundage: riv.bowConfig.poundage,
      defaultDistance: riv.bowConfig.defaultDistance
    },
    rating: riv.rating,
    status: "simulated" as const
  })).filter((riv) => {
    const matchesSearch = riv.fullName.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          riv.clubName.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesBow = bowFilter === "ALL" || riv.bowConfig.type === bowFilter;
    
    let matchesDist = true;
    if (distanceFilter !== "ALL") {
      matchesDist = riv.bowConfig.defaultDistance === Number(distanceFilter);
    }

    return matchesSearch && matchesBow && matchesDist;
  });

  const handleStartSimulatedDuel = (rival: any) => {
    const matchConfig = {
      id: `MATCH-${Date.now()}`,
      bowType: rival.bowConfig.type,
      distance: rival.bowConfig.defaultDistance,
      system: rival.bowConfig.type === "Compound" ? "cumulative" : "set",
      rival: {
        uid: rival.uid,
        fullName: rival.fullName,
        country: rival.country,
        clubName: rival.clubName,
        clubLogo: rival.clubLogo,
        clubCountry: rival.clubCountry,
        rating: Number(rival.rating)
      }
    };
    onStartDuel(matchConfig);
  };

  const handleCreateRoomSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (duelMode === "FRIEND") {
      const codeSuffix = Math.random().toString(36).substring(2, 7).toUpperCase();
      const bowCode = customBow === "Compound" ? "C" : customBow === "Recurve" ? "R" : "B";
      const generatedCode = `INV-${bowCode}${customDistance}-${codeSuffix}`;
      
      const shareUrl = typeof window !== "undefined" && !window.location.origin.includes("localhost")
        ? `${window.location.origin}?join=${generatedCode}`
        : `https://archery101010.com?join=${generatedCode}`;

      const shareText = `¡Te desafío a una Eliminatoria Online 1 vs 1 en Archery 101010!\n\nFormato: ${customBow === "Recurve" ? "Recurvo" : customBow === "Compound" ? "Compuesto" : "Barebow"} a ${customDistance}m\nCódigo de Sala: ${generatedCode}\n\nEntra al duelo en vivo aquí:\n${shareUrl}`;

      // Write duel room to Firestore immediately so that guest join attempts don't fail as invalid
      setDoc(doc(db, "active_duels", generatedCode), {
        id: generatedCode,
        bowType: customBow,
        distance: customDistance,
        creatorUid: user.uid,
        creatorName: user.fullName,
        creatorConnected: true,
        creatorConnectedAt: Date.now(),
        playerUid: "",
        playerName: "",
        playerConnected: false,
        playerConnectedAt: 0,
        creatorReady: false,
        playerReady: false,
        status: "waiting",
        updatedAt: Date.now()
      }).catch((err) => {
        console.error("Error creating active duel in Firestore immediately:", err);
      });

      setGeneratedInvite({
        code: generatedCode,
        bowType: customBow,
        distance: customDistance,
        text: shareText
      });
      setIsCreatingRoom(false);
      return;
    }
    
    const botRatings = {
      Rookie: 7.2,
      Medium: 8.3,
      High: 9.2,
      Olympic: 9.8
    };
    
    const botNames = {
      Rookie: "Bot Novato",
      Medium: "Arquero Medio",
      High: "Alto Nivel",
      Olympic: "Campeón Olímpico"
    };

    const matchConfig = {
      id: `MATCH-${Date.now()}`,
      bowType: customBow,
      distance: customDistance,
      system: customBow === "Compound" ? "cumulative" : "set",
      rival: {
        uid: `RIV-BOT-${botLevel.toUpperCase()}`,
        fullName: botNames[botLevel],
        country: "ES",
        clubName: "101010 Academy",
        clubLogo: "2",
        clubCountry: "ES",
        rating: botRatings[botLevel]
      }
    };
    onStartDuel(matchConfig);
  };

  const handleJoinRoomSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!joinCode) return;

    const code = joinCode.toUpperCase().trim();
    
    try {
      const docRef = doc(db, "active_duels", code);
      const docSnap = await getDoc(docRef);
      
      if (docSnap.exists()) {
        const data = docSnap.data();
        
        // Update document to connect player
        await updateDoc(docRef, {
          playerUid: user.uid,
          playerName: user.fullName,
          playerConnected: true,
          playerConnectedAt: Date.now(),
          status: "active",
          updatedAt: Date.now()
        });

        const matchConfig = {
          id: data.id,
          bowType: data.bowType,
          distance: data.distance,
          system: data.bowType === "Compound" ? "cumulative" : "set",
          isCreator: false,
          rival: {
            uid: "RIV-FRIEND-CREATOR",
            fullName: data.creatorName || "Anfitrión del Duelo",
            country: "CR",
            clubName: "Lobby Archery",
            clubLogo: "1",
            clubCountry: "CR",
            rating: 9.2
          }
        };
        onStartDuel(matchConfig);
      } else {
        alert("El código de duelo no existe o es inválido.");
      }
    } catch (err) {
      console.error("Error joining duel in Firestore:", err);
      alert("No se pudo conectar al duelo. Verifica tu conexión a internet.");
    }
  };

  return (
    <div className="flex flex-col gap-4 py-3 min-h-full relative overflow-hidden">
      {/* Hero Header: Eliminatorias Online 1v1 */}
      <div className="bg-[#0D1017] border border-white/[0.1] rounded-2xl p-4 relative overflow-hidden z-10 flex flex-col gap-2.5">
        <div className="absolute top-0 left-0 right-0 h-[3px] flex">
          <div className="flex-1 bg-cyan-neon" />
          <div className="flex-1 bg-red-rival" />
          <div className="flex-1 bg-yellow-gold" />
        </div>

        {/* Row 1: Back button + Live Badge on Left, Alias Pill on Right */}
        <div className="flex items-center justify-between gap-2 pt-0.5">
          <div className="flex items-center gap-2">
            <button
              onClick={onBack}
              aria-label="Volver"
              className="h-8 w-8 rounded-xl bg-[#141923] border border-white/[0.08] text-white hover:text-white flex items-center justify-center cursor-pointer transition shrink-0"
            >
              <ArrowLeft size={15} />
            </button>
            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/25">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shrink-0" />
              <span className="text-[9px] text-emerald-400 uppercase tracking-wider font-black whitespace-nowrap">
                EN VIVO · 1 VS 1
              </span>
            </div>
          </div>

          {/* Compact Gamertag / Alias Pill */}
          <div className="flex items-center gap-1.5 bg-[#080A0F] border border-white/[0.08] rounded-xl px-2.5 py-1 shrink-0">
            {isEditingAlias ? (
              <form onSubmit={handleSaveAlias} className="flex items-center gap-1">
                <input
                  type="text"
                  autoFocus
                  value={currentAlias}
                  onChange={(e) => setCurrentAlias(e.target.value)}
                  className="h-6 w-24 bg-[#121722] border border-cyan-neon text-cyan-neon font-mono font-bold text-xs px-1.5 rounded outline-none"
                  placeholder="alias"
                />
                <button
                  type="submit"
                  className="h-6 px-2 rounded bg-cyan-neon text-black font-black text-[9px] flex items-center justify-center cursor-pointer"
                >
                  <Check size={11} />
                </button>
              </form>
            ) : (
              <button
                type="button"
                onClick={() => setIsEditingAlias(true)}
                className="flex items-center gap-1.5 text-left cursor-pointer group"
                title="Cambiar tu alias para retos online"
              >
                <span className="text-[11px] font-mono font-bold text-cyan-neon truncate max-w-[110px]">
                  @{currentAlias}
                </span>
                <Edit3 size={10} className="text-white group-hover:text-white transition shrink-0" />
              </button>
            )}
          </div>
        </div>

        {/* Row 2: Full-width Title & Description (Never squeezed by side buttons) */}
        <div className="flex flex-col gap-1 pt-0.5">
          <h2
            className="text-white text-[15px] sm:text-lg font-black uppercase tracking-wider leading-snug [text-wrap:balance]"
            style={{ fontFamily: "var(--font-family-logo, 'Good Times', sans-serif)" }}
          >
            ELIMINATORIAS ONLINE
          </h2>
          <p className="text-xs text-white leading-relaxed [text-wrap:pretty]">
            Compite flecha a flecha en tiempo real bajo reglamento oficial WA (Recurvo y Barebow a 6 pts de set · Compuesto a 15 flechas).
          </p>
        </div>
      </div>

      {/* Lobby Tab Bar */}
      <div className="grid grid-cols-3 bg-[#0D1017] border border-white/[0.08] p-1 rounded-xl z-10 gap-1">
        <button
          onClick={() => setActiveTab("SEARCH")}
          className={`h-9 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all cursor-pointer flex items-center justify-center whitespace-nowrap ${
            activeTab === "SEARCH"
              ? "bg-cyan-neon text-black"
              : "text-white hover:text-white"
          }`}
        >
          Arena 1 vs 1
        </button>
        <button
          onClick={() => setActiveTab("DRAFTS")}
          className={`h-9 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all cursor-pointer flex items-center justify-center gap-1.5 whitespace-nowrap ${
            activeTab === "DRAFTS"
              ? "bg-cyan-neon text-black"
              : "text-white hover:text-white"
          }`}
        >
          <span>En Curso</span>
          {drafts.length > 0 && (
            <span className="px-1.5 py-0.5 rounded-full bg-yellow-gold text-black text-[9px] font-black leading-none">
              {drafts.length}
            </span>
          )}
        </button>
        <button
          onClick={() => setActiveTab("HISTORY")}
          className={`h-9 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all cursor-pointer flex items-center justify-center whitespace-nowrap ${
            activeTab === "HISTORY"
              ? "bg-cyan-neon text-black"
              : "text-white hover:text-white"
          }`}
        >
          Historial
        </button>
      </div>

      {/* Tab Contents */}
      {activeTab === "SEARCH" && (
        <div className="flex flex-col gap-4 z-10">
          {/* 1. Direct Match Creator Card (Always visible, single-line header guaranteed) */}
          <div className="bg-[#0D1017] border border-white/[0.1] rounded-2xl p-4 flex flex-col gap-3.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-black uppercase tracking-wider text-white whitespace-nowrap">
                Nueva Eliminatoria
              </span>
              <span className="text-[10px] font-bold text-cyan-neon bg-cyan-neon/10 border border-cyan-neon/25 px-2.5 py-0.5 rounded-lg whitespace-nowrap shrink-0">
                {customBow === "Compound" ? "15 Flechas · Acumulado" : "Sistema de Sets · 6 Pts"}
              </span>
            </div>

            <form onSubmit={handleCreateRoomSubmit} className="flex flex-col gap-3">
              {/* Selector de Modo: Amigo Online vs Bot Olímpico */}
              <div className="grid grid-cols-2 gap-1.5 bg-[#080A0F] p-1 rounded-xl border border-white/[0.07]">
                <button
                  type="button"
                  onClick={() => setDuelMode("FRIEND")}
                  className={`h-9 px-2 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all cursor-pointer flex items-center justify-center whitespace-nowrap ${
                    duelMode === "FRIEND"
                      ? "bg-cyan-neon text-black"
                      : "text-white hover:text-white"
                  }`}
                >
                  Contra Amigo Online
                </button>
                <button
                  type="button"
                  onClick={() => setDuelMode("BOT")}
                  className={`h-9 px-2 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all cursor-pointer flex items-center justify-center whitespace-nowrap ${
                    duelMode === "BOT"
                      ? "bg-yellow-gold text-black"
                      : "text-white hover:text-white"
                  }`}
                >
                  Contra Bot Olímpico
                </button>
              </div>

              {/* Tactile Bow & Distance Selectors */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <span className="text-[10px] text-white font-bold uppercase tracking-wider">
                    Modalidad de Arco
                  </span>
                  <div className="grid grid-cols-3 gap-1.5">
                    {(["Recurve", "Compound", "Barebow"] as const).map((b) => (
                      <button
                        key={b}
                        type="button"
                        onClick={() => setCustomBow(b)}
                        className={`h-9 rounded-xl text-[10px] font-black uppercase border transition cursor-pointer flex items-center justify-center whitespace-nowrap ${
                          customBow === b
                            ? "bg-white/[0.12] border-cyan-neon text-white"
                            : "bg-[#080A0F] border-white/[0.06] text-white hover:text-white"
                        }`}
                      >
                        {b === "Recurve" ? "Recurvo" : b === "Compound" ? "Compuesto" : "Barebow"}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex flex-col gap-1.5">
                  <span className="text-[10px] text-white font-bold uppercase tracking-wider">
                    Distancia Oficial
                  </span>
                  <div className="grid grid-cols-3 gap-1.5">
                    {([18, 50, 70] as const).map((d) => (
                      <button
                        key={d}
                        type="button"
                        onClick={() => setCustomDistance(d)}
                        className={`h-9 rounded-xl text-[10px] font-black uppercase border transition cursor-pointer tabular-nums flex items-center justify-center whitespace-nowrap ${
                          customDistance === d
                            ? "bg-white/[0.12] border-cyan-neon text-white"
                            : "bg-[#080A0F] border-white/[0.06] text-white hover:text-white"
                        }`}
                      >
                        {d} m
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Bot Level Pills or Online Explanation */}
              {duelMode === "BOT" ? (
                <div className="flex flex-col gap-1.5">
                  <span className="text-[10px] text-white font-bold uppercase tracking-wider">
                    Nivel del Oponente Simulado
                  </span>
                  <div className="grid grid-cols-4 gap-1.5">
                    {(
                      [
                        { id: "Rookie", label: "Novato", avg: "7.2" },
                        { id: "Medium", label: "Medio", avg: "8.3" },
                        { id: "High", label: "Alto", avg: "9.2" },
                        { id: "Olympic", label: "Olímpico", avg: "9.8" }
                      ] as const
                    ).map((lvl) => (
                      <button
                        key={lvl.id}
                        type="button"
                        onClick={() => setBotLevel(lvl.id)}
                        className={`py-2 px-1 rounded-xl border flex flex-col items-center justify-center transition cursor-pointer ${
                          botLevel === lvl.id
                            ? "bg-yellow-gold/15 border-yellow-gold text-yellow-gold"
                            : "bg-[#080A0F] border-white/[0.06] text-white hover:text-white"
                        }`}
                      >
                        <span className="text-[9px] font-black uppercase whitespace-nowrap">{lvl.label}</span>
                        <span className="text-[8px] font-bold opacity-80 tabular-nums mt-0.5">Prom. {lvl.avg}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="bg-[#080A0F] border border-white/[0.06] rounded-xl px-3 py-2.5">
                  <p className="text-[11px] text-white leading-snug [text-wrap:pretty]">
                    Genera una sala en vivo con código y enlace directo para compartir por WhatsApp con tu oponente.
                  </p>
                </div>
              )}

              <button
                type="submit"
                className={`w-full h-11 rounded-xl font-black text-xs uppercase tracking-wider cursor-pointer active:scale-98 transition flex items-center justify-center whitespace-nowrap ${
                  duelMode === "FRIEND"
                    ? "bg-cyan-neon hover:bg-[#19c8ff] text-black"
                    : "bg-yellow-gold hover:brightness-105 text-black"
                }`}
              >
                {duelMode === "FRIEND"
                  ? "Crear Sala Online y Enviar Reto"
                  : "Iniciar Eliminatoria vs Bot"}
              </button>
            </form>
          </div>

          {/* 2. Quick Join by Room Code Card */}
          <div className="bg-[#0D1017] border border-white/[0.08] p-4 rounded-2xl flex flex-col gap-2.5">
            <div className="flex flex-col gap-0.5">
              <span className="text-xs font-black uppercase tracking-wider text-white">
                Unirse con Código de Invitación
              </span>
              <span className="text-[11px] text-white">
                Si un amigo te envió un código de sala, escríbelo aquí para entrar directo.
              </span>
            </div>
            <form onSubmit={handleJoinRoomSubmit} className="flex gap-2 items-center w-full">
              <input
                type="text"
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value)}
                placeholder="Ej. INV-R70-X9A"
                className="flex-1 h-10 bg-[#080A0F] border border-white/[0.1] focus:border-cyan-neon text-white text-xs px-3 rounded-xl outline-none transition uppercase text-center font-mono font-bold"
              />
              <button
                type="submit"
                className="h-10 px-4 rounded-xl bg-white/[0.1] hover:bg-cyan-neon hover:text-black border border-white/[0.12] text-white font-black text-[10px] uppercase tracking-wider cursor-pointer transition active:scale-95 shrink-0 whitespace-nowrap"
              >
                Entrar a Sala
              </button>
            </form>
          </div>

          {/* Search and Filters */}
          <div className="flex flex-col gap-2 pt-1">
            <div className="relative flex items-center">
              <span className="absolute left-3 text-white">
                <Search size={14} />
              </span>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Filtrar rivales por nombre o club..."
                className="w-full h-10 bg-[#0D1017] border border-white/[0.08] text-white text-xs pl-9 pr-4 rounded-xl outline-none focus:border-cyan-neon transition duration-150"
              />
            </div>

            {/* Filter Badges */}
            <div className="grid grid-cols-3 gap-1.5">
              {(["Recurve", "Compound", "Barebow"] as const).map((bow) => (
                <button
                  key={bow}
                  type="button"
                  onClick={() => setBowFilter(bowFilter === bow ? "ALL" : bow)}
                  className={`h-8 rounded-xl text-[10px] font-black uppercase transition-all duration-150 border cursor-pointer flex items-center justify-center whitespace-nowrap ${
                    bowFilter === bow
                      ? "bg-cyan-neon/15 border-cyan-neon text-cyan-neon"
                      : "bg-[#0D1017] border-white/[0.07] text-white hover:text-white"
                  }`}
                >
                  {bow === "Recurve" ? "Recurvo" : bow === "Compound" ? "Compuesto" : "Barebow"}
                </button>
              ))}
            </div>
          </div>

          {/* Rivals List */}
          <div className="flex flex-col gap-5 flex-1 pb-6">
            {/* Real Online Archers */}
            <div className="flex flex-col gap-2.5">
              <h4 className="text-white text-xs font-black uppercase tracking-wider pl-1 flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-400" />
                Arqueros Conectados en Línea ({filteredRivals.length})
              </h4>

              <motion.div
                variants={containerVariants}
                initial="initial"
                animate="animate"
                className="flex flex-col gap-2.5"
              >
                <AnimatePresence>
                  {filteredRivals.length === 0 ? (
                    <motion.div
                      variants={cardVariants}
                      className="bg-[#0D1017] border border-white/[0.06] rounded-2xl p-4 flex flex-col items-center justify-center text-center gap-1"
                    >
                      <Users size={16} className="text-white" />
                      <p className="text-[11px] text-white font-semibold">
                        No hay otros arqueros en el lobby público en este instante.
                      </p>
                      <p className="text-[10px] text-white">
                        Usa &ldquo;Crear Sala Online 1v1&rdquo; arriba para enviar un enlace directo por WhatsApp a tu amigo.
                      </p>
                    </motion.div>
                  ) : (
                    filteredRivals.map((riv) => {
                      const flag = COUNTRIES.find((c) => c.code === riv.country)?.flag || "🇨🇷 CRC";
                      return (
                        <motion.div
                          key={riv.uid}
                          variants={cardVariants}
                          exit={{ opacity: 0, scale: 0.95 }}
                          className="bg-[#0D1017] border border-white/[0.08] rounded-2xl p-3 flex justify-between items-center hover:border-cyan-neon/40 transition-all duration-150"
                        >
                          <div className="flex items-center gap-3 w-[70%]">
                            <div className="relative shrink-0">
                              <div className="w-10 h-10 rounded-full bg-[#080A0F] border border-white/[0.1] flex items-center justify-center text-white font-black text-xs">
                                {riv.fullName.substring(0, 2).toUpperCase()}
                              </div>
                              <span className="absolute -bottom-1 -right-1 text-[8px] font-black uppercase tracking-wider bg-[#0D1017] border border-white/15 text-cyan-neon px-1 py-0.5 rounded leading-none whitespace-nowrap">{flag}</span>
                            </div>
                            
                            <div className="flex flex-col min-w-0">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="text-white text-xs font-bold truncate">{riv.fullName}</span>
                                {riv.nickname && (
                                  <span className="text-cyan-neon font-mono text-[9px] font-bold">@{riv.nickname}</span>
                                )}
                                <span className="text-[8px] px-1.5 py-0.5 rounded bg-[#080A0F] border border-white/[0.06] text-yellow-gold font-extrabold uppercase shrink-0">
                                  {riv.bowConfig.type === "Recurve" ? "Recurvo" : riv.bowConfig.type === "Compound" ? "Compuesto" : riv.bowConfig.type}
                                </span>
                              </div>
                              <div className="flex items-center gap-1 mt-0.5 truncate text-[10px] text-white">
                                <ClubLogoIcon logo={riv.clubLogo} className="w-3 h-3 shrink-0" />
                                <span className="truncate">{riv.clubName}</span>
                                <span>·</span>
                                <span className="shrink-0">{riv.bowConfig.defaultDistance}m</span>
                              </div>
                            </div>
                          </div>

                          <div className="flex flex-col items-end gap-1.5">
                            <span className="text-[9px] text-emerald-400 font-black tracking-tight">En línea</span>
                            <button
                              onClick={() => handleChallengeRealUser(riv)}
                              className="px-3.5 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-wider cursor-pointer active:scale-95 transition bg-cyan-neon hover:bg-[#19c8ff] text-black"
                            >
                              Retar 1v1
                            </button>
                          </div>
                        </motion.div>
                      );
                    })
                  )}
                </AnimatePresence>
              </motion.div>
            </div>

            {/* Simulated Practice Bots */}
            <div className="flex flex-col gap-2.5 mt-1">
              <h4 className="text-white text-xs font-black uppercase tracking-wider pl-1 flex items-center gap-1.5">
                Simuladores de Eliminatoria (Bots WA)
              </h4>

              <motion.div
                variants={containerVariants}
                initial="initial"
                animate="animate"
                className="flex flex-col gap-2"
              >
                {practiceBots.map((riv) => {
                  const flag = COUNTRIES.find((c) => c.code === riv.country)?.flag || "🇨🇷 CRC";
                  return (
                    <motion.div
                      key={riv.uid}
                      variants={cardVariants}
                      className="bg-[#0D1017]/80 border border-white/[0.06] rounded-2xl p-3 flex justify-between items-center hover:border-white/15 transition-all duration-150"
                    >
                      <div className="flex items-center gap-3 w-[70%]">
                        <div className="relative shrink-0">
                          <div className="w-10 h-10 rounded-full bg-[#080A0F] border border-white/[0.08] flex items-center justify-center text-white font-bold text-xs">
                            {riv.fullName.substring(0, 2).toUpperCase()}
                          </div>
                          <span className="absolute -bottom-1 -right-1 text-[8px] font-black uppercase tracking-wider bg-[#0D1017] border border-white/15 text-white px-1 py-0.5 rounded leading-none whitespace-nowrap">{flag}</span>
                        </div>
                        
                        <div className="flex flex-col min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-white text-xs font-bold truncate">{riv.fullName}</span>
                            <span className="text-[8px] px-1.5 py-0.5 rounded bg-[#080A0F] border border-white/[0.06] text-white font-bold uppercase shrink-0">
                              {riv.bowConfig.type === "Recurve" ? "Recurvo" : riv.bowConfig.type === "Compound" ? "Compuesto" : riv.bowConfig.type}
                            </span>
                          </div>
                          <div className="flex items-center gap-1 mt-0.5 truncate text-[10px] text-white">
                            <ClubLogoIcon logo={riv.clubLogo} className="w-3 h-3 shrink-0 opacity-75" />
                            <span className="truncate">{riv.clubName}</span>
                            <span>·</span>
                            <span className="shrink-0">{riv.bowConfig.defaultDistance}m</span>
                          </div>
                        </div>
                      </div>

                      <div className="flex flex-col items-end gap-1.5">
                        <span className="text-[9px] text-yellow-gold font-bold tracking-tight tabular-nums">
                          Prom. {riv.rating}
                        </span>
                        <button
                          onClick={() => handleStartSimulatedDuel(riv)}
                          className="px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-wider cursor-pointer active:scale-95 transition bg-white/[0.06] border border-white/[0.1] text-white hover:bg-white/[0.12]"
                        >
                          Competir
                        </button>
                      </div>
                    </motion.div>
                  );
                })}
              </motion.div>
            </div>
          </div>
        </div>
      )}

      {activeTab === "DRAFTS" && (
        <div className="flex flex-col gap-4 z-10 flex-1">
          <h4 className="text-white text-xs font-black uppercase tracking-wider pl-1 flex items-center gap-1.5">
            <Users size={13} className="text-cyan-neon" />
            Eliminatorias en Curso ({drafts.length})
          </h4>
          
          <div className="flex flex-col gap-2.5">
            {drafts.length === 0 ? (
              <div className="bg-[#0D1017] border border-white/[0.06] rounded-2xl p-6 flex flex-col items-center justify-center text-center gap-2">
                <ShieldAlert size={20} className="text-white" />
                <p className="text-xs text-white">No tienes eliminatorias en curso guardadas.</p>
              </div>
            ) : (
              drafts.map((dr) => (
                <div
                  key={dr.uid}
                  className="bg-[#0D1017] border border-white/[0.08] rounded-2xl p-3.5 flex justify-between items-center hover:border-cyan-neon/30 transition-all duration-150"
                >
                  <div className="flex flex-col gap-1 w-[68%]">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-white text-xs font-bold truncate">vs {dr.opponent}</span>
                      <span className="text-[8px] px-1.5 py-0.5 rounded bg-[#080A0F] border border-white/[0.06] text-cyan-neon font-extrabold uppercase shrink-0">
                        {dr.bowConfig?.type === "Recurve" ? "Recurvo" : dr.bowConfig?.type === "Compound" ? "Compuesto" : (dr.bowConfig?.type || "Barebow")}
                      </span>
                    </div>
                    <span className="text-[10px] text-white truncate">
                      {dr.opponentClubName} · Set {dr.currentEnd + 1} · {dr.distance} m
                    </span>
                  </div>
                  
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => handleDeleteDraft(dr.uid)}
                      className="h-8 w-8 rounded-xl border border-white/10 hover:border-red-rival/40 text-white hover:text-red-rival flex items-center justify-center cursor-pointer transition active:scale-95"
                      title="Eliminar Duelo"
                    >
                      <Trash2 size={13} />
                    </button>
                    <button
                      onClick={() => {
                        onStartDuel({
                          ...dr.config,
                          id: dr.uid,
                          currentEnd: dr.currentEnd,
                          currentArrow: dr.currentArrow,
                          userTiros: dr.userTiros,
                          rivalTiros: dr.rivalTiros,
                          userSetPoints: dr.userSetPoints,
                          rivalSetPoints: dr.rivalSetPoints,
                          isShootOff: dr.isShootOff,
                          userShootOffShot: dr.userShootOffShot,
                          rivalShootOffShot: dr.rivalShootOffShot,
                          duelFinished: dr.duelFinished,
                          impacts: dr.impacts
                        });
                      }}
                      className="h-8 px-3.5 rounded-xl bg-cyan-neon hover:bg-[#19c8ff] text-black font-black text-[10px] uppercase tracking-wider cursor-pointer transition active:scale-95 flex items-center justify-center whitespace-nowrap"
                    >
                      Reanudar
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {activeTab === "HISTORY" && (
        <div className="flex flex-col gap-4 z-10 flex-1">
          <h4 className="text-white text-xs font-black uppercase tracking-wider pl-1 flex items-center gap-1.5">
            <Trophy size={13} className="text-yellow-gold" />
            Historial de Eliminatorias ({history.length})
          </h4>
          
          <div className="flex flex-col gap-2.5">
            {history.length === 0 ? (
              <div className="bg-[#0D1017] border border-white/[0.06] rounded-2xl p-6 flex flex-col items-center justify-center text-center gap-2">
                <ShieldAlert size={20} className="text-white" />
                <p className="text-xs text-white">No has completado ninguna eliminatoria todavía.</p>
              </div>
            ) : (
              history.map((h) => {
                const flag = COUNTRIES.find((c) => c.code === h.opponentCountry)?.flag || "🇲🇽 MEX";
                return (
                  <div
                    key={h.uid}
                    className="bg-[#0D1017] border border-white/[0.08] rounded-2xl p-3.5 flex justify-between items-center"
                  >
                    <div className="flex flex-col gap-1 w-[70%]">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-white text-xs font-bold truncate">vs {h.opponent} ({flag})</span>
                        <span className="text-[8px] px-1.5 py-0.5 rounded bg-[#080A0F] border border-white/[0.06] text-yellow-gold font-extrabold uppercase shrink-0">
                          {h.bowConfig?.type === "Recurve" ? "Recurvo" : h.bowConfig?.type === "Compound" ? "Compuesto" : (h.bowConfig?.type || "Barebow")}
                        </span>
                      </div>
                      <span className="text-[10px] text-white">
                        Puntos: {h.score} pts · {h.distance} m · {formatMatchDate(h.timestamp)}
                      </span>
                    </div>
                    
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      <span className={`text-[9px] font-black uppercase px-2.5 py-1 rounded-lg border whitespace-nowrap ${
                        h.outcome === "win"
                          ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
                          : h.outcome === "loss"
                          ? "bg-red-500/10 border-red-500/30 text-red-400"
                          : "bg-white/[0.05] border-white/10 text-white"
                      }`}>
                        {h.outcome === "win" ? "Victoria" : h.outcome === "loss" ? "Derrota" : "Empate"}
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
      
      {/* Bottom spacer */}
      <div className="h-6" />

      {/* Generated Invite Modal */}
      <AnimatePresence>
        {generatedInvite && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/90 backdrop-blur-md">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-[#0B0E14] border border-white/[0.1] rounded-3xl p-6 w-full max-w-sm text-center relative shadow-2xl overflow-hidden"
            >
              <div className="absolute top-0 left-0 right-0 h-[3px] flex">
                <div className="flex-1 bg-cyan-neon" />
                <div className="flex-1 bg-red-rival" />
                <div className="flex-1 bg-yellow-gold" />
              </div>

              <div className="relative z-10 flex flex-col items-center">
                <span className="text-[10px] text-emerald-400 font-black tracking-widest uppercase block mb-1">
                  Sala Online Creada
                </span>
                <h3 className="text-white text-base font-black uppercase tracking-wide">
                  Eliminatoria 1 vs 1 en Vivo
                </h3>
                <p className="text-xs text-white mt-1 leading-snug">
                  Comparte este código o enlace con tu rival para que se una a la sala.
                </p>

                {/* Display Invite Code Box */}
                <div className="my-5 bg-[#080A0F] border border-white/[0.1] p-4 rounded-2xl w-full flex flex-col items-center gap-2">
                  <span className="text-[9px] text-white font-bold uppercase tracking-widest">
                    Código Oficial de Sala
                  </span>
                  <span className="text-white text-lg font-mono font-black tracking-widest uppercase">
                    {generatedInvite.code}
                  </span>
                  <span className="text-[10px] text-cyan-neon font-bold">
                    {generatedInvite.bowType === "Recurve" ? "Recurvo" : generatedInvite.bowType === "Compound" ? "Compuesto" : "Barebow"} · {generatedInvite.distance} m
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2 w-full mb-3">
                  <button
                    onClick={async () => {
                      if (typeof navigator !== "undefined" && navigator.share) {
                        try {
                          await navigator.share({
                            title: "Eliminatoria Online 1v1 - Archery 101010",
                            text: generatedInvite.text
                          });
                          return;
                        } catch (e) {
                          // Fallback to direct WhatsApp web/app link if dismissed or failed
                        }
                      }
                      const waUrl = `https://api.whatsapp.com/send?text=${encodeURIComponent(generatedInvite.text)}`;
                      window.open(waUrl, "_blank");
                    }}
                    className="h-10 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-black text-[10px] uppercase tracking-wider cursor-pointer active:scale-95 transition flex items-center justify-center whitespace-nowrap px-2"
                  >
                    Enviar por WhatsApp
                  </button>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(generatedInvite.code);
                      alert("¡Código de sala copiado al portapapeles!");
                    }}
                    className="h-10 rounded-xl bg-white/[0.08] hover:bg-white/[0.14] text-white border border-white/[0.1] font-black text-[10px] uppercase tracking-wider cursor-pointer active:scale-95 transition flex items-center justify-center whitespace-nowrap px-2"
                  >
                    Copiar Código
                  </button>
                </div>

                {/* Start Arena button */}
                <button
                  onClick={() => {
                    const matchConfig = {
                      id: generatedInvite.code,
                      bowType: generatedInvite.bowType,
                      distance: generatedInvite.distance,
                      system: generatedInvite.bowType === "Compound" ? "cumulative" : "set",
                      isCreator: true,
                      rival: {
                        uid: "RIV-FRIEND-PLAYER",
                        fullName: "Desafiante Invitado",
                        country: "CR",
                        clubName: "Oponente Invitado",
                        clubLogo: "0",
                        clubCountry: "CR",
                        rating: 9.0
                      }
                    };

                    setGeneratedInvite(null);
                    onStartDuel(matchConfig);
                  }}
                  className="w-full h-11 rounded-xl bg-cyan-neon hover:bg-[#19c8ff] text-black font-black text-xs uppercase tracking-wider cursor-pointer active:scale-98 transition flex items-center justify-center whitespace-nowrap"
                >
                  Entrar a la Sala de Duelo
                </button>

                <button
                  onClick={() => setGeneratedInvite(null)}
                  className="text-[10px] text-white hover:text-white uppercase font-black tracking-widest mt-4 cursor-pointer"
                >
                  Cerrar
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Challenger waiting overlay modal */}
      <AnimatePresence>
        {sentInvite && (
          <div className="fixed inset-0 z-[99999] bg-black/90 backdrop-blur-md flex items-center justify-center p-4">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="w-full max-w-[320px] bg-[#0A0B0E] border border-white/10 p-6 rounded-3xl flex flex-col gap-4 text-center shadow-2xl relative overflow-hidden"
            >
              <div className="w-12 h-12 rounded-full bg-cyan-neon/10 border border-cyan-neon/30 flex items-center justify-center text-cyan-neon mx-auto mt-2">
                <Target size={20} />
              </div>

              <div className="flex flex-col gap-1.5">
                <span className="text-[9px] text-cyan-neon font-black tracking-widest uppercase">
                  Desafío en Proceso
                </span>
                <h3 className="text-white text-base font-black uppercase tracking-wide">
                  Retando Jugador
                </h3>
              </div>

              <p className="text-[11px] text-white leading-relaxed px-2">
                {inviteStatusMessage}
              </p>

              <div className="flex flex-col gap-2 mt-2">
                <button
                  onClick={async () => {
                    try {
                      const { doc, deleteDoc } = await import("firebase/firestore");
                      const { db } = await import("@/lib/firebase");
                      // Cancel the invitation in Firestore
                      await deleteDoc(doc(db, "duel_invitations", sentInvite.id));
                      
                      // Also clean up the active duel room
                      await deleteDoc(doc(db, "active_duels", sentInvite.roomCode));
                    } catch (err) {
                      console.error("Error cancelling duel invite:", err);
                    } finally {
                      setSentInvite(null);
                    }
                  }}
                  className="w-full py-3 rounded-xl bg-neutral-900 border border-white/10 text-white hover:text-white font-black text-xs uppercase tracking-wider cursor-pointer transition"
                >
                  Cancelar Desafío
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
