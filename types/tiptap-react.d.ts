import type * as React from "react";

declare module "@tiptap/react" {
  export const EditorContent: React.ComponentType<any>;
  export function useEditor(options?: any): any;
}
