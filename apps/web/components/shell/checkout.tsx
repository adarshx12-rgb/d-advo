"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CreditCardIcon as CreditCard, FlaskIcon as FlaskConical } from "@phosphor-icons/react/dist/ssr";
import { Button, Dialog, DialogContent } from "@hps/ui";
import { formatInr } from "@hps/shared";
import { api, getUserToken } from "@/lib/session";

interface CheckoutResponse {
  purchaseId: string;
  orderId: string;
  amountPaise: number;
  currency: string;
  mode: "MOCK" | "RAZORPAY";
  productName: string;
  clientData: Record<string, string | number>;
}

declare global {
  interface Window {
    Razorpay?: new (opts: Record<string, unknown>) => { open(): void };
  }
}

function loadRazorpay(): Promise<void> {
  if (window.Razorpay) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://checkout.razorpay.com/v1/checkout.js";
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Could not load the payment window."));
    document.body.appendChild(s);
  });
}

/** Ownership only changes when the server has processed a verified webhook, so we poll for it. */
async function waitForPaid(purchaseId: string, timeoutMs = 60_000): Promise<boolean> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const { purchase } = await api<{ purchase: { status: string } }>(`/api/store/purchases/${purchaseId}`);
    if (purchase.status === "PAID") return true;
    if (purchase.status === "FAILED") return false;
    await new Promise((r) => setTimeout(r, 1500));
  }
  return false;
}

export function BuyButton({ productId, label, onPurchased }: { productId: string; label: string; onPurchased?: () => void }) {
  const router = useRouter();
  const [order, setOrder] = useState<CheckoutResponse | null>(null);
  const [status, setStatus] = useState<"idle" | "working" | "done">("idle");
  const [error, setError] = useState<string | null>(null);

  const start = async () => {
    if (!getUserToken()) {
      router.push(`/account?next=${encodeURIComponent(`/store/${productId}`)}`);
      return;
    }
    setError(null);
    setStatus("working");
    try {
      const o = await api<CheckoutResponse>("/api/store/checkout", { body: { productId } });
      if (o.mode === "MOCK") {
        setOrder(o);
        setStatus("idle");
        return;
      }
      await loadRazorpay();
      const rz = new window.Razorpay!({
        key: o.clientData.keyId,
        order_id: o.orderId,
        amount: o.amountPaise,
        currency: o.currency,
        name: "Hybrid Party Show",
        description: o.productName,
        theme: { color: "#8b6cff" },
        handler: async () => {
          const ok = await waitForPaid(o.purchaseId).catch(() => false);
          setStatus(ok ? "done" : "idle");
          if (ok) onPurchased?.();
          else setError("Payment received by the provider but not yet confirmed. It will appear in your library once confirmed.");
        },
        modal: { ondismiss: () => setStatus("idle") },
      });
      rz.open();
    } catch (e) {
      setError((e as Error).message);
      setStatus("idle");
    }
  };

  const completeMock = async () => {
    if (!order) return;
    setStatus("working");
    try {
      await api("/api/store/mock/complete", { body: { purchaseId: order.purchaseId } });
      const ok = await waitForPaid(order.purchaseId, 10_000);
      setOrder(null);
      setStatus(ok ? "done" : "idle");
      if (ok) onPurchased?.();
    } catch (e) {
      setError((e as Error).message);
      setStatus("idle");
    }
  };

  if (status === "done") return <p className="font-semibold text-teal" data-testid="purchase-done">Unlocked. It is in your library now.</p>;
  return (
    <div className="space-y-2">
      <Button size="lg" onClick={start} disabled={status === "working"} data-testid="buy">
        <CreditCard /> {status === "working" ? "Working…" : label}
      </Button>
      {error && (
        <p role="alert" className="body-6 text-chaos">
          {error}
        </p>
      )}
      <Dialog open={order !== null} onOpenChange={(o) => !o && setOrder(null)}>
        {order && (
          <DialogContent title="Test checkout" description="Development payment mode. No real money moves and this purchase can never count in production.">
            <div className="space-y-4">
              <div className="flex items-center justify-between rounded-xl border border-line bg-stage p-4">
                <span className="font-semibold">{order.productName}</span>
                <span className="tabular heading-4">{formatInr(order.amountPaise)}</span>
              </div>
              <p className="flex items-start gap-2 body-6 text-ink-faint">
                <FlaskConical className="mt-0.5 size-4 shrink-0" /> Pressing pay asks the server to send itself a signed test webhook — the same verification path real payments use.
              </p>
              <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={() => setOrder(null)}>
                  Cancel
                </Button>
                <Button onClick={completeMock} disabled={status === "working"} data-testid="mock-pay">
                  Pay {formatInr(order.amountPaise)} (test)
                </Button>
              </div>
            </div>
          </DialogContent>
        )}
      </Dialog>
    </div>
  );
}
