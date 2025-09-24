declare module "https-proxy-agent" {
  import type { Agent } from "https";
  interface HttpsProxyAgentOptions {
    [key: string]: unknown;
  }

  export class HttpsProxyAgent<T extends string | URL | HttpsProxyAgentOptions = string> extends Agent {
    constructor(proxy: T);
  }
}
