import { describe, expect, it } from "vitest";
import { boardUsersLine, ensureBoardUsers, supabaseAuthUserStore, USERS_PAGE, type AuthUserStore } from "../lib/board-users.js";
import { parseBoardMembers } from "../lib/env.js";

function fakeStore(emails: string[]): AuthUserStore & { created: string[] } {
  const created: string[] = [];
  return {
    created,
    listEmails: () => Promise.resolve([...emails, ...created]),
    createUser: (email) => {
      created.push(email);
      return Promise.resolve();
    },
  };
}

describe("ensureBoardUsers", () => {
  it("creates the moderator's user from MODERATOR_EMAIL and leaves existing board users alone", async () => {
    const members = parseBoardMembers("board@peanutgallery.games", "mod@peanutgallery.games");
    const store = fakeStore(["Board@PeanutGallery.games", "someone-else@example.com"]);
    expect(await ensureBoardUsers(store, members)).toEqual({ existing: 1, created: 1 });
    expect(store.created).toEqual(["mod@peanutgallery.games"]);
    // A second run changes nothing.
    expect(await ensureBoardUsers(store, members)).toEqual({ existing: 2, created: 0 });
    expect(store.created).toEqual(["mod@peanutgallery.games"]);
  });

  it("creates no moderator when MODERATOR_EMAIL is unset", async () => {
    const store = fakeStore([]);
    expect(await ensureBoardUsers(store, parseBoardMembers("board@peanutgallery.games", undefined))).toEqual({ existing: 0, created: 1 });
    expect(store.created).toEqual(["board@peanutgallery.games"]);
  });

  it("prints counts and never an address", () => {
    const line = boardUsersLine({ existing: 1, created: 1 });
    expect(line).toBe("board users: 1 already in Supabase Auth, 1 created");
    expect(line).not.toMatch(/@/);
  });
});

describe("supabaseAuthUserStore", () => {
  it("pages through every user and creates a confirmed user with no password", async () => {
    const calls: unknown[] = [];
    const page = (n: number, count: number) => Array.from({ length: count }, (_, i) => ({ email: `u${n}-${i}@example.com` }));
    const db = {
      auth: {
        admin: {
          listUsers: (args: { page: number; perPage: number }) => {
            calls.push(["list", args]);
            return Promise.resolve({ data: { users: args.page === 1 ? page(1, USERS_PAGE) : page(2, 2) }, error: null });
          },
          createUser: (args: Record<string, unknown>) => {
            calls.push(["create", args]);
            return Promise.resolve({ data: { user: {} }, error: null });
          },
        },
      },
    };
    const store = supabaseAuthUserStore(db as never);
    expect(await store.listEmails()).toHaveLength(USERS_PAGE + 2);
    await store.createUser("mod@peanutgallery.games");
    expect(calls).toEqual([
      ["list", { page: 1, perPage: USERS_PAGE }],
      ["list", { page: 2, perPage: USERS_PAGE }],
      ["create", { email: "mod@peanutgallery.games", email_confirm: true }],
    ]);
  });

  it("fails on an Auth error without naming the address", async () => {
    const db = {
      auth: {
        admin: {
          listUsers: () => Promise.resolve({ data: { users: [] }, error: null }),
          createUser: () => Promise.resolve({ data: null, error: { message: "Signups not allowed for this instance" } }),
        },
      },
    };
    await expect(supabaseAuthUserStore(db as never).createUser("mod@peanutgallery.games")).rejects.toThrow(
      /^auth user create: Signups not allowed for this instance$/,
    );
  });
});
