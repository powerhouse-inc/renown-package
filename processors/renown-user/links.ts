/** A link as the read model stores it (`renown_user.links`, jsonb). */
export interface StoredLink {
  id: string;
  label: string;
  url: string;
}

/**
 * The links after one link operation, mirroring the renown-user reducer for
 * operations that succeeded (failed ones never reach this function). Returns
 * `undefined` for any other action type.
 */
export function nextLinks(
  links: StoredLink[],
  type: string,
  input: Record<string, unknown>,
): StoredLink[] | undefined {
  switch (type) {
    case "ADD_LINK":
      return [...links, { id: String(input.id), label: String(input.label), url: String(input.url) }];
    case "UPDATE_LINK":
      return links.map((link) =>
        link.id === input.id
          ? {
              id: link.id,
              label: typeof input.label === "string" ? input.label : link.label,
              url: typeof input.url === "string" ? input.url : link.url,
            }
          : link,
      );
    case "REMOVE_LINK":
      return links.filter((link) => link.id !== input.id);
    case "REORDER_LINKS": {
      const ids = Array.isArray(input.linkIds) ? input.linkIds.map(String) : [];
      const front: StoredLink[] = [];
      for (const id of ids) {
        const link = links.find((l) => l.id === id);
        if (link && !front.includes(link)) front.push(link);
      }
      return [...front, ...links.filter((link) => !front.includes(link))];
    }
    default:
      return undefined;
  }
}
