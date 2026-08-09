import type { Metadata } from "next";
import ScoutClient from "./ScoutClient";

export const metadata: Metadata = {
  title: "Forkyssey — Discover your next upstream quest",
  description:
    "A live, evidence-first open-source contribution scout with duplicate-work checks, maintainer signals, and cited investigation briefs.",
};

export default function Home() {
  return <ScoutClient />;
}
