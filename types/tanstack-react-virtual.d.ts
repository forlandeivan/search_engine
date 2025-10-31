declare module "@tanstack/react-virtual" {
  export type VirtualItem = {
    key: number | string;
    index: number;
    start: number;
    size: number;
  };

  export type UseVirtualizerReturn = {
    getVirtualItems(): VirtualItem[];
    getTotalSize(): number;
    scrollToIndex(index: number, options?: Record<string, unknown>): void;
  } & Record<string, unknown>;

  export function useVirtualizer(options: Record<string, unknown>): UseVirtualizerReturn;
}
