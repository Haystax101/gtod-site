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
import type * as budget from "../budget.js";
import type * as chat from "../chat.js";
import type * as coach from "../coach.js";
import type * as coachPrompts from "../coachPrompts.js";
import type * as community from "../community.js";
import type * as content_playbook from "../content/playbook.js";
import type * as content_schemes from "../content/schemes.js";
import type * as conversations from "../conversations.js";
import type * as crons from "../crons.js";
import type * as dev from "../dev.js";
import type * as embeddings from "../embeddings.js";
import type * as http from "../http.js";
import type * as knowledge from "../knowledge.js";
import type * as messages from "../messages.js";
import type * as moderation from "../moderation.js";
import type * as prompt from "../prompt.js";
import type * as retrieval from "../retrieval.js";
import type * as tiers from "../tiers.js";
import type * as timeline from "../timeline.js";
import type * as users from "../users.js";
import type * as vacancies from "../vacancies.js";
import type * as voice from "../voice.js";
import type * as voicePrompts from "../voicePrompts.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  attachments: typeof attachments;
  billing: typeof billing;
  budget: typeof budget;
  chat: typeof chat;
  coach: typeof coach;
  coachPrompts: typeof coachPrompts;
  community: typeof community;
  "content/playbook": typeof content_playbook;
  "content/schemes": typeof content_schemes;
  conversations: typeof conversations;
  crons: typeof crons;
  dev: typeof dev;
  embeddings: typeof embeddings;
  http: typeof http;
  knowledge: typeof knowledge;
  messages: typeof messages;
  moderation: typeof moderation;
  prompt: typeof prompt;
  retrieval: typeof retrieval;
  tiers: typeof tiers;
  timeline: typeof timeline;
  users: typeof users;
  vacancies: typeof vacancies;
  voice: typeof voice;
  voicePrompts: typeof voicePrompts;
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
