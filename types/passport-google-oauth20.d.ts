declare module "passport-google-oauth20" {
  import type { Request } from "express";
  import type { Profile as PassportProfile, Strategy as PassportStrategy } from "passport";

  export interface StrategyOptions {
    clientID: string;
    clientSecret: string;
    callbackURL: string;
    passReqToCallback?: false;
  }

  export interface StrategyOptionsWithRequest extends StrategyOptions {
    passReqToCallback: true;
  }

  export interface GoogleProfile extends PassportProfile {
    id: string;
    displayName: string;
    emails?: Array<{ value?: string; verified?: boolean }>;
    name?: {
      familyName?: string;
      givenName?: string;
    };
    photos?: Array<{ value?: string }>;
  }

  export type VerifyCallback = (error: any, user?: any, info?: any) => void;

  export class Strategy extends PassportStrategy {
    constructor(
      options: StrategyOptions,
      verify: (accessToken: string, refreshToken: string, profile: GoogleProfile, done: VerifyCallback) => void,
    );
    constructor(
      options: StrategyOptionsWithRequest,
      verify: (
        req: Request,
        accessToken: string,
        refreshToken: string,
        profile: GoogleProfile,
        done: VerifyCallback,
      ) => void,
    );
    authenticate(req: Request, options?: any): void;
  }

  export { GoogleProfile as Profile };
}
