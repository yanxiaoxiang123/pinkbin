import { useRef, useState } from 'react';
import { useStore } from '../store';
import { uid } from '../chatUtils';

export interface PendingImage {
  id: string;
  name: string;
  dataUrl: string;
  mimeType: string;
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(r.error);
    r.onload = () => resolve(r.result as string);
    r.readAsDataURL(file);
  });
}

const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|heic|heif|bmp|svg)$/i;

export function useImageDrop() {
  const pushTurn = useStore((s) => s.pushChatTurn);
  const [pendingImages, setPendingImages] = useState<PendingImage[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const addImageFile = async (file: File) => {
    const looksLikeImage = file.type.startsWith('image/') || IMAGE_EXT_RE.test(file.name);
    if (!looksLikeImage) return;
    if (file.size > 20 * 1024 * 1024) {
      pushTurn({ id: uid(), role: 'system', text: `图片 ${file.name} 太大（>20MB），跳过` });
      return;
    }
    try {
      const dataUrl = await fileToDataUrl(file);
      const mimeType = file.type || 'image/png';
      setPendingImages((prev) => [
        ...prev,
        { id: uid(), name: file.name || 'image', dataUrl, mimeType },
      ]);
    } catch (e) {
      pushTurn({ id: uid(), role: 'system', text: `读取图片失败：${String(e)}` });
    }
  };

  const onPaste = async (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const it of items) {
      if (it.kind === 'file') {
        const f = it.getAsFile();
        if (f) {
          e.preventDefault();
          await addImageFile(f);
        }
      }
    }
  };

  // Checks whether a dropped File list contains images; returns true when it
  // does (caller should stop processing other drop data in that case).
  const handleImageDrop = async (files: FileList | File[]): Promise<boolean> => {
    const imageFiles = Array.from(files).filter((f) =>
      f.type.startsWith('image/') || IMAGE_EXT_RE.test(f.name),
    );
    if (imageFiles.length === 0) return false;
    for (const f of imageFiles) await addImageFile(f);
    return true;
  };

  return {
    pendingImages,
    setPendingImages,
    fileInputRef,
    addImageFile,
    onPaste,
    handleImageDrop,
  };
}