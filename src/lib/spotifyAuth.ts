"use client";

import { getLocalSetting, saveLocalSetting } from "@/lib/db/indexedDB";

export interface ConnectedSpotifyAccount {
  username: string;
  displayName: string;
  email?: string;
  avatarUrl?: string;
  product?: "premium" | "free" | "open" | string;
  authMode: "session" | "oauth";
  connectedAt: string;
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
}

export interface SpotifyApiPlaylist {
  id: string;
  name: string;
  description?: string;
  ownerName?: string;
  imageUrl?: string;
  tracksTotal?: number;
}

const SPOTIFY_SCOPES = [
  "streaming",
  "user-read-email",
  "user-read-private",
  "user-read-playback-state",
  "user-modify-playback-state",
  "playlist-read-private",
  "playlist-read-collaborative",
  "user-library-read"
].join(" ");

function generateRandomString(length: number): string {
  const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
  const values = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(values)
    .map((x) => possible[x % possible.length])
    .join("");
}

async function sha256(plain: string): Promise<ArrayBuffer> {
  const encoder = new TextEncoder();
  const data = encoder.encode(plain);
  return window.crypto.subtle.digest("SHA-256", data);
}

function base64UrlEncode(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function getRedirectUri(): string {
  if (typeof window === "undefined") return "";
  return `${window.location.origin}${window.location.pathname}`;
}

export async function getSpotifyClientId(): Promise<string> {
  const envClientId = process.env.NEXT_PUBLIC_SPOTIFY_CLIENT_ID || "";
  if (envClientId.trim()) return envClientId.trim();
  const savedClientId = await getLocalSetting<string>("spotify_oauth_client_id", "");
  return (savedClientId || "").trim();
}

/**
 * Starts the official Spotify OAuth 2.0 Authorization Code with PKCE flow.
 */
export async function startSpotifyOAuthPKCE(customClientId?: string): Promise<void> {
  const clientId = (customClientId || (await getSpotifyClientId())).trim();
  if (!clientId) {
    throw new Error("Falta el Client ID de Spotify OAuth.");
  }

  const codeVerifier = generateRandomString(64);
  const hashed = await sha256(codeVerifier);
  const codeChallenge = base64UrlEncode(hashed);

  await saveLocalSetting("spotify_pkce_verifier", codeVerifier);
  await saveLocalSetting("spotify_oauth_client_id", clientId);

  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    scope: SPOTIFY_SCOPES,
    code_challenge_method: "S256",
    code_challenge: codeChallenge,
    redirect_uri: getRedirectUri(),
    show_dialog: "true"
  });

  window.location.href = `https://accounts.spotify.com/authorize?${params.toString()}`;
}

/**
 * Checks if the current URL contains a `?code=` callback from Spotify OAuth PKCE
 * and exchanges it for an access token, user profile, and playlists.
 */
export async function handleSpotifyOAuthCallbackIfPresent(): Promise<{
  account: ConnectedSpotifyAccount;
  playlists: SpotifyApiPlaylist[];
} | null> {
  if (typeof window === "undefined") return null;

  const url = new URL(window.location.href);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");

  if (error) {
    url.searchParams.delete("error");
    window.history.replaceState({}, document.title, url.toString());
    return null;
  }

  if (!code) return null;

  const codeVerifier = await getLocalSetting<string>("spotify_pkce_verifier", "");
  const clientId = await getSpotifyClientId();

  // Clean URL query params immediately so reloads don't re-trigger
  url.searchParams.delete("code");
  url.searchParams.delete("state");
  window.history.replaceState({}, document.title, url.toString());

  if (!codeVerifier || !clientId) return null;

  try {
    const tokenRes = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams({
        client_id: clientId,
        grant_type: "authorization_code",
        code,
        redirect_uri: getRedirectUri(),
        code_verifier: codeVerifier
      })
    });

    if (!tokenRes.ok) return null;
    const tokenData = await tokenRes.json();
    const accessToken: string = tokenData.access_token;
    const refreshToken: string | undefined = tokenData.refresh_token;
    const expiresIn: number = tokenData.expires_in || 3600;
    const expiresAt = Date.now() + expiresIn * 1000;

    // Fetch user profile
    const profileRes = await fetch("https://api.spotify.com/v1/me", {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    if (!profileRes.ok) return null;
    const profile = await profileRes.json();

    const account: ConnectedSpotifyAccount = {
      username: profile.id || "",
      displayName: profile.display_name || profile.id || "Usuario Spotify",
      email: profile.email,
      avatarUrl: profile.images?.[0]?.url,
      product: profile.product || "premium",
      authMode: "oauth",
      connectedAt: new Date().toISOString(),
      accessToken,
      refreshToken,
      expiresAt
    };

    await saveLocalSetting("spotify_connected_account", account);

    // Fetch user's playlists automatically
    const playlists = await fetchUserSpotifyPlaylists(accessToken);
    return { account, playlists };
  } catch (err) {
    console.warn("Error completing Spotify PKCE callback:", err);
    return null;
  }
}

/**
 * Fetches the authenticated user's personal & followed playlists from Spotify Web API.
 */
export async function fetchUserSpotifyPlaylists(accessToken: string): Promise<SpotifyApiPlaylist[]> {
  try {
    const res = await fetch("https://api.spotify.com/v1/me/playlists?limit=50", {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    if (!res.ok) return [];
    const data = await res.json();
    if (!Array.isArray(data?.items)) return [];

    return data.items
      .filter((item: any) => item && item.id && item.name)
      .map((item: any) => ({
        id: item.id,
        name: item.name,
        description: item.description || "",
        ownerName: item.owner?.display_name || item.owner?.id || "Spotify",
        imageUrl: item.images?.[0]?.url,
        tracksTotal: item.tracks?.total || 0
      }));
  } catch {
    return [];
  }
}

/**
 * Extracts a clean Spotify username from either a raw username/email or a Spotify profile URL
 * (e.g. https://open.spotify.com/user/123456?si=abc -> 123456)
 */
export function extractSpotifyUsername(input: string): string {
  const trimmed = input.trim();
  const match = trimmed.match(/spotify\.com\/(?:intl-[a-zA-Z0-9-]+\/)?user\/([^/?#&\s]+)/i);
  if (match && match[1]) {
    return decodeURIComponent(match[1]);
  }
  const uriMatch = trimmed.match(/^spotify:user:([^:\s]+)$/i);
  if (uriMatch && uriMatch[1]) {
    return uriMatch[1];
  }
  return trimmed.replace(/^@/, "");
}
