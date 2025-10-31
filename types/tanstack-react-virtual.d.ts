declare module "@tanstack/react-virtual" {
  export interface VirtualItem {
    key: number;
    index: number;
    start: number;
    size: number;
  }

  export interface ScrollToIndexOptions {
    align?: "auto" | "start" | "center" | "end";
  }

  export interface VirtualizerOptions<TScrollElement extends Element | Window, TItemElement extends Element> {
    count: number;
    estimateSize: (index: number) => number;
    getScrollElement: () => TScrollElement | null;
    overscan?: number;
  }

  export interface Virtualizer<TScrollElement extends Element | Window, TItemElement extends Element> {
    getVirtualItems(): VirtualItem[];
    getTotalSize(): number;
    scrollToIndex: (index: number, options?: ScrollToIndexOptions) => void;
  }

  export function useVirtualizer<TScrollElement extends Element | Window, TItemElement extends Element>(
    options: VirtualizerOptions<TScrollElement, TItemElement>,
  ): Virtualizer<TScrollElement, TItemElement>;
}
