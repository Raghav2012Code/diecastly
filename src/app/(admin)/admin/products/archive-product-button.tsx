"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { setProductStatusAction } from "./actions";

export function ArchiveProductButton({
  productId,
  productName,
  status,
}: {
  productId: string;
  productName: string;
  status: string;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();
  const router = useRouter();

  const archiving = status !== "archived";
  const nextStatus = archiving ? "archived" : "draft";

  function confirm() {
    startTransition(async () => {
      const result = await setProductStatusAction(productId, nextStatus);
      if (result.ok) {
        toast(archiving ? `${productName} archived` : `${productName} moved to draft`, "success");
        setOpen(false);
        router.refresh();
      } else {
        toast(result.error, "error");
      }
    });
  }

  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        {archiving ? "Archive" : "Unarchive"}
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        size="sm"
        title={archiving ? "Archive product" : "Unarchive product"}
        description={
          archiving
            ? `“${productName}” will be hidden from the storefront and can no longer be sold. Order history keeps its name and SKU.`
            : `“${productName}” will move back to draft so you can review it before making it active.`
        }
        footer={
          <>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button variant={archiving ? "destructive" : "default"} onClick={confirm} disabled={pending}>
              {pending ? "Saving…" : archiving ? "Archive product" : "Unarchive"}
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted-foreground">
          Products are never deleted — their stock ledger and order history stay intact.
        </p>
      </Modal>
    </>
  );
}
