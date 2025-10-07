declare module "passport-yandex" {
  import type { Strategy as PassportStrategy } from "passport";

  export interface YandexProfile extends Record<string, unknown> {
    id: string;
    displayName?: string;
    name?: {
      familyName?: string;
      givenName?: string;
      middleName?: string;
    };
    emails?: Array<{ value?: string; type?: string }>;
    photos?: Array<{ value?: string }>;
    _json?: {
      id?: string;
      default_email?: string;
      emails?: Array<{ value?: string; default?: boolean; primary?: boolean }>;
      real_name?: string;
      first_name?: string;
      last_name?: string;
      display_name?: string;
      is_avatar_empty?: boolean;
      default_avatar_id?: string;
      is_email_verified?: boolean;
      default_phone?: { number?: string };
    } & Record<string, unknown>;
  }

  export interface StrategyOptions {
    clientID: string;
    clientSecret: string;
    callbackURL: string;
  }

  export type VerifyCallback = (
    err?: Error | null,
    user?: Express.User | false,
    info?: unknown,
  ) => void;

  export interface VerifyFunction {
    (
      accessToken: string,
      refreshToken: string,
      profile: YandexProfile,
      done: VerifyCallback,
    ): void;
  }

  export class Strategy extends PassportStrategy {
    constructor(options: StrategyOptions, verify: VerifyFunction);
    name: "yandex";
  }
}
