"use server";

import "server-only";

import { type ActionContext, createAction } from "@/lib/actions/action";
import { markAllRead, markRead } from "@/lib/notify";

/** Notification centre: mark one, or clear the whole backlog. */
export const markAllReadAction = createAction({
  revalidate: ["/notifications", "/home", "/"],
  handler: async (_input, { user }: ActionContext) => {
    await markAllRead(user.id);
    return { done: true };
  },
});

export const markReadAction = createAction({
  handler: async (raw, { user }: ActionContext) => {
    const id = Number((raw as { id?: unknown })?.id);
    if (!Number.isFinite(id)) return { done: false };
    await markRead(id, user.id);
    return { done: true };
  },
  revalidate: ["/notifications", "/home", "/"],
});
