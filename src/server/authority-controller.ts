/** Durable Object that holds OAuth grants and the package registry in its SQLite storage, so they survive restarts. */
import { DurableObject } from "cloudflare:workers";
import { createSqlOAuthStore, SqlPackageStore } from "../core/durable-stores";
import { createOAuthServer } from "../core/oauth-server";
import { handleNpmRegistryCall, type NpmRegistryCall } from "./npm-registry";
import { PackageRegistry } from "../core/package-registry";
import { handleAuthorityCall, type AuthorityBackend, type AuthorityCall, type AuthorityReply } from "./authority-api";
import {accountKeyFor, accountOf, projectOf} from "./projects.js";
import type { Env } from "./env.js";

import {createOciStore} from "../core/oci-store";
import {handleOciRegistryCall,type OciRegistryCall} from "./oci-registry";

export class AuthorityController extends DurableObject<Env> {
  private readonly oci;
  private registryQueue: Promise<unknown> = Promise.resolve();
  private serializeRegistry<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.registryQueue.then(operation);
    this.registryQueue = result.catch(() => undefined);
    return result;
  }
  private readonly backend: AuthorityBackend;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const sql = ctx.storage.sql;
    this.oci = createOciStore(sql);
    this.backend = {
      oauth: createOAuthServer({ store: createSqlOAuthStore(sql), isUserActive: async userId => await accountOf(env, await accountKeyFor(userId)).accountLifecycle() === "active", canAccessRepository: async (userId, repositoryId) => Boolean(await projectOf(env, repositoryId).roleOf(userId)) && !await projectOf(env, repositoryId).repositoryDeletionPending() }),
      registry: new PackageRegistry(new SqlPackageStore(sql)),
    };
  }

  npmCall(input: NpmRegistryCall) { return this.serializeRegistry(() => handleNpmRegistryCall(this.backend.registry, input)); }

  ociCall(input:OciRegistryCall){return this.serializeRegistry(() => handleOciRegistryCall(this.oci,input));}
  introspect(token: string) { return this.backend.oauth.introspect(token); }
  call(input: AuthorityCall): Promise<AuthorityReply> {
    return input.pathname.startsWith("/api/registry/")
      ? this.serializeRegistry(() => handleAuthorityCall(this.backend, input))
      : handleAuthorityCall(this.backend, input);
  }
}
