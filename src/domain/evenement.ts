/**
 * The WordPress side of the sync: the `evenement` post type with its Pods fields.
 * Field names are Dutch because they are owned by the website, not by this Worker.
 */

/** Pods datetime format: `YYYY-MM-DD HH:MM:SS` in the site's timezone. */
export type PodsDateTime = string;

/** Pods yes/no field. Write `1`/`0`; reads back as `"1"`, `"0"`, or `[]` when never set. */
export type PodsBoolean = 0 | 1;

/** Everything the sync writes to an `evenement` post (core fields + Pods fields). */
export type EvenementPayload = {
  title: string;
  status: "publish" | "private" | "draft";
  datum: PodsDateTime;
  einddatum: PodsDateTime;
  locatie: string;
  spacebring_link: string;
  omschrijving: string;
  spacebring_id: string;
  geannuleerd: PodsBoolean;
  afbeelding: string;
};

/** What comes back when reading an `evenement` post. */
export type EvenementPost = {
  id: number;
  slug: string;
  status: string;
  link: string;
  title: { rendered: string; raw?: string };
  modified_gmt: string;
  datum: string;
  einddatum: string;
  locatie: string;
  spacebring_link: string;
  omschrijving: string;
  spacebring_id: string;
  geannuleerd: "1" | "0" | "" | [];
  afbeelding: string;
};
