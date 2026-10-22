import { SignJWT, jwtVerify } from "jose";
import type { Role } from "../../domain.js";

/**
 * Stateless session carried in an httpOnly cookie. httpOnly keeps the token
 * away from page JavaScript (XSS), and a cookie works with EventSource, which
 * can't send an Authorization header.
 */
export interface SessionUser {
  id: string;
  role: Role;
  name: string;
  email: string;
  /** Present for authors only. */
  authorId: string | null;
}

export const SESSION_COOKIE = "bl_session";

export class SessionSigner {
  private readonly key: Uint8Array;

  constructor(
    secret: string,
    private readonly ttlHours: number,
  ) {
    this.key = new TextEncoder().encode(secret);
  }

  get maxAgeMs() {
    return this.ttlHours * 3600 * 1000;
  }

  sign(user: SessionUser): Promise<string> {
    return new SignJWT({ role: user.role, name: user.name, email: user.email, authorId: user.authorId })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(user.id)
      .setIssuedAt()
      .setExpirationTime(`${this.ttlHours}h`)
      .sign(this.key);
  }

  async verify(token: string): Promise<SessionUser | null> {
    try {
      const { payload } = await jwtVerify(token, this.key, { algorithms: ["HS256"] });
      if (!payload.sub || (payload.role !== "AUTHOR" && payload.role !== "ADMIN")) return null;
      return {
        id: payload.sub,
        role: payload.role,
        name: String(payload.name ?? ""),
        email: String(payload.email ?? ""),
        authorId: typeof payload.authorId === "string" ? payload.authorId : null,
      };
    } catch {
      return null;
    }
  }
}
