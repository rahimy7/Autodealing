import { useEffect, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

// Shows a person's profile photo — a contact's or a team member's — falling back
// to the first letter of their name.
//
// The photos come from Meta (see fetchSenderProfile): those urls are signed and
// expire, so a stored avatar eventually stops loading. `onError` is what keeps
// that from leaving a broken image in the list — the circle just goes back to the
// initial, which is also what internal/demo contacts without a photo show.
//
// Sizing, shape, background and text colour stay with the caller via `className`
// (the photo follows the container's rounding), so each screen keeps its own
// look. `fallback` replaces the initial when a screen has a better placeholder,
// such as a virtual agent's icon. `children` is for overlays such as the channel
// badge, and is intentionally outside the clipped image.
export default function ContactAvatar({
  name,
  avatar,
  fallback,
  className,
  children,
}: {
  name?: string | null;
  avatar?: string | null;
  fallback?: ReactNode;
  className?: string;
  children?: ReactNode;
}) {
  const [failed, setFailed] = useState(false);

  // A different contact — or a refreshed url for the same one — deserves a new attempt.
  useEffect(() => setFailed(false), [avatar]);

  const initial = name?.trim().charAt(0).toUpperCase() || "?";
  const showPhoto = Boolean(avatar) && !failed;

  return (
    <div className={cn("rounded-full flex items-center justify-center flex-shrink-0 relative", className)}>
      {showPhoto ? (
        <img
          src={avatar ?? undefined}
          alt={name ?? "Contacto"}
          loading="lazy"
          onError={() => setFailed(true)}
          className="absolute inset-0 w-full h-full rounded-[inherit] object-cover"
        />
      ) : (
        (fallback ?? initial)
      )}
      {children}
    </div>
  );
}
