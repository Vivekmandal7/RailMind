"use client";
import { useEffect } from "react";
import { getFirebaseAnalytics } from "@/lib/firebase";

/** Initializes Firebase Analytics once on the client (no-op if config missing). */
export default function FirebaseAnalytics() {
  useEffect(() => {
    getFirebaseAnalytics().catch(() => {});
  }, []);
  return null;
}
