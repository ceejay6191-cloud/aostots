import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

const db = supabase as any;

type PresenceUser = { id: string; name: string; color: string };

function colorForUser(id: string) {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash * 31 + id.charCodeAt(i)) % 360;
  }
  return `hsl(${hash} 70% 50%)`;
}

function parsePresence(state: Record<string, any>) {
  const next: Record<string, PresenceUser> = {};
  Object.values(state).forEach((entries: any) => {
    const entry = Array.isArray(entries) ? entries[0] : entries;
    if (!entry?.userId) return;
    next[entry.userId] = {
      id: entry.userId,
      name: entry.name ?? "User",
      color: entry.color ?? colorForUser(entry.userId),
    };
  });
  return next;
}

export function useProjectPresence(
  projectId?: string | null,
  options?: { observeOnly?: boolean; enabled?: boolean }
) {
  const { user } = useAuth();
  const [presence, setPresence] = useState<Record<string, PresenceUser>>({});
  const observerKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!projectId || options?.enabled === false) return;
    const presenceKey =
      user?.id ??
      (observerKeyRef.current ??= `observer-${Math.random().toString(16).slice(2)}`);

    const channel = db.channel(`project-presence-${projectId}`, {
      config: { presence: { key: presenceKey } },
    });

    channel.on("presence", { event: "sync" }, () => {
      const state = channel.presenceState?.() ?? {};
      setPresence(parsePresence(state));
    });

    channel.subscribe((status: string) => {
      if (status !== "SUBSCRIBED") return;
      if (!options?.observeOnly && user?.id) {
        channel.track({
          userId: user.id,
          name: user.email ?? "User",
          color: colorForUser(user.id),
        });
      }
    });

    return () => {
      setPresence({});
      db.removeChannel(channel);
    };
  }, [projectId, options?.observeOnly, options?.enabled, user?.id, user?.email]);

  return presence;
}

export function useProjectsPresence(projectIds: string[]) {
  const { user } = useAuth();
  const [presenceByProject, setPresenceByProject] = useState<
    Record<string, Record<string, PresenceUser>>
  >({});
  const channelsRef = useRef<Record<string, any>>({});
  const observerKeyRef = useRef<string | null>(null);
  const idsKey = useMemo(() => projectIds.slice().sort().join("|"), [projectIds]);

  useEffect(() => {
    const presenceKey =
      user?.id ??
      (observerKeyRef.current ??= `observer-${Math.random().toString(16).slice(2)}`);
    const nextIds = new Set(projectIds);

    for (const id of Object.keys(channelsRef.current)) {
      if (!nextIds.has(id)) {
        db.removeChannel(channelsRef.current[id]);
        delete channelsRef.current[id];
        setPresenceByProject((prev) => {
          const next = { ...prev };
          delete next[id];
          return next;
        });
      }
    }

    for (const projectId of projectIds) {
      if (channelsRef.current[projectId]) continue;
      const channel = db.channel(`project-presence-${projectId}`, {
        config: { presence: { key: presenceKey } },
      });
      channel.on("presence", { event: "sync" }, () => {
        const state = channel.presenceState?.() ?? {};
        const parsed = parsePresence(state);
        setPresenceByProject((prev) => ({ ...prev, [projectId]: parsed }));
      });
      channel.subscribe();
      channelsRef.current[projectId] = channel;
    }

    return () => {
      for (const id of Object.keys(channelsRef.current)) {
        db.removeChannel(channelsRef.current[id]);
      }
      channelsRef.current = {};
      setPresenceByProject({});
    };
  }, [idsKey, user?.id]);

  return presenceByProject;
}
