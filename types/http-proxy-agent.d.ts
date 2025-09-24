declare module "http-proxy-agent" {
  import type { Agent } from "http";
  interface HttpProxyAgentOptions {
    [key: string]: unknown;
  }

  export class HttpProxyAgent<T extends string | URL | HttpProxyAgentOptions = string> extends Agent {
    constructor(proxy: T);
  }
}
