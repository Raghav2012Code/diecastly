"use client";

import { useRef, useState, useTransition } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Star, Trash2 } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import { createClient } from "@/lib/supabase/client";
import { PRODUCT_IMAGE_BUCKET, productImageObjectPath, productImageUrl } from "@/lib/storage";
import type { ProductImageRow } from "@/lib/types/database.types";
import { cn } from "@/lib/utils";
import {
  deleteProductImageAction,
  registerProductImageAction,
  reorderProductImagesAction,
  setPrimaryImageAction,
  updateImageAltAction,
} from "./actions";

const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED = ["image/jpeg", "image/png", "image/webp"];

function validateFile(file: File): string | null {
  if (!ALLOWED.includes(file.type)) return `${file.name}: only JPEG, PNG or WebP images are allowed.`;
  if (file.size > MAX_BYTES) return `${file.name}: images must be 5 MB or smaller.`;
  return null;
}

function storageErrorMessage(message: string): string {
  const lower = message.toLowerCase();
  if (lower.includes("mime") || lower.includes("not supported")) {
    return "Only JPEG, PNG and WebP images are allowed.";
  }
  if (lower.includes("size") || lower.includes("large")) {
    return "Each image must be 5 MB or smaller.";
  }
  return "Upload failed. Please try again.";
}

export function ProductImages({
  productId,
  images,
}: {
  productId: string;
  images: ProductImageRow[];
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [altDrafts, setAltDrafts] = useState<Record<string, string>>({});
  const [pendingDelete, setPendingDelete] = useState<ProductImageRow | null>(null);
  const [, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const router = useRouter();

  async function upload(files: FileList | null) {
    if (!files || files.length === 0) return;
    setError(null);
    setBusy(true);
    const supabase = createClient();
    let added = 0;

    try {
      for (const file of Array.from(files)) {
        const invalid = validateFile(file);
        if (invalid) {
          setError(invalid);
          continue;
        }

        const path = productImageObjectPath(productId, file.name);
        const { error: uploadError } = await supabase.storage
          .from(PRODUCT_IMAGE_BUCKET)
          .upload(path, file, { contentType: file.type, upsert: false });
        if (uploadError) {
          setError(storageErrorMessage(uploadError.message));
          continue;
        }

        const result = await registerProductImageAction({
          productId,
          storagePath: path,
          altText: null,
        });
        if (!result.ok) {
          setError(result.error);
          continue;
        }
        added += 1;
      }

      if (added > 0) {
        toast(added === 1 ? "Image added" : `${added} images added`, "success");
        router.refresh();
      }
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  function move(index: number, direction: -1 | 1) {
    const next = [...images];
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setBusy(true);
    startTransition(async () => {
      const result = await reorderProductImagesAction({
        images: next.map((image, sortOrder) => ({ id: image.id, sortOrder })),
      });
      setBusy(false);
      if (result.ok) {
        toast("Image order saved", "success");
        router.refresh();
      } else {
        toast(result.error, "error");
      }
    });
  }

  function makePrimary(imageId: string) {
    setBusy(true);
    startTransition(async () => {
      const result = await setPrimaryImageAction(productId, imageId);
      setBusy(false);
      if (result.ok) {
        toast("Primary image updated", "success");
        router.refresh();
      } else {
        toast(result.error, "error");
      }
    });
  }

  function confirmDelete() {
    if (!pendingDelete) return;
    const image = pendingDelete;
    setBusy(true);
    startTransition(async () => {
      const result = await deleteProductImageAction(image.id, productId);
      setBusy(false);
      setPendingDelete(null);
      if (result.ok) {
        toast("Image deleted", "success");
        router.refresh();
      } else {
        toast(result.error, "error");
      }
    });
  }

  function saveAlt(imageId: string) {
    const altText = altDrafts[imageId];
    startTransition(async () => {
      const result = await updateImageAltAction({ id: imageId, altText: altText ?? "" });
      if (result.ok) {
        toast("Alt text saved", "success");
        router.refresh();
      } else {
        toast(result.error, "error");
      }
    });
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-3">
        <CardTitle>Images</CardTitle>
        <div className="flex items-center gap-2">
          <label
            htmlFor="product-image-upload"
            aria-disabled={busy}
            className={cn(buttonVariants({ variant: "outline", size: "sm" }), busy && "pointer-events-none opacity-50")}
          >
            {busy ? "Working…" : "Add images"}
          </label>
          <input
            ref={inputRef}
            id="product-image-upload"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            disabled={busy}
            className="sr-only"
            onChange={(event) => upload(event.target.files)}
          />
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-muted-foreground">JPEG, PNG or WebP, up to 5 MB each. The first image becomes primary.</p>

        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}

        {images.length === 0 ? (
          <div className="rounded-md border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
            No images yet. Add a photo so the catalog has something to show.
          </div>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {images.map((image, index) => {
              const url = productImageUrl(image.storage_path);
              return (
                <li key={image.id} className="space-y-2 rounded-md border border-border p-2">
                  <div className="relative aspect-square overflow-hidden rounded-sm bg-secondary">
                    {url ? (
                      <Image
                        src={url}
                        alt={image.alt_text ?? ""}
                        fill
                        sizes="(max-width: 640px) 100vw, 240px"
                        className="object-cover"
                      />
                    ) : null}
                    {image.is_primary ? (
                      <Badge tone="petrol" className="absolute left-2 top-2">
                        Primary
                      </Badge>
                    ) : null}
                  </div>

                  <div className="flex items-center justify-between gap-1">
                    <div className="flex items-center gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label="Move earlier"
                        disabled={busy || index === 0}
                        onClick={() => move(index, -1)}
                      >
                        <ArrowUp />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label="Move later"
                        disabled={busy || index === images.length - 1}
                        onClick={() => move(index, 1)}
                      >
                        <ArrowDown />
                      </Button>
                    </div>
                    <div className="flex items-center gap-1">
                      {!image.is_primary ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label="Make primary"
                          disabled={busy}
                          onClick={() => makePrimary(image.id)}
                        >
                          <Star />
                        </Button>
                      ) : null}
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label="Delete image"
                        disabled={busy}
                        onClick={() => setPendingDelete(image)}
                      >
                        <Trash2 />
                      </Button>
                    </div>
                  </div>

                  <div className="flex items-center gap-1">
                    <Input
                      aria-label="Alt text"
                      value={altDrafts[image.id] ?? image.alt_text ?? ""}
                      placeholder="Describe the image"
                      onChange={(event) =>
                        setAltDrafts((previous) => ({ ...previous, [image.id]: event.target.value }))
                      }
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      onClick={() => saveAlt(image.id)}
                    >
                      Save
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>

      <Modal
        open={Boolean(pendingDelete)}
        onClose={() => setPendingDelete(null)}
        size="sm"
        title="Delete image"
        description="This removes the image from the product and from storage. It cannot be undone."
        footer={
          <>
            <Button variant="outline" onClick={() => setPendingDelete(null)} disabled={busy}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={confirmDelete} disabled={busy}>
              {busy ? "Deleting…" : "Delete image"}
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted-foreground">The product itself and its order history are unaffected.</p>
      </Modal>
    </Card>
  );
}
