/** Durable Object that holds OAuth grants and the package registry in its SQLite storage, so they survive restarts. */
import { DurableObject } from "cloudflare:workers";
import { createSqlOAuthStore, SqlPackageStore } from "../core/durable-stores";
import { createOAuthServer } from "../core/oauth-server";
import { PackageRegistry } from "../core/package-registry";
import { handleAuthorityCall, type AuthorityBackend, type AuthorityCall, type AuthorityReply } from "./authority-api";
import type { Env } from "./env.js";

export class AuthorityController extends DurableObject<Env> {
  private readonly backend: AuthorityBackend;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const sql = ctx.storage.sql;
    this.backend = {
      oauth: createOAuthServer({ store: createSqlOAuthStore(sql) }),
      registry: new PackageRegistry(new SqlPackageStore(sql)),
    };
  }

  call(input: AuthorityCall): Promise<AuthorityReply> {
    return handleAuthorityCall(this.backend, input);
  }
}
