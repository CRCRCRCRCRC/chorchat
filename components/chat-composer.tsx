"use client";

/* eslint-disable @next/next/no-img-element */

import { ImagePlus, Send, X } from "lucide-react";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { getReplyPreview } from "@/lib/messages";
import type { Message } from "@/lib/types";

export type ComposerPayload = {
  text: string;
  files: File[];
};

type ChatComposerProps = {
  isSending: boolean;
  replyTo: Message | null;
  editing: Message | null;
  editingLabel: string | null;
  onCancelReply: () => void;
  onCancelEdit: () => void;
  onTypingActivity: (isTyping: boolean) => void;
  onSubmit: (payload: ComposerPayload) => Promise<void>;
};

const MAX_SELECTED_IMAGES = 30;

export function ChatComposer({
  isSending,
  replyTo,
  editing,
  editingLabel,
  onCancelReply,
  onCancelEdit,
  onTypingActivity,
  onSubmit
}: ChatComposerProps) {
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [previewItems, setPreviewItems] = useState<Array<{ file: File; url: string }>>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (editing) {
      setText(editing.text ?? "");
      setFiles([]);
    }
  }, [editing]);

  useEffect(() => {
    return () => onTypingActivity(false);
  }, [onTypingActivity]);

  useEffect(() => {
    const nextPreviewItems = files.map((selectedFile) => ({
      file: selectedFile,
      url: URL.createObjectURL(selectedFile)
    }));

    setPreviewItems(nextPreviewItems);

    return () => {
      nextPreviewItems.forEach((item) => URL.revokeObjectURL(item.url));
    };
  }, [files]);

  const canSubmit = useMemo(() => Boolean(text.trim() || files.length > 0) && !isSending, [files.length, isSending, text]);

  function addFiles(nextFiles: File[]) {
    if (editing || nextFiles.length === 0) {
      return;
    }

    setFiles((currentFiles) => {
      const imageFiles = nextFiles.filter((nextFile) => nextFile.type.startsWith("image/"));
      return [...currentFiles, ...imageFiles].slice(0, MAX_SELECTED_IMAGES);
    });
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!canSubmit) {
      return;
    }

    const submittedText = text.trim();
    const submittedFiles = files;

    setText("");
    setFiles([]);
    onTypingActivity(false);

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }

    await onSubmit({
      text: submittedText,
      files: submittedFiles
    });
  }

  return (
    <footer className="border-t border-line bg-white px-3 py-3 sm:px-5">
      <div className="mx-auto max-w-5xl">
        {replyTo ? (
          <div className="mb-2 flex items-center justify-between gap-3 rounded-lg border border-line bg-slate-50 px-3 py-2">
            <div className="min-w-0 text-sm">
              <p className="font-medium text-slate-800">正在回覆</p>
              <p className="truncate text-slate-500">{getReplyPreview(replyTo)}</p>
            </div>
            <button
              type="button"
              onClick={onCancelReply}
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-slate-500 hover:bg-white hover:text-slate-900"
              aria-label="取消回覆"
            >
              <X size={17} />
            </button>
          </div>
        ) : null}

        {editing ? (
          <div className="mb-2 flex items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
            <div className="min-w-0 text-sm">
              <p className="font-medium text-amber-900">正在編輯訊息</p>
              <p className="truncate text-amber-700">{editingLabel}</p>
            </div>
            <button
              type="button"
              onClick={() => {
                setText("");
                onCancelEdit();
              }}
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-amber-700 hover:bg-white hover:text-amber-950"
              aria-label="取消編輯"
            >
              <X size={17} />
            </button>
          </div>
        ) : null}

        {previewItems.length > 0 ? (
          <div className="mb-2 rounded-lg border border-line bg-slate-50 p-2">
            <div className="mb-2 flex items-center justify-between gap-3 text-sm text-slate-600">
              <p>
                已選擇 {previewItems.length} 張圖片
                {text.trim() ? "，文字與圖片會分開傳送" : ""}
              </p>
              <button
                type="button"
                onClick={() => {
                  setFiles([]);

                  if (fileInputRef.current) {
                    fileInputRef.current.value = "";
                  }
                }}
                className="rounded-md px-2 py-1 text-slate-500 hover:bg-white hover:text-slate-900"
              >
                全部移除
              </button>
            </div>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {previewItems.map((item, index) => (
                <div key={`${item.file.name}-${item.file.lastModified}-${index}`} className="relative h-20 w-20 shrink-0">
                  <img
                    src={item.url}
                    alt="待傳送圖片預覽"
                    className="h-20 w-20 rounded-md bg-white object-contain"
                    decoding="async"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      setFiles((currentFiles) => currentFiles.filter((_, fileIndex) => fileIndex !== index));

                      if (fileInputRef.current) {
                        fileInputRef.current.value = "";
                      }
                    }}
                    className="absolute right-1 top-1 inline-flex h-6 w-6 items-center justify-center rounded-md bg-black/60 text-white hover:bg-black/75"
                    aria-label="移除圖片"
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        <form onSubmit={handleSubmit} className="flex items-end gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="sr-only"
            disabled={Boolean(editing) || isSending}
            onChange={(event) => {
              addFiles(Array.from(event.target.files ?? []));
              event.currentTarget.value = "";
            }}
          />

          <button
            type="button"
            disabled={Boolean(editing) || isSending}
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-line text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            aria-label="上傳圖片"
          >
            <ImagePlus size={20} />
          </button>

          <textarea
            value={text}
            onChange={(event) => {
              setText(event.target.value);
              onTypingActivity(!editing && Boolean(event.target.value.trim()));
            }}
            onPaste={(event) => {
              if (editing) {
                return;
              }

              const pastedImages = Array.from(event.clipboardData.items)
                .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
                .map((item) => item.getAsFile())
                .filter((item): item is File => Boolean(item));

              if (pastedImages.length > 0) {
                addFiles(pastedImages);
              }
            }}
            rows={1}
            placeholder={editing ? "修改訊息內容" : "輸入訊息"}
            className="max-h-36 min-h-11 flex-1 resize-none rounded-lg border border-line bg-slate-50 px-4 py-3 text-base leading-5 outline-none transition placeholder:text-slate-400 focus:border-brand focus:bg-white focus:ring-4 focus:ring-brand/10"
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
          />

          <button
            type="submit"
            disabled={!canSubmit}
            className="inline-flex h-11 min-w-11 shrink-0 items-center justify-center rounded-md bg-brand px-4 font-semibold text-white transition hover:bg-blue-600 disabled:cursor-not-allowed disabled:bg-slate-300"
            aria-label={editing ? "儲存編輯" : "送出訊息"}
          >
            {isSending ? "..." : <Send size={18} />}
          </button>
        </form>
      </div>
    </footer>
  );
}
