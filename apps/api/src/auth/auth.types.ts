export type AccessTokenPayload = {
  sub: string;
  sessionId: string;
  roles: string[];
  type: "access";
  iat?: number;
  exp?: number;
};

export type AuthenticatedUser = {
  id: string;
  sessionId: string;
  roles: string[];
};

export type RequestContext = {
  ipAddress?: string | null;
  userAgent?: string | null;
};

export type RequestWithUser = {
  headers: Record<string, string | string[] | undefined>;
  ip?: string;
  originalUrl?: string;
  url?: string;
  get?: (name: string) => string | undefined;
  user?: AuthenticatedUser;
};
