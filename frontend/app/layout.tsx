import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import FirebaseAnalytics from "@/components/FirebaseAnalytics";
import AbortErrorSuppressor from "@/components/AbortErrorSuppressor";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap"
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap"
});

export const metadata: Metadata = {
  title: "RailMind — Operator Control Room",
  description:
    "A live digital twin of a railway corridor with AI conflict prediction and re-optimization."
};

export default function RootLayout({
  children
}: {
  children: React.ReactNode;
}) {
  // Runs before Next.js's dev runtime registers its error handlers, so our
  // capture-phase listeners win and benign Mapbox aborts never reach the overlay
  // (incl. the first style/satellite switch). Mirrors AbortErrorSuppressor.
  const earlyAbortGuard = `(function(){function m(e){if(!e)return false;try{return /abort/i.test((e.name||'')+' '+(e.message||'')+' '+String(e)+' '+(e.stack||''))}catch(x){return false}}
addEventListener('error',function(ev){if(m(ev.error)||/abort/i.test(ev.message||'')){ev.preventDefault();ev.stopImmediatePropagation()}},true);
addEventListener('unhandledrejection',function(ev){if(m(ev.reason)){ev.preventDefault();ev.stopImmediatePropagation()}},true);
if(!window.__railmindOrigRAF){window.__railmindOrigRAF=window.requestAnimationFrame.bind(window)}var o=window.__railmindOrigRAF;window.requestAnimationFrame=function(c){return o(function(t){try{c(t)}catch(e){if(!m(e))throw e}})};
var oe=console.error.bind(console);console.error=function(){for(var i=0;i<arguments.length;i++){var a=arguments[i];if(m(a)||(a&&/abort/i.test(String(a.message||a))))return}return oe.apply(console,arguments)};})();`;
  return (
    <html lang="en" className={`${inter.variable} ${mono.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: earlyAbortGuard }} />
      </head>
      <body className="bg-base text-text font-sans antialiased">
        <AbortErrorSuppressor />
        <FirebaseAnalytics />
        {children}
      </body>
    </html>
  );
}
