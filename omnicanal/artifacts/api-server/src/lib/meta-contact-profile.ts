type Profile = { name: string | null; username: string | null; pictureUrl: string | null };
type ContactIdentity = {
  name: string;
  externalId?: string | null;
  phone?: string | null;
  metaProfileName?: string | null;
  instagramUsername?: string | null;
};

export function normalizeInstagramUsername(value: string | null | undefined): string | null {
  const username = value?.trim().replace(/^@+/, "");
  return username && /^[a-zA-Z0-9._]{1,30}$/.test(username) ? username : null;
}

// A profile change can replace a generated name or our previously synced name,
// but never a name curated by the team. Sender IDs remain the routing identity.
export function metaProfilePatch(contact: ContactIdentity | null, channel: string, profile: Profile) {
  const name = profile.name?.trim() || null;
  const username = channel === "instagram" ? normalizeInstagramUsername(profile.username) : null;
  const patch: { name?: string; metaProfileName?: string; instagramUsername?: string; avatar?: string } = {};
  if (name) patch.metaProfileName = name;
  if (username) patch.instagramUsername = username;
  if (profile.pictureUrl) patch.avatar = profile.pictureUrl;
  const candidate = name || (username ? `@${username}` : null);
  const autoName = !contact || !contact.name?.trim() ||
    /^(Cliente|Comentario)\s/i.test(contact.name) ||
    contact.name === contact.externalId || contact.name === contact.phone ||
    contact.name === contact.metaProfileName ||
    (!!contact.instagramUsername && contact.name.replace(/^@/, "") === contact.instagramUsername);
  if (candidate && autoName) patch.name = candidate;
  return patch;
}
