// Board users in Supabase Auth (docs/specs/board-site.md). Sign-ups are off and the board site's
// magic link never creates a user (shouldCreateUser: false), so each board member and the moderator
// gets their auth user here, through the admin API, before their first sign-in. The
// restrict_auth_users_to_board trigger still refuses any address without a board_members row, so the
// seed writes those rows first. Nothing here prints an address.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { BoardMember } from "./env.js";

export interface AuthUserStore {
  /** Every auth user's email, lowercased. */
  listEmails(): Promise<string[]>;
  /** Creates a confirmed user with no password: they sign in by magic link only. */
  createUser(email: string): Promise<void>;
}

export type BoardUsersResult = { existing: number; created: number };

export async function ensureBoardUsers(store: AuthUserStore, members: readonly BoardMember[]): Promise<BoardUsersResult> {
  const known = new Set((await store.listEmails()).map((email) => email.toLowerCase()));
  let created = 0;
  for (const member of members) {
    const email = member.email.toLowerCase();
    if (known.has(email)) continue;
    await store.createUser(email);
    known.add(email);
    created += 1;
  }
  return { existing: members.length - created, created };
}

export const USERS_PAGE = 1000;

export function supabaseAuthUserStore(db: SupabaseClient): AuthUserStore {
  return {
    async listEmails() {
      const emails: string[] = [];
      for (let page = 1; ; page += 1) {
        const { data, error } = await db.auth.admin.listUsers({ page, perPage: USERS_PAGE });
        if (error) throw new Error(`auth users list: ${error.message}`);
        for (const user of data.users) if (user.email) emails.push(user.email.toLowerCase());
        if (data.users.length < USERS_PAGE) return emails;
      }
    },
    async createUser(email) {
      const { error } = await db.auth.admin.createUser({ email, email_confirm: true });
      if (error) throw new Error(`auth user create: ${error.message}`);
    },
  };
}

/** The seed's line: counts only, never an address. */
export function boardUsersLine(result: BoardUsersResult): string {
  return `board users: ${result.existing} already in Supabase Auth, ${result.created} created`;
}
