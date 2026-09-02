/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as attachments from "../attachments.js";
import type * as billing from "../billing.js";
import type * as chat from "../chat.js";
import type * as content_playbook from "../content/playbook.js";
import type * as conversations from "../conversations.js";
import type * as crons from "../crons.js";
import type * as dev from "../dev.js";
import type * as http from "../http.js";
import type * as knowledge from "../knowledge.js";
import type * as messages from "../messages.js";
import type * as prompt from "../prompt.js";
import type * as tiers from "../tiers.js";
import type * as users from "../users.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  attachments: typeof attachments;
  billing: typeof billing;
  chat: typeof chat;
  "content/playbook": typeof content_playbook;
  conversations: typeof conversations;
  crons: typeof crons;
  dev: typeof dev;
  http: typeof http;
  knowledge: typeof knowledge;
  messages: typeof messages;
  prompt: typeof prompt;
  tiers: typeof tiers;
  users: typeof users;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
