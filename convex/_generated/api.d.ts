/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as agents from "../agents.js";
import type * as auth from "../auth.js";
import type * as authInternal from "../authInternal.js";
import type * as billing from "../billing.js";
import type * as crons from "../crons.js";
import type * as directLine from "../directLine.js";
import type * as forum from "../forum.js";
import type * as http from "../http.js";
import type * as lib_crypto from "../lib/crypto.js";
import type * as lib_handles from "../lib/handles.js";
import type * as lib_universities from "../lib/universities.js";
import type * as lib_years from "../lib/years.js";
import type * as missions from "../missions.js";
import type * as rooms from "../rooms.js";
import type * as settings from "../settings.js";
import type * as stories from "../stories.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  agents: typeof agents;
  auth: typeof auth;
  authInternal: typeof authInternal;
  billing: typeof billing;
  crons: typeof crons;
  directLine: typeof directLine;
  forum: typeof forum;
  http: typeof http;
  "lib/crypto": typeof lib_crypto;
  "lib/handles": typeof lib_handles;
  "lib/universities": typeof lib_universities;
  "lib/years": typeof lib_years;
  missions: typeof missions;
  rooms: typeof rooms;
  settings: typeof settings;
  stories: typeof stories;
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
