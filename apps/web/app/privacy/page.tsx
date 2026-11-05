import type { Metadata } from "next";
import { LegalPage } from "@/components/shell/legal-page";

export const metadata: Metadata = { title: "Privacy", description: "What Hybrid Party Show stores, for how long, and why." };

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy"
      updated="{{date}}"
      sections={[
        {
          heading: "Playing without an account",
          body: [
            "Players need only a display name and an avatar. Your browser keeps a random session key so you can rejoin your seat if you disconnect. The server stores only a hash of that key, never the key itself.",
            "Answers you give during a match stay on the game server while the match runs. Other players see them only at the reveal for that round. Answers marked to keep out of evidence are never shown again after their reveal.",
          ],
        },
        {
          heading: "Host accounts",
          body: [
            "Hosts who sign in give us an email address and a password. Passwords are stored as salted scrypt hashes. We use the account to remember purchases, card themes and streamer branding.",
          ],
        },
        {
          heading: "Match history",
          body: [
            "When a match finishes we keep a summary: display names, final scores, debate and bluff outcomes, and which prompts were used. This lets us balance content and investigate reports.",
          ],
        },
        {
          heading: "Payments",
          body: [
            "Card details are handled by Razorpay and never reach our servers. We keep the order, amount, status and receipt number for each purchase.",
          ],
        },
        {
          heading: "Microphones and cameras",
          body: ["The game never asks for microphone or camera access. Debates happen out loud in the room, and no audio is captured or stored."],
        },
        {
          heading: "Contact",
          body: ["Questions about your data go to {{privacy contact email}}."],
        },
      ]}
    />
  );
}
