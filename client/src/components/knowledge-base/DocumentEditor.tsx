import { useEffect } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { Button } from "@/components/ui/button";
import { Toggle } from "@/components/ui/toggle";
import { Separator } from "@/components/ui/separator";
import type { LucideIcon } from "lucide-react";
import {
  Bold,
  Heading1,
  Heading2,
  Heading3,
  Italic,
  ListOrdered,
  List
} from "lucide-react";
import { cn } from "@/lib/utils";

interface DocumentEditorProps {
  value: string;
  onChange: (value: string) => void;
}

const headingLevels = [
  { level: 1, icon: Heading1, label: "Заголовок 1" },
  { level: 2, icon: Heading2, label: "Заголовок 2" },
  { level: 3, icon: Heading3, label: "Заголовок 3" }
] satisfies Array<{ level: 1 | 2 | 3; icon: LucideIcon; label: string }>;

export function DocumentEditor({ value, onChange }: DocumentEditorProps) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: {
          levels: [1, 2, 3]
        }
      }),
      Placeholder.configure({
        placeholder: "Начните писать документ..."
      })
    ],
    content: value || "<p></p>",
    editorProps: {
      attributes: {
        class:
          "prose prose-sm max-w-none dark:prose-invert min-h-[18rem] focus:outline-none"
      }
    },
    onUpdate: ({ editor }: { editor: any }) => {
      onChange(editor.getHTML());
    }
  });

  useEffect(() => {
    if (!editor) {
      return;
    }

    const current = editor.getHTML();
    if (value !== current) {
      editor.commands.setContent(value || "<p></p>", false);
    }
  }, [editor, value]);

  if (!editor) {
    return null;
  }

  return (
    <div className="flex h-full flex-col rounded-lg border bg-background">
      <div className="flex flex-wrap items-center gap-1 border-b bg-muted/40 px-2 py-2 text-muted-foreground">
        <Toggle
          size="sm"
          pressed={editor.isActive("bold")}
          onPressedChange={() => editor.chain().focus().toggleBold().run()}
          aria-label="Полужирный"
        >
          <Bold className="h-4 w-4" />
        </Toggle>
        <Toggle
          size="sm"
          pressed={editor.isActive("italic")}
          onPressedChange={() => editor.chain().focus().toggleItalic().run()}
          aria-label="Курсив"
        >
          <Italic className="h-4 w-4" />
        </Toggle>
        <Separator orientation="vertical" className="mx-1 h-6" />
        {headingLevels.map(({ level, icon: Icon, label }) => (
          <Button
            key={level}
            type="button"
            variant={editor.isActive("heading", { level }) ? "secondary" : "ghost"}
            size="sm"
            className={cn("h-8 px-2", editor.isActive("heading", { level }) && "text-primary")}
            onClick={() => editor.chain().focus().toggleHeading({ level }).run()}
          >
            <span className="flex items-center gap-1">
              <Icon className="h-4 w-4" />
              <span className="text-xs">{label}</span>
            </span>
          </Button>
        ))}
        <Separator orientation="vertical" className="mx-1 h-6" />
        <Toggle
          size="sm"
          pressed={editor.isActive("bulletList")}
          onPressedChange={() => editor.chain().focus().toggleBulletList().run()}
          aria-label="Маркированный список"
        >
          <List className="h-4 w-4" />
        </Toggle>
        <Toggle
          size="sm"
          pressed={editor.isActive("orderedList")}
          onPressedChange={() => editor.chain().focus().toggleOrderedList().run()}
          aria-label="Нумерованный список"
        >
          <ListOrdered className="h-4 w-4" />
        </Toggle>
      </div>
      <div className="flex-1 overflow-auto px-4 py-3">
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}

export default DocumentEditor;
