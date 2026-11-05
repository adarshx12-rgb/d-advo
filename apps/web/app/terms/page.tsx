import type { Metadata } from "next";
import { LegalPage } from "@/components/shell/legal-page";

export const metadata: Metadata = { title: "Terms", description: "The rules for using Hybrid Party Show and buying content." };

export default function TermsPage() {
  return (
    <LegalPage
      title="Terms"
      updated="{{date}}"
      sections={[
        {
          heading: "Who runs the service",
          body: ["Hybrid Party Show is operated by {{company name}}, {{registered address}}. These terms are governed by the laws of {{jurisdiction}}."],
        },
        {
          heading: "Playing fair",
          body: [
            "Be kind to the people in your room. Hosts can remove players, and anyone can report a prompt. Do not use display names to harass or impersonate others.",
            "Adult prompts are only for players who are 18 or older and have opted in. Confirming your age when you are not is a breach of these terms.",
          ],
        },
        {
          heading: "Purchases",
          body: [
            "Prices are shown in Indian rupees and charged by Razorpay. Packs, themes and streamer branding belong to the account that bought them. Packs can be used by everyone in rooms that account hosts.",
            "Nothing for sale affects scores, timers or the outcome of a match.",
            "Refunds: {{refund policy}}.",
          ],
        },
        {
          heading: "Content",
          body: ["All prompts are original to Hybrid Party Show. You may stream and record your matches."],
        },
      ]}
    />
  );
}
