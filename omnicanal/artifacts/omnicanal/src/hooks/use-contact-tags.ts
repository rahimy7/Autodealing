import { useClient } from "@/lib/platform";
import { contactTagsForClient } from "@/lib/contact-tags";
export function useContactTags() {
  return contactTagsForClient(useClient().id);
}
