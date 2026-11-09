import { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useAudioPlayer, useAudioPlayerStatus, setAudioModeAsync } from "expo-audio";
import { colors, radius, spacing } from "../theme";
import { API_URL } from "../lib/config";
import { useAuth } from "../lib/auth";

function secondsLabel(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const total = Math.floor(seconds);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/**
 * Voice-note player. `/api/media/<file>` is behind the session token, so the URL
 * is absolutised and the Authorization header travels with the media request —
 * the same reason the web player fetches the audio itself instead of handing the
 * path to an <audio> tag.
 */
export function AudioBubble({ url, tint }: { url: string; tint: string }) {
  const { token } = useAuth();
  const [failed, setFailed] = useState(false);

  const source = useMemo(
    () => ({
      uri: url.startsWith("http") ? url : `${API_URL}${url}`,
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    }),
    [url, token],
  );

  const player = useAudioPlayer(source);
  const status = useAudioPlayerStatus(player);

  useEffect(() => {
    // Voice notes must be audible with the phone on silent, like WhatsApp's.
    setAudioModeAsync({ playsInSilentMode: true }).catch(() => {});
  }, []);

  useEffect(() => {
    if (status.didJustFinish) player.seekTo(0);
  }, [status.didJustFinish, player]);

  if (failed) {
    return (
      <View style={styles.row}>
        <Ionicons name="mic-off" size={14} color={tint} />
        <Text style={[styles.failed, { color: tint }]}>Audio no disponible</Text>
      </View>
    );
  }

  const duration = status.duration ?? 0;
  const position = status.currentTime ?? 0;
  const progress = duration > 0 ? Math.min(position / duration, 1) : 0;

  return (
    <View style={styles.row}>
      <Pressable
        onPress={() => {
          try {
            if (status.playing) player.pause();
            else player.play();
          } catch {
            setFailed(true);
          }
        }}
        style={[styles.playButton, { borderColor: tint }]}
      >
        <Ionicons name={status.playing ? "pause" : "play"} size={14} color={tint} />
      </Pressable>

      <View style={styles.trackWrapper}>
        <View style={[styles.track, { backgroundColor: `${tint}33` }]}>
          <View style={[styles.fill, { width: `${progress * 100}%`, backgroundColor: tint }]} />
        </View>
      </View>

      <Text style={[styles.duration, { color: tint }]}>
        {secondsLabel(status.playing || position > 0 ? position : duration)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: 4, minWidth: 180 },
  playButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  trackWrapper: { flex: 1 },
  track: { height: 4, borderRadius: radius.pill, overflow: "hidden" },
  fill: { height: 4, borderRadius: radius.pill },
  duration: { fontSize: 11, fontVariant: ["tabular-nums"] },
  failed: { fontSize: 12 },
});
