declare module 'turndown-plugin-gfm' {
  import type TurndownService from 'turndown';

  export interface GfmOptions {
    fences?: boolean;
    tables?: boolean;
    strikethrough?: boolean;
    taskListItems?: boolean;
  }

  export function gfm(service: TurndownService, options?: GfmOptions): void;
}
